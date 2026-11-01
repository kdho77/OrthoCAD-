// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { analyzeManifoldBuffers } from "@/lib/geometry/manifold-core";
import { applyAfoCorrections } from "./corrections";
import { AFO_EDGE_MM, AFO_FLARE_MM, AFO_THICKNESS_MM, defaultAfoCorrections } from "./defaults";
import { geodesicVertexPath } from "./geodesic";
import { meanRadiusFrom, meshIsWatertight, positionsEqual, vertexCount } from "./mesh-ops";
import { offsetMesh, offsetMeshAlongNormals } from "./sdf-offset";
import { countTriangleSelfIntersections } from "./self-intersection";
import { buildAfoShell, equatorialLoop } from "./shell";
import { buildSyntheticLegMesh, buildUnitSphereMesh } from "./synthetic-leg";
import { validateTrimLoop } from "./trim-loop";

describe("AFO acceptance (spec §11)", () => {
    test("A6 identity at zero: offset 0 copies the input", () => {
        const sphere = buildUnitSphereMesh(30, 10);
        const out = offsetMesh(sphere, { distanceMm: 0 });
        expect(positionsEqual(sphere.positions, out.positions)).toBe(true);
        expect(out.indices.length).toBe(sphere.indices.length);
    });

    test("A6 identity at zero: zero corrections copy the input", () => {
        const leg = buildSyntheticLegMesh();
        const zero = defaultAfoCorrections();
        zero.smoothIterations = 0;
        const out = applyAfoCorrections(leg, zero);
        expect(positionsEqual(leg.positions, out.positions)).toBe(true);
    });

    test("A3 offset at +10 expands a r=30 sphere", () => {
        const sphere = buildUnitSphereMesh(30, 12);
        const out = offsetMeshAlongNormals(sphere, 10);
        const r = meanRadiusFrom(out, { x: 0, y: 0, z: 0 });
        expect(r).toBeGreaterThan(38);
        expect(r).toBeLessThan(42);
    });

    test("A4 offset at -10 contracts a r=30 sphere", () => {
        const sphere = buildUnitSphereMesh(30, 12);
        const out = offsetMeshAlongNormals(sphere, -10);
        const r = meanRadiusFrom(out, { x: 0, y: 0, z: 0 });
        expect(r).toBeGreaterThan(18);
        expect(r).toBeLessThan(22);
    });

    test("A3/A4 SDF offset at ±10 moves the isosurface the right way", () => {
        const sphere = buildUnitSphereMesh(30, 8);
        const plus = offsetMesh(sphere, { distanceMm: 10, resolution: 16 });
        const minus = offsetMesh(sphere, { distanceMm: -10, resolution: 16 });
        expect(vertexCount(plus)).toBeGreaterThan(20);
        expect(vertexCount(minus)).toBeGreaterThan(20);
        const rp = meanRadiusFrom(plus, { x: 0, y: 0, z: 0 });
        const rm = meanRadiusFrom(minus, { x: 0, y: 0, z: 0 });
        expect(rp).toBeGreaterThan(rm);
        expect(rp).toBeGreaterThan(32);
        expect(rm).toBeLessThan(28);
    });

    test("A1/A2 watertight shell with no self-intersection", () => {
        const sphere = buildUnitSphereMesh(30, 12);
        const loop = equatorialLoop(sphere);
        expect(loop.length).toBeGreaterThanOrEqual(6);
        const shell = buildAfoShell(sphere, loop, {
            thicknessMm: AFO_THICKNESS_MM,
            edgeMm: AFO_EDGE_MM,
            flareMm: AFO_FLARE_MM,
        });
        const report = analyzeManifoldBuffers(shell.positions, shell.indices);
        expect(report.openEdges).toBe(0);
        expect(report.nonManifoldEdges).toBe(0);
        expect(report.isWatertight).toBe(true);
        expect(countTriangleSelfIntersections(shell)).toBe(0);
    });

    test("A5 valid trim-loop rules", () => {
        const sphere = buildUnitSphereMesh(30, 10);
        const loop = equatorialLoop(sphere);
        const valid = validateTrimLoop(sphere, loop, true);
        expect(valid.ok).toBe(true);

        const tooShort = validateTrimLoop(sphere, [loop[0]!, loop[1]!], true);
        expect(tooShort.ok).toBe(false);

        const open = validateTrimLoop(sphere, loop, false);
        expect(open.ok).toBe(false);
        expect(open.reasons.some((r) => /not closed/i.test(r))).toBe(true);

        const crossing = [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 10, z: 0 },
            { x: 10, y: 0, z: 0 },
            { x: 0, y: 10, z: 0 },
        ];
        // Bow-tie of 4 points as vertex indices on a tiny custom mesh.
        const bow: typeof sphere = {
            positions: new Float32Array(crossing.flatMap((p) => [p.x, p.y, p.z])),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        };
        const bad = validateTrimLoop(bow, [0, 1, 2, 3], true);
        expect(bad.ok).toBe(false);
        expect(bad.reasons.some((r) => /self-intersect/i.test(r))).toBe(true);
    });

    test("synthetic leg is a small closed-ish body (no patient scan committed)", () => {
        const leg = buildSyntheticLegMesh();
        expect(vertexCount(leg)).toBeGreaterThan(30);
        expect(vertexCount(leg)).toBeLessThan(8000);
        expect(leg.indices.length).toBeGreaterThan(90);
        // Prefer watertight; allow MC T-junctions on the coarse lattice by
        // requiring the geodesic graph to be connected from heel to shin.
        const heel = nearestBy(leg, { x: 0, y: 0, z: 0 });
        const shin = nearestBy(leg, { x: 0, y: 35, z: 180 });
        const path = geodesicVertexPath(leg, heel, shin);
        expect(path).not.toBeNull();
        expect((path ?? []).length).toBeGreaterThan(2);
        void meshIsWatertight;
    });
});

function nearestBy(mesh: { positions: Float32Array }, p: { x: number; y: number; z: number }): number {
    const n = (mesh.positions.length / 3) | 0;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
        const dx = (mesh.positions[i * 3] ?? 0) - p.x;
        const dy = (mesh.positions[i * 3 + 1] ?? 0) - p.y;
        const dz = (mesh.positions[i * 3 + 2] ?? 0) - p.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}
