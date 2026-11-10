// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { analyzeManifoldBuffers } from "@/lib/geometry/manifold-core";
import { getAfoState, ingestOrientedScan, useAfoStore } from "@/stores/afo-store";
import { cloneableWorkerOptions } from "./afo-engine";
import { detectTibialCrest } from "./crest";
import {
    AFO_EDGE_MM,
    AFO_FLARE_MM,
    AFO_FOOTPLATE_FLARE_CAP_MM,
    AFO_THICKNESS_MM,
    defaultAfoDesignState,
} from "./defaults";
import { countMeshBodies, duplicateDirectedEdgeCount, meshProjector, meshSignedVolume } from "./mesh-ops";
import { buildAfoShell, trimPolygonForShell } from "./shell";
import { buildClinicalFixtureA, buildLiveFrameLeg, buildUnitSphereMesh } from "./synthetic-leg";
import { AFO_TRIM_NO_MESH, designLandmarkPlacementActive, trimPointerIsClick } from "./trim-preview";
import { balanceBracePins, fitSurfaceSpline, posteriorLeafPins } from "./trim-spline";
import type { AfoTriMesh, AfoVec3 } from "./types";

function dist(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function at(mesh: AfoTriMesh, i: number): AfoVec3 {
    return {
        x: mesh.positions[i * 3] ?? 0,
        y: mesh.positions[i * 3 + 1] ?? 0,
        z: mesh.positions[i * 3 + 2] ?? 0,
    };
}

function pointSegmentDist(p: AfoVec3, a: AfoVec3, b: AfoVec3): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const ab2 = abx * abx + aby * aby + abz * abz || 1;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / ab2));
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
}

function distToPolyline(p: AfoVec3, loop: AfoVec3[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++)
        best = Math.min(best, pointSegmentDist(p, loop[i]!, loop[(i + 1) % loop.length]!));
    return best;
}

/** Skin-side opening loops: boundaries of the faces that still lie on the source. */
function innerRimLoops(shell: AfoTriMesh, source: AfoTriMesh): AfoVec3[][] {
    const projector = meshProjector(source);
    const nAll = (shell.positions.length / 3) | 0;
    const err: number[] = [];
    for (let i = 0; i < nAll; i++) err.push(projector.closest(at(shell, i)).errorMm);
    let n = 0;
    while (n < nAll && (err[n] ?? 1) < 0.2) n++;
    const onSkin: boolean[] = err.map((e) => e < 0.12);
    const t = (shell.indices.length / 3) | 0;
    const edgeCount = new Map<string, { a: number; b: number; n: number }>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < t; i++) {
        const vs = [shell.indices[i * 3] ?? 0, shell.indices[i * 3 + 1] ?? 0, shell.indices[i * 3 + 2] ?? 0];
        if (!vs.every((v) => onSkin[v])) continue;
        for (let e = 0; e < 3; e++) {
            const a = vs[e]!;
            const b = vs[(e + 1) % 3]!;
            const k = key(a, b);
            const prev = edgeCount.get(k);
            if (prev) prev.n += 1;
            else edgeCount.set(k, { a, b, n: 1 });
        }
    }
    const next = new Map<number, number[]>();
    const unused = new Set<string>();
    for (const e of edgeCount.values()) {
        if (e.n !== 1) continue;
        (next.get(e.a) ?? next.set(e.a, []).get(e.a)!).push(e.b);
        (next.get(e.b) ?? next.set(e.b, []).get(e.b)!).push(e.a);
        unused.add(e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`);
    }
    const loops: AfoVec3[][] = [];
    for (const start of next.keys()) {
        const open = (next.get(start) ?? []).some((b) =>
            unused.has(start < b ? `${start}|${b}` : `${b}|${start}`),
        );
        if (!open) continue;
        const ids = [start];
        const seen = new Set<number>([start]);
        let cur = start;
        for (let guard = 0; guard < nAll; guard++) {
            const nxt = (next.get(cur) ?? []).find((v) =>
                unused.has(cur < v ? `${cur}|${v}` : `${v}|${cur}`),
            );
            if (nxt == null) break;
            unused.delete(cur < nxt ? `${cur}|${nxt}` : `${nxt}|${cur}`);
            if (seen.has(nxt)) break;
            ids.push(nxt);
            seen.add(nxt);
            cur = nxt;
        }
        if (ids.length >= 3) loops.push(ids.map((i) => at(shell, i)));
    }
    return loops;
}

function rimDihedralDeg(shell: AfoTriMesh): { deg: number; x: number; y: number; z: number } {
    const face0 = shell.rimFaceStart ?? (shell.indices.length / 3) | 0;
    const t = (shell.indices.length / 3) | 0;
    const normals: AfoVec3[] = [];
    const rim = new Uint8Array(t);
    for (let i = 0; i < t; i++) {
        const vs = [shell.indices[i * 3] ?? 0, shell.indices[i * 3 + 1] ?? 0, shell.indices[i * 3 + 2] ?? 0];
        if (i >= face0) rim[i] = 1;
        const a = at(shell, vs[0]!);
        const b = at(shell, vs[1]!);
        const c = at(shell, vs[2]!);
        const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
        const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-6) rim[i] = 0;
        normals.push({
            x: nx / (len || 1),
            y: ny / (len || 1),
            z: nz / (len || 1),
        });
    }
    const edgeFaces = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < t; i++) {
        const vs = [shell.indices[i * 3] ?? 0, shell.indices[i * 3 + 1] ?? 0, shell.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = edgeFaces.get(k);
            if (list) list.push(i);
            else edgeFaces.set(k, [i]);
        }
    }
    let worst = 0;
    let where = { x: 0, y: 0, z: 0 };
    for (const faces of edgeFaces.values()) {
        if (faces.length !== 2) continue;
        if (!rim[faces[0]!] || !rim[faces[1]!]) continue;
        const va = [0, 1, 2].map((k) => shell.indices[faces[0]! * 3 + k] ?? 0);
        const vb = [0, 1, 2].map((k) => shell.indices[faces[1]! * 3 + k] ?? 0);
        const shared = va.filter((v) => vb.includes(v));
        if (shared.length !== 2) continue;
        const pa = at(shell, shared[0]!);
        const pb = at(shell, shared[1]!);
        if (dist(pa, pb) < 0.05) continue;
        const n0 = normals[faces[0]!]!;
        const n1 = normals[faces[1]!]!;
        const c = Math.min(1, Math.max(-1, n0.x * n1.x + n0.y * n1.y + n0.z * n1.z));
        const deg = (Math.acos(c) * 180) / Math.PI;
        if (deg > worst) {
            worst = deg;
            where = { x: (pa.x + pb.x) * 0.5, y: (pa.y + pb.y) * 0.5, z: (pa.z + pb.z) * 0.5 };
        }
    }
    return { deg: worst, ...where };
}

/** Skin-skin edges near the opening. The rim-to-skin junction is left out; it is meant to be about 90°. */
function nearOpeningFold(
    shell: AfoTriMesh,
    opening: AfoVec3[],
): { count: number; deg: number; x: number; y: number; z: number } {
    const face0 = shell.rimFaceStart ?? (shell.indices.length / 3) | 0;
    const t = (shell.indices.length / 3) | 0;
    const normals: AfoVec3[] = [];
    const areas: number[] = [];
    for (let i = 0; i < t; i++) {
        const ia = shell.indices[i * 3] ?? 0;
        const ib = shell.indices[i * 3 + 1] ?? 0;
        const ic = shell.indices[i * 3 + 2] ?? 0;
        const a = at(shell, ia);
        const b = at(shell, ib);
        const c = at(shell, ic);
        const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
        const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const len = Math.hypot(nx, ny, nz);
        areas.push(len * 0.5);
        normals.push({ x: nx / (len || 1), y: ny / (len || 1), z: nz / (len || 1) });
    }
    const edgeFaces = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < t; i++) {
        const vs = [shell.indices[i * 3] ?? 0, shell.indices[i * 3 + 1] ?? 0, shell.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = edgeFaces.get(k);
            if (list) list.push(i);
            else edgeFaces.set(k, [i]);
        }
    }
    let count = 0;
    let worst = 0;
    let worstArea = 0;
    let worstSide = "";
    let where = { x: 0, y: 0, z: 0 };
    for (const [k, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const f0 = faces[0]!;
        const f1 = faces[1]!;
        if (f0 >= face0 || f1 >= face0) continue;
        const [sa, sb] = k.split("|").map(Number);
        const pa = at(shell, sa!);
        const pb = at(shell, sb!);
        if (dist(pa, pb) < 0.05) continue;
        const mid = { x: (pa.x + pb.x) * 0.5, y: (pa.y + pb.y) * 0.5, z: (pa.z + pb.z) * 0.5 };
        if (distToPolyline(mid, opening) > 3) continue;
        // A face under 0.1 mm² is a collapsed remnant; its normal is not a real fold.
        if ((areas[f0] ?? 0) < 0.1 || (areas[f1] ?? 0) < 0.1) continue;
        const n0 = normals[f0]!;
        const n1 = normals[f1]!;
        const dotN = Math.min(1, Math.max(-1, n0.x * n1.x + n0.y * n1.y + n0.z * n1.z));
        const deg = (Math.acos(dotN) * 180) / Math.PI;
        if (deg > 60) {
            count++;
            if (deg > worst) {
                worst = deg;
                worstArea = Math.min(areas[f0] ?? 0, areas[f1] ?? 0);
                const n0v = shell.outerVertex0 ?? 0;
                const small = (areas[f0] ?? 0) <= (areas[f1] ?? 0) ? f0 : f1;
                const sv = [
                    shell.indices[small * 3] ?? 0,
                    shell.indices[small * 3 + 1] ?? 0,
                    shell.indices[small * 3 + 2] ?? 0,
                ];
                worstSide = sv.every((v) => v < n0v)
                    ? "inner"
                    : sv.every((v) => v >= n0v && v < n0v * 2)
                      ? "outer"
                      : "other";
                where = mid;
            }
        }
    }
    return { count, deg: worst, area: worstArea, side: worstSide, ...where };
}

function shellOpening(shell: AfoTriMesh): AfoVec3[] {
    const n = shell.outerVertex0 ?? 0;
    const face0 = shell.rimFaceStart ?? 0;
    const count = new Map<string, { a: number; b: number; n: number }>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (!vs.every((v) => v < n)) continue;
        for (let e = 0; e < 3; e++) {
            const a = vs[e]!;
            const b = vs[(e + 1) % 3]!;
            const k = key(a, b);
            const prev = count.get(k);
            if (prev) prev.n += 1;
            else count.set(k, { a, b, n: 1 });
        }
    }
    const next = new Map<number, number[]>();
    for (const e of count.values()) {
        if (e.n !== 1) continue;
        const ab = next.get(e.a) ?? [];
        ab.push(e.b);
        next.set(e.a, ab);
        const ba = next.get(e.b) ?? [];
        ba.push(e.a);
        next.set(e.b, ba);
    }
    const start = next.keys().next().value as number | undefined;
    if (start == null) return [];
    const loop = [start];
    const seen = new Set<number>([start]);
    let cur = start;
    for (let guard = 0; guard < n + 2; guard++) {
        const nxt = (next.get(cur) ?? []).find((v) => !seen.has(v));
        if (nxt == null) break;
        loop.push(nxt);
        seen.add(nxt);
        cur = nxt;
    }
    return loop.map((i) => at(shell, i));
}

function minInteriorWall(shell: AfoTriMesh, opening: AfoVec3[]): number {
    const n = shell.outerVertex0 ?? 0;
    const face0 = shell.rimFaceStart ?? 0;
    const innerIdx: number[] = [];
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (!vs.every((v) => v < n)) continue;
        innerIdx.push(vs[0]!, vs[1]!, vs[2]!);
    }
    const proj = meshProjector({
        positions: shell.positions.subarray(0, n * 3),
        indices: new Uint32Array(innerIdx),
    });
    let min = Infinity;
    for (let i = 0; i < n; i++) {
        const p = at(shell, i);
        if (distToPolyline(p, opening) < 10) continue;
        const outer = at(shell, n + i);
        min = Math.min(min, proj.closest(outer).errorMm);
    }
    return min;
}

describe("AFO trim acceptance", () => {
    test("shell defaults match the Windows app and the footplate cap is named", () => {
        expect(AFO_THICKNESS_MM).toBe(4);
        expect(AFO_EDGE_MM).toBe(2.5);
        expect(AFO_FLARE_MM).toBe(2.5);
        expect(AFO_FOOTPLATE_FLARE_CAP_MM).toBe(1);
    });

    test("fixture and live-frame legs have no directed edge twice", () => {
        expect(duplicateDirectedEdgeCount(buildClinicalFixtureA().mesh)).toBe(0);
        expect(duplicateDirectedEdgeCount(buildLiveFrameLeg("left"))).toBe(0);
        expect(duplicateDirectedEdgeCount(buildLiveFrameLeg("right"))).toBe(0);
        expect(meshSignedVolume(buildClinicalFixtureA().mesh)).toBeGreaterThan(0);
    });

    test("ingestOrientedScan repairs reversed winding", () => {
        const sphere = buildUnitSphereMesh(30, 8);
        const flipped: AfoTriMesh = {
            positions: sphere.positions,
            indices: new Uint32Array(sphere.indices),
        };
        for (let i = 0; i < flipped.indices.length; i += 3) {
            const tmp = flipped.indices[i + 1] ?? 0;
            flipped.indices[i + 1] = flipped.indices[i + 2] ?? 0;
            flipped.indices[i + 2] = tmp;
        }
        expect(meshSignedVolume(flipped)).toBeLessThan(0);
        useAfoStore.getState().resetSession();
        ingestOrientedScan(flipped);
        const stored = useAfoStore.getState().sourceMesh;
        expect(stored).not.toBeNull();
        expect(duplicateDirectedEdgeCount(stored!)).toBe(0);
        expect(meshSignedVolume(stored!)).toBeGreaterThan(0);
        const afo = getAfoState();
        const fromOriented = detectTibialCrest(stored!, afo.corrections.braceHeightMm, afo.clinicalMarkers);
        expect(afo.crest.points).toEqual(fromOriented.points);
    });

    test("a pin is a click, not an orbit drag, and landmark mode is exclusive", () => {
        expect(trimPointerIsClick(0, false)).toBe(true);
        expect(trimPointerIsClick(4, false)).toBe(true);
        expect(trimPointerIsClick(4.1, false)).toBe(false);
        expect(trimPointerIsClick(1, true)).toBe(false);
        expect(AFO_TRIM_NO_MESH.length).toBeGreaterThan(10);
        expect(
            designLandmarkPlacementActive({
                placingTrim: false,
                placingClinical: false,
                placingDesignLandmarks: true,
            }),
        ).toBe(true);
        expect(
            designLandmarkPlacementActive({
                placingTrim: true,
                placingClinical: false,
                placingDesignLandmarks: true,
            }),
        ).toBe(false);
        expect(
            designLandmarkPlacementActive({
                placingTrim: false,
                placingClinical: true,
                placingDesignLandmarks: true,
            }),
        ).toBe(false);
        expect(
            designLandmarkPlacementActive({
                placingTrim: false,
                placingClinical: false,
                placingDesignLandmarks: false,
            }),
        ).toBe(false);
        expect(
            designLandmarkPlacementActive({
                placingTrim: false,
                placingClinical: false,
                placingDesignLandmarks: true,
                measuring: true,
            }),
        ).toBe(false);
    });

    test("worker shell options clone without the progress callback", () => {
        const safe = cloneableWorkerOptions({
            thicknessMm: 4,
            edgeMm: 2.5,
            flareMm: 2.5,
            onProgress: () => undefined,
            trimPolygon: [{ x: 1, y: 2, z: 3 }],
        });
        expect(safe).not.toHaveProperty("onProgress");
        expect(() => structuredClone(safe)).not.toThrow();
        expect(safe.trimPolygon).toEqual([{ x: 1, y: 2, z: 3 }]);
    });

    test("a sharp pin corner is exempt and the spans stay within 25 degrees", () => {
        const quad: AfoTriMesh = {
            positions: new Float32Array([-40, -30, 0, 40, -30, 0, 40, 30, 0, -40, 30, 0]),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        };
        const pins = [
            { x: -20, y: -8, z: 0 },
            { x: 0, y: -8, z: 0 },
            { x: 6, y: 10, z: 0 },
            { x: 20, y: -8, z: 0 },
            { x: 8, y: 12, z: 0 },
            { x: -8, y: 12, z: 0 },
        ];
        const fit = fitSurfaceSpline(quad, pins, { closed: true, spacingMm: 1 });
        expect(fit.reasons.join(" | ")).toBe("");
        expect(fit.ok).toBe(true);
        expect(fit.maxTurnDeg).toBeLessThanOrEqual(25);
    });

    test("a smooth sphere rim stays under 60 degrees", () => {
        const sphere = buildUnitSphereMesh(36, 14);
        const pins: AfoVec3[] = [];
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            pins.push({ x: Math.cos(a) * 26, y: Math.sin(a) * 26, z: 10 });
        }
        const fit = fitSurfaceSpline(sphere, pins, { closed: true, spacingMm: 1, quick: true });
        const shell = buildAfoShell(sphere, [0, 1, 2], {
            thicknessMm: 4,
            edgeMm: 2.5,
            flareMm: 0,
            trimPolygon: trimPolygonForShell(fit.curve, true)!,
            heelSeed: { x: 0, y: 0, z: -36 },
        });
        const report = analyzeManifoldBuffers(shell.positions, shell.indices);
        expect(report.openEdges).toBe(0);
        expect(report.nonManifoldEdges).toBe(0);
        const bend = rimDihedralDeg(shell);
        expect(shell.rimFaceStart).toBeGreaterThan(0);
        expect(
            bend.deg,
            `sphere dihedral at ${bend.x.toFixed(1)},${bend.y.toFixed(1)},${bend.z.toFixed(1)}`,
        ).toBeLessThanOrEqual(60);
    });

    test("balance-brace and posterior-leaf shells are watertight, on the curve, and flared", () => {
        const failures: string[] = [];
        const note = (name: string, ok: boolean, detail: string) => {
            if (!ok) failures.push(`${name}: ${detail}`);
        };
        for (const side of ["left", "right"] as const) {
            const leg = buildLiveFrameLeg(side, 32);
            const afo = defaultAfoDesignState(side);
            const presets = [
                ["balance-brace", balanceBracePins(leg, afo)],
                ["posterior-leaf", posteriorLeafPins(leg, afo)],
            ] as const;
            for (const [preset, placed] of presets) {
                const name = `${side} ${preset}`;
                const fit = fitSurfaceSpline(leg, placed.pins, { closed: true });
                note(name, fit.ok, fit.ok ? "spline ok" : fit.reasons.join(" | "));
                if (!fit.ok) continue;
                const polygon = trimPolygonForShell(fit.curve, true)!;
                const plain = buildAfoShell(leg, [0, 1, 2], {
                    thicknessMm: AFO_THICKNESS_MM,
                    edgeMm: AFO_EDGE_MM,
                    flareMm: 0,
                    trimPolygon: polygon,
                    heelSeed: { x: leg.positions[0] ?? 0, y: 0, z: -10 },
                });
                const gateShell = (label: string, shell: AfoTriMesh) => {
                    const report = analyzeManifoldBuffers(shell.positions, shell.indices);
                    note(name, report.openEdges === 0, `${label} open edges ${report.openEdges}`);
                    note(
                        name,
                        report.nonManifoldEdges === 0,
                        `${label} non-manifold edges ${report.nonManifoldEdges}`,
                    );
                    note(name, countMeshBodies(shell) === 1, `${label} bodies ${countMeshBodies(shell)}`);
                    note(
                        name,
                        shell.rimFaceStart != null && shell.rimFaceStart > 0,
                        `${label} rim tagged at face ${shell.rimFaceStart ?? "missing"}`,
                    );
                    const dihedral = rimDihedralDeg(shell);
                    const where = `(${dihedral.x.toFixed(1)}, ${dihedral.y.toFixed(1)}, ${dihedral.z.toFixed(1)})`;
                    note(
                        name,
                        dihedral.deg <= 60,
                        `${label} dihedral ${dihedral.deg.toFixed(2)}° at ${where}`,
                    );
                    return dihedral;
                };
                gateShell("plain", plain);
                const rims = innerRimLoops(plain, leg);
                const boundary = rims[0] ?? shellOpening(plain);
                let curveToEdge = 0;
                let edgeToCurve = 0;
                for (const p of polygon) curveToEdge = Math.max(curveToEdge, distToPolyline(p, boundary));
                for (let i = 0; i < boundary.length; i++) {
                    const a = boundary[i]!;
                    const b = boundary[(i + 1) % boundary.length]!;
                    edgeToCurve = Math.max(edgeToCurve, distToPolyline(a, polygon));
                    edgeToCurve = Math.max(
                        edgeToCurve,
                        distToPolyline(
                            { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 },
                            polygon,
                        ),
                    );
                }
                note(
                    name,
                    rims.length === 1 && curveToEdge <= 0.1 && edgeToCurve <= 0.1,
                    `curve Hausdorff ${Math.max(curveToEdge, edgeToCurve).toFixed(3)} mm (${curveToEdge.toFixed(3)} / ${edgeToCurve.toFixed(3)}), loops ${rims.length}`,
                );
                const plainOpen = shellOpening(plain);
                const plainFold = nearOpeningFold(plain, plainOpen);
                note(
                    name,
                    plainFold.count === 0,
                    `plain opening folds ${plainFold.count} worst ${plainFold.deg.toFixed(1)}° area ${plainFold.area.toFixed(3)} ${plainFold.side} at (${plainFold.x.toFixed(1)}, ${plainFold.y.toFixed(1)}, ${plainFold.z.toFixed(1)})`,
                );
                const plainWall = minInteriorWall(plain, plainOpen);
                note(name, plainWall >= AFO_THICKNESS_MM - 0.1, `plain min wall ${plainWall.toFixed(3)} mm`);
                const projector = meshProjector(leg);
                let nInner = 0;
                while (
                    nInner < plain.positions.length / 3 &&
                    projector.closest(at(plain, nInner)).errorMm < 0.2
                ) {
                    nInner++;
                }
                let edgeErr = 0;
                for (let i = 0; i < nInner; i++) {
                    const v = at(plain, i);
                    if (distToPolyline(v, polygon) > 0.15) continue;
                    const outer = at(plain, i + nInner);
                    const thickness = dist(v, outer);
                    edgeErr = Math.max(edgeErr, Math.abs(thickness - AFO_EDGE_MM));
                }
                note(name, edgeErr <= 0.1, `edge error ${edgeErr.toFixed(3)} mm`);
                const flared = buildAfoShell(leg, [0, 1, 2], {
                    thicknessMm: AFO_THICKNESS_MM,
                    edgeMm: AFO_EDGE_MM,
                    flareMm: AFO_FLARE_MM,
                    trimPolygon: polygon,
                    heelSeed: { x: 0, y: 0, z: -10 },
                });
                note(
                    name,
                    flared.positions.length === plain.positions.length,
                    `flare vertex count ${flared.positions.length} vs ${plain.positions.length}`,
                );
                gateShell("flared", flared);
                const flaredOpen = shellOpening(flared);
                const flaredFold = nearOpeningFold(flared, flaredOpen);
                note(
                    name,
                    flaredFold.count === 0,
                    `flared opening folds ${flaredFold.count} worst ${flaredFold.deg.toFixed(1)}° area ${flaredFold.area.toFixed(3)} ${flaredFold.side} at (${flaredFold.x.toFixed(1)}, ${flaredFold.y.toFixed(1)}, ${flaredFold.z.toFixed(1)})`,
                );
                const flaredWall = minInteriorWall(flared, flaredOpen);
                note(
                    name,
                    flaredWall >= AFO_THICKNESS_MM - 0.1,
                    `flared min wall ${flaredWall.toFixed(3)} mm`,
                );
                let minZ = Infinity;
                for (let i = 0; i < leg.positions.length; i += 3)
                    minZ = Math.min(minZ, leg.positions[i + 2] ?? 0);
                let wallErr = 0;
                let footErr = 0;
                let walls = 0;
                let feet = 0;
                const limit = Math.min(plain.positions.length, flared.positions.length) / 3;
                for (let i = 0; i < limit; i++) {
                    const p = at(plain, i);
                    if (distToPolyline(p, polygon) > 0.12) continue;
                    const q = at(flared, i);
                    const d = dist(p, q);
                    const hit = projector.closest(p);
                    const foot = hit.normal.z < -0.65 && p.z < minZ + 8;
                    if (foot) {
                        feet++;
                        footErr = Math.max(footErr, Math.abs(d - AFO_FOOTPLATE_FLARE_CAP_MM));
                    } else {
                        walls++;
                        wallErr = Math.max(wallErr, Math.abs(d - AFO_FLARE_MM));
                    }
                }
                note(
                    name,
                    walls > 0 && wallErr <= 0.2,
                    `flare error ${wallErr.toFixed(3)} mm on ${walls} wall verts`,
                );
                note(
                    name,
                    feet === 0 || footErr <= 0.2,
                    `footplate error ${footErr.toFixed(3)} mm on ${feet} verts`,
                );
            }
        }
        expect(failures, failures.join("\n")).toEqual([]);
    });

    test("a 100k-triangle shell builds in under 5 seconds", () => {
        const sphere = buildUnitSphereMesh(40, 165);
        const tris = sphere.indices.length / 3;
        expect(tris).toBeGreaterThan(100_000);
        const pins: AfoVec3[] = [];
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            pins.push({ x: Math.cos(a) * 28, y: Math.sin(a) * 28, z: 12 });
        }
        const fit = fitSurfaceSpline(sphere, pins, { closed: true, spacingMm: 1, quick: true });
        expect(fit.ok).toBe(true);
        const started = performance.now();
        const shell = buildAfoShell(sphere, [0, 1, 2], {
            thicknessMm: 4,
            edgeMm: 2.5,
            flareMm: 0,
            trimPolygon: trimPolygonForShell(fit.curve, true)!,
            heelSeed: { x: 0, y: 0, z: -40 },
        });
        const seconds = (performance.now() - started) / 1000;
        expect(shell.indices.length).toBeGreaterThan(1000);
        expect(seconds).toBeLessThan(5);
    });
});
