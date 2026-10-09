// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { buildGeneratedPlantar } from "./plantar-cdt";

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
});
