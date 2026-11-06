// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import type { Side } from "@/types";
import {
    type AmputationPoint,
    amputationDeltaMm,
    amputationFillerActive,
    amputationOutsideReachMm,
    amputationRiseMm,
    confirmAmputationDraw,
    defaultSideAmputation,
    normalizeSideAmputation,
    rimBlendBandMm,
    rimRiseTaper,
    subdivideTallWalls,
} from "./amputee-filler";
import { type HeightFieldParams, heightAt, outlineHalfWidth } from "./height-field";

const LENGTH = 260;
const WIDTH = 96;

function half(u: number): number {
    return outlineHalfWidth(u) * (WIDTH / 2);
}

/** U from the medial edge, around the toe, to the lateral edge. */
function forefootCut(length = LENGTH, width = WIDTH): AmputationPoint[] {
    const edge = (u: number) => outlineHalfWidth(u) * (width / 2);
    const u0 = 0.7;
    return [
        { x: u0 * length, y: edge(u0) },
        { x: 0.78 * length, y: edge(0.78) * 0.4 },
        { x: 0.86 * length, y: 0 },
        { x: 0.78 * length, y: -edge(0.78) * 0.4 },
        { x: u0 * length, y: -edge(u0) },
    ];
}

function amp(over: Partial<ReturnType<typeof defaultSideAmputation>> = {}) {
    return normalizeSideAmputation({
        ...defaultSideAmputation(),
        enabled: true,
        points: forefootCut(),
        ...over,
    });
}

function bareField(side: Side): HeightFieldParams {
    return {
        side,
        lengthMm: LENGTH,
        widthMm: WIDTH,
        thicknessMm: 2,
        corrections: {
            forefootPostingDeg: 0,
            rearfootPostingDeg: 0,
            medialSkiveMm: 0,
            lateralSkiveMm: 0,
            archFillMm: 0,
            archHeightMm: 0,
            archEaseMm: 0,
            heelCupDepthMm: 0,
            heelCupHeightMm: 0,
            heelCupWidthMm: 0,
            heelLiftMm: 0,
            apexMoveMm: 0,
            medialFlangeMm: 0,
            lateralFlangeMm: 0,
        },
    };
}

describe("amputation fillet profile", () => {
    const spec = {
        height: 15,
        filletInside: 10,
        filletOutside: 30,
        interfaceFillet: true,
    };

    test("plateau is the requested height and the heel side of the outside fillet is flat", () => {
        expect(amputationRiseMm(40, spec)).toBe(15);
        expect(amputationRiseMm(spec.filletInside + 5, spec)).toBe(15);
        const reach = amputationOutsideReachMm(spec);
        expect(reach).toBeLessThanOrEqual(spec.filletOutside);
        expect(amputationRiseMm(-spec.filletOutside - 1, spec)).toBe(0);
        expect(amputationRiseMm(-reach, spec)).toBe(0);
        expect(amputationRiseMm(-reach + 2, spec)).toBeGreaterThan(0);
        expect(amputationRiseMm(-reach + 2, spec)).toBeLessThan(15);
    });

    test("overlapping radii stay at or under the height", () => {
        for (let s = -40; s <= 40; s += 0.5) {
            const h = amputationRiseMm(s, spec);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThanOrEqual(15);
        }
    });

    test("the rim fade is 0 on the wall and full height once the blend has finished", () => {
        expect(rimRiseTaper(0, 20)).toBe(0);
        expect(rimRiseTaper(-1, 20)).toBe(0);
        expect(rimRiseTaper(20, 20)).toBe(1);
        expect(rimRiseTaper(10, 20)).toBeGreaterThan(0.4);
        expect(rimRiseTaper(10, 20)).toBeLessThan(0.6);
        const band = rimBlendBandMm(spec);
        expect(band).toBeGreaterThan(15);
        const peak = (1.5 * spec.height) / band;
        expect(Math.atan(peak) * (180 / Math.PI)).toBeLessThanOrEqual(50.1);
    });

    test("interface fillet off cleans up about 1 mm and is near-vertical", () => {
        const off = { ...spec, interfaceFillet: false, filletOutside: 30 };
        const reach = amputationOutsideReachMm(off);
        expect(reach).toBeGreaterThan(0.7);
        expect(reach).toBeLessThan(1.2);
        expect(amputationRiseMm(-2, off)).toBe(0);
        expect(amputationRiseMm(20, off)).toBe(15);
    });
});

describe("amputation draw", () => {
    test("confirm fits a spline and snaps the ends onto the outline", () => {
        const raw = forefootCut();
        raw[2] = { x: raw[2]!.x, y: raw[2]!.y + 1 };
        const drawn = confirmAmputationDraw(raw, LENGTH, WIDTH, half);
        expect(drawn.rejected).toBe(false);
        expect(drawn.spline.length).toBeGreaterThan(raw.length);
    });

    test("a self-crossing click is clipped instead of kept", () => {
        const raw: AmputationPoint[] = [
            { x: 180, y: 30 },
            { x: 210, y: 10 },
            { x: 190, y: -10 },
            { x: 220, y: 20 },
            { x: 180, y: -30 },
        ];
        const drawn = confirmAmputationDraw(raw, LENGTH, WIDTH, half);
        expect(drawn.clipped || drawn.rejected).toBe(true);
    });

    test("a point outside the outline is clipped back onto it", () => {
        const raw = forefootCut();
        raw[1] = { x: raw[1]!.x, y: 80 };
        const drawn = confirmAmputationDraw(raw, LENGTH, WIDTH, half);
        expect(drawn.rejected).toBe(false);
        expect(drawn.clipped).toBe(true);
        expect(Math.abs(drawn.points[1]!.y)).toBeLessThan(WIDTH / 2);
    });
});

describe("amputation height field", () => {
    test("filler off does not change heightAt", () => {
        const field = bareField("right");
        const disabled = amp({ enabled: false });
        expect(amputationFillerActive(disabled)).toBe(false);
        for (let i = 0; i <= 10; i++) {
            for (let j = 0; j <= 8; j++) {
                const u = i / 10;
                const v = (j / 8) * 2 - 1;
                const plain = heightAt(u, v, field);
                const missing = heightAt(u, v, { ...field, amputation: undefined });
                const off = heightAt(u, v, { ...field, amputation: disabled });
                expect(missing).toBe(plain);
                expect(off).toBe(plain);
            }
        }
    });

    test("the added rise matches the shared profile and the left foot mirrors the right", () => {
        const cut = amp();
        for (const side of ["left", "right"] as const) {
            const field = { ...bareField(side), amputation: cut };
            for (const [u, v] of [
                [0.2, 0],
                [0.95, 0],
                [0.95, 0.4],
                [0.75, -0.2],
            ] as const) {
                const delta = heightAt(u, v, field) - heightAt(u, v, bareField(side));
                const shared = amputationDeltaMm(u, v, side, LENGTH, WIDTH, cut, half);
                expect(delta).toBeCloseTo(shared, 6);
            }
        }
        const left = amp();
        const right = amp();
        for (let i = 0; i <= 12; i++) {
            const u = i / 12;
            for (const v of [-0.6, -0.2, 0, 0.3, 0.8]) {
                expect(amputationDeltaMm(u, v, "left", LENGTH, WIDTH, left, half)).toBeCloseTo(
                    amputationDeltaMm(u, v, "right", LENGTH, WIDTH, right, half),
                    6,
                );
            }
        }
    });

    test("toe side reaches the plateau and the heel past the fillet does not", () => {
        const cut = amp();
        const field = { ...bareField("left"), amputation: cut };
        const toe = heightAt(0.97, 0, field) - heightAt(0.97, 0, bareField("left"));
        const heel = heightAt(0.15, 0, field) - heightAt(0.15, 0, bareField("left"));
        expect(toe).toBeCloseTo(15, 1);
        expect(Math.abs(toe - 15)).toBeLessThanOrEqual(0.1);
        expect(heel).toBe(0);
    });
});

describe("tall wall subdivision", () => {
    test("splits a steep wall edge without shortening the shortest edge or opening the mesh", () => {
        const positions = [0, 0, 0, 1, 0, 0, 0, 0, 12, 1, 0, 12, 0, 3, 0, 1, 3, 0, 0, 3, 12, 1, 3, 12];
        const indices = [
            0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7, 0, 4, 1, 1, 4, 5, 2, 3, 6, 3, 7, 6, 0, 2, 4, 2, 6, 4, 1, 5, 3,
            5, 7, 3,
        ];
        const before = minEdge(positions, indices);
        const splits = subdivideTallWalls(positions, indices);
        expect(splits).toBeGreaterThan(0);
        expect(minEdge(positions, indices)).toBeGreaterThanOrEqual(before - 1e-9);
        expect(nakedEdges(indices)).toBe(0);
        expect(maxAspect(positions, indices)).toBeLessThan(maxAspectOfOriginal());
    });
});

function maxAspectOfOriginal(): number {
    const positions = [0, 0, 0, 1, 0, 0, 0, 0, 12, 1, 0, 12, 0, 3, 0, 1, 3, 0, 0, 3, 12, 1, 3, 12];
    const indices = [
        0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7, 0, 4, 1, 1, 4, 5, 2, 3, 6, 3, 7, 6, 0, 2, 4, 2, 6, 4, 1, 5, 3, 5,
        7, 3,
    ];
    return maxAspect(positions, indices);
}

function minEdge(positions: number[], indices: number[]): number {
    let min = Infinity;
    for (let f = 0; f < indices.length; f += 3) {
        for (const [i, j] of [
            [indices[f]!, indices[f + 1]!],
            [indices[f + 1]!, indices[f + 2]!],
            [indices[f + 2]!, indices[f]!],
        ] as const) {
            const d = Math.hypot(
                positions[i * 3]! - positions[j * 3]!,
                positions[i * 3 + 1]! - positions[j * 3 + 1]!,
                positions[i * 3 + 2]! - positions[j * 3 + 2]!,
            );
            if (d < min) min = d;
        }
    }
    return min;
}

function maxAspect(positions: number[], indices: number[]): number {
    let worst = 0;
    for (let f = 0; f < indices.length; f += 3) {
        const lens: number[] = [];
        const tri = [indices[f]!, indices[f + 1]!, indices[f + 2]!];
        for (let k = 0; k < 3; k++) {
            const i = tri[k]!;
            const j = tri[(k + 1) % 3]!;
            lens.push(
                Math.hypot(
                    positions[i * 3]! - positions[j * 3]!,
                    positions[i * 3 + 1]! - positions[j * 3 + 1]!,
                    positions[i * 3 + 2]! - positions[j * 3 + 2]!,
                ),
            );
        }
        const short = Math.min(...lens);
        const long = Math.max(...lens);
        const aspect = short < 1e-9 ? Infinity : long / short;
        if (aspect > worst) worst = aspect;
    }
    return worst;
}

function nakedEdges(indices: number[]): number {
    const use = new Map<string, number>();
    for (let f = 0; f < indices.length; f += 3) {
        const tri = [indices[f]!, indices[f + 1]!, indices[f + 2]!];
        for (let k = 0; k < 3; k++) {
            const i = tri[k]!;
            const j = tri[(k + 1) % 3]!;
            const key = i < j ? `${i},${j}` : `${j},${i}`;
            use.set(key, (use.get(key) ?? 0) + 1);
        }
    }
    let naked = 0;
    for (const n of use.values()) if (n !== 2) naked++;
    return naked;
}
