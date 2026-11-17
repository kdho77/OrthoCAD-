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
import { normalizeBottomTextMarking } from "../../../../shared/bottom-text-marking";
import { beltPrintFrameDet, printedPlantarView } from "./belt-print-frame";
import { defaultTextMarking } from "./constants";
import { flattenText } from "./contours";
import { loadTextFont } from "./font";
import { extractHostTextContext, placeBottomText } from "./place";
import type { TextGlyphGroup, TextXy } from "./types";

const NAME = "JABBOUR";

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

/**
 * Printed plantar face, toe to the right. Capital J's hook is the lower-left.
 * A name that only reads through the top puts that hook on the right.
 */
function jHookExtendsLeft(outer: TextXy[]): boolean {
    const viewed = outer.map((p) => printedPlantarView(p));
    const ys = viewed.map((p) => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = maxY - minY;
    const hook = viewed.filter((p) => p.y <= minY + span * 0.28);
    const cap = viewed.filter((p) => p.y >= maxY - span * 0.28);
    if (hook.length < 3 || cap.length < 3) return false;
    const hookMin = Math.min(...hook.map((p) => p.x));
    const hookMax = Math.max(...hook.map((p) => p.x));
    const capMin = Math.min(...cap.map((p) => p.x));
    const capMax = Math.max(...cap.map((p) => p.x));
    return hookMin < capMin - 1.5 && hookMax <= capMax + 0.75;
}

function leftmostGroup(placed: {
    flat: { groups: TextGlyphGroup[] };
    meta: { centroids: Array<{ x: number; y: number }> };
}): TextGlyphGroup | undefined {
    let jay: TextGlyphGroup | undefined;
    let jayX = Infinity;
    placed.flat.groups.forEach((group, index) => {
        const centroid = placed.meta.centroids[index];
        if (!centroid) return;
        const x = printedPlantarView(centroid).x;
        if (x < jayX) {
            jayX = x;
            jay = group;
        }
    });
    return jay;
}

/** Production pairing. Internal left is the unmirrored SAMPLE_Top. */
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

describe("printed bottom name in the belt frame", () => {
    test("VertexSlice toe-first plus belt forward has det -1", () => {
        expect(beltPrintFrameDet()).toBeCloseTo(-1, 6);
    });

    test("both feet read JABBOUR left to right on the printed plantar face", async () => {
        const font = await loadTextFont();
        const legacy = normalizeBottomTextMarking({
            ...defaultTextMarking("bottom"),
            text: NAME,
            capHeightMm: 6,
            bold: false,
        });
        expect(legacy.capHeightMm).toBe(12);
        expect(legacy.bold).toBe(true);
        const flat = flattenText(font, legacy.text, legacy.capHeightMm, legacy.letterSpacingMm, legacy.bold);

        for (const side of ["left", "right"] as const) {
            const geo = await loftInternal(side);
            const ctx = extractHostTextContext(geo);
            const design = placeBottomText(geo, ctx, legacy, flat, side);
            const printed = placeBottomText(geo, ctx, legacy, flat, side, { beltPrint: true });
            const designJay = leftmostGroup(design);
            expect(designJay, `${side} design J`).toBeDefined();
            if (!designJay) return;
            expect(
                jHookExtendsLeft(designJay.outer),
                `${side} design-space name is mirrored on the belt`,
            ).toBe(false);

            const jay = leftmostGroup(printed);
            expect(jay, `${side} has a J`).toBeDefined();
            if (!jay) return;
            expect(jHookExtendsLeft(jay.outer), `${side} printed J reads from below`).toBe(true);

            const ordered = [...printed.meta.centroids].sort(
                (a, b) => printedPlantarView(a).x - printedPlantarView(b).x,
            );
            const left = ordered[0];
            const right = ordered[ordered.length - 1];
            expect(left, `${side} has a glyph`).toBeDefined();
            expect(right, `${side} has a glyph`).toBeDefined();
            if (!left || !right) return;
            expect(
                printedPlantarView(right).x - printedPlantarView(left).x,
                `${side} reads left to right`,
            ).toBeGreaterThan(20);

            const cap = legacy.capHeightMm * (printed.meta.mappedWidthMm / flat.advanceMm);
            expect(cap, `${side} cap`).toBeGreaterThan(11.5);
            expect(cap, `${side} cap`).toBeLessThanOrEqual(12);
            const ys = jay.outer.map((p) => p.y);
            const glyphH = Math.max(...ys) - Math.min(...ys);
            expect(glyphH, `${side} glyph height`).toBeGreaterThan(11);
            expect(glyphH, `${side} glyph height`).toBeLessThan(14);
            geo.dispose();
        }
    }, 240_000);
});
