// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { assertIEdges } from "./cdt-lib";
import { buildGeneratedPlantar, makePlantarSampler } from "./plantar-cdt";

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
});
