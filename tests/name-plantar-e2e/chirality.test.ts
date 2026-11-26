// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { fitLinear, gradeChirality, jHookExtendsLeft } from "./measure";
import { heelEnd, physicalReadingView, type Xyz } from "./reading-view";
import {
    BELT_CONTACT_Y_MM,
    ENGRAVE_Y_MM,
    G1_AXIS_MIN,
    G1_HOOK_CLEAR_MM,
    G1_HOOK_SLACK_MM,
    G1_MIN_ADVANCE_MM,
    G1_SKEW_MAX,
    SYNTHETIC_NAME,
} from "./thresholds";

/** Upright J in the reading frame: stem at x=4, cap across the top, hook to the lower left. */
function uprightJay(): Array<{ x: number; y: number }> {
    const pts: Array<{ x: number; y: number }> = [];
    for (let y = 2; y <= 12; y += 0.4) pts.push({ x: 4, y });
    for (let x = 1; x <= 7; x += 0.4) pts.push({ x, y: 12 });
    for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push({ x: 4 - t * 6, y: 2 + Math.sin(t * Math.PI) * 1.2 });
    }
    return pts;
}

describe("plantar reading frame", () => {
    test("toe is to the right and +X is the cap", () => {
        const heel = physicalReadingView({ x: 0, y: 0, z: 80 });
        const toe = physicalReadingView({ x: 0, y: 0, z: 10 });
        expect(toe.x).toBeGreaterThan(heel.x);
        const capSide = physicalReadingView({ x: 5, y: 0, z: 0 });
        const footSide = physicalReadingView({ x: -5, y: 0, z: 0 });
        expect(capSide.y).toBeGreaterThan(footSide.y);
    });

    test("de-shear leaves height out of the along axis", () => {
        const low = physicalReadingView({ x: 140, y: 0.2, z: 40.2 });
        const high = physicalReadingView({ x: 140, y: 4, z: 44 });
        expect(low.x).toBeCloseTo(high.x, 6);
    });

    test("a 180 degree belt turn keeps the reading and a mirror flips it", () => {
        const point = { x: 12, y: 0.2, z: 40 };
        const upright = physicalReadingView(point, true);
        // Heel-first turns the part 180° on the belt: X and zt both flip.
        const zt = point.z - point.y;
        const turned = physicalReadingView({ x: -point.x, y: point.y, z: point.y - zt }, false);
        expect(turned.x).toBeCloseTo(upright.x, 6);
        expect(turned.y).toBeCloseTo(upright.y, 6);
        const mirrored = physicalReadingView({ ...point, x: -point.x }, true);
        expect(mirrored.x).toBeCloseTo(upright.x, 6);
        expect(mirrored.y).toBeCloseTo(-upright.y, 6);
    });
});

describe("heel end follows hand_classify", () => {
    function skin(heelAtHigh: boolean): Xyz[] {
        const points: Xyz[] = [];
        for (let z = 0; z <= 200; z += 2) {
            for (const x of [-30, 30]) points.push({ x, y: 0.1, z });
        }
        const heelZ = heelAtHigh ? 190 : 10;
        for (const x of [-20, 20]) {
            for (let y = 1; y <= 14; y += 1) points.push({ x, y, z: heelZ });
        }
        return points;
    }

    test("the taller end fifth is the heel, and a 180 degree turn moves it to low zt", () => {
        const toeFirst = heelEnd(skin(true));
        expect(toeFirst.heelHigh).toBe(true);
        expect(toeFirst.deltaMm).toBeGreaterThan(5);
        const turned = skin(true).map((p) => ({ x: -p.x, y: p.y, z: p.y - (p.z - p.y) }));
        const heelFirst = heelEnd(turned);
        expect(heelFirst.heelHigh).toBe(false);
        expect(heelFirst.deltaMm).toBeLessThan(-5);
    });
});

describe("#435 chirality thresholds", () => {
    test("numbers match the frozen gate and are not loosened", () => {
        expect(SYNTHETIC_NAME).toBe("JABBOUR");
        expect(G1_MIN_ADVANCE_MM).toBe(20);
        expect(G1_HOOK_CLEAR_MM).toBe(1.5);
        expect(G1_HOOK_SLACK_MM).toBe(0.75);
        expect(G1_AXIS_MIN).toBe(0.5);
        expect(G1_SKEW_MAX).toBe(0.15);
        expect(BELT_CONTACT_Y_MM).toBe(0.6);
        expect(ENGRAVE_Y_MM).toBe(1.6);
    });

    test("an upright J passes and a left-right mirror fails", () => {
        const jay = uprightJay();
        expect(jHookExtendsLeft(jay)).toBe(true);
        expect(jHookExtendsLeft(jay.map((p) => ({ x: -p.x, y: p.y })))).toBe(false);
        expect(jHookExtendsLeft(jay.map((p) => ({ x: p.x, y: -p.y })))).toBe(false);
    });

    test("the linear map keeps advance on +x and the cap on +y", () => {
        const src = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 0, y: 8 },
            { x: 10, y: 8 },
        ];
        const upright = fitLinear(
            src,
            src.map((p) => ({ x: 2 * p.x, y: 2 * p.y })),
        );
        expect(gradeChirality({ map: upright, advanceMm: 72, hookLeft: true }).pass).toBe(true);
        const mirrored = fitLinear(
            src,
            src.map((p) => ({ x: -p.x, y: p.y })),
        );
        const grade = gradeChirality({ map: mirrored, advanceMm: -72, hookLeft: false });
        expect(grade.pass).toBe(false);
        expect(mirrored.a).toBeLessThan(0);
        expect(mirrored.det).toBeLessThan(0);
    });
});
