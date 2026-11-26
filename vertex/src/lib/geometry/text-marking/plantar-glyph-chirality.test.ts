// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side, SideCorrections } from "@/types";
import { fitLinear, type LinearMap } from "../../../../../tests/name-plantar-e2e/measure";
import { physicalReadingView } from "../../../../../tests/name-plantar-e2e/reading-view";
import { G1_AXIS_MIN, G1_SKEW_MAX } from "../../../../../tests/name-plantar-e2e/thresholds";
import { normalizeBottomTextMarking } from "../../../../shared/bottom-text-marking";
import { beltMachinePoint, flatBedSoleView, printedPlantarView } from "./belt-print-frame";
import { defaultTextMarking } from "./constants";
import { flattenText } from "./contours";
import { loadTextFont } from "./font";
import { extractHostTextContext, placeBottomText } from "./place";
import type { TextGlyphGroup, TextXy } from "./types";

/** Synthetic probe. Not a patient name. Asymmetric letters only. */
const PROBE = "GNRF";

const ZERO: SideCorrections = {
    forefootPostingDeg: 0,
    rearfootPostingDeg: 0,
    medialSkiveMm: 0,
    lateralSkiveMm: 0,
    archFillMm: 0,
    archHeightMm: 0,
    heelCupDepthMm: 0,
    heelCupHeightMm: 0,
    heelCupWidthMm: 0,
    heelLiftMm: 0,
    apexMoveMm: 0,
    medialFlangeMm: 0,
    lateralFlangeMm: 0,
};

interface Box {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    w: number;
    h: number;
}

function bounds(pts: readonly TextXy[]): Box {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function meanYInXBand(outer: readonly TextXy[], x0: number, x1: number): number {
    const b = bounds(outer);
    let sum = 0;
    let n = 0;
    for (const p of outer) {
        const t = (p.x - b.minX) / b.w;
        if (t < x0 || t >= x1) continue;
        sum += p.y;
        n += 1;
    }
    return n >= 8 ? sum / n : Number.NaN;
}

/** Upright N (and R's leg): the stroke is higher on the left than on the right. A mirror is И. */
function fallsTowardTheRight(outer: readonly TextXy[]): boolean {
    const b = bounds(outer);
    const left = meanYInXBand(outer, 0.3, 0.48);
    const right = meanYInXBand(outer, 0.52, 0.7);
    return left - right > 0.15 * b.h;
}

/** Upright F: the arms reach the right at the top, and the bottom is only the stem. */
function fArmsFaceRight(outer: readonly TextXy[]): boolean {
    const b = bounds(outer);
    const maxX = (y0: number, y1: number) => {
        let best = -Infinity;
        for (const p of outer) {
            const t = (p.y - b.minY) / b.h;
            if (t < y0 || t > y1) continue;
            if (p.x > best) best = p.x;
        }
        return best;
    };
    return (maxX(0.72, 1) - maxX(0, 0.28)) / b.w > 0.35;
}

/** Upright R: the bowl is in the upper half and the leg falls to the right. */
function rReadsForward(outer: readonly TextXy[], holes: readonly TextXy[][]): boolean {
    const hole = holes[0];
    if (!hole || hole.length < 3) return false;
    const b = bounds(outer);
    const hb = bounds(hole);
    const cy = ((hb.minY + hb.maxY) / 2 - b.minY) / b.h;
    return cy > 0.55 && fallsTowardTheRight(outer);
}

function expectSoleMap(map: LinearMap, label: string) {
    expect(map.a, `${label} advance`).toBeGreaterThan(G1_AXIS_MIN);
    expect(map.d, `${label} cap`).toBeGreaterThan(G1_AXIS_MIN);
    expect(Math.abs(map.b), `${label} skew`).toBeLessThan(G1_SKEW_MAX);
    expect(Math.abs(map.c), `${label} skew`).toBeLessThan(G1_SKEW_MAX);
    expect(map.det, `${label} chirality`).toBeGreaterThan(0);
}

function byAdvance(groups: readonly TextGlyphGroup[]): TextGlyphGroup[] {
    return [...groups].sort((a, b) => {
        const ax = a.outer.reduce((s, p) => s + p.x, 0) / a.outer.length;
        const bx = b.outer.reduce((s, p) => s + p.x, 0) / b.outer.length;
        return ax - bx;
    });
}

function expectGlyphShapes(
    label: string,
    fontGroups: readonly TextGlyphGroup[],
    placedGroups: readonly TextGlyphGroup[],
    view: (p: TextXy) => TextXy,
) {
    const font = byAdvance(fontGroups);
    const placed = byAdvance(placedGroups);
    expect(placed, label).toHaveLength(PROBE.length);
    for (let i = 0; i < PROBE.length; i++) {
        const letter = PROBE[i]!;
        const source = font[i]!;
        const group = placed[i]!;
        const viewed = {
            outer: group.outer.map(view),
            holes: group.holes.map((hole) => hole.map(view)),
        };
        if (letter === "N") {
            expect(fallsTowardTheRight(viewed.outer), `${label} ${letter} reads as И`).toBe(true);
        }
        if (letter === "F") {
            expect(fArmsFaceRight(viewed.outer), `${label} ${letter} arms face right`).toBe(true);
        }
        if (letter === "R") {
            expect(rReadsForward(viewed.outer, viewed.holes), `${label} ${letter} bowl`).toBe(true);
        }
        expectSoleMap(fitLinear(source.outer, viewed.outer), `${label} ${letter}`);
    }
}

async function loftInternal(side: Side) {
    const buf = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "right") {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    const preview = await reconstructProceduralPreview(raw, {
        corrections: { ...ZERO },
        wallStyle: "straight",
        scanPattern: "full_contact",
        side,
        thicknessMm: 2,
    });
    raw.dispose();
    return preview.geometry;
}

describe("glyph chirality from below the sole", () => {
    test("G, N, R, and F fail when the cap is flipped or the string is mirrored", async () => {
        const font = await loadTextFont();
        const flat = flattenText(font, PROBE, 12, 0, true);
        const ordered = byAdvance(flat.groups);
        expect(ordered).toHaveLength(4);
        const letters = [...PROBE];
        for (let i = 0; i < letters.length; i++) {
            const letter = letters[i]!;
            const group = ordered[i]!;
            const upright = group.outer;
            const mirrorX = upright.map((p) => ({ x: -p.x, y: p.y }));
            const mirrorY = upright.map((p) => ({ x: p.x, y: -p.y }));
            if (letter === "N" || letter === "R") {
                expect(fallsTowardTheRight(upright), letter).toBe(true);
                expect(fallsTowardTheRight(mirrorX), `${letter} left-right`).toBe(false);
                expect(fallsTowardTheRight(mirrorY), `${letter} upside down`).toBe(false);
            }
            if (letter === "F") {
                expect(fArmsFaceRight(upright)).toBe(true);
                expect(fArmsFaceRight(mirrorX)).toBe(false);
                expect(fArmsFaceRight(mirrorY)).toBe(false);
            }
            if (letter === "R") {
                expect(rReadsForward(upright, group.holes)).toBe(true);
                expect(
                    rReadsForward(
                        mirrorY,
                        group.holes.map((hole) => hole.map((p) => ({ x: p.x, y: -p.y }))),
                    ),
                ).toBe(false);
            }
            const flatUp = fitLinear(
                upright,
                upright.map((p) => flatBedSoleView({ x: p.x, y: p.y })),
            );
            expectSoleMap(flatUp, `${letter} flat bed`);
            const capDown = fitLinear(
                upright,
                upright.map((p) => flatBedSoleView({ x: p.x, y: -p.y })),
            );
            expect(capDown.d, `${letter} flat −Y cap is upside down`).toBeLessThan(-G1_AXIS_MIN);
            const belt = fitLinear(
                upright,
                upright.map((p) => printedPlantarView({ x: p.x, y: -p.y })),
            );
            expectSoleMap(belt, `${letter} belt`);
            const oldBelt = fitLinear(
                upright,
                upright.map((p) => printedPlantarView(p)),
            );
            expect(oldBelt.d, `${letter} unflipped belt Y`).toBeLessThan(-G1_AXIS_MIN);
        }
    });

    test("both feet read GNRF forward on the belt and on a flat bed", async () => {
        const font = await loadTextFont();
        const marking = normalizeBottomTextMarking({
            ...defaultTextMarking("bottom"),
            text: PROBE,
            capHeightMm: 6,
            bold: false,
        });
        expect(marking.capHeightMm).toBe(12);
        expect(marking.bold).toBe(true);
        const flat = flattenText(
            font,
            marking.text,
            marking.capHeightMm,
            marking.letterSpacingMm,
            marking.bold,
        );
        const signs: Array<{ side: Side; a: number; d: number }> = [];

        for (const side of ["left", "right"] as const) {
            const geo = await loftInternal(side);
            const ctx = extractHostTextContext(geo);
            const bed = placeBottomText(geo, ctx, marking, flat, side);
            const belt = placeBottomText(geo, ctx, marking, flat, side, { beltPrint: true });
            expectGlyphShapes(`${side} flat bed`, flat.groups, bed.flat.groups, flatBedSoleView);
            expectGlyphShapes(`${side} belt`, flat.groups, belt.flat.groups, (p) => printedPlantarView(p));
            expectGlyphShapes(`${side} heel-first`, flat.groups, belt.flat.groups, (p) =>
                printedPlantarView(p, "heel_first"),
            );

            const fontGroups = byAdvance(flat.groups);
            const placed = byAdvance(belt.flat.groups);
            for (let i = 0; i < PROBE.length; i++) {
                const overlay = fitLinear(
                    fontGroups[i]!.outer,
                    placed[i]!.outer.map((p) => printedPlantarView({ x: p.x, y: -p.y })),
                );
                expect(overlay.d, `${side} ${PROBE[i]} overlay`).toBeLessThan(-G1_AXIS_MIN);
                const live = fitLinear(
                    fontGroups[i]!.outer,
                    placed[i]!.outer.map((p) => printedPlantarView(p)),
                );
                signs.push({ side, a: live.a, d: live.d });
            }

            const mids: number[] = [];
            for (let i = 0; i < belt.meta.centroids.length; i++) {
                const a = belt.meta.centroids[i]!;
                const b = bed.meta.centroids[i]!;
                expect(Math.abs(a.x - b.x), `${side} centroid x`).toBeLessThan(0.05);
                mids.push((a.y + b.y) / 2);
            }
            for (const mid of mids) {
                expect(Math.abs(mid - mids[0]!), `${side} belt/flat mirror axis`).toBeLessThan(0.05);
            }
            geo.dispose();
        }

        for (const row of signs) {
            expect(row.a, row.side).toBeGreaterThan(G1_AXIS_MIN);
            expect(row.d, row.side).toBeGreaterThan(G1_AXIS_MIN);
        }
        const left = signs.filter((row) => row.side === "left");
        const right = signs.filter((row) => row.side === "right");
        expect(left).toHaveLength(right.length);
        for (let i = 0; i < left.length; i++) {
            expect(Math.sign(left[i]!.a)).toBe(Math.sign(right[i]!.a));
            expect(Math.sign(left[i]!.d)).toBe(Math.sign(right[i]!.d));
        }
    }, 240_000);
});

describe("belt machine frame", () => {
    test("the sole view is the gcode reading frame and the flat bed", () => {
        const samples = [
            { x: 8, y: 3, z: 0 },
            { x: -12, y: 4, z: 0 },
            { x: 20, y: -6, z: 0.6 },
        ];
        for (const p of samples) {
            const mach = beltMachinePoint(p);
            const read = physicalReadingView(mach, true);
            const sole = printedPlantarView(p);
            expect(sole.x).toBeCloseTo(read.x, 6);
            expect(sole.y).toBeCloseTo(read.y, 6);
            const heel = printedPlantarView(p, "heel_first");
            const heelMach = beltMachinePoint(p, 90);
            const heelRead = physicalReadingView(heelMach, false);
            expect(heel.x).toBeCloseTo(heelRead.x, 6);
            expect(heel.y).toBeCloseTo(heelRead.y, 6);
        }
        const onSole = { x: 8, y: 3 };
        const belt = printedPlantarView(onSole);
        const bed = flatBedSoleView(onSole);
        expect(belt.x).toBeCloseTo(bed.x, 6);
        expect(belt.y).toBeCloseTo(-bed.y, 6);
        expect(belt.x).toBeCloseTo(8, 6);
        expect(belt.y).toBeCloseTo(-3, 6);
    });
});
