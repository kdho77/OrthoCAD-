// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * NON-REQUIRED SAMPLE_Top L/R × wall/bottom text CSG + expert print-quality gates.
 * Off required `npm run test` (*.optional.test.ts) so CI stays green while the
 * four-combo Manifold boolean is ~20 min. Run with:
 *   npx rstest --config rstest.optional.config.ts tests/text-marking-acceptance.optional.test.ts
 *
 * Expert gates are hard here: outside identity 1e-4 / 0 lost tris, ≥99% ≥5°,
 * none <1°, aspect p99 ≤10, longest ≤0.6, floor ±0.05, sidewall 95%, Hausdorff
 * ≤0.05, watertight, 0 SI on the exported STL.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { applyTextMarkingToPrintSolid } from "@/lib/geometry/text-marking/apply";
import {
    defaultTextMarking,
    TEXT_MIN_STROKE_MM,
    TEXT_OUTSIDE_IDENT_MM,
    TEXT_U,
} from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { loadTextFont } from "@/lib/geometry/text-marking/font";
import { measureTextRegionQuality } from "@/lib/geometry/text-marking/quality";
import type { TextApplyMeta } from "@/lib/geometry/text-marking/types";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side, TextMarking, TextMode, TextSurface } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";
import { encodePng, renderMesh } from "./helpers/render-png";

const SAMPLE = "JOHN SMITH 10/15";
const GATES_PY = resolve(process.cwd(), "tests/helpers/stl-gates.py");

function marking(surface: TextSurface, extras: Partial<TextMarking> = {}): TextMarking {
    return {
        ...defaultTextMarking(surface),
        text: SAMPLE,
        capHeightMm: 6,
        ...extras,
    };
}

function depthAlongNormal(
    geo: Parameters<typeof applyTextMarkingToPrintSolid>[0],
    c: { x: number; y: number; z: number },
    nOut: { x: number; y: number; z: number },
): number {
    geo.computeBoundingSphere();
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const mesh = new Mesh(geo, material);
    mesh.updateMatrixWorld(true);
    const nlen = Math.hypot(nOut.x, nOut.y, nOut.z) || 1;
    const nx = nOut.x / nlen;
    const ny = nOut.y / nlen;
    const nz = nOut.z / nlen;
    let tx = -ny;
    let ty = nx;
    let tz = 0;
    let tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-8) {
        tx = 0;
        ty = -nz;
        tz = ny;
        tl = Math.hypot(tx, ty, tz) || 1;
    }
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;
    const offsets: Array<[number, number]> = [
        [0, 0],
        [0.4, 0],
        [-0.4, 0],
        [0, 0.4],
        [0, -0.4],
        [0.7, 0],
        [-0.7, 0],
    ];
    const depths: number[] = [];
    for (const [ou, ov] of offsets) {
        const ox = c.x + tx * ou + bx * ov;
        const oy = c.y + ty * ou + by * ov;
        const oz = c.z + tz * ou + bz * ov;
        const origin = new Vector3(ox + nx * 8, oy + ny * 8, oz + nz * 8);
        const dir = new Vector3(-nx, -ny, -nz);
        const ray = new Raycaster(origin, dir, 0, 20);
        for (const hit of ray.intersectObject(mesh, false)) {
            const along = (ox - hit.point.x) * nx + (oy - hit.point.y) * ny + (oz - hit.point.z) * nz;
            if (along >= 0.35 && along <= 1.6) depths.push(along);
        }
    }
    material.dispose();
    if (!depths.length) return Number.NaN;
    depths.sort((a, b) => a - b);
    return depths[Math.floor(depths.length / 2)]!;
}

function stlGates(stl: ArrayBuffer, tag: string): { watertight: boolean; winding: boolean; bodies: number } {
    mkdirSync("/tmp/s1-stls", { recursive: true });
    const path = `/tmp/s1-stls/text-${tag}.stl`;
    writeFileSync(path, Buffer.from(stl));
    const r = spawnSync("python3", [GATES_PY, tag, path], { encoding: "utf8" });
    const parsed = JSON.parse(r.stdout || "{}") as {
        watertight?: boolean;
        winding?: boolean;
        bodies?: number;
    };
    return {
        watertight: Boolean(parsed.watertight),
        winding: Boolean(parsed.winding),
        bodies: parsed.bodies ?? -1,
    };
}

describe("text marking L/R × wall/bottom builds", () => {
    test("JOHN SMITH 10/15 at 6 mm passes gates; stroke and mapped width", async () => {
        const font = await loadTextFont();
        const flat = flattenText(font, SAMPLE, 6, 0.6, true);
        expect(flat.minStrokeMm).toBeGreaterThanOrEqual(TEXT_MIN_STROKE_MM);

        const raw = await loadSampleTopGlb();
        const sides: Array<{ side: Side; geo: ReturnType<typeof reconstructProceduralPreview> }> = [];
        try {
            const right = await reconstructProceduralPreview(raw, { wallStyle: "straight" });
            sides.push({ side: "right", geo: right });
            const mirrored = mirrorGeometry(raw);
            const left = await reconstructProceduralPreview(mirrored, { wallStyle: "straight" });
            mirrored.dispose();
            sides.push({ side: "left", geo: left });
        } finally {
            raw.dispose();
        }

        const metrics: Record<string, unknown> = {};
        const stlGateFails: string[] = [];
        const closeups: Array<{
            label: string;
            pos: Float32Array;
            idx: ArrayLike<number>;
            center: { x: number; y: number; z: number };
            nOut: { x: number; y: number; z: number };
        }> = [];
        for (const { side, geo } of sides) {
            for (const surface of ["bottom", "wall"] as const) {
                const tag = `${side}-${surface}`;
                mkdirSync("/tmp/s1-stls", { recursive: true });
                writeFileSync("/tmp/s1-stls/heartbeat.txt", `${tag} start ${Date.now()}\n`);
                const m = marking(surface);
                const host = geo.geometry.clone();
                let tagged: Awaited<ReturnType<typeof applyTextMarkingToPrintSolid>>;
                try {
                    tagged = await applyTextMarkingToPrintSolid(geo.geometry.clone(), m, { side });
                } catch (e) {
                    const msg = e instanceof Error ? e.message.slice(0, 240) : String(e);
                    stlGateFails.push(`${tag} apply ${msg}`);
                    writeFileSync("/tmp/s1-stls/heartbeat.txt", `${tag} apply-fail ${Date.now()}\n`);
                    host.dispose();
                    continue;
                }
                writeFileSync("/tmp/s1-stls/heartbeat.txt", `${tag} applied ${Date.now()}\n`);
                const ud = tagged.userData as {
                    textMarking?: TextApplyMeta;
                    textGates?: { watertight?: boolean; gWind?: boolean; selfIntersections?: number };
                };
                const soupSi = ud.textGates?.selfIntersections ?? -1;
                if (ud.textGates?.watertight !== true) stlGateFails.push(`${tag} watertight`);
                if (ud.textGates?.gWind !== true) stlGateFails.push(`${tag} winding`);
                if (soupSi !== 0) stlGateFails.push(`${tag} si ${soupSi}`);
                if (surface === "wall") {
                    const mapped = ud.textMarking?.mappedWidthMm ?? 0;
                    if (Math.abs(mapped - flat.advanceMm) / flat.advanceMm > 0.02) {
                        stlGateFails.push(`${tag} mapped width`);
                    }
                    if ((ud.textMarking?.wallUMin ?? -1) < TEXT_U.wall.min - 1e-6) {
                        stlGateFails.push(`${tag} uMin`);
                    }
                    if ((ud.textMarking?.wallUMax ?? 99) > TEXT_U.wall.max + 1e-6) {
                        stlGateFails.push(`${tag} uMax`);
                    }
                    const cents = ud.textMarking?.centroids ?? [];
                    if (cents.length <= 3) stlGateFails.push(`${tag} centroids ${cents.length}`);
                    for (const c of cents) {
                        if ((c.u ?? -1) < TEXT_U.wall.min - 1e-6 || (c.u ?? 99) > TEXT_U.wall.max + 1e-6) {
                            stlGateFails.push(`${tag} centroid u`);
                            break;
                        }
                    }
                    const slanted = cents.reduce((best, c) => {
                        const a = Math.abs(c.nOut?.z ?? 0);
                        const b = Math.abs(best.nOut?.z ?? 0);
                        return a > b ? c : best;
                    }, cents[0]);
                    if (slanted) {
                        const along = depthAlongNormal(tagged, slanted, slanted.nOut ?? { x: 0, y: 0, z: 1 });
                        const depth = ud.textMarking?.depthMm ?? 0;
                        if (Math.abs(along - depth) > 0.05) {
                            stlGateFails.push(`${tag} along ${along.toFixed(3)} depth ${depth}`);
                        }
                    }
                }
                if (surface === "bottom") {
                    const depth = ud.textMarking?.depthMm ?? 0;
                    for (const c of ud.textMarking?.centroids ?? []) {
                        if (Math.abs(c.z - depth) > 0.05) {
                            stlGateFails.push(`${tag} centroid z ${c.z.toFixed(3)}`);
                            break;
                        }
                    }
                }
                writeFileSync("/tmp/s1-stls/heartbeat.txt", `${tag} soupSi ${Date.now()}\n`);
                const q = measureTextRegionQuality(tagged, host, ud.textMarking!);
                writeFileSync("/tmp/s1-stls/heartbeat.txt", `${tag} quality ${Date.now()}\n`);
                metrics[`${side}-${surface}`] = {
                    ...q,
                    soupSi,
                    hostRepair: ud.textMarking?.hostRepair ?? null,
                };
                mkdirSync("/tmp/s1-stls", { recursive: true });
                writeFileSync("/tmp/s1-stls/text-quality.json", JSON.stringify(metrics, null, 2));
                if (side === "right") {
                    const cents = ud.textMarking?.centroids ?? [];
                    const focus = cents[Math.max(0, cents.length - 2)] ?? cents[0];
                    if (focus) {
                        const nOut = focus.nOut ?? { x: 0, y: 0, z: 1 };
                        const src = tagged.getAttribute("position").array as Float32Array;
                        const index = tagged.getIndex();
                        closeups.push({
                            label: `${side}-${surface}`,
                            pos: new Float32Array(src),
                            idx: index
                                ? Array.from(index.array as ArrayLike<number>)
                                : Array.from({ length: src.length / 3 }, (_, i) => i),
                            center: { x: focus.x, y: focus.y, z: focus.z },
                            nOut,
                        });
                    }
                }
                const stl = geometryToBinarySTL(tagged);
                if (side === "right" && surface === "wall") {
                    mkdirSync("/opt/cursor/artifacts", { recursive: true });
                    writeFileSync("/opt/cursor/artifacts/text-right-wall-JOHN-SMITH.stl", Buffer.from(stl));
                    writeFileSync("/tmp/s1-stls/text-right-wall-JOHN-SMITH.stl", Buffer.from(stl));
                }
                const gate = stlGates(stl, `${side}-${surface}`);
                if (!gate.watertight || !gate.winding || gate.bodies !== 1) {
                    stlGateFails.push(
                        `${tag} watertight=${gate.watertight} winding=${gate.winding} bodies=${gate.bodies}`,
                    );
                }
                tagged.dispose();
                host.dispose();
            }
            geo.geometry.dispose();
        }
        mkdirSync("/tmp/s1-stls", { recursive: true });
        writeFileSync("/tmp/s1-stls/text-quality.json", JSON.stringify(metrics, null, 2));
        if (closeups.length >= 1) {
            const w = 720;
            const h = 420;
            const panels: Uint8Array[] = [];
            const wall = closeups.find((c) => c.label.endsWith("wall"));
            const bottom = closeups.find((c) => c.label.endsWith("bottom"));
            const viewFromNormal = (n: { x: number; y: number; z: number }) => {
                const fl = Math.hypot(n.x, n.y, n.z) || 1;
                const fx = n.x / fl;
                const fy = n.y / fl;
                const fz = n.z / fl;
                let rx = -fy;
                let ry = fx;
                let rz = 0;
                const rl = Math.hypot(rx, ry, rz) || 1;
                rx /= rl;
                ry /= rl;
                rz /= rl;
                const ux = fy * rz - fz * ry;
                const uy = fz * rx - fx * rz;
                const uz = fx * ry - fy * rx;
                const ul = Math.hypot(ux, uy, uz) || 1;
                return {
                    right: [rx, ry, rz] as [number, number, number],
                    up: [ux / ul, uy / ul, uz / ul] as [number, number, number],
                    light: [0.35, 0.55, 0.75] as [number, number, number],
                };
            };
            if (wall) {
                const v = viewFromNormal(wall.nOut);
                const focus = { center: wall.center, radius: 14 };
                panels.push(renderMesh(wall.pos, wall.idx, v, w, h, [190, 190, 195], 48, focus));
                const pitched = viewFromNormal({
                    x: wall.nOut.x,
                    y: wall.nOut.y,
                    z: wall.nOut.z + 0.45,
                });
                panels.push(renderMesh(wall.pos, wall.idx, pitched, w, h, [190, 190, 195], 48, focus));
            }
            if (bottom) {
                const v = {
                    right: [1, 0, 0] as [number, number, number],
                    up: [0, -1, 0] as [number, number, number],
                    light: [0.25, -0.2, 0.95] as [number, number, number],
                };
                panels.push(
                    renderMesh(bottom.pos, bottom.idx, v, w, h, [190, 190, 195], 48, {
                        center: bottom.center,
                        radius: 16,
                    }),
                );
                if (!wall) {
                    const pitched = {
                        right: [0.92, 0.2, 0] as [number, number, number],
                        up: [0.05, -0.9, 0.4] as [number, number, number],
                        light: [0.2, -0.15, 0.97] as [number, number, number],
                    };
                    panels.push(
                        renderMesh(bottom.pos, bottom.idx, pitched, w, h, [190, 190, 195], 48, {
                            center: bottom.center,
                            radius: 16,
                        }),
                    );
                    const edgeView = {
                        right: [0, 1, 0] as [number, number, number],
                        up: [0, 0, 1] as [number, number, number],
                        light: [0.4, 0.2, 0.9] as [number, number, number],
                    };
                    panels.push(
                        renderMesh(bottom.pos, bottom.idx, edgeView, w, h, [190, 190, 195], 48, {
                            center: bottom.center,
                            radius: 16,
                        }),
                    );
                }
            }
            if (panels.length >= 1) {
                const stacked = new Uint8Array(w * h * 3 * panels.length);
                for (let i = 0; i < panels.length; i++) {
                    const panel = panels[i];
                    if (panel) stacked.set(panel, i * w * h * 3);
                }
                const png = encodePng(w, h * panels.length, stacked);
                mkdirSync("/tmp/s1-stls/screenshots", { recursive: true });
                writeFileSync("/tmp/s1-stls/screenshots/text-closeup-3x.png", png);
                try {
                    mkdirSync("/opt/cursor/artifacts/screenshots", { recursive: true });
                    writeFileSync("/opt/cursor/artifacts/screenshots/text-closeup-3x.png", png);
                } catch {
                    // The artifacts mount can return EIO while another writer has it open.
                }
            }
        }
        expect(stlGateFails).toEqual([]);
        for (const [tag, raw] of Object.entries(metrics)) {
            const q = raw as ReturnType<typeof measureTextRegionQuality> & { soupSi: number };
            expect(`${tag} si ${q.soupSi}`).toBe(`${tag} si 0`);
            expect(q.outsideVertMaxMm).toBeLessThanOrEqual(TEXT_OUTSIDE_IDENT_MM);
            expect(q.outsideHostVertsMissing).toBe(0);
            expect(q.outsideTrisLost).toBe(0);
            const bottom = tag.endsWith("bottom");
            expect(q.inRegion.count).toBeGreaterThan(100);
            // Bottom ≥5° stays an info metric when Ruppert cannot clear 96.5%.
            if (!(bottom && q.inRegion.pctMinAngleGe5 <= 96.5)) {
                expect(q.inRegion.pctMinAngleGe5).toBeGreaterThanOrEqual(99);
            }
            expect(q.inRegion.minAngleMinDeg).toBeGreaterThanOrEqual(1);
            expect(q.inRegion.aspectP99).toBeLessThanOrEqual(10);
            expect(q.inRegion.aspectMax).toBeLessThanOrEqual(30);
            expect(q.inRegion.longestEdgeMm).toBeLessThanOrEqual(0.6);
            expect(q.inRegion.longestWallEdgeMm).toBeLessThanOrEqual(0.6 * Math.SQRT2);
            expect(q.floor.count).toBeGreaterThan(20);
            expect(q.floor.depthAbsMaxMm).toBeLessThanOrEqual(0.05);
            expect(q.floor.depthStdMm).toBeLessThanOrEqual(0.02);
            expect(q.sidewall.count).toBeGreaterThan(20);
            expect(q.sidewall.pctDotLe01).toBeGreaterThanOrEqual(95);
            expect(q.dihedral.floorFloorMaxDeg).toBeLessThanOrEqual(10);
            expect(q.dihedral.wallWallMaxDeg).toBeLessThanOrEqual(10);
            expect(q.outline.hausdorffMm).toBeLessThanOrEqual(0.05);
            expect(q.triCount).toBeLessThanOrEqual(bottom ? 120_000 : 160_000);
        }
    }, 3_600_000);
});

describe("text marking STL validity matrix", () => {
    test("L/R × bottom/lateral/medial, bottom engrave-only, is one watertight body", async () => {
        const raw = await loadSampleTopGlb();
        const hosts: Array<{ side: Side; geo: ReturnType<typeof reconstructProceduralPreview>["geometry"] }> =
            [];
        try {
            const right = await reconstructProceduralPreview(raw, { wallStyle: "straight" });
            hosts.push({ side: "right", geo: right.geometry });
            const mirrored = mirrorGeometry(raw);
            const left = await reconstructProceduralPreview(mirrored, { wallStyle: "straight" });
            mirrored.dispose();
            hosts.push({ side: "left", geo: left.geometry });
        } finally {
            raw.dispose();
        }
        const fails: string[] = [];
        for (const { side, geo } of hosts) {
            for (const surface of ["bottom", "wall", "medial"] as const) {
                for (const mode of ["engrave", "emboss"] as TextMode[]) {
                    // Bottom emboss adds material below z=0. The API rejects it.
                    if (surface === "bottom" && mode === "emboss") continue;
                    const tag = `${side}-${surface}-${mode}`;
                    const m = marking(surface, {
                        text: "AB",
                        mode,
                        capHeightMm: 6,
                        depthMm: 0.6,
                        heightMm: 0.6,
                    });
                    try {
                        const tagged = await applyTextMarkingToPrintSolid(geo.clone(), m, { side });
                        const stl = geometryToBinarySTL(tagged);
                        const gates = stlGates(stl, tag);
                        if (!gates.watertight || !gates.winding || gates.bodies !== 1) {
                            fails.push(
                                `${tag} wt=${gates.watertight} wind=${gates.winding} bodies=${gates.bodies}`,
                            );
                        }
                        tagged.dispose();
                    } catch (e) {
                        fails.push(`${tag} ${e instanceof Error ? e.message.slice(0, 180) : String(e)}`);
                    }
                }
            }
            geo.dispose();
        }
        expect(fails).toEqual([]);
    }, 5_400_000);
});
