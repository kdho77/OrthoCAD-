// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry, Color } from "three";
import { applyHeightmapColors, zRangeFromPositions } from "./heightmap-colors";

describe("applyHeightmapColors", () => {
    test("uses HSL ramp with clamped t", () => {
        const geometry = new BufferGeometry();
        geometry.setAttribute(
            "position",
            new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 2, 0, 0, 4]), 3),
        );
        const colors = new BufferAttribute(new Float32Array(9), 3);
        applyHeightmapColors(geometry, colors);

        const low = new Color(colors.getX(0), colors.getY(0), colors.getZ(0));
        const high = new Color(colors.getX(2), colors.getY(2), colors.getZ(2));
        const lowHsl = { h: 0, s: 0, l: 0 };
        const highHsl = { h: 0, s: 0, l: 0 };
        low.getHSL(lowHsl);
        high.getHSL(highHsl);
        expect(lowHsl.h).toBeCloseTo(0.66, 2);
        expect(highHsl.h).toBeCloseTo(0, 2);
        expect(lowHsl.s).toBeCloseTo(0.85, 2);
        expect(highHsl.s).toBeCloseTo(0.85, 2);
    });

    test("respects shared zRange from base", () => {
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 1]), 3));
        const colors = new BufferAttribute(new Float32Array(3), 3);
        const base = new BufferGeometry();
        base.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 10]), 3));
        const range = zRangeFromPositions(base);
        applyHeightmapColors(geometry, colors, range);
        const c = new Color(colors.getX(0), colors.getY(0), colors.getZ(0));
        const hsl = { h: 0, s: 0, l: 0 };
        c.getHSL(hsl);
        expect(hsl.h).toBeCloseTo(0.66 - 0.66 * 0.1, 2);
    });
});
