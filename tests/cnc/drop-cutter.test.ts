// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { describe, expect, test } from "@rstest/core";
import { buildDropMap, dropCutterZ } from "@/lib/cnc/drop-cutter";
import type { Heightmap } from "@/lib/cnc/types";

function grid(zValue: number, n: number, cell: number, insideFill = 1): Heightmap {
    const z = new Float32Array(n * n);
    const inside = new Uint8Array(n * n);
    z.fill(zValue);
    if (insideFill) inside.fill(1);
    return { originX: 0, originY: 0, cell, nx: n, ny: n, z, inside };
}

describe("ball drop cutter", () => {
    test("flat plane gives tipZ equal to z", () => {
        const hm = grid(6, 80, 0.2);
        expect(dropCutterZ(hm, 8, 8, 5, "ball")).toBeCloseTo(6, 6);
        const map = buildDropMap(hm, 5, "ball");
        const ix = 40;
        const iy = 40;
        const fromMap = map.z[iy * map.nx + ix];
        expect(fromMap).toBeCloseTo(6, 5);
        expect(dropCutterZ(hm, ix * map.cell, iy * map.cell, 5, "ball")).toBeCloseTo(
            fromMap ?? Number.NaN,
            5,
        );
    });

    test("a single spike gives the analytic sphere profile", () => {
        const cell = 0.2;
        const n = 80;
        const hm = grid(1, n, cell);
        const spikeIx = 40;
        const spikeIy = 40;
        hm.z[spikeIy * n + spikeIx] = 10;
        const sx = spikeIx * cell;
        const sy = spikeIy * cell;
        const r = 5;
        expect(dropCutterZ(hm, sx, sy, r, "ball")).toBeCloseTo(10, 5);
        for (const d of [1, 3, 4]) {
            const expected = 10 - r + Math.sqrt(r * r - d * d);
            expect(dropCutterZ(hm, sx + d, sy, r, "ball")).toBeCloseTo(expected, 5);
        }
        expect(dropCutterZ(hm, sx + 6, sy, r, "ball")).toBeCloseTo(1, 5);
        const map = buildDropMap(hm, r, "ball");
        const jx = spikeIx + Math.round(3 / cell);
        const mapped = map.z[spikeIy * map.nx + jx];
        expect(mapped).toBeCloseTo(10 - r + Math.sqrt(r * r - 9), 4);
    });

    test("outside cells stored as stock top, zero, or NaN stay at the skin floor", () => {
        for (const stored of [30, 0, Number.NaN]) {
            const hm = grid(4, 80, 0.2);
            const i = 40 * 80 + 42;
            hm.inside[i] = 0;
            hm.z[i] = stored;
            expect(dropCutterZ(hm, 8, 8, 5, "ball")).toBeCloseTo(4, 5);
        }
    });

    test("tipZ clamps at 1 mm", () => {
        const hm = grid(0.2, 80, 0.2);
        expect(dropCutterZ(hm, 8, 8, 5, "ball")).toBe(1);
    });

    test("a coarser flat plane is bilinear, not a cell maximum", () => {
        const hm = grid(6, 20, 0.5);
        expect(dropCutterZ(hm, 4, 4, 5, "ball")).toBeCloseTo(6, 5);
    });
});
