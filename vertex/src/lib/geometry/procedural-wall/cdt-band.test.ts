// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { cdtInteriorPolygon, cdtPlanarBand, DISH_BAND_MM, delaunayXY, pointInPoly } from "./cdt-band";

describe("plan-view CDT dish band", () => {
    test("DISH_BAND_MM is 3", () => {
        expect(DISH_BAND_MM).toBe(3);
    });

    test("delaunay of a quad yields two triangles", () => {
        const faces = delaunayXY([
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
            { x: 0, y: 2 },
        ]);
        expect(faces.length).toBe(2);
    });

    test("band CDT keeps the outer ring as a boundary", () => {
        const n = 12;
        const outer = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 10 * Math.cos(a), y: 6 * Math.sin(a), z: 0 };
        });
        const inner = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 7 * Math.cos(a), y: 4 * Math.sin(a), z: 0 };
        });
        const { points, faces } = cdtPlanarBand(outer, inner, []);
        expect(faces.length).toBeGreaterThan(8);
        let onOuter = 0;
        for (const [a, b, c] of faces) {
            if (a < n || b < n || c < n) onOuter++;
            const pa = points[a]!;
            const pb = points[b]!;
            const pc = points[c]!;
            const cx = (pa.x + pb.x + pc.x) / 3;
            const cy = (pa.y + pb.y + pc.y) / 3;
            expect(pointInPoly(cx, cy, outer)).toBe(true);
        }
        expect(onOuter).toBeGreaterThan(0);
    });

    test("interior CDT keeps every boundary edge once", () => {
        const n = 16;
        const outer = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 12 * Math.cos(a), y: 7 * Math.sin(a), z: 0 };
        });
        const steiner = [{ x: 0, y: 0, z: 0 }];
        const { points, faces } = cdtInteriorPolygon(outer, steiner);
        expect(faces.length).toBeGreaterThan(n - 2);
        const edgeCount = new Map<string, number>();
        const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
        for (const [a, b, c] of faces) {
            for (const [i, j] of [
                [a, b],
                [b, c],
                [c, a],
            ] as Array<[number, number]>) {
                if (i < n && j < n) edgeCount.set(key(i, j), (edgeCount.get(key(i, j)) ?? 0) + 1);
            }
            const pa = points[a]!;
            const pb = points[b]!;
            const pc = points[c]!;
            expect(pointInPoly((pa.x + pb.x + pc.x) / 3, (pa.y + pb.y + pc.y) / 3, outer)).toBe(true);
        }
        for (let i = 0; i < n; i++) {
            expect(edgeCount.get(key(i, (i + 1) % n)) ?? 0).toBe(1);
        }
    });
});
