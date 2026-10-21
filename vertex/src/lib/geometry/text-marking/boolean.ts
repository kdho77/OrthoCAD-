// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import {
    TEXT_DEGENERATE_AREA_MM2,
    TEXT_DEGENERATE_MIN_ANGLE_DEG,
    TEXT_HOST_SI_PAD_MM,
    TEXT_HOST_SLIVER_MIN_ANGLE_DEG,
    TEXT_REGION_PAD_MM,
    TEXT_WELD_MM,
} from "./constants";
import { buildTextCutterMesh } from "./cutter";
import { TextMarkingError } from "./errors";
import { refineHostLocally, SampleGrid } from "./host-refine";
import { decimateCoplanarCaps } from "./qem-caps";
import { distToTextRegion } from "./quality";
import { countSoupSelfIntersections } from "./soup-intersect";
import type { MapTextPoint, TextApplyMeta, TextGlyphGroup, TextHostRepair } from "./types";

type ManifoldMesh = {
    merge: () => boolean;
    tolerance?: number;
};

type ManifoldCtor = {
    new (mesh: unknown): ManifoldHandle;
    reserveIDs?: (n: number) => number;
};

type ManifoldWasm = {
    setup: () => void;
    Manifold: ManifoldCtor;
    Mesh: new (args: {
        numProp: number;
        vertProperties: Float32Array;
        triVerts: Uint32Array;
        faceID?: Uint32Array;
        runIndex?: Uint32Array;
        runOriginalID?: Uint32Array;
        tolerance?: number;
    }) => ManifoldMesh;
};

/** True when the triangle centroid is inside (footprint + pad). */
export type TriBandPred = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
) => boolean;

type ManifoldHandle = {
    add: (other: ManifoldHandle) => ManifoldHandle;
    subtract: (other: ManifoldHandle) => ManifoldHandle;
    warp: (fn: (vert: [number, number, number]) => void) => ManifoldHandle;
    getMesh: () => {
        vertProperties: Float32Array;
        triVerts: Uint32Array;
        numProp: number;
        faceID?: Uint32Array;
    };
    status?: () => string;
    delete: () => void;
};

let wasm: ManifoldWasm | null = null;
/** Fallback when Manifold.reserveIDs is missing — never reuse 1 for host and cutter. */
let nextFaceID = 1;

/** 0 insole, 1 cap/floor, 2 wall. Plain array so BufferGeometry.clone keeps it. */
export function readFaceClass(geo: { userData?: unknown }): number[] | null {
    const raw = (geo.userData as { faceClass?: unknown } | undefined)?.faceClass;
    if (Array.isArray(raw)) return raw.map((v) => (v === 1 || v === 2 ? v : 0));
    if (raw instanceof Uint8Array) return Array.from(raw);
    return null;
}

function writeFaceClass(geo: BufferGeometry, faceClass: number[] | null): void {
    if (!faceClass) return;
    geo.userData = { ...geo.userData, faceClass };
}

function allocFaceIDs(mod: ManifoldWasm, nTri: number): number {
    if (typeof mod.Manifold.reserveIDs === "function") {
        return mod.Manifold.reserveIDs(nTri);
    }
    const first = nextFaceID;
    nextFaceID += nTri;
    return first;
}

async function loadWasm(): Promise<ManifoldWasm> {
    if (wasm) return wasm;
    const Module = (await import("manifold-3d")).default as (opts?: {
        wasmBinary?: Uint8Array;
    }) => Promise<ManifoldWasm>;
    let mod: ManifoldWasm | null = null;
    if (typeof process !== "undefined" && process.versions?.node) {
        const { readFileSync } = await import("node:fs");
        const { createRequire } = await import("node:module");
        const require = createRequire(import.meta.url);
        const wasmPath = require.resolve("manifold-3d/manifold.wasm");
        mod = await Module({ wasmBinary: readFileSync(wasmPath) });
    } else {
        mod = await Module();
    }
    mod.setup();
    wasm = mod;
    return mod;
}

/** Manifold-3d check on the exact index. No tolerance weld. */
export async function assertExactManifold(geo: BufferGeometry): Promise<void> {
    const mod = await loadWasm();
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!pos || !index) throw new TextMarkingError("stl-gate", "mesh has no indexed positions");
    const vertProperties = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        vertProperties[i * 3] = pos.getX(i);
        vertProperties[i * 3 + 1] = pos.getY(i);
        vertProperties[i * 3 + 2] = pos.getZ(i);
    }
    const triVerts = new Uint32Array(index.count);
    for (let i = 0; i < index.count; i++) triVerts[i] = index.getX(i);
    const mesh = new mod.Mesh({
        numProp: 3,
        vertProperties,
        triVerts,
        tolerance: 0,
    });
    const man = new mod.Manifold(mesh);
    const status = man.status?.() ?? "NoError";
    man.delete();
    if (status !== "NoError") {
        throw new TextMarkingError("stl-gate", `manifold status ${status}`);
    }
}

function weldedIndexed(geo: BufferGeometry): BufferGeometry {
    const clone = geo.clone();
    if (!clone.getIndex()) {
        const n = clone.getAttribute("position").count;
        const tri: number[] = [];
        for (let i = 0; i < n; i++) tri.push(i);
        clone.setIndex(tri);
    }
    const welded = mergeVertices(clone, TEXT_WELD_MM);
    if (welded !== clone) clone.dispose();
    return welded;
}

function textGroupsToManifold(
    mod: ManifoldWasm,
    groups: TextGlyphGroup[],
    mapPoint: MapTextPoint,
    sidewallRings?: number,
): ManifoldHandle {
    let cutter: BufferGeometry | null = null;
    try {
        cutter = buildTextCutterMesh(groups, mapPoint, sidewallRings);
        const cleaned = collapseDegenerateThenWeld(cutter);
        if (cleaned !== cutter) {
            cutter.dispose();
            cutter = cleaned;
        }
        return geometryToManifold(mod, cutter, "text cutter");
    } catch (e) {
        throw new TextMarkingError(
            "boolean",
            `text solid failed: ${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
        cutter?.dispose();
    }
}

function geometryToManifold(mod: ManifoldWasm, geo: BufferGeometry, label: string): ManifoldHandle {
    const welded = weldedIndexed(geo);
    try {
        const pos = welded.getAttribute("position");
        if (!pos) throw new TextMarkingError("boolean", `${label} mesh has no positions`);
        const indices = welded.getIndex();
        if (!indices) throw new TextMarkingError("boolean", `${label} mesh has no index`);
        const vertProperties = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
            vertProperties[i * 3] = pos.getX(i);
            vertProperties[i * 3 + 1] = pos.getY(i);
            vertProperties[i * 3 + 2] = pos.getZ(i);
        }
        const src = indices.array as ArrayLike<number>;
        const clean: number[] = [];
        for (let t = 0; t + 2 < indices.count; t += 3) {
            const i0 = src[t]!;
            const i1 = src[t + 1]!;
            const i2 = src[t + 2]!;
            if (i0 === i1 || i1 === i2 || i2 === i0) continue;
            const ax = pos.getX(i0);
            const ay = pos.getY(i0);
            const az = pos.getZ(i0);
            const bx = pos.getX(i1);
            const by = pos.getY(i1);
            const bz = pos.getZ(i1);
            const cx = pos.getX(i2);
            const cy = pos.getY(i2);
            const cz = pos.getZ(i2);
            const abx = bx - ax;
            const aby = by - ay;
            const abz = bz - az;
            const acx = cx - ax;
            const acy = cy - ay;
            const acz = cz - az;
            const nx = aby * acz - abz * acy;
            const ny = abz * acx - abx * acz;
            const nz = abx * acy - aby * acx;
            if (nx * nx + ny * ny + nz * nz < 1e-18) continue;
            clean.push(i0, i1, i2);
        }
        if (clean.length < 9) {
            throw new TextMarkingError("boolean", `${label} mesh has no usable triangles`);
        }
        const nTri = clean.length / 3;
        const srcClass = readFaceClass(welded) ?? readFaceClass(geo);
        const weldedTri = indices.count / 3;
        const classForClean: number[] = [];
        if (srcClass && srcClass.length === weldedTri) {
            for (let t = 0; t + 2 < indices.count; t += 3) {
                const i0 = src[t]!;
                const i1 = src[t + 1]!;
                const i2 = src[t + 2]!;
                if (i0 === i1 || i1 === i2 || i2 === i0) continue;
                const ax = pos.getX(i0);
                const ay = pos.getY(i0);
                const az = pos.getZ(i0);
                const bx = pos.getX(i1);
                const by = pos.getY(i1);
                const bz = pos.getZ(i1);
                const cx = pos.getX(i2);
                const cy = pos.getY(i2);
                const cz = pos.getZ(i2);
                const abx = bx - ax;
                const aby = by - ay;
                const abz = bz - az;
                const acx = cx - ax;
                const acy = cy - ay;
                const acz = cz - az;
                const nx = aby * acz - abz * acy;
                const ny = abz * acx - abx * acz;
                const nz = abx * acy - aby * acx;
                if (nx * nx + ny * ny + nz * nz < 1e-18) continue;
                classForClean.push(srcClass[t / 3] ?? 0);
            }
        }
        const firstID = allocFaceIDs(mod, nTri);
        const faceID = new Uint32Array(nTri);
        const runIndex = new Uint32Array(nTri + 1);
        const runOriginalID = new Uint32Array(nTri);
        for (let i = 0; i < nTri; i++) {
            // Low 2 bits carry the construction tag. The high bits stay unique
            // so coplanar faces still do not merge.
            const cls = classForClean.length === nTri ? (classForClean[i] ?? 0) : 0;
            const packed = ((firstID + i) << 2) | (cls & 3);
            faceID[i] = packed;
            runIndex[i] = i * 3;
            runOriginalID[i] = packed;
        }
        runIndex[nTri] = nTri * 3;
        const mesh = new mod.Mesh({
            numProp: 3,
            vertProperties,
            triVerts: new Uint32Array(clean),
            faceID,
            runIndex,
            runOriginalID,
            tolerance: 0,
        });
        if ("tolerance" in mesh) mesh.tolerance = 0;
        // Unique faceIDs keep coplanar host/cutter triangles from merging.
        // Do not call mesh.merge() or Manifold.asOriginal().
        try {
            return new mod.Manifold(mesh);
        } catch (e) {
            throw new TextMarkingError(
                "boolean",
                `${label} manifold construction failed: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    } finally {
        welded.dispose();
    }
}

function triMetrics(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
): { area: number; minAng: number; short: 0 | 1 | 2 } {
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const bcx = cx - bx;
    const bcy = cy - by;
    const bcz = cz - bz;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const area = 0.5 * Math.hypot(nx, ny, nz);
    const lab = Math.hypot(abx, aby, abz);
    const lac = Math.hypot(acx, acy, acz);
    const lbc = Math.hypot(bcx, bcy, bcz);
    const ang = (opp: number, a: number, b: number) => {
        const den = 2 * a * b;
        if (den < 1e-18) return 0;
        const cos = Math.max(-1, Math.min(1, (a * a + b * b - opp * opp) / den));
        return Math.acos(cos);
    };
    const minAng = Math.min(ang(lbc, lab, lac), ang(lac, lab, lbc), ang(lab, lac, lbc));
    let short: 0 | 1 | 2 = 0;
    let shortL = lab;
    if (lbc < shortL) {
        short = 1;
        shortL = lbc;
    }
    if (lac < shortL) short = 2;
    return { area, minAng, short };
}

/**
 * Position-only weld. three.js mergeVertices also hashes normals, so it leaves
 * the needle cracks that split a wall body, and a 1e-4 mm weld on the whole
 * CSG soup creates non-manifold edges. 1e-6 mm closes those cracks without
 * joining cutter shells (they sit >0.1 mm off the wall).
 */
const SHELL_SPLIT_WELD_MM = 1e-6;

function exactWeldIndexed(geo: BufferGeometry): BufferGeometry {
    const src = geo.getIndex();
    const pos = geo.getAttribute("position");
    if (!pos) return geo;
    const indexArr = src ? (src.array as ArrayLike<number>) : null;
    const vertRemap = new Int32Array(pos.count);
    const map = new Map<string, number>();
    const newPos: number[] = [];
    const mul = 1 / SHELL_SPLIT_WELD_MM;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const key = `${Math.round(x * mul)}|${Math.round(y * mul)}|${Math.round(z * mul)}`;
        let id = map.get(key);
        if (id === undefined) {
            id = newPos.length / 3;
            map.set(key, id);
            newPos.push(x, y, z);
        }
        vertRemap[i] = id;
    }
    const cornerCount = indexArr ? (src?.count ?? 0) : pos.count;
    const corner = (i: number) => (indexArr ? (indexArr[i] ?? 0) : i);
    const srcClass = readFaceClass(geo);
    const nOld = cornerCount / 3;
    const next: number[] = [];
    const nextClass: number[] = [];
    for (let t = 0; t + 2 < cornerCount; t += 3) {
        const a = vertRemap[corner(t)] ?? 0;
        const b = vertRemap[corner(t + 1)] ?? 0;
        const c = vertRemap[corner(t + 2)] ?? 0;
        if (a === b || b === c || c === a) continue;
        next.push(a, b, c);
        if (srcClass && srcClass.length === nOld) nextClass.push(srcClass[t / 3] ?? 0);
    }
    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(new Float32Array(newPos), 3));
    out.setIndex(next);
    out.computeVertexNormals();
    out.computeBoundingBox();
    out.userData = { ...geo.userData };
    if (nextClass.length === next.length / 3) writeFaceClass(out, nextClass);
    return out;
}

/**
 * Letter cutters that miss the solid come back as inverted shells.
 * Keep every closed positive component (the union body). Emboss shells are
 * positive and must stay; only volume < 0 is dropped.
 */
function dropInvertedShells(geo: BufferGeometry): BufferGeometry {
    const welded = exactWeldIndexed(geo);
    if (welded === geo) return geo;
    const index = welded.getIndex();
    const pos = welded.getAttribute("position");
    if (!index || !pos) {
        welded.dispose();
        return geo;
    }
    const src = index.array as ArrayLike<number>;
    const nTri = Math.floor(index.count / 3);
    const edge = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let t = 0; t < nTri; t++) {
        const a = src[t * 3] ?? 0;
        const b = src[t * 3 + 1] ?? 0;
        const c = src[t * 3 + 2] ?? 0;
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = key(u, v);
            const list = edge.get(k);
            if (list) list.push(t);
            else edge.set(k, [t]);
        }
    }
    const nbr: number[][] = Array.from({ length: nTri }, () => []);
    for (const tris of edge.values()) {
        if (tris.length !== 2) continue;
        const i0 = tris[0] ?? 0;
        const i1 = tris[1] ?? 0;
        nbr[i0]?.push(i1);
        nbr[i1]?.push(i0);
    }
    const seen = new Uint8Array(nTri);
    const comps: number[][] = [];
    for (let t = 0; t < nTri; t++) {
        if (seen[t]) continue;
        const stack = [t];
        seen[t] = 1;
        const comp: number[] = [];
        while (stack.length) {
            const cur = stack.pop() ?? 0;
            comp.push(cur);
            for (const n of nbr[cur] ?? []) {
                if (seen[n]) continue;
                seen[n] = 1;
                stack.push(n);
            }
        }
        comps.push(comp);
    }
    const volume = (comp: number[]) => {
        let v = 0;
        for (const t of comp) {
            const a = src[t * 3] ?? 0;
            const b = src[t * 3 + 1] ?? 0;
            const c = src[t * 3 + 2] ?? 0;
            const ax = pos.getX(a);
            const ay = pos.getY(a);
            const az = pos.getZ(a);
            const bx = pos.getX(b);
            const by = pos.getY(b);
            const bz = pos.getZ(b);
            const cx = pos.getX(c);
            const cy = pos.getY(c);
            const cz = pos.getZ(c);
            v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
        }
        return v / 6;
    };
    const closed = (comp: number[]) => {
        const counts = new Map<string, number>();
        for (const t of comp) {
            const a = src[t * 3] ?? 0;
            const b = src[t * 3 + 1] ?? 0;
            const c = src[t * 3 + 2] ?? 0;
            for (const [u, v] of [
                [a, b],
                [b, c],
                [c, a],
            ] as const) {
                const k = key(u, v);
                counts.set(k, (counts.get(k) ?? 0) + 1);
            }
        }
        for (const n of counts.values()) if (n !== 2) return false;
        return comp.length > 0;
    };
    const kept: number[][] = [];
    for (const comp of comps) {
        if (!closed(comp)) continue;
        if (volume(comp) > 1) kept.push(comp);
    }
    if (!kept.length) {
        welded.dispose();
        return geo;
    }
    const srcClass = readFaceClass(welded);
    const next: number[] = [];
    const nextClass: number[] = [];
    for (const comp of kept) {
        for (const t of comp) {
            next.push(src[t * 3] ?? 0, src[t * 3 + 1] ?? 0, src[t * 3 + 2] ?? 0);
            if (srcClass && srcClass.length === nTri) nextClass.push(srcClass[t] ?? 0);
        }
    }
    const out = welded.clone();
    out.setIndex(next);
    out.userData = { ...welded.userData };
    if (nextClass.length === next.length / 3) writeFaceClass(out, nextClass);
    welded.dispose();
    if (!indexedWatertight(out)) {
        out.dispose();
        return geo;
    }
    return out;
}

function indexedWatertight(geo: BufferGeometry): boolean {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!pos || !index) return false;
    const triCount = index.count / 3;
    const edgeCount = new Map<string, number>();
    const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let t = 0; t < triCount; t++) {
        const a = index.getX(t * 3);
        const b = index.getX(t * 3 + 1);
        const c = index.getX(t * 3 + 2);
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const e = edgeKey(u, v);
            edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
        }
    }
    for (const count of edgeCount.values()) {
        if (count !== 2) return false;
    }
    return true;
}

function triAspect(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
): number {
    const lab = Math.hypot(bx - ax, by - ay, bz - az);
    const lbc = Math.hypot(cx - bx, cy - by, cz - bz);
    const lca = Math.hypot(ax - cx, ay - cy, az - cz);
    const s = Math.min(lab, lbc, lca);
    const l = Math.max(lab, lbc, lca);
    return s < 1e-12 ? 1e6 : l / s;
}

/**
 * Collapse in-pad edges that fail the 5.8° / aspect-10 gate, then (only while the
 * mesh is over budget) collapse smooth edges up to 0.59 mm. A collapse is kept
 * only when the link has exactly two neighbors, the moved vertex is not on an
 * outside triangle, and every updated triangle keeps its normal and stays within
 * 0.04 mm of the deleted vertex. The caller discards a self-intersecting result.
 */
function collapseSafeBand(geo: BufferGeometry, band?: TriBandPred): BufferGeometry {
    if (!band) return geo;
    const keep = (base: BufferGeometry, mode: "needle" | "open") => {
        const next = collapseBandPasses(base, band, mode);
        if (next === base) return base;
        if (indexedWatertight(next) && soupRealHits(next) === 0) {
            if (base !== geo) base.dispose();
            return next;
        }
        next.dispose();
        return base;
    };
    // Strict passes delete needles whose fan stays ≥ 5.8° and aspect ≤ 10.
    // What those passes refuse is handed to flipShortNeedles, which swaps the
    // short edge instead of moving a vertex.
    return keep(geo, "needle");
}

function collapseBandPasses(
    geo: BufferGeometry,
    band: TriBandPred,
    mode: "needle" | "open" | "decimate",
): BufferGeometry {
    const work = geo.clone();
    work.userData = geo.userData ?? {};
    let any = false;
    let goodIndex: number[] | null = null;
    let goodClass: number[] | null = null;
    const passes = mode === "decimate" ? 12 : mode === "open" ? 4 : 6;
    const budget = 115_000;
    const minKeep = (5.8 * Math.PI) / 180;
    for (let pass = 0; pass < passes; pass++) {
        const pos = work.getAttribute("position");
        const index = work.getIndex();
        if (!pos || !index) break;
        const idx = index.array as ArrayLike<number>;
        const nTri = Math.floor(index.count / 3);
        if (mode === "decimate" && nTri <= budget) break;
        const nVert = pos.count;
        const adj: number[][] = Array.from({ length: nVert }, () => []);
        const vertTris: number[][] = Array.from({ length: nVert }, () => []);
        const inBandTri = new Uint8Array(nTri);
        const touchesOut = new Uint8Array(nVert);
        const crease = new Uint8Array(nVert);
        type EdgeRec = { u: number; v: number; tris: number[] };
        const edges = new Map<string, EdgeRec>();
        const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
        const touchEdge = (u: number, v: number, t: number) => {
            const k = edgeKey(u, v);
            let e = edges.get(k);
            if (!e) {
                e = { u, v, tris: [] };
                edges.set(k, e);
            }
            e.tris.push(t);
            adj[u]!.push(v);
            adj[v]!.push(u);
        };
        for (let t = 0; t < nTri; t++) {
            const a = idx[t * 3] ?? 0;
            const b = idx[t * 3 + 1] ?? 0;
            const c = idx[t * 3 + 2] ?? 0;
            const inside = band(
                pos.getX(a),
                pos.getY(a),
                pos.getZ(a),
                pos.getX(b),
                pos.getY(b),
                pos.getZ(b),
                pos.getX(c),
                pos.getY(c),
                pos.getZ(c),
            );
            inBandTri[t] = inside ? 1 : 0;
            if (!inside) {
                touchesOut[a] = 1;
                touchesOut[b] = 1;
                touchesOut[c] = 1;
            }
            vertTris[a]!.push(t);
            vertTris[b]!.push(t);
            vertTris[c]!.push(t);
            touchEdge(a, b, t);
            touchEdge(b, c, t);
            touchEdge(c, a, t);
        }
        const triN = (t: number) => {
            const a = idx[t * 3] ?? 0;
            const b = idx[t * 3 + 1] ?? 0;
            const c = idx[t * 3 + 2] ?? 0;
            const ax = pos.getX(a);
            const ay = pos.getY(a);
            const az = pos.getZ(a);
            const bx = pos.getX(b);
            const by = pos.getY(b);
            const bz = pos.getZ(b);
            const cx = pos.getX(c);
            const cy = pos.getY(c);
            const cz = pos.getZ(c);
            const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
            const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
            const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
            const len = Math.hypot(nx, ny, nz);
            return len < 1e-12 ? null : { x: nx / len, y: ny / len, z: nz / len };
        };
        for (const e of edges.values()) {
            if (e.tris.length !== 2) continue;
            const n0 = triN(e.tris[0] ?? 0);
            const n1 = triN(e.tris[1] ?? 0);
            if (!n0 || !n1) continue;
            const dot = Math.max(-1, Math.min(1, n0.x * n1.x + n0.y * n1.y + n0.z * n1.z));
            if ((Math.acos(dot) * 180) / Math.PI > 45) {
                crease[e.u] = 1;
                crease[e.v] = 1;
            }
        }
        const third = (t: number, u: number, v: number) => {
            const a = idx[t * 3] ?? 0;
            const b = idx[t * 3 + 1] ?? 0;
            const c = idx[t * 3 + 2] ?? 0;
            if (a !== u && a !== v) return a;
            if (b !== u && b !== v) return b;
            return c;
        };
        const stamp = new Int32Array(nVert);
        let sid = 1;
        const linkOk = (u: number, v: number, p: number, q: number) => {
            const mark = sid++;
            if (sid > 2_000_000_000) {
                stamp.fill(0);
                sid = 1;
            }
            for (const n of adj[v] ?? []) stamp[n] = mark;
            const commons = new Set<number>();
            for (const n of adj[u] ?? []) {
                if (stamp[n] === mark) commons.add(n);
            }
            return commons.size === 2 && commons.has(p) && commons.has(q);
        };
        const fanWhy = { edge: 0, area: 0, angle: 0, aspect: 0, flip: 0, plane: 0 };
        const fanOk = (
            child: number,
            parent: number,
            maxPlane: number,
            minDot: number,
            preserve: boolean,
            loose: boolean,
            needleAspect: number,
        ) => {
            const px = pos.getX(parent);
            const py = pos.getY(parent);
            const pz = pos.getZ(parent);
            const cx = pos.getX(child);
            const cy = pos.getY(child);
            const cz = pos.getZ(child);
            let sawEdge = false;
            const fail = (why: keyof typeof fanWhy) => {
                fanWhy[why]++;
                return false;
            };
            for (const t of vertTris[child] ?? []) {
                const a = idx[t * 3] ?? 0;
                const b = idx[t * 3 + 1] ?? 0;
                const c = idx[t * 3 + 2] ?? 0;
                if (a === parent || b === parent || c === parent) {
                    sawEdge = true;
                    continue;
                }
                const other: number[] = [];
                if (a !== child) other.push(a);
                if (b !== child) other.push(b);
                if (c !== child) other.push(c);
                if (other.length !== 2) return fail("area");
                const x = other[0] ?? 0;
                const y = other[1] ?? 0;
                const ax = pos.getX(x);
                const ay = pos.getY(x);
                const az = pos.getZ(x);
                const bx = pos.getX(y);
                const by = pos.getY(y);
                const bz = pos.getZ(y);
                // An edge that is already longer than 0.59 mm is split later. Reject only a new one.
                // Only a new edge that crosses 0.59 mm fails the length gate. An edge that is
                // already longer is split after this pass.
                const crosses = (nx: number, ny: number, nz: number, ox: number, oy: number, oz: number) => {
                    const neu = Math.hypot(nx, ny, nz);
                    const old = Math.hypot(ox, oy, oz);
                    return old <= 0.59 && neu > 0.59;
                };
                if (crosses(ax - px, ay - py, az - pz, ax - cx, ay - cy, az - cz)) return fail("edge");
                if (crosses(bx - px, by - py, bz - pz, bx - cx, by - cy, bz - cz)) return fail("edge");
                const oldM = triMetrics(cx, cy, cz, ax, ay, az, bx, by, bz);
                const newM = triMetrics(px, py, pz, ax, ay, az, bx, by, bz);
                if (newM.area < 1e-8 || newM.minAng < (1 * Math.PI) / 180) return fail("area");
                if (preserve) {
                    const angFloor = loose ? (5 * Math.PI) / 180 : minKeep;
                    const oldAspect = triAspect(cx, cy, cz, ax, ay, az, bx, by, bz);
                    const newAspect = triAspect(px, py, pz, ax, ay, az, bx, by, bz);
                    if (oldM.minAng >= angFloor) {
                        if (newM.minAng < angFloor) return fail("angle");
                    } else if (newM.minAng + 1e-4 < oldM.minAng) return fail("angle");
                    if (loose) {
                        if (newAspect > Math.max(oldAspect, needleAspect) + 0.01) return fail("aspect");
                    } else if (oldAspect <= 10) {
                        if (newAspect > 10) return fail("aspect");
                    } else if (newAspect > oldAspect + 0.01) return fail("aspect");
                }
                const ux = ax - cx;
                const uy = ay - cy;
                const uz = az - cz;
                const vx = bx - cx;
                const vy = by - cy;
                const vz = bz - cz;
                const onx = uy * vz - uz * vy;
                const ony = uz * vx - ux * vz;
                const onz = ux * vy - uy * vx;
                const wx = ax - px;
                const wy = ay - py;
                const wz = az - pz;
                const zx = bx - px;
                const zy = by - py;
                const zz = bz - pz;
                const nnx = wy * zz - wz * zy;
                const nny = wz * zx - wx * zz;
                const nnz = wx * zy - wy * zx;
                const ol = Math.hypot(onx, ony, onz);
                const nl = Math.hypot(nnx, nny, nnz);
                if (ol < 1e-12 || nl < 1e-12) return fail("area");
                const dot = (onx * nnx + ony * nny + onz * nnz) / (ol * nl);
                if (dot < minDot) return fail("flip");
                const plane = Math.abs((cx - px) * nnx + (cy - py) * nny + (cz - pz) * nnz) / nl;
                if (plane > maxPlane) return fail("plane");
            }
            return sawEdge;
        };
        let rejPin = 0;
        let rejLink = 0;
        let rejFan = 0;
        const aspectOfTri = (t: number) => {
            const a = idx[t * 3] ?? 0;
            const b = idx[t * 3 + 1] ?? 0;
            const c = idx[t * 3 + 2] ?? 0;
            return triAspect(
                pos.getX(a),
                pos.getY(a),
                pos.getZ(a),
                pos.getX(b),
                pos.getY(b),
                pos.getZ(b),
                pos.getX(c),
                pos.getY(c),
                pos.getZ(c),
            );
        };
        const candidates: Array<{ child: number; parent: number; len: number }> = [];
        for (const e of edges.values()) {
            if (e.tris.length !== 2) continue;
            const t0 = e.tris[0] ?? 0;
            const t1 = e.tris[1] ?? 0;
            if (!inBandTri[t0] && !inBandTri[t1]) continue;
            const len = Math.hypot(
                pos.getX(e.u) - pos.getX(e.v),
                pos.getY(e.u) - pos.getY(e.v),
                pos.getZ(e.u) - pos.getZ(e.v),
            );
            if (len < 1e-8) continue;
            if (mode === "needle" || mode === "open") {
                const onCrease = crease[e.u] || crease[e.v];
                if (len > (onCrease ? 0.048 : 0.08)) continue;
                let needle = false;
                for (const t of e.tris) {
                    if (!inBandTri[t]) continue;
                    const a = idx[t * 3] ?? 0;
                    const b = idx[t * 3 + 1] ?? 0;
                    const c = idx[t * 3 + 2] ?? 0;
                    const m = triMetrics(
                        pos.getX(a),
                        pos.getY(a),
                        pos.getZ(a),
                        pos.getX(b),
                        pos.getY(b),
                        pos.getZ(b),
                        pos.getX(c),
                        pos.getY(c),
                        pos.getZ(c),
                    );
                    const aspect = triAspect(
                        pos.getX(a),
                        pos.getY(a),
                        pos.getZ(a),
                        pos.getX(b),
                        pos.getY(b),
                        pos.getZ(b),
                        pos.getX(c),
                        pos.getY(c),
                        pos.getZ(c),
                    );
                    if (m.minAng >= minKeep && aspect <= 10) continue;
                    const pair = m.short === 0 ? [a, b] : m.short === 1 ? [b, c] : [c, a];
                    const su = pair[0] ?? 0;
                    const sv = pair[1] ?? 0;
                    if ((su === e.u && sv === e.v) || (su === e.v && sv === e.u)) needle = true;
                }
                if (!needle) continue;
            } else {
                if (!inBandTri[t0] || !inBandTri[t1]) continue;
                if (len > 0.5) continue;
                const n0 = triN(t0);
                const n1 = triN(t1);
                if (!n0 || !n1) continue;
                const dot = Math.max(-1, Math.min(1, n0.x * n1.x + n0.y * n1.y + n0.z * n1.z));
                if ((Math.acos(dot) * 180) / Math.PI > 12) continue;
            }
            const p = third(t0, e.u, e.v);
            const q = third(t1, e.u, e.v);
            if (p === q) continue;
            let child = e.u;
            let parent = e.v;
            if (touchesOut[child] && !touchesOut[parent]) {
                child = e.v;
                parent = e.u;
            }
            if (touchesOut[child]) {
                rejPin++;
                continue;
            }
            if (!linkOk(e.u, e.v, p, q)) {
                rejLink++;
                continue;
            }
            const maxPlane = mode === "decimate" ? 0.02 : 0.05;
            const minDot = mode === "decimate" ? 0.7 : 0.2;
            const needleAspect = Math.max(aspectOfTri(t0), aspectOfTri(t1));
            if (!fanOk(child, parent, maxPlane, minDot, true, mode === "open", needleAspect)) {
                rejFan++;
                continue;
            }
            candidates.push({ child, parent, len });
        }
        candidates.sort((a, b) => a.len - b.len);
        const blocked = new Uint8Array(nVert);
        const welds: Array<[number, number]> = [];
        for (const c of candidates) {
            if (mode === "decimate" && nTri - welds.length * 2 <= budget) break;
            if (blocked[c.child] || blocked[c.parent]) continue;
            let starHit = false;
            for (const n of adj[c.child] ?? []) {
                if (blocked[n]) {
                    starHit = true;
                    break;
                }
            }
            if (starHit) continue;
            blocked[c.child] = 1;
            for (const n of adj[c.child] ?? []) blocked[n] = 1;
            welds.push([c.child, c.parent]);
        }
        if (!welds.length) break;
        any = true;
        const remap = new Int32Array(nVert);
        for (let i = 0; i < nVert; i++) remap[i] = i;
        for (const [child, parent] of welds) remap[child] = parent;
        const srcClass = readFaceClass(work);
        const next: number[] = [];
        const nextClass: number[] = [];
        for (let t = 0; t < nTri; t++) {
            const a = remap[idx[t * 3] ?? 0] ?? 0;
            const b = remap[idx[t * 3 + 1] ?? 0] ?? 0;
            const c = remap[idx[t * 3 + 2] ?? 0] ?? 0;
            if (a === b || b === c || c === a) continue;
            next.push(a, b, c);
            if (srcClass && srcClass.length === nTri) nextClass.push(srcClass[t] ?? 0);
        }
        if (next.length < 9) break;
        work.setIndex(next);
        if (nextClass.length === next.length / 3) writeFaceClass(work, nextClass);
        if (!indexedWatertight(work)) {
            if (goodIndex) {
                work.setIndex(goodIndex);
                if (goodClass) writeFaceClass(work, goodClass);
                break;
            }
            work.dispose();
            return geo;
        }
        goodIndex = next;
        goodClass = nextClass.length === next.length / 3 ? nextClass : null;
    }
    if (!any) {
        work.dispose();
        return geo;
    }
    work.computeVertexNormals();
    work.computeBoundingBox();
    return work;
}

/**
 * Swap the short edge of an in-pad needle for the other diagonal of its quad.
 * The quad must be convex and within 0.04 mm of planar, the new diagonal ≤ 0.59 mm,
 * and both new triangles ≥ 5.8° with aspect ≤ 10. Vertices do not move. A
 * self-intersecting result is discarded.
 */
function flipShortNeedles(geo: BufferGeometry, band?: TriBandPred): BufferGeometry {
    if (!band) return geo;
    const work = geo.clone();
    work.userData = geo.userData ?? {};
    const minKeep = (5.8 * Math.PI) / 180;
    let any = false;
    let goodIndex: number[] | null = null;
    let goodClass: number[] | null = null;
    const planeOf = (
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        cx: number,
        cy: number,
        cz: number,
    ) => {
        const ux = bx - ax;
        const uy = by - ay;
        const uz = bz - az;
        const vx = cx - ax;
        const vy = cy - ay;
        const vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz);
        return nl < 1e-12 ? null : { x: nx / nl, y: ny / nl, z: nz / nl };
    };
    const side = (
        n: { x: number; y: number; z: number },
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        cx: number,
        cy: number,
        cz: number,
    ) => {
        const ux = bx - ax;
        const uy = by - ay;
        const uz = bz - az;
        const vx = cx - ax;
        const vy = cy - ay;
        const vz = cz - az;
        const cxr = uy * vz - uz * vy;
        const cyr = uz * vx - ux * vz;
        const czr = ux * vy - uy * vx;
        return cxr * n.x + cyr * n.y + czr * n.z;
    };
    for (let pass = 0; pass < 6; pass++) {
        const pos = work.getAttribute("position");
        const index = work.getIndex();
        if (!pos || !index) break;
        const idx = index.array as ArrayLike<number>;
        const nTri = Math.floor(index.count / 3);
        const inBand = new Uint8Array(nTri);
        type EdgeRec = { u: number; v: number; tris: number[] };
        const edges = new Map<string, EdgeRec>();
        const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
        const touch = (u: number, v: number, t: number) => {
            const k = edgeKey(u, v);
            let e = edges.get(k);
            if (!e) {
                e = { u, v, tris: [] };
                edges.set(k, e);
            }
            e.tris.push(t);
        };
        for (let t = 0; t < nTri; t++) {
            const a = idx[t * 3] ?? 0;
            const b = idx[t * 3 + 1] ?? 0;
            const c = idx[t * 3 + 2] ?? 0;
            inBand[t] = band(
                pos.getX(a),
                pos.getY(a),
                pos.getZ(a),
                pos.getX(b),
                pos.getY(b),
                pos.getZ(b),
                pos.getX(c),
                pos.getY(c),
                pos.getZ(c),
            )
                ? 1
                : 0;
            touch(a, b, t);
            touch(b, c, t);
            touch(c, a, t);
        }
        const at = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)] as const;
        const why = { band: 0, needle: 0, diag: 0, convex: 0, plane: 0, quality: 0, exist: 0 };
        type Flip = {
            t0: number;
            t1: number;
            u: number;
            v: number;
            p: number;
            q: number;
            score: number;
            nSeg: number;
        };
        const candidates: Flip[] = [];
        for (const e of edges.values()) {
            if (e.tris.length !== 2) continue;
            const t0 = e.tris[0] ?? 0;
            const t1 = e.tris[1] ?? 0;
            if (!inBand[t0] || !inBand[t1]) {
                why.band++;
                continue;
            }
            let needle = false;
            let score = Math.PI;
            for (const t of e.tris) {
                const a = idx[t * 3] ?? 0;
                const b = idx[t * 3 + 1] ?? 0;
                const c = idx[t * 3 + 2] ?? 0;
                const pa = at(a);
                const pb = at(b);
                const pc = at(c);
                const m = triMetrics(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], pc[0], pc[1], pc[2]);
                const aspect = triAspect(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], pc[0], pc[1], pc[2]);
                if (m.minAng >= minKeep && aspect <= 10) continue;
                const pair = m.short === 0 ? [a, b] : m.short === 1 ? [b, c] : [c, a];
                const su = pair[0] ?? 0;
                const sv = pair[1] ?? 0;
                if ((su === e.u && sv === e.v) || (su === e.v && sv === e.u)) {
                    needle = true;
                    if (m.minAng < score) score = m.minAng;
                }
            }
            if (!needle) {
                why.needle++;
                continue;
            }
            const dirOf = (t: number) => {
                const a = idx[t * 3] ?? 0;
                const b = idx[t * 3 + 1] ?? 0;
                const c = idx[t * 3 + 2] ?? 0;
                let apex = a;
                if (a !== e.u && a !== e.v) apex = a;
                else if (b !== e.u && b !== e.v) apex = b;
                else apex = c;
                const uToV = (a === e.u && b === e.v) || (b === e.u && c === e.v) || (c === e.u && a === e.v);
                return { apex, uToV };
            };
            const d0 = dirOf(t0);
            const d1 = dirOf(t1);
            if (d0.uToV === d1.uToV || d0.apex === d1.apex) continue;
            const u = d0.uToV ? e.u : e.v;
            const v = d0.uToV ? e.v : e.u;
            const p = d0.apex;
            const q = d1.apex;
            if (edges.has(edgeKey(p, q))) {
                why.exist++;
                continue;
            }
            const pu = at(u);
            const pv = at(v);
            const pp = at(p);
            const pq = at(q);
            const diag = Math.hypot(pq[0] - pp[0], pq[1] - pp[1], pq[2] - pp[2]);
            const nSeg = diag <= 0.59 ? 1 : Math.ceil(diag / 0.55);
            if (diag < 1e-6 || nSeg > 6) {
                why.diag++;
                continue;
            }
            const n0 = planeOf(pu[0], pu[1], pu[2], pv[0], pv[1], pv[2], pp[0], pp[1], pp[2]);
            if (!n0) {
                why.plane++;
                continue;
            }
            const sQ = side(n0, pu[0], pu[1], pu[2], pv[0], pv[1], pv[2], pq[0], pq[1], pq[2]);
            const sU = side(n0, pp[0], pp[1], pp[2], pq[0], pq[1], pq[2], pu[0], pu[1], pu[2]);
            const sV = side(n0, pp[0], pp[1], pp[2], pq[0], pq[1], pq[2], pv[0], pv[1], pv[2]);
            if (!(sQ < -1e-8 && sU * sV < 0)) {
                why.convex++;
                continue;
            }
            const distQ = Math.abs((pq[0] - pu[0]) * n0.x + (pq[1] - pu[1]) * n0.y + (pq[2] - pu[2]) * n0.z);
            if (distQ > 0.04) {
                why.plane++;
                continue;
            }
            let piecesOk = true;
            for (let s = 0; s < nSeg; s++) {
                const ta = s / nSeg;
                const tb = (s + 1) / nSeg;
                const s0x = pp[0] + (pq[0] - pp[0]) * ta;
                const s0y = pp[1] + (pq[1] - pp[1]) * ta;
                const s0z = pp[2] + (pq[2] - pp[2]) * ta;
                const s1x = pp[0] + (pq[0] - pp[0]) * tb;
                const s1y = pp[1] + (pq[1] - pp[1]) * tb;
                const s1z = pp[2] + (pq[2] - pp[2]) * tb;
                const pieceOk = (
                    ax: number,
                    ay: number,
                    az: number,
                    bx: number,
                    by: number,
                    bz: number,
                    cx: number,
                    cy: number,
                    cz: number,
                ) => {
                    const m = triMetrics(ax, ay, az, bx, by, bz, cx, cy, cz);
                    const aspect = triAspect(ax, ay, az, bx, by, bz, cx, cy, cz);
                    const n = planeOf(ax, ay, az, bx, by, bz, cx, cy, cz);
                    const dot = n ? n.x * n0.x + n.y * n0.y + n.z * n0.z : 0;
                    return m.area >= 1e-8 && m.minAng >= minKeep && aspect <= 10 && dot >= 0.2;
                };
                if (
                    !pieceOk(pu[0], pu[1], pu[2], s1x, s1y, s1z, s0x, s0y, s0z) ||
                    !pieceOk(pv[0], pv[1], pv[2], s0x, s0y, s0z, s1x, s1y, s1z)
                ) {
                    piecesOk = false;
                    break;
                }
            }
            if (!piecesOk) {
                why.quality++;
                continue;
            }
            candidates.push({ t0, t1, u, v, p, q, score, nSeg });
        }
        candidates.sort((a, b) => a.score - b.score);
        const blocked = new Uint8Array(pos.count);
        const chosen: Flip[] = [];
        for (const c of candidates) {
            if (blocked[c.u] || blocked[c.v] || blocked[c.p] || blocked[c.q]) continue;
            blocked[c.u] = 1;
            blocked[c.v] = 1;
            blocked[c.p] = 1;
            blocked[c.q] = 1;
            chosen.push(c);
        }
        if (!chosen.length) break;
        any = true;
        const basePos = pos.array as ArrayLike<number>;
        const xyz = Array.from({ length: basePos.length }, (_, i) => basePos[i] ?? 0);
        let vCount = pos.count;
        const srcClass = readFaceClass(work);
        const skip = new Uint8Array(nTri);
        const extra: number[] = [];
        const extraClass: number[] = [];
        const rewritten = Array.from({ length: nTri * 3 }, (_, i) => idx[i] ?? 0);
        for (const c of chosen) {
            if (c.nSeg === 1) {
                rewritten[c.t0 * 3] = c.u;
                rewritten[c.t0 * 3 + 1] = c.q;
                rewritten[c.t0 * 3 + 2] = c.p;
                rewritten[c.t1 * 3] = c.v;
                rewritten[c.t1 * 3 + 1] = c.p;
                rewritten[c.t1 * 3 + 2] = c.q;
                continue;
            }
            skip[c.t0] = 1;
            skip[c.t1] = 1;
            const ids: number[] = [c.p];
            for (let s = 1; s < c.nSeg; s++) {
                const t = s / c.nSeg;
                const id = vCount++;
                xyz.push(
                    pos.getX(c.p) + (pos.getX(c.q) - pos.getX(c.p)) * t,
                    pos.getY(c.p) + (pos.getY(c.q) - pos.getY(c.p)) * t,
                    pos.getZ(c.p) + (pos.getZ(c.q) - pos.getZ(c.p)) * t,
                );
                ids.push(id);
            }
            ids.push(c.q);
            const cls = srcClass && srcClass.length === nTri ? (srcClass[c.t0] ?? srcClass[c.t1] ?? 0) : 0;
            for (let s = 0; s < c.nSeg; s++) {
                const s0 = ids[s] ?? 0;
                const s1 = ids[s + 1] ?? 0;
                extra.push(c.u, s1, s0, c.v, s0, s1);
                extraClass.push(cls, cls);
            }
        }
        const next: number[] = [];
        const nextClass: number[] = [];
        for (let t = 0; t < nTri; t++) {
            if (skip[t]) continue;
            next.push(rewritten[t * 3] ?? 0, rewritten[t * 3 + 1] ?? 0, rewritten[t * 3 + 2] ?? 0);
            if (srcClass && srcClass.length === nTri) nextClass.push(srcClass[t] ?? 0);
        }
        for (const id of extra) next.push(id);
        if (srcClass && srcClass.length === nTri) for (const cls of extraClass) nextClass.push(cls);
        for (const name of Object.keys(work.attributes)) {
            if (name !== "position") work.deleteAttribute(name);
        }
        work.setAttribute("position", new BufferAttribute(new Float32Array(xyz), 3));
        work.setIndex(next);
        if (nextClass.length === next.length / 3) writeFaceClass(work, nextClass);
        if (!indexedWatertight(work)) {
            if (goodIndex) {
                work.setIndex(goodIndex);
                if (goodClass) writeFaceClass(work, goodClass);
            } else {
                work.dispose();
                return geo;
            }
            break;
        }
        goodIndex = next;
        goodClass = nextClass.length === next.length / 3 ? nextClass : null;
    }
    if (!any) {
        work.dispose();
        return geo;
    }
    if (soupRealHits(work) !== 0) {
        work.dispose();
        return geo;
    }
    work.computeVertexNormals();
    work.computeBoundingBox();
    return work;
}

export function makeFootprintBand(
    groups: TextGlyphGroup[],
    mapped: MapTextPoint,
    padMm: number,
): TriBandPred {
    const pts: Array<{ x: number; y: number; z: number }> = [];
    const push = (p: { x: number; y: number; z: number }) => {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
        pts.push(p);
    };
    for (const g of groups) {
        for (const t of [0, 0.5, 1]) {
            for (const p of g.outer) push(mapped(p, t));
            for (const hole of g.holes) for (const p of hole) push(mapped(p, t));
        }
        // Outline samples miss the letter interior (a 6 mm bowl is ~3 mm from
        // its contour). Fill so interior floor needles are in the band.
        // A non-finite or huge extent (bad mirror) must not spin this loop.
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of g.outer) {
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        const spanX = maxX - minX;
        const spanY = maxY - minY;
        if (!Number.isFinite(spanX) || !Number.isFinite(spanY) || spanX > 80 || spanY > 40) continue;
        for (let x = minX; x <= maxX; x += 0.5) {
            for (let y = minY; y <= maxY; y += 0.5) {
                if (!pointInPoly(x, y, g.outer)) continue;
                if (g.holes.some((h) => pointInPoly(x, y, h))) continue;
                push(mapped({ x, y }, 0.5));
            }
        }
    }
    const grid = new SampleGrid(pts, 0.5);
    const nearest = (x: number, y: number, z: number, maxMm: number): number =>
        grid.nearest({ x, y, z }, maxMm);
    return (ax, ay, az, bx, by, bz, cx, cy, cz) => {
        const mx = (ax + bx + cx) / 3;
        const my = (ay + by + cy) / 3;
        const mz = (az + bz + cz) / 3;
        const long = Math.max(
            Math.hypot(bx - ax, by - ay, bz - az),
            Math.hypot(cx - bx, cy - by, cz - bz),
            Math.hypot(ax - cx, ay - cy, az - cz),
        );
        const reach = padMm + long;
        return nearest(mx, my, mz, reach) <= reach;
    };
}

/**
 * Collapse needles (area < 1e-6 mm² or min angle < threshold) by welding the
 * shortest edge. When `band` is set, only triangles inside that band collapse.
 */
export function collapseDegenerateThenWeld(
    geo: BufferGeometry,
    forceWeldMm = 0,
    band?: TriBandPred,
    minAngleDeg = TEXT_DEGENERATE_MIN_ANGLE_DEG,
): BufferGeometry {
    const minAng = (minAngleDeg * Math.PI) / 180;
    const srcIndex = geo.getIndex();
    const srcPos = geo.getAttribute("position");
    if (!srcIndex || !srcPos) return geo;
    const src = srcIndex.array as ArrayLike<number>;
    const inBand = (
        i0: number,
        i1: number,
        i2: number,
        pos: { getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number },
    ) =>
        !band ||
        band(
            pos.getX(i0),
            pos.getY(i0),
            pos.getZ(i0),
            pos.getX(i1),
            pos.getY(i1),
            pos.getZ(i1),
            pos.getX(i2),
            pos.getY(i2),
            pos.getZ(i2),
        );
    let found = false;
    for (let t = 0; t + 2 < srcIndex.count; t += 3) {
        const i0 = src[t] ?? 0;
        const i1 = src[t + 1] ?? 0;
        const i2 = src[t + 2] ?? 0;
        if (!inBand(i0, i1, i2, srcPos)) continue;
        const m = triMetrics(
            srcPos.getX(i0),
            srcPos.getY(i0),
            srcPos.getZ(i0),
            srcPos.getX(i1),
            srcPos.getY(i1),
            srcPos.getZ(i1),
            srcPos.getX(i2),
            srcPos.getY(i2),
            srcPos.getZ(i2),
        );
        if (m.area < TEXT_DEGENERATE_AREA_MM2 || m.minAng < minAng) {
            found = true;
            break;
        }
    }
    if (!found && forceWeldMm <= 0) return geo;

    const work = geo.clone();
    const userData = geo.userData;
    for (let pass = 0; pass < 4; pass++) {
        const pos = work.getAttribute("position");
        const index = work.getIndex();
        if (!pos || !index) break;
        const nVert = pos.count;
        const parent = new Uint32Array(nVert);
        for (let i = 0; i < nVert; i++) parent[i] = i;
        const find = (i: number): number => {
            let x = i;
            while (parent[x] !== x) x = parent[x] ?? x;
            let y = i;
            while (y !== x) {
                const n = parent[y] ?? y;
                parent[y] = x;
                y = n;
            }
            return x;
        };
        const union = (a: number, b: number) => {
            const pa = find(a);
            const pb = find(b);
            if (pa !== pb) parent[pb] = pa;
        };
        const idx = index.array as ArrayLike<number>;
        let collapsed = 0;
        for (let t = 0; t + 2 < index.count; t += 3) {
            const i0 = idx[t] ?? 0;
            const i1 = idx[t + 1] ?? 0;
            const i2 = idx[t + 2] ?? 0;
            const m = triMetrics(
                pos.getX(i0),
                pos.getY(i0),
                pos.getZ(i0),
                pos.getX(i1),
                pos.getY(i1),
                pos.getZ(i1),
                pos.getX(i2),
                pos.getY(i2),
                pos.getZ(i2),
            );
            if (!inBand(i0, i1, i2, pos)) continue;
            if (m.area >= TEXT_DEGENERATE_AREA_MM2 && m.minAng >= minAng) continue;
            collapsed++;
            if (m.short === 0) union(i0, i1);
            else if (m.short === 1) union(i1, i2);
            else union(i2, i0);
        }
        if (!collapsed) break;
        const srcClass = readFaceClass(work);
        const nOld = index.count / 3;
        const nextIndex: number[] = [];
        const nextClass: number[] = [];
        for (let t = 0; t + 2 < index.count; t += 3) {
            const a = find(idx[t] ?? 0);
            const b = find(idx[t + 1] ?? 0);
            const c = find(idx[t + 2] ?? 0);
            // Skip tris that collapsed to a line. Do not drop leftover needles —
            // that opens the surface. Another pass unions their short edges.
            if (a === b || b === c || c === a) continue;
            nextIndex.push(a, b, c);
            if (srcClass && srcClass.length === nOld) nextClass.push(srcClass[t / 3] ?? 0);
        }
        if (nextIndex.length < 9) break;
        work.setIndex(nextIndex);
        if (nextClass.length === nextIndex.length / 3) writeFaceClass(work, nextClass);
    }
    work.computeVertexNormals();
    work.computeBoundingBox();
    const keptClass = readFaceClass(work);
    work.userData = { ...(userData ?? {}), ...(keptClass ? { faceClass: keptClass } : {}) };
    // Re-weld only when the snap stays a 2-manifold. A global mergeVertices on
    // Manifold-3d CSG output otherwise creates nm edges.
    const originalWatertight = indexedWatertight(geo);
    const tryWeld = (src: BufferGeometry, mm: number): BufferGeometry | null => {
        const welded = mergeVertices(src, mm);
        welded.computeVertexNormals();
        welded.computeBoundingBox();
        welded.userData = { ...src.userData };
        if (indexedWatertight(welded)) {
            if (welded !== src) src.dispose();
            return welded;
        }
        if (welded !== src) welded.dispose();
        return null;
    };
    if (forceWeldMm > 0) {
        const snapped = tryWeld(work, forceWeldMm);
        if (snapped) return snapped;
    }
    const welded = tryWeld(work, TEXT_WELD_MM);
    if (welded) return welded;
    if (indexedWatertight(work) || !originalWatertight) return work;
    work.dispose();
    return geo;
}

function manifoldToGeometry(handle: ManifoldHandle, userData: unknown): BufferGeometry {
    const mesh = handle.getMesh();
    const nProp = mesh.numProp || 3;
    const nVert = mesh.vertProperties.length / nProp;
    const positions = new Float32Array(nVert * 3);
    for (let i = 0; i < nVert; i++) {
        positions[i * 3] = mesh.vertProperties[i * nProp]!;
        positions[i * 3 + 1] = mesh.vertProperties[i * nProp + 1]!;
        positions[i * 3 + 2] = mesh.vertProperties[i * nProp + 2]!;
    }
    const nTri = mesh.triVerts.length / 3;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    geo.setIndex(Array.from(mesh.triVerts));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const faceClass = new Array<number>(nTri).fill(0);
    const ids = mesh.faceID;
    if (ids && ids.length >= nTri) {
        for (let i = 0; i < nTri; i++) faceClass[i] = (ids[i] ?? 0) & 3;
    }
    geo.userData = { ...(userData as object), faceClass };
    return geo;
}

function csgOnce(
    mod: ManifoldWasm,
    hostMesh: BufferGeometry,
    groups: TextGlyphGroup[],
    mapped: MapTextPoint,
    op: "add" | "subtract",
    userData: unknown,
    sidewallRings?: number,
    band?: TriBandPred,
): BufferGeometry {
    const a = geometryToManifold(mod, hostMesh, "host");
    const b = textGroupsToManifold(mod, groups, mapped, sidewallRings);
    let result: ManifoldHandle | null = null;
    try {
        result = op === "add" ? a.add(b) : a.subtract(b);
        const geo = manifoldToGeometry(result, userData);
        // Band-only 1° collapse: catches 0.53° slivers without a whole-mesh weld.
        const cleaned = collapseDegenerateThenWeld(geo, 0, band, TEXT_HOST_SLIVER_MIN_ANGLE_DEG);
        if (cleaned !== geo) geo.dispose();
        return cleaned;
    } finally {
        result?.delete();
        a.delete();
        b.delete();
    }
}

function soupHitsInBand(
    geo: BufferGeometry,
    groups: TextGlyphGroup[],
    mapped: MapTextPoint,
    padMm: number,
): ReturnType<typeof countSoupSelfIntersections> {
    const all = countSoupSelfIntersections(geo, TEXT_WELD_MM);
    const band = makeFootprintBand(groups, mapped, padMm);
    const pairs = all.pairs.filter((p) => {
        const c = p.centroid;
        const a = p.a[0]!;
        const b = p.a[1]!;
        const d = p.a[2]!;
        return (
            band(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z) ||
            band(
                p.b[0]!.x,
                p.b[0]!.y,
                p.b[0]!.z,
                p.b[1]!.x,
                p.b[1]!.y,
                p.b[1]!.z,
                p.b[2]!.x,
                p.b[2]!.y,
                p.b[2]!.z,
            ) ||
            Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z) < padMm
        );
    });
    return { real: pairs.length, coplanar: all.coplanar, pairs };
}

/** Repair pre-existing slivers / SI (min angle < 1°) inside footprint + pad only. */
export function repairHostBand(
    host: BufferGeometry,
    groups: TextGlyphGroup[],
    mapped: MapTextPoint,
    padMm = TEXT_HOST_SI_PAD_MM,
): { geo: BufferGeometry; report: TextHostRepair } {
    const band = makeFootprintBand(groups, mapped, padMm);
    const before = soupHitsInBand(host, groups, mapped, padMm);
    const repaired = collapseDegenerateThenWeld(host, 0, band, TEXT_HOST_SLIVER_MIN_ANGLE_DEG);
    const after = soupHitsInBand(repaired, groups, mapped, padMm);
    const src = host.getIndex();
    const dst = repaired.getIndex();
    const collapsed = Math.max(0, ((src?.count ?? 0) - (dst?.count ?? 0)) / 3);
    return {
        geo: repaired,
        report: { collapsed, siBefore: before.real, siAfter: after.real },
    };
}

function soupRealHits(geo: BufferGeometry): number {
    return countSoupSelfIntersections(geo, TEXT_WELD_MM).real;
}

function restoreOutsideVerts(
    result: BufferGeometry,
    host: BufferGeometry,
    groups: TextGlyphGroup[],
    mapped: MapTextPoint,
): void {
    const hostPos = host.getAttribute("position");
    const resPos = result.getAttribute("position");
    if (!hostPos || !resPos) return;
    const outlineWorld = groups.map((g) => ({
        outer: g.outer.map((p) => mapped(p, 0.5)),
        holes: g.holes.map((h) => h.map((p) => mapped(p, 0.5))),
    }));
    const outline = outlineWorld.flatMap((g) => [g.outer, ...g.holes].flat());
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const p of outline) {
        if (p.z < zMin) zMin = p.z;
        if (p.z > zMax) zMax = p.z;
    }
    const meta = {
        surface: zMax - zMin < 2 ? "bottom" : "wall",
        outlineWorld,
        centroids: [],
        mode: "engrave",
        depthMm: 0.8,
        heightMm: 0,
        capHeightMm: 6,
        advanceMm: 0,
        mappedWidthMm: 0,
    } as TextApplyMeta;
    const cell = 0.25;
    const grid = new Map<string, number[]>();
    const keyOf = (x: number, y: number, z: number) =>
        `${Math.floor(x / cell)}|${Math.floor(y / cell)}|${Math.floor(z / cell)}`;
    for (let i = 0; i < resPos.count; i++) {
        const k = keyOf(resPos.getX(i), resPos.getY(i), resPos.getZ(i));
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
    }
    const claimed = new Set<number>();
    for (let hi = 0; hi < hostPos.count; hi++) {
        const hx = hostPos.getX(hi);
        const hy = hostPos.getY(hi);
        const hz = hostPos.getZ(hi);
        if (distToTextRegion({ x: hx, y: hy, z: hz }, meta, outline) <= TEXT_REGION_PAD_MM) continue;
        let best = TEXT_WELD_MM;
        let bestI = -1;
        const ix = Math.floor(hx / cell);
        const iy = Math.floor(hy / cell);
        const iz = Math.floor(hz / cell);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const list = grid.get(`${ix + dx}|${iy + dy}|${iz + dz}`);
                    if (!list) continue;
                    for (const ri of list) {
                        if (claimed.has(ri)) continue;
                        const d = Math.hypot(
                            hx - resPos.getX(ri),
                            hy - resPos.getY(ri),
                            hz - resPos.getZ(ri),
                        );
                        if (d < best) {
                            best = d;
                            bestI = ri;
                        }
                    }
                }
            }
        }
        if (bestI >= 0 && best > 1e-4) {
            resPos.setXYZ(bestI, hx, hy, hz);
            claimed.add(bestI);
        }
    }
    resPos.needsUpdate = true;
}

/** Single manifold-3d WASM boolean. `op` add = emboss, subtract = engrave. */
export async function booleanTextSolid(
    host: BufferGeometry,
    groups: TextGlyphGroup[],
    mapPoint: MapTextPoint,
    op: "add" | "subtract",
    rebind?: (geo: BufferGeometry) => MapTextPoint,
    sidewallRings?: number,
): Promise<BufferGeometry> {
    const mod = await loadWasm();
    const mappedOrig = rebind ? rebind(host) : mapPoint;
    const hostFix = repairHostBand(host, groups, mappedOrig, TEXT_HOST_SI_PAD_MM);
    const hostWork = hostFix.geo;
    const regionBand = makeFootprintBand(groups, mappedOrig, TEXT_REGION_PAD_MM);
    const refined = refineHostLocally(hostWork, groups, mappedOrig, TEXT_REGION_PAD_MM);
    const prepped = collapseDegenerateThenWeld(refined, 0, regionBand);
    if (prepped !== refined && refined !== hostWork && refined !== host) {
        if (prepped !== host && prepped !== hostWork) refined.dispose();
    }
    const refinedOk = prepped !== host && prepped !== hostWork && indexedWatertight(prepped);
    const mappedRefined = rebind && refinedOk ? rebind(prepped) : mappedOrig;
    let mapUsed = mappedOrig;
    const finish = (geo: BufferGeometry): BufferGeometry => {
        const ud = { ...geo.userData };
        const kept = dropInvertedShells(geo);
        if (kept !== geo) geo.dispose();
        kept.userData = { ...ud, ...kept.userData, textHostRepair: hostFix.report };
        return kept;
    };
    try {
        let geo: BufferGeometry;
        try {
            if (refinedOk) {
                mapUsed = mappedRefined;
                geo = csgOnce(
                    mod,
                    prepped,
                    groups,
                    mappedRefined,
                    op,
                    host.userData,
                    sidewallRings,
                    regionBand,
                );
                if (soupRealHits(geo) > 0) {
                    const orig = csgOnce(
                        mod,
                        hostWork,
                        groups,
                        mappedOrig,
                        op,
                        host.userData,
                        sidewallRings,
                        regionBand,
                    );
                    if (soupRealHits(orig) === 0) {
                        geo.dispose();
                        geo = orig;
                        mapUsed = mappedOrig;
                    } else {
                        orig.dispose();
                    }
                }
            } else {
                mapUsed = mappedOrig;
                geo = csgOnce(
                    mod,
                    hostWork,
                    groups,
                    mappedOrig,
                    op,
                    host.userData,
                    sidewallRings,
                    regionBand,
                );
            }
        } catch (e) {
            if (refinedOk) {
                mapUsed = mappedOrig;
                geo = csgOnce(
                    mod,
                    hostWork,
                    groups,
                    mappedOrig,
                    op,
                    host.userData,
                    sidewallRings,
                    regionBand,
                );
            } else if (e instanceof TextMarkingError) {
                throw e;
            } else {
                throw new TextMarkingError(
                    "boolean",
                    `boolean failed: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
        }
        let cleaned = collapseDegenerateThenWeld(geo, 0, regionBand, TEXT_HOST_SLIVER_MIN_ANGLE_DEG);
        if (cleaned !== geo) geo.dispose();
        const smoothed = collapseSafeBand(cleaned, regionBand);
        if (smoothed !== cleaned) {
            cleaned.dispose();
            cleaned = smoothed;
        }
        const flipped = flipShortNeedles(cleaned, regionBand);
        if (flipped !== cleaned) {
            cleaned.dispose();
            cleaned = flipped;
        }
        restoreOutsideVerts(cleaned, host, groups, mappedOrig);
        const qem = decimateCoplanarCaps(cleaned, groups, mapUsed);
        if (qem.geo !== cleaned) {
            cleaned.dispose();
            cleaned = qem.geo;
        }
        cleaned.userData = { ...cleaned.userData, textQem: qem.report };
        const hits = countSoupSelfIntersections(cleaned, TEXT_WELD_MM);
        if (hits.real > 0 && hostFix.report.siAfter === 0) {
            const p = hits.pairs[0];
            throw new TextMarkingError(
                "stl-gate",
                `text boolean self-intersects after a clean host ` +
                    `(hostRepair collapsed=${hostFix.report.collapsed} siBefore=${hostFix.report.siBefore}): ` +
                    `triA#${p?.triA}=${JSON.stringify(p?.a)} triB#${p?.triB}=${JSON.stringify(p?.b)} ` +
                    `centroid=${JSON.stringify(p?.centroid)}`,
            );
        }
        return finish(cleaned);
    } catch (e) {
        if (e instanceof TextMarkingError) throw e;
        throw new TextMarkingError(
            "boolean",
            `boolean failed: ${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
        if (prepped !== host && prepped !== hostWork) prepped.dispose();
        if (hostWork !== host && hostWork !== prepped) hostWork.dispose();
    }
}
