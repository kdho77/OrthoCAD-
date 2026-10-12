// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { minDistToLoopXY } from "./cdt-band";
import { assertIEdges } from "./cdt-lib";
import {
    buildGeneratedPlantar,
    collapseShortIEdges,
    collarSteiner,
    faceMinAngleDeg,
    I_COLLAPSE_MM,
    I_SLIVER_ASPECT,
    inwardEdgeSteiner,
    makePlantarSampler,
    maxIAspect,
    PLANTAR_STEINER_EDGE_MIN_MM,
    SLIVER_MIN_ANGLE_DEG,
} from "./plantar-cdt";

describe("generated plantar CDT", () => {
    test("re-anchors min z to 0 after a negative posting field", () => {
        const n = 20;
        const boundary = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 20 * Math.cos(a), y: 10 * Math.sin(a), z: 0.2 };
        });
        const mesh = buildGeneratedPlantar({
            boundary,
            dish: null,
            zDelta: (_x, y) => y * 0.2,
        });
        expect(mesh.boundaryCount).toBe(n);
        expect(mesh.steinerCount).toBeGreaterThan(8);
        expect(mesh.faces.length).toBeGreaterThan(n);
        expect(mesh.minZ).toBeGreaterThanOrEqual(-1e-9);
        expect(mesh.openEdges).toBe(0);
        expect(mesh.missingBoundary).toBe(0);
        for (const p of mesh.points) expect(p.z).toBeGreaterThanOrEqual(-1e-9);
        const edge = new Map<string, number>();
        const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
        for (const [a, b, c] of mesh.faces) {
            for (const [i, j] of [
                [a, b],
                [b, c],
                [c, a],
            ] as Array<[number, number]>) {
                if (i < n && j < n) edge.set(key(i, j), (edge.get(key(i, j)) ?? 0) + 1);
            }
        }
        for (let i = 0; i < n; i++) {
            expect(edge.get(key(i, (i + 1) % n)) ?? 0).toBe(1);
        }
    });

    test("library CDT of inner ring I keeps every I edge", () => {
        const n = 24;
        const inner = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 20 * Math.cos(a), y: 11 * Math.sin(a), z: 0.1 };
        });
        const mesh = buildGeneratedPlantar({
            boundary: inner,
            dish: null,
            zDelta: () => 0,
        });
        expect(mesh.bandCount).toBe(0);
        expect(mesh.openEdges).toBe(0);
        expect(mesh.missingBoundary).toBe(0);
        expect(mesh.steinerCount).toBeGreaterThan(0);
        for (let i = n; i < mesh.points.length; i++) {
            const p = mesh.points[i]!;
            expect(minDistToLoopXY(p.x, p.y, inner)).toBeGreaterThanOrEqual(PLANTAR_STEINER_EDGE_MIN_MM);
        }
        const edge = new Map<string, number>();
        const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
        for (const [a, b, c] of mesh.faces) {
            for (const [i, j] of [
                [a, b],
                [b, c],
                [c, a],
            ] as Array<[number, number]>) {
                if (i < n && j < n) edge.set(key(i, j), (edge.get(key(i, j)) ?? 0) + 1);
            }
        }
        for (let i = 0; i < n; i++) {
            expect(edge.get(key(i, (i + 1) % n)) ?? 0).toBe(1);
        }
    });

    test("library CDT of a concave C has 0 open and 0 missing boundary edges", () => {
        const boundary = [
            { x: 0, y: 0, z: 0 },
            { x: 20, y: 0, z: 0 },
            { x: 20, y: 14, z: 0 },
            { x: 12, y: 14, z: 0 },
            { x: 12, y: 5, z: 0 },
            { x: 8, y: 5, z: 0 },
            { x: 8, y: 14, z: 0 },
            { x: 0, y: 14, z: 0 },
        ];
        const mesh = buildGeneratedPlantar({
            boundary,
            dish: null,
            zDelta: () => 0,
            marginMm: 1.2,
        });
        expect(mesh.openEdges).toBe(0);
        expect(mesh.missingBoundary).toBe(0);
        expect(mesh.faces.length).toBeGreaterThan(6);
    });

    test("missing I edge fails with the station index", () => {
        expect(() => assertIEdges([[0, 1, 2]], 4)).toThrow(/\[S1-I\] missing edge at station 2/);
    });

    test("collapses I edges under 0.3 mm and keeps sliver aspect <= 20", () => {
        const points = [
            { x: 0, y: 0, z: 0 },
            { x: 0.2, y: 0, z: 0 },
            { x: 10, y: 0, z: 0 },
            { x: 10, y: 8, z: 0 },
            { x: 0, y: 8, z: 0 },
            { x: 5, y: 4, z: 0 },
        ];
        const faces: Array<[number, number, number]> = [
            [0, 1, 5],
            [1, 2, 5],
            [2, 3, 5],
            [3, 4, 5],
            [4, 0, 5],
        ];
        const out = collapseShortIEdges(points, faces, 5, I_COLLAPSE_MM);
        expect(out.collapsed).toBe(1);
        expect(out.faces.some((f) => f.includes(1))).toBe(false);
        expect(maxIAspect(points, out.faces, 5)).toBeLessThanOrEqual(I_SLIVER_ASPECT);
        const mesh = buildGeneratedPlantar({
            boundary: [
                { x: 0, y: 0, z: 0 },
                { x: 16, y: 0, z: 0 },
                { x: 16, y: 10, z: 0 },
                { x: 0, y: 10, z: 0 },
            ],
            dish: null,
            zDelta: () => 0,
        });
        expect(mesh.sliverMaxAspect).toBeLessThanOrEqual(I_SLIVER_ASPECT);
        expect(mesh.openEdges).toBe(0);
    });

    test("dense pair-insert B ring stays closed with aspect <= 20", () => {
        const n = 420;
        const boundary = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            const pinch = 1 + 0.22 * Math.cos(2 * a);
            return { x: 55 * pinch * Math.cos(a), y: 22 * pinch * Math.sin(a), z: 0 };
        });
        let minEdge = Infinity;
        for (let i = 0; i < n; i++) {
            const a = boundary[i]!;
            const b = boundary[(i + 1) % n]!;
            minEdge = Math.min(minEdge, Math.hypot(b.x - a.x, b.y - a.y));
        }
        expect(minEdge).toBeGreaterThanOrEqual(0.3);
        const collar = collarSteiner(boundary, PLANTAR_STEINER_EDGE_MIN_MM, 0.9);
        const inward = inwardEdgeSteiner(boundary, 0.65, PLANTAR_STEINER_EDGE_MIN_MM);
        expect(collar.length).toBeGreaterThan(20);
        expect(inward.length).toBeGreaterThan(n * 0.8);
        for (const p of collar) {
            expect(minDistToLoopXY(p.x, p.y, boundary)).toBeGreaterThanOrEqual(PLANTAR_STEINER_EDGE_MIN_MM);
        }
        const mesh = buildGeneratedPlantar({
            boundary,
            dish: null,
            zDelta: () => 0,
        });
        expect(mesh.openEdges).toBe(0);
        expect(mesh.missingBoundary).toBe(0);
        expect(mesh.steinerCount).toBeGreaterThan(collar.length);
        expect(mesh.sliverMaxAspect).toBeLessThanOrEqual(I_SLIVER_ASPECT);
        for (let i = boundary.length; i < mesh.points.length; i++) {
            const p = mesh.points[i]!;
            expect(minDistToLoopXY(p.x, p.y, boundary)).toBeGreaterThanOrEqual(PLANTAR_STEINER_EDGE_MIN_MM);
        }
    });

    test("flat sampler ignores dish and starts at z=0", () => {
        const n = 12;
        const outline = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 10 * Math.cos(a), y: 6 * Math.sin(a), z: 2 };
        });
        const sampler = makePlantarSampler(outline, null, undefined, () => 0, { flat: true });
        expect(sampler.lift).toBe(0);
        expect(sampler.z(0, 0, 9)).toBe(0);
    });

    test("sampler applies fields and re-anchor before B", () => {
        const n = 16;
        const outline = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 12 * Math.cos(a), y: 8 * Math.sin(a), z: 0 };
        });
        const sampler = makePlantarSampler(outline, null, undefined, (_x, y) => y * 0.4);
        expect(sampler.lift).toBeGreaterThan(0);
        for (const p of outline) {
            expect(sampler.z(p.x, p.y, 0)).toBeGreaterThanOrEqual(-1e-9);
        }
    });

    test("sampler plantar keeps B bit-identical and min angle >= 5deg", () => {
        const n = 36;
        const boundary = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 24 * Math.cos(a), y: 14 * Math.sin(a), z: 0 };
        });
        const sampler = makePlantarSampler(boundary, null, undefined, (x) => 0.02 * x, { flat: true });
        for (const p of boundary) p.z = sampler.z(p.x, p.y, 0);
        const mesh = buildGeneratedPlantar({
            boundary,
            dish: null,
            zDelta: (x) => 0.02 * x,
            sampler,
            flat: true,
        });
        expect(mesh.extraLift).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < n; i++) {
            const B = mesh.points[i]!;
            expect(B.x).toBe(boundary[i]!.x);
            expect(B.y).toBe(boundary[i]!.y);
            expect(B.z).toBeCloseTo(sampler.z(B.x, B.y, 0) + mesh.extraLift, 9);
        }
        for (const f of mesh.faces) {
            const A = mesh.points[f[0]!]!;
            const B = mesh.points[f[1]!]!;
            const C = mesh.points[f[2]!]!;
            expect(faceMinAngleDeg(A, B, C)).toBeGreaterThanOrEqual(SLIVER_MIN_ANGLE_DEG - 0.5);
        }
    });
});
