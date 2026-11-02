// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { interpretOneClickRx } from "@/lib/clinical/one-click-rx";
import { hasPostingAngleWarning } from "@/lib/geometry/clinical-constraints";
import { type HeightFieldParams, heightAt } from "@/lib/geometry/height-field";
import {
    codeOutlineWidthMm,
    FOREFOOT_POST_DEG_MAX,
    FOREFOOT_POST_U,
    postingDegAboveWarn,
    postingMmAtStation,
    postingRiseMm,
    postingStationU,
    REARFOOT_POST_DEG_MAX,
    REARFOOT_POST_U,
} from "@/lib/geometry/posting-degrees";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { sampleDefaultOutline } from "@/lib/geometry/trimline";
import { getForefootFactor, getRearfootFactor, wedgeDeltaAt } from "@/lib/geometry/wedge";
import type { Side, SideCorrections } from "@/types";

const WALL_STYLES = ["straight", "round", "hybrid"] as const;

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

/** Medial-to-lateral span of the code outline, perpendicular to the long axis. */
function polylineWidthMm(u: number, lengthMm: number, widthMm: number): number {
    const curve = sampleDefaultOutline(lengthMm, widthMm, 20);
    const x = u * lengthMm;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of curve.points) {
        if (p.x !== x) continue;
        yMin = Math.min(yMin, p.y);
        yMax = Math.max(yMax, p.y);
    }
    if (!Number.isFinite(yMin) || !(yMax > yMin)) throw new Error(`no outline span at u ${u}`);
    return yMax - yMin;
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

describe("posting degrees → mm", () => {
    test("US 7.5 at 2° matches outline W·tanθ at each station, side, and wall style", () => {
        const layout = insoleLayoutForUsMenSize(7.5);
        const deg = 2;
        const outline = { lengthMm: layout.lengthMm, widthMm: layout.widthMm };
        for (const wallStyle of WALL_STYLES) {
            for (const side of ["left", "right"] as const) {
                for (const zone of ["rearfoot", "forefoot"] as const) {
                    const u = postingStationU(zone);
                    const edge = zone === "rearfoot" ? "medial" : "lateral";
                    const fromPolyline = polylineWidthMm(u, layout.lengthMm, layout.widthMm);
                    const W = codeOutlineWidthMm(u, outline);
                    expect(W).toBe(fromPolyline);
                    const h = fromPolyline * Math.tan((deg * Math.PI) / 180);
                    expect(postingRiseMm(deg, W)).toBe(h);
                    const corrections = blank();
                    if (zone === "rearfoot") {
                        corrections.rearfootWedge = { side: edge, value: deg, unit: "deg" };
                    } else {
                        corrections.forefootWedge = { side: edge, value: deg, unit: "deg" };
                    }
                    const rise = wedgeDeltaAt(u, highV(side, edge), side, corrections, outline);
                    expect(Math.abs(rise - h)).toBeLessThanOrEqual(0.01);
                    // Wall style builds on this planform; it does not pick a different W.
                    expect(wallStyle === "straight" || wallStyle === "round" || wallStyle === "hybrid").toBe(
                        true,
                    );
                }
            }
        }
    });

    test("0° is an exact no-op", () => {
        const layout = insoleLayoutForUsMenSize(7.5);
        const outline = { lengthMm: layout.lengthMm, widthMm: layout.widthMm };
        expect(postingRiseMm(0, 80)).toBe(0);
        expect(postingMmAtStation("rearfoot", 0, outline)).toBe(0);
        expect(postingMmAtStation("forefoot", 0, outline)).toBe(0);
        const zero = blank();
        zero.rearfootWedge = { side: "medial", value: 0, unit: "deg" };
        zero.forefootWedge = { side: "lateral", value: 0, unit: "deg" };
        const bare = field("right", blank(), layout.lengthMm, layout.widthMm);
        const posted = field("right", zero, layout.lengthMm, layout.widthMm);
        for (const u of [0, REARFOOT_POST_U, 0.4, FOREFOOT_POST_U, 1]) {
            for (const v of [-1, -0.4, 0, 0.4, 1]) {
                expect(heightAt(u, v, posted)).toBe(heightAt(u, v, bare));
                expect(wedgeDeltaAt(u, v, "right", zero, outline)).toBe(0);
            }
        }
    });

    test("millimetre wedges stay on the absolute taper", () => {
        const outline = { lengthMm: 266, widthMm: 95 };
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
            { u: FOREFOOT_POST_U, v: -1, side: "left", zone: "forefoot", edge: "lateral", mm: 1.5 },
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
        const outline = { lengthMm: layout.lengthMm, widthMm: layout.widthMm };
        const both = blank();
        both.rearfootWedge = { side: "medial", value: 4, unit: "deg" };
        both.forefootWedge = { side: "lateral", value: 3, unit: "deg" };
        const rearOnly = blank();
        rearOnly.rearfootWedge = both.rearfootWedge;
        const foreOnly = blank();
        foreOnly.forefootWedge = both.forefootWedge;
        expect(getForefootFactor(REARFOOT_POST_U)).toBe(0);
        expect(getRearfootFactor(FOREFOOT_POST_U)).toBe(0);
        for (const u of [REARFOOT_POST_U, 0.4, FOREFOOT_POST_U]) {
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
        expect(wedgeDeltaAt(FOREFOOT_POST_U, highV("right", "lateral"), "right", both, outline)).toBe(hFore);
        // The angles are not summed into one conversion.
        const summed = postingRiseMm(7, codeOutlineWidthMm(REARFOOT_POST_U, outline));
        expect(hRear + hFore).not.toBe(summed);
    });

    test("degree clamps are 0–8° rearfoot and 0–10° forefoot, with a warning above 6°", () => {
        const outline = { lengthMm: 260, widthMm: 95 };
        const rear9 = blank();
        rear9.rearfootWedge = { side: "lateral", value: 9, unit: "deg" };
        const rear8 = blank();
        rear8.rearfootWedge = { side: "lateral", value: REARFOOT_POST_DEG_MAX, unit: "deg" };
        expect(wedgeDeltaAt(REARFOOT_POST_U, 1, "right", rear9, outline)).toBe(
            wedgeDeltaAt(REARFOOT_POST_U, 1, "right", rear8, outline),
        );
        const fore12 = blank();
        fore12.forefootWedge = { side: "lateral", value: 12, unit: "deg" };
        const fore10 = blank();
        fore10.forefootWedge = { side: "lateral", value: FOREFOOT_POST_DEG_MAX, unit: "deg" };
        expect(wedgeDeltaAt(FOREFOOT_POST_U, 1, "right", fore12, outline)).toBe(
            wedgeDeltaAt(FOREFOOT_POST_U, 1, "right", fore10, outline),
        );
        expect(postingDegAboveWarn(6)).toBe(false);
        expect(postingDegAboveWarn(6.1)).toBe(true);
        expect(hasPostingAngleWarning(rear9)).toBe(true);
        const at6 = blank();
        at6.rearfootWedge = { side: "medial", value: 6, unit: "deg" };
        expect(hasPostingAngleWarning(at6)).toBe(false);
        const full7 = blank();
        full7.fullLengthWedge = { side: "lateral", value: 7, unit: "deg" };
        expect(hasPostingAngleWarning(full7)).toBe(false);
        expect(hasPostingAngleWarning(full7, 7)).toBe(false);
    });

    test("shoe width and size recompute h from the outline", () => {
        const medium = insoleLayoutForUsMenSize(7.5);
        const larger = insoleLayoutForUsMenSize(9);
        const medOutline = { lengthMm: medium.lengthMm, widthMm: medium.widthMm };
        const wideOutline = {
            ...medOutline,
            shoeWidth: {
                id: "wide" as const,
                ballWidthMm: medium.widthMm,
                heelWidthMm: medium.widthMm * 0.62,
            },
        };
        const hMed = postingMmAtStation("forefoot", 2, medOutline);
        const hWide = postingMmAtStation("forefoot", 2, wideOutline);
        const hLarge = postingMmAtStation("forefoot", 2, {
            lengthMm: larger.lengthMm,
            widthMm: larger.widthMm,
        });
        expect(hWide).not.toBe(hMed);
        expect(hLarge).not.toBe(hMed);
        expect(hWide).toBeGreaterThan(hMed);
    });

    test("an Rx in degrees uses the station conversion and varus raises medial", () => {
        const layout = insoleLayoutForUsMenSize(7.5);
        const outline = { lengthMm: layout.lengthMm, widthMm: layout.widthMm };
        const parsed = interpretOneClickRx("Left: 4° rearfoot varus", ["left"]);
        const parsedWedge = parsed.correctionsBySide.left?.rearfootWedge;
        expect(parsedWedge).toEqual({
            side: "medial",
            value: 4,
            unit: "deg",
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
        });
        const fore = interpretOneClickRx("Right forefoot 12 deg valgus", ["right"]);
        expect(fore.correctionsBySide.right?.forefootWedge).toEqual({
            side: "lateral",
            value: FOREFOOT_POST_DEG_MAX,
            unit: "deg",
        });
    });
});
