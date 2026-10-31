// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { insoleLayoutForUsMenSize } from "./shoe-size";
import {
    applyShoeWidthToGeometry,
    applyShoeWidthToPoints,
    formatShoeWidthSummary,
    SHOE_WIDTH_HEEL_CAP_MM,
    shoeWidthAffineY,
    shoeWidthBallScale,
    shoeWidthForSide,
    shoeWidthHeelScale,
    shoeWidthScaleAtU,
} from "./shoe-width";

describe("shoe width rule", () => {
    test("ball delta is ±0.5 mm at sizes 6 / 9 / 12", () => {
        for (const size of [6, 9, 12]) {
            const ball = insoleLayoutForUsMenSize(size).widthMm;
            for (const [id, delta] of [
                ["narrow", -5],
                ["medium", 0],
                ["wide", 5],
                ["extra_wide", 10],
            ] as const) {
                const scale = shoeWidthBallScale(ball, id);
                expect(Math.abs((scale - 1) * ball - delta)).toBeLessThanOrEqual(0.5);
            }
        }
    });

    test("heel stays within ±2 mm of Medium", () => {
        for (const size of [6, 9, 12]) {
            const layout = insoleLayoutForUsMenSize(size);
            const ball = layout.widthMm;
            const heel = ball * 0.62;
            const wide = shoeWidthHeelScale(heel, ball, "wide");
            expect(Math.abs(wide.deltaMm)).toBeLessThanOrEqual(SHOE_WIDTH_HEEL_CAP_MM + 1e-6);
            expect(shoeWidthScaleAtU(0.02, ball, heel, "wide")).toBeCloseTo(wide.scale, 5);
            expect(shoeWidthScaleAtU(0.7, ball, heel, "wide")).toBeCloseTo(
                shoeWidthBallScale(ball, "wide"),
                5,
            );
        }
    });

    test("length is unchanged — scale is Y-only", () => {
        expect(shoeWidthBallScale(95, "wide")).toBeCloseTo(100 / 95, 6);
    });

    test("outline X is unchanged and correction millimetre values stay put", () => {
        const pts = [
            { x: 0, y: 10 },
            { x: 130, y: 40 },
            { x: 260, y: -10 },
        ];
        const corrections = { archHeightMm: 6, heelCupDepthMm: 14, medialSkiveMm: 3 };
        const out = applyShoeWidthToPoints(pts, "wide", {
            ballWidthMm: 95,
            heelWidthMm: 59,
            minX: 0,
            lengthMm: 260,
        });
        expect(out.map((p) => p.x)).toEqual(pts.map((p) => p.x));
        expect(corrections).toEqual({ archHeightMm: 6, heelCupDepthMm: 14, medialSkiveMm: 3 });
    });

    test("non-array outline is a no-op (does not throw)", () => {
        const curve = { points: [{ x: 0, y: 10 }] };
        expect(() =>
            applyShoeWidthToPoints(curve as unknown as { x: number; y: number }[], "wide", {
                ballWidthMm: 95,
                heelWidthMm: 59,
                minX: 0,
                lengthMm: 260,
            }),
        ).not.toThrow();
    });

    test("unlocked L/R widths stay independent", () => {
        const design = {
            shoeWidth: "wide" as const,
            shoeWidthBySide: { left: "wide" as const, right: "narrow" as const },
            corrections: { linked: false },
        };
        expect(shoeWidthForSide(design, "left")).toBe("wide");
        expect(shoeWidthForSide(design, "right")).toBe("narrow");
        expect(formatShoeWidthSummary(design)).toBe("L Wide / R Narrow");
        expect(formatShoeWidthSummary({ ...design, corrections: { linked: true } })).toBe("Wide");
    });

    test("mesh affine matches applyShoeWidthToPoints vertex-for-vertex", () => {
        const pts = [
            { x: 0, y: 10 },
            { x: 130, y: 40 },
            { x: 260, y: -10 },
        ];
        const opts = { ballWidthMm: 95, heelWidthMm: 59, minX: 0, lengthMm: 260 };
        const scaled = applyShoeWidthToPoints(pts, "wide", opts);
        const geo = new BufferGeometry();
        const arr = new Float32Array(pts.length * 3);
        pts.forEach((p, i) => {
            arr[i * 3] = p.x;
            arr[i * 3 + 1] = p.y;
            arr[i * 3 + 2] = 2;
        });
        geo.setAttribute("position", new BufferAttribute(arr, 3));
        const out = applyShoeWidthToGeometry(geo, "wide", opts);
        const pos = out.getAttribute("position")!;
        for (let i = 0; i < pts.length; i++) {
            expect(pos.getX(i)).toBeCloseTo(scaled[i]!.x, 4);
            expect(pos.getY(i)).toBeCloseTo(scaled[i]!.y, 4);
            expect(pos.getZ(i)).toBeCloseTo(2, 5);
        }
        const yMid = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        expect(shoeWidthAffineY(130, 40, yMid, "wide", opts)).toBeCloseTo(scaled[1]!.y, 6);
        out.dispose();
        geo.dispose();
    });
});
