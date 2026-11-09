// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    assertInsideRim,
    clipperRoundInset,
    clipperUnion,
    hygieneBottomPattern,
    projectStationsInsideRim,
    turningNumber,
} from "./pattern-hygiene";

describe("pattern hygiene", () => {
    test("Clipper2 union makes a simple +1 outline", () => {
        const n = 48;
        const loop = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 40 * Math.cos(a), y: 18 * Math.sin(a), z: 0 };
        });
        const unioned = clipperUnion(loop);
        expect(Math.abs(turningNumber(unioned) - 1)).toBeLessThan(0.05);
        const inset = clipperRoundInset(unioned, 3);
        expect(inset.length).toBeGreaterThan(8);
        expect(Math.abs(turningNumber(inset) - 1)).toBeLessThan(0.05);
    });

    test("hygiene rejects a pattern that leaves the rim", () => {
        const rim = Array.from({ length: 32 }, (_, i) => {
            const a = (i / 32) * Math.PI * 2;
            return { x: 20 * Math.cos(a), y: 12 * Math.sin(a), z: 0 };
        });
        const outside = Array.from({ length: 24 }, (_, i) => {
            const a = (i / 24) * Math.PI * 2;
            return { x: 30 * Math.cos(a), y: 18 * Math.sin(a), z: 0 };
        });
        expect(() => hygieneBottomPattern(outside, { rimPlan: rim, requireInsideRim: true })).toThrow(
            /outside the TopSheet rim|from the rim/,
        );
    });

    test("assertInsideRim still rejects a station outside the rim", () => {
        const rim = Array.from({ length: 32 }, (_, i) => {
            const a = (i / 32) * Math.PI * 2;
            return { x: 20 * Math.cos(a), y: 12 * Math.sin(a), z: 0 };
        });
        const outside = [{ x: 30, y: 0, z: 0 }];
        expect(() => assertInsideRim(outside, rim, 0)).toThrow(
            /station 0 \(30\.00,0\.00\) is outside the TopSheet rim/,
        );
    });

    test("projectStationsInsideRim pulls an outside station in and leaves an inside station put", () => {
        const rim = Array.from({ length: 32 }, (_, i) => {
            const a = (i / 32) * Math.PI * 2;
            return { x: 20 * Math.cos(a), y: 12 * Math.sin(a), z: 0 };
        });
        const inside = { x: 1, y: 1, z: 0 };
        const outside = { x: 30, y: -4, z: 0 };
        const projected = projectStationsInsideRim([inside, outside], rim, 0);
        expect(projected[0]).toBe(inside);
        expect(() => assertInsideRim(projected, rim, 0)).not.toThrow();
        const kept = hygieneBottomPattern([inside, outside, { x: 0, y: 8, z: 0 }, { x: -4, y: 0, z: 0 }], {
            rimPlan: rim,
            requireInsideRim: true,
            clearanceMm: 0,
            keepFair: true,
        }).loop;
        expect(() => assertInsideRim(kept, rim, 0)).not.toThrow();
    });
});
