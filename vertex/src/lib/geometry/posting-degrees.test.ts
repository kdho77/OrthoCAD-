// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { interpretOneClickRx } from "@/lib/clinical/one-click-rx";
import { hasPostingAngleWarning } from "@/lib/geometry/clinical-constraints";
import { type HeightFieldParams, heightAt } from "@/lib/geometry/height-field";
import {
    bottomOutlineChordMm,
    codeOutlineWidthMm,
    FOREFOOT_POST_DEG_MAX,
    FOREFOOT_STATION_U0,
    FOREFOOT_STATION_U1,
    postingDegAboveWarn,
    postingMmAtStation,
    postingRiseMm,
    postingStationU,
    REARFOOT_POST_DEG_MAX,
    REARFOOT_POST_U,
    sizedBottomOutline,
} from "@/lib/geometry/posting-degrees";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import type { ShoeWidthId } from "@/lib/geometry/shoe-width";
import { effectiveOutlineHalfWidth } from "@/lib/geometry/trimline";
import { getForefootFactor, getRearfootFactor, wedgeDeltaAt } from "@/lib/geometry/wedge";
import type { Side, SideCorrections, WedgeCorrection } from "@/types";

function blank(): SideCorrections {
    return {
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
    };
}

function highV(side: Side, edge: "medial" | "lateral"): number {
    const medialSign = side === "left" ? -1 : 1;
    const m = edge === "medial" ? 1 : -1;
    return -m * medialSign;
}

function field(
    side: Side,
    corrections: SideCorrections,
    lengthMm: number,
    widthMm: number,
): HeightFieldParams {
    return {
        side,
        lengthMm,
        widthMm,
        thicknessMm: 3,
        corrections,
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

function stationWedge(edge: "medial" | "lateral", value: number): WedgeCorrection {
    return { side: edge, value, unit: "deg", degreeMode: "station" };
}

interface OutlinePoint {
    x: number;
    y: number;
}

/** Independent medial-to-lateral span. Not the production chord helper. */
function medialLateralMm(points: ReadonlyArray<OutlinePoint>, u: number, lengthMm: number): number {
    const x = u * lengthMm;
    let yMin = Infinity;
    let yMax = -Infinity;
    let hits = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        const dx = b.x - a.x;
        if (dx === 0) continue;
        const t = (x - a.x) / dx;
        if (t < 0 || t > 1) continue;
        const y = a.y + t * (b.y - a.y);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
        hits += 1;
    }
    if (hits < 2) throw new Error(`outline has no full chord at u ${u}`);
    return yMax - yMin;
}

function outlineFor(lengthMm: number, widthMm: number, widthId?: ShoeWidthId) {
    return {
        lengthMm,
        widthMm,
        shoeWidth: widthId ? { id: widthId, ballWidthMm: widthMm, heelWidthMm: widthMm * 0.62 } : undefined,
    };
}

describe("posting degrees → mm", () => {
    test("W is the bottom outline's full medial-lateral chord at both stations, L and R, width +/-", () => {
        const layout = insoleLayoutForUsMenSize(7.5);
        const cases: Array<{ widthId?: ShoeWidthId; widthMm: number }> = [
            { widthMm: layout.widthMm },
            { widthId: "narrow", widthMm: layout.widthMm },
            { widthId: "wide", widthMm: layout.widthMm },
            { widthMm: layout.widthMm - 5 },
            { widthMm: layout.widthMm + 5 },
        ];
        for (const { widthId, widthMm } of cases) {
            const outline = outlineFor(layout.lengthMm, widthMm, widthId);
            const points = sizedBottomOutline(outline);
            for (const zone of ["rearfoot", "forefoot"] as const) {
                const u = postingStationU(zone, outline);
                if (zone === "rearfoot") expect(u).toBe(REARFOOT_POST_U);
                else {
                    expect(u).toBeGreaterThanOrEqual(FOREFOOT_STATION_U0);
                    expect(u).toBeLessThanOrEqual(FOREFOOT_STATION_U1);
                }
                const W = codeOutlineWidthMm(zone, outline);
                const chord = medialLateralMm(points, u, outline.lengthMm);
                expect(Math.abs(W - chord)).toBeLessThanOrEqual(0.1);
                expect(Math.abs(W - bottomOutlineChordMm(u, outline))).toBeLessThanOrEqual(0.1);
                // Full chord, not a half-width of the ball.
                expect(W).toBeGreaterThan(widthMm * 0.5);
                if (zone === "forefoot" && widthId === undefined && widthMm === layout.widthMm) {
                    expect(W).toBeGreaterThanOrEqual(80);
                    expect(W).toBeLessThanOrEqual(90);
                }
                const deg = 2;
                const h = chord * Math.tan((deg * Math.PI) / 180);
                expect(Math.abs(postingRiseMm(deg, W) - h)).toBeLessThanOrEqual(0.01);
                const edge = zone === "rearfoot" ? "medial" : "lateral";
                for (const side of ["left", "right"] as const) {
                    const corrections = blank();
                    const wedge = stationWedge(edge, deg);
                    if (zone === "rearfoot") corrections.rearfootWedge = wedge;
                    else corrections.forefootWedge = wedge;
                    const rise = wedgeDeltaAt(u, highV(side, edge), side, corrections, outline);
                    expect(Math.abs(rise - h)).toBeLessThanOrEqual(0.01);
                    // The opposite edge is the hinge.
                    expect(
                        wedgeDeltaAt(
                            u,
                            highV(side, edge === "medial" ? "lateral" : "medial"),
                            side,
                            corrections,
                            outline,
                        ),
                    ).toBe(0);
                }
            }
            const medium = codeOutlineWidthMm("forefoot", outlineFor(layout.lengthMm, layout.widthMm));
            const changed = codeOutlineWidthMm("forefoot", outline);
            if (widthId === "wide" || widthMm > layout.widthMm) expect(changed).toBeGreaterThan(medium);
            if (widthId === "narrow" || widthMm < layout.widthMm) expect(changed).toBeLessThan(medium);
        }
    });

    test("US 7.5 station rise is W·tan(2°) and legacy degrees still use local width", () => {
        const layout = insoleLayoutForUsMenSize(7.5);
        const outline = outlineFor(layout.lengthMm, layout.widthMm);
        const rearW = codeOutlineWidthMm("rearfoot", outline);
        const foreW = codeOutlineWidthMm("forefoot", outline);
        const rearH = postingMmAtStation("rearfoot", 2, outline);
        const foreH = postingMmAtStation("forefoot", 2, outline);
        expect(rearH).toBeCloseTo(rearW * Math.tan((2 * Math.PI) / 180), 8);
        expect(foreH).toBeCloseTo(foreW * Math.tan((2 * Math.PI) / 180), 8);
        // Left and right share the chord. Width class is what moves it.
        expect(codeOutlineWidthMm("forefoot", outline)).toBe(foreW);
        expect(codeOutlineWidthMm("rearfoot", outline)).toBe(rearW);

        const legacy = blank();
        legacy.forefootWedge = { side: "lateral", value: 10, unit: "deg" };
        const u = 0.7;
        const hw = effectiveOutlineHalfWidth(u, layout.lengthMm, layout.widthMm, null);
        const localFullWidth = 2 * hw * (layout.widthMm / 2);
        const expected = localFullWidth * Math.tan((10 * Math.PI) / 180) * getForefootFactor(u);
        expect(wedgeDeltaAt(u, 1, "right", legacy, outline)).toBeCloseTo(expected, 8);
        const station = blank();
        station.forefootWedge = stationWedge("lateral", 10);
        expect(wedgeDeltaAt(u, 1, "right", station, outline)).not.toBeCloseTo(expected, 1);
    });

    test("0° is an exact no-op on both degree paths", () => {
        const layout = insoleLayoutForUsMenSize(7.5);
        const outline = outlineFor(layout.lengthMm, layout.widthMm);
        expect(postingRiseMm(0, 80)).toBe(0);
        expect(postingMmAtStation("rearfoot", 0, outline)).toBe(0);
        expect(postingMmAtStation("forefoot", 0, outline)).toBe(0);
        const zero = blank();
        zero.rearfootWedge = stationWedge("medial", 0);
        zero.forefootWedge = { side: "lateral", value: 0, unit: "deg" };
        const bare = field("right", blank(), layout.lengthMm, layout.widthMm);
        const posted = field("right", zero, layout.lengthMm, layout.widthMm);
        const foreU = postingStationU("forefoot", outline);
        for (const u of [0, REARFOOT_POST_U, 0.4, foreU, 1]) {
            for (const v of [-1, -0.4, 0, 0.4, 1]) {
                expect(heightAt(u, v, posted)).toBe(heightAt(u, v, bare));
                expect(wedgeDeltaAt(u, v, "right", zero, outline)).toBe(0);
            }
        }
    });

    test("millimetre wedges stay on the absolute taper", () => {
        const outline = { lengthMm: 266, widthMm: 95 };
        const foreU = postingStationU("forefoot", outline);
        const samples: Array<{
            u: number;
            v: number;
            side: Side;
            zone: "rearfoot" | "forefoot";
            edge: "medial" | "lateral";
            mm: number;
        }> = [
            { u: REARFOOT_POST_U, v: 1, side: "right", zone: "rearfoot", edge: "lateral", mm: 4 },
            { u: REARFOOT_POST_U, v: -1, side: "left", zone: "rearfoot", edge: "medial", mm: 3 },
            { u: foreU, v: -1, side: "left", zone: "forefoot", edge: "lateral", mm: 1.5 },
            { u: 0.4, v: 0.25, side: "right", zone: "forefoot", edge: "medial", mm: 6 },
        ];
        for (const s of samples) {
            const corrections = blank();
            const wedge = { side: s.edge, value: s.mm, unit: "mm" as const };
            if (s.zone === "rearfoot") corrections.rearfootWedge = wedge;
            else corrections.forefootWedge = wedge;
            const zoneFactor = s.zone === "rearfoot" ? getRearfootFactor(s.u) : getForefootFactor(s.u);
            const medialSign = s.side === "left" ? -1 : 1;
            const m = -(Math.max(-1, Math.min(1, s.v)) * medialSign);
            const cross = Math.max(0, Math.min(1, (1 - m) / 2));
            const taper = s.edge === "medial" ? 1 - cross : cross;
            const expected = s.mm * taper * zoneFactor;
            expect(wedgeDeltaAt(s.u, s.v, s.side, corrections, outline)).toBe(expected);
        }
    });

    test("rearfoot and forefoot convert at their own stations and only blend in the midfoot", () => {
        const layout = insoleLayoutForUsMenSize(9);
        const outline = outlineFor(layout.lengthMm, layout.widthMm);
        const foreU = postingStationU("forefoot", outline);
        const both = blank();
        both.rearfootWedge = stationWedge("medial", 4);
        both.forefootWedge = stationWedge("lateral", 3);
        const rearOnly = blank();
        rearOnly.rearfootWedge = both.rearfootWedge;
        const foreOnly = blank();
        foreOnly.forefootWedge = both.forefootWedge;
        expect(getForefootFactor(REARFOOT_POST_U)).toBe(0);
        expect(getRearfootFactor(foreU)).toBe(0);
        for (const u of [REARFOOT_POST_U, 0.4, foreU]) {
            for (const v of [-1, 0, 1]) {
                const sum =
                    wedgeDeltaAt(u, v, "right", rearOnly, outline) +
                    wedgeDeltaAt(u, v, "right", foreOnly, outline);
                expect(wedgeDeltaAt(u, v, "right", both, outline)).toBe(sum);
            }
        }
        const hRear = postingMmAtStation("rearfoot", 4, outline);
        const hFore = postingMmAtStation("forefoot", 3, outline);
        expect(wedgeDeltaAt(REARFOOT_POST_U, highV("right", "medial"), "right", both, outline)).toBe(hRear);
        expect(wedgeDeltaAt(foreU, highV("right", "lateral"), "right", both, outline)).toBe(hFore);
        const summed = postingRiseMm(7, codeOutlineWidthMm("rearfoot", outline));
        expect(hRear + hFore).not.toBe(summed);
    });

    test("station-mode clamps are 0–8° rearfoot and 0–10° forefoot, with a warning above 6°", () => {
        const outline = { lengthMm: 260, widthMm: 95 };
        const rear9 = blank();
        rear9.rearfootWedge = stationWedge("lateral", 9);
        const rear8 = blank();
        rear8.rearfootWedge = stationWedge("lateral", REARFOOT_POST_DEG_MAX);
        expect(wedgeDeltaAt(REARFOOT_POST_U, 1, "right", rear9, outline)).toBe(
            wedgeDeltaAt(REARFOOT_POST_U, 1, "right", rear8, outline),
        );
        const foreU = postingStationU("forefoot", outline);
        const fore12 = blank();
        fore12.forefootWedge = stationWedge("lateral", 12);
        const fore10 = blank();
        fore10.forefootWedge = stationWedge("lateral", FOREFOOT_POST_DEG_MAX);
        expect(wedgeDeltaAt(foreU, 1, "right", fore12, outline)).toBe(
            wedgeDeltaAt(foreU, 1, "right", fore10, outline),
        );
        // Legacy degrees are not clamped to 8°.
        const legacy9 = blank();
        legacy9.rearfootWedge = { side: "lateral", value: 9, unit: "deg" };
        const legacy8 = blank();
        legacy8.rearfootWedge = { side: "lateral", value: 8, unit: "deg" };
        expect(wedgeDeltaAt(REARFOOT_POST_U, 1, "right", legacy9, outline)).toBeGreaterThan(
            wedgeDeltaAt(REARFOOT_POST_U, 1, "right", legacy8, outline),
        );
        expect(postingDegAboveWarn(6)).toBe(false);
        expect(postingDegAboveWarn(6.1)).toBe(true);
        expect(hasPostingAngleWarning(rear9)).toBe(true);
        const at6 = blank();
        at6.rearfootWedge = stationWedge("medial", 6);
        expect(hasPostingAngleWarning(at6)).toBe(false);
        expect(hasPostingAngleWarning(legacy9)).toBe(true);
        const legacy7 = blank();
        legacy7.rearfootWedge = { side: "medial", value: 7, unit: "deg" };
        expect(hasPostingAngleWarning(legacy7)).toBe(false);
        const full7 = blank();
        full7.fullLengthWedge = { side: "lateral", value: 7, unit: "deg" };
        expect(hasPostingAngleWarning(full7)).toBe(false);
        expect(hasPostingAngleWarning(full7, 7)).toBe(false);
    });

    test("an Rx in degrees uses station mode and varus raises medial", () => {
        const layout = insoleLayoutForUsMenSize(7.5);
        const outline = outlineFor(layout.lengthMm, layout.widthMm);
        const parsed = interpretOneClickRx("Left: 4° rearfoot varus", ["left"]);
        const parsedWedge = parsed.correctionsBySide.left?.rearfootWedge;
        expect(parsedWedge).toEqual({
            side: "medial",
            value: 4,
            unit: "deg",
            degreeMode: "station",
        });
        const corrections = blank();
        corrections.rearfootWedge = parsedWedge;
        const h = postingMmAtStation("rearfoot", 4, outline);
        const rise = wedgeDeltaAt(REARFOOT_POST_U, highV("left", "medial"), "left", corrections, outline);
        expect(Math.abs(rise - h)).toBeLessThanOrEqual(0.01);
        const clamped = interpretOneClickRx("Left rearfoot 12 deg varus", ["left"]);
        expect(clamped.correctionsBySide.left?.rearfootWedge).toEqual({
            side: "medial",
            value: REARFOOT_POST_DEG_MAX,
            unit: "deg",
            degreeMode: "station",
        });
        const fore = interpretOneClickRx("Right forefoot 12 deg valgus", ["right"]);
        expect(fore.correctionsBySide.right?.forefootWedge).toEqual({
            side: "lateral",
            value: FOREFOOT_POST_DEG_MAX,
            unit: "deg",
            degreeMode: "station",
        });
    });
});
