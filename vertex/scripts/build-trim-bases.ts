// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeManifold } from "@/lib/geometry/manifold";
import {
    closestOnCut,
    cutPolyline,
    footprintFrameFromRim,
    TRIM_EXTEND_MM,
    TRIM_SEED_CONTROLS,
    type TrimKind,
} from "@/lib/geometry/procedural-wall/trim-curve";
import { geometryPositions, trimTopToCut, weldExact } from "@/lib/geometry/procedural-wall/trim-mesh";
import { extractMergedGeometry, loadGlbFromBuffer, reorientToFootprintFrame } from "@/lib/library/loaders";

function writeGlb(file: string, pos: Float32Array, idx: Uint32Array) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!;
        const y = pos[i + 1]!;
        const z = pos[i + 2]!;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }
    const posBytes = Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength);
    const idxBytes = Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength);
    const posPad = (4 - (posBytes.length % 4)) % 4;
    const bin = Buffer.concat([posBytes, Buffer.alloc(posPad), idxBytes]);
    const binPad = (4 - (bin.length % 4)) % 4;
    const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);
    const json = {
        asset: { version: "2.0", generator: "orthocad-trim" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: "Top" }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
        accessors: [
            {
                bufferView: 0,
                componentType: 5126,
                count: pos.length / 3,
                type: "VEC3",
                min: [minX, minY, minZ],
                max: [maxX, maxY, maxZ],
            },
            {
                bufferView: 1,
                componentType: 5125,
                count: idx.length,
                type: "SCALAR",
            },
        ],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
            { buffer: 0, byteOffset: posBytes.length + posPad, byteLength: idxBytes.length, target: 34963 },
        ],
        buffers: [{ byteLength: binChunk.length }],
    };
    const jsonBuf = Buffer.from(JSON.stringify(json));
    const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
    const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
    const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(total, 8);
    const jHead = Buffer.alloc(8);
    jHead.writeUInt32LE(jsonChunk.length, 0);
    jHead.writeUInt32LE(0x4e4f534a, 4);
    const bHead = Buffer.alloc(8);
    bHead.writeUInt32LE(binChunk.length, 0);
    bHead.writeUInt32LE(0x004e4942, 4);
    writeFileSync(file, Buffer.concat([header, jHead, jsonChunk, bHead, binChunk]));
}

function sourceRim(pos: Float32Array, idx: Uint32Array): { x: number; y: number; z: number }[] {
    const count = new Map<string, number>();
    const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
    for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!;
        const b = idx[t + 1]!;
        const c = idx[t + 2]!;
        for (const [p, q] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = edgeKey(p, q);
            count.set(k, (count.get(k) ?? 0) + 1);
        }
    }
    const adj = new Map<number, number[]>();
    for (const [k, n] of count) {
        if (n !== 1) continue;
        const [a, b] = k.split(",").map(Number) as [number, number];
        (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
        (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
    }
    const start = adj.keys().next().value as number | undefined;
    if (start === undefined) return [];
    const loop = [start];
    let prev = -1;
    let cur = start;
    while (loop.length <= adj.size + 2) {
        const nxt = (adj.get(cur) ?? []).find((n) => n !== prev && (n !== start || loop.length < 3));
        if (nxt === undefined || (nxt === start && loop.length > 2)) break;
        if (nxt === start) break;
        loop.push(nxt);
        prev = cur;
        cur = nxt;
    }
    return loop.map((i) => ({ x: pos[i * 3]!, y: pos[i * 3 + 1]!, z: pos[i * 3 + 2]! }));
}

function boundaryCycle(pos: Float32Array, idx: Uint32Array): { loops: number; odd: number } {
    const q = 1e5;
    const key = (i: number) =>
        `${Math.round(pos[i * 3]! * q)},${Math.round(pos[i * 3 + 1]! * q)},${Math.round(pos[i * 3 + 2]! * q)}`;
    const count = new Map<string, number>();
    const adj = new Map<string, string[]>();
    const xy = new Map<string, { x: number; y: number }>();
    for (let t = 0; t < idx.length; t += 3) {
        const ids = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
        const ks = ids.map(key);
        for (let e = 0; e < 3; e++) {
            const id = ids[e]!;
            xy.set(ks[e]!, { x: pos[id * 3]!, y: pos[id * 3 + 1]! });
            const a = ks[e]!;
            const b = ks[(e + 1) % 3]!;
            const k = a < b ? `${a}|${b}` : `${b}|${a}`;
            count.set(k, (count.get(k) ?? 0) + 1);
        }
    }
    for (const [k, n] of count) {
        if (n !== 1) continue;
        const [a, b] = k.split("|") as [string, string];
        const la = adj.get(a) ?? [];
        la.push(b);
        adj.set(a, la);
        const lb = adj.get(b) ?? [];
        lb.push(a);
        adj.set(b, lb);
    }
    let odd = 0;
    for (const ns of adj.values()) if (ns.length !== 2) odd++;
    const seen = new Set<string>();
    let loops = 0;
    for (const start of adj.keys()) {
        if (seen.has(start)) continue;
        loops++;
        const stack = [start];
        seen.add(start);
        while (stack.length) {
            const cur = stack.pop()!;
            for (const n of adj.get(cur) ?? []) {
                if (!seen.has(n)) {
                    seen.add(n);
                    stack.push(n);
                }
            }
        }
    }
    return { loops, odd, maxChordOnCut: 0, cut: [...xy.values()] };
}

async function main() {
    const buf = readFileSync(resolve("vertex/public/Templates/SAMPLE_Top.glb"));
    const group = await loadGlbFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const merged = extractMergedGeometry(group);
    if (!merged) throw new Error("no geometry");
    const foot = reorientToFootprintFrame(merged.geometry, { preserveAuthorZ: true });
    const src = foot.getAttribute("position")!.array as Float32Array;
    const srcIdx = foot.getIndex()!.array as Uint32Array;
    const welded = weldExact(src, srcIdx);
    const rimPts = sourceRim(welded.pos, welded.idx);
    const frame = footprintFrameFromRim(rimPts);
    const outDir = resolve("vertex/public/Templates");
    const art = "/opt/cursor/artifacts";
    mkdirSync(art, { recursive: true });
    const overlay: Record<string, { rim: { x: number; y: number }[]; cut: { x: number; y: number }[] }> = {};
    for (const kind of ["34", "sulcus"] as const) {
        const geo = trimTopToCut(foot, kind, TRIM_SEED_CONTROLS[kind]);
        const { pos, idx } = geometryPositions(geo);
        const man = analyzeManifold(geo);
        const b = boundaryCycle(pos, idx);
        if (man.nonManifoldEdges !== 0 || b.loops !== 1 || b.odd !== 0) {
            throw new Error(
                `${kind} boundary failed ${JSON.stringify({ man, b: { loops: b.loops, odd: b.odd } })}`,
            );
        }
        const cut = cutPolyline(frame, TRIM_SEED_CONTROLS[kind], TRIM_EXTEND_MM, 0.1);
        let maxCutChord = 0;
        const q = 1e5;
        const key = (i: number) =>
            `${Math.round(pos[i * 3]! * q)},${Math.round(pos[i * 3 + 1]! * q)},${Math.round(pos[i * 3 + 2]! * q)}`;
        const open = new Map<string, [number, number]>();
        const edgeCount = new Map<string, number>();
        for (let t = 0; t < idx.length; t += 3) {
            const ids = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
            for (let e = 0; e < 3; e++) {
                const a = ids[e]!;
                const c = ids[(e + 1) % 3]!;
                const k = key(a) < key(c) ? `${key(a)}|${key(c)}` : `${key(c)}|${key(a)}`;
                edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
                open.set(k, [a, c]);
            }
        }
        for (const [k, n] of edgeCount) {
            if (n !== 1) continue;
            const [a, c] = open.get(k)!;
            const ax = pos[a * 3]!;
            const ay = pos[a * 3 + 1]!;
            const cx = pos[c * 3]!;
            const cy = pos[c * 3 + 1]!;
            if (closestOnCut(ax, ay, cut).dist > 0.2 || closestOnCut(cx, cy, cut).dist > 0.2) continue;
            maxCutChord = Math.max(maxCutChord, Math.hypot(ax - cx, ay - cy));
        }
        if (maxCutChord > 0.1 + 1e-3) {
            throw new Error(`${kind} cut chord ${maxCutChord.toFixed(4)} mm`);
        }
        const deep = new Map<string, number>();
        for (let i = 0; i < welded.pos.length / 3; i++) {
            const x = welded.pos[i * 3]!;
            const y = welded.pos[i * 3 + 1]!;
            const z = welded.pos[i * 3 + 2]!;
            if (closestOnCut(x, y, cut).signed < 3.05) continue;
            deep.set(`${x},${y},${z}`, 1);
        }
        let matched = 0;
        for (let i = 0; i < pos.length / 3; i++) {
            const k = `${pos[i * 3]},${pos[i * 3 + 1]},${pos[i * 3 + 2]}`;
            if (deep.has(k)) {
                deep.set(k, 0);
                matched++;
            }
        }
        let missing = 0;
        for (const v of deep.values()) if (v === 1) missing++;
        if (missing > 0) throw new Error(`${kind} hausdorff: ${missing} deep vertices missing`);
        const file = kind === "34" ? "SAMPLE_Top_34.glb" : "SAMPLE_Top_sulcus.glb";
        writeGlb(resolve(outDir, file), pos, idx);
        writeGlb(resolve(art, file), pos, idx);
        const json = {
            kind,
            frame: "footprint-uv",
            u: "0 medial, 1 lateral",
            v: "0 heel, 1 toe",
            extendMm: TRIM_EXTEND_MM,
            controls: TRIM_SEED_CONTROLS[kind as TrimKind],
            skive: kind === "sulcus" ? { lengthMm: 6 } : { lengthMm: 10, thickOver4Mm: "3t", capMm: 15 },
            endThicknessMm: 0.5,
        };
        writeFileSync(resolve(outDir, file.replace(".glb", ".json")), `${JSON.stringify(json, null, 2)}\n`);
        const rimAdj = new Map<number, number[]>();
        for (const [k, n] of edgeCount) {
            if (n !== 1) continue;
            const [a, c] = open.get(k)!;
            const la = rimAdj.get(a) ?? [];
            la.push(c);
            rimAdj.set(a, la);
            const lc = rimAdj.get(c) ?? [];
            lc.push(a);
            rimAdj.set(c, lc);
        }
        const rimStart = rimAdj.keys().next().value as number;
        const rimLoop: { x: number; y: number }[] = [{ x: pos[rimStart * 3]!, y: pos[rimStart * 3 + 1]! }];
        let prev = -1;
        let cur = rimStart;
        for (let step = 0; step < rimAdj.size + 2; step++) {
            const nxt = (rimAdj.get(cur) ?? []).find((n) => n !== prev);
            if (nxt === undefined || nxt === rimStart) break;
            rimLoop.push({ x: pos[nxt * 3]!, y: pos[nxt * 3 + 1]! });
            prev = cur;
            cur = nxt;
        }
        overlay[kind] = {
            rim: rimLoop,
            cut: cut.map((p) => ({ x: p.x, y: p.y })),
        };
        console.log(kind, {
            tris: man.triangleCount,
            open: man.openEdges,
            chord: Number(maxCutChord.toFixed(4)),
            deep: matched,
            missing,
        });
    }
    writeFileSync(resolve(art, "trim-overlay.json"), JSON.stringify(overlay));
    console.log("wrote glbs");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
