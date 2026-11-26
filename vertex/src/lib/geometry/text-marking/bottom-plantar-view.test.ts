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
import { defaultTextMarking } from "./constants";
import { flattenText } from "./contours";
import { loadTextFont } from "./font";
import { extractHostTextContext, placeBottomText } from "./place";
import type { TextXy } from "./types";

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
 * Viewer under the sole, looking up (+Z). Toe (+X) is screen-right.
 * Screen-up is +Y. This is the plantar face, not a view through the top.
 */
function plantarView(p: TextXy): TextXy {
    return { x: p.x, y: p.y };
}

/**
 * Capital J in the plantar view: the hook is the lower-left of the glyph.
 * A mirrored J puts that hook on the right of the stem.
 */
function jHookExtendsLeft(outer: TextXy[]): boolean {
    const viewed = outer.map(plantarView);
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

/**
 * Production pairing. SAMPLE_Top primary side is internal left, so the
 * unmirrored mesh is internal left and internal right is the Y mirror.
 */
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

describe("bottom name in the plantar view on SAMPLE_Top", () => {
    test("internal left and right read JABBOUR upright at 12 mm bold", async () => {
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
        expect(flat.bold).toBe(true);
        expect(flat.capHeightMm).toBe(12);

        const readSign: Partial<Record<Side, number>> = {};
        for (const side of ["left", "right"] as const) {
            const geo = await loftInternal(side);
            const ctx = extractHostTextContext(geo);
            const placed = placeBottomText(geo, ctx, legacy, flat, side);
            const cap = legacy.capHeightMm * (placed.meta.mappedWidthMm / flat.advanceMm);
            expect(cap, `${side} cap`).toBeGreaterThan(11.5);
            expect(cap, `${side} cap`).toBeLessThanOrEqual(12);

            const ordered = [...placed.meta.centroids].sort((a, b) => plantarView(a).x - plantarView(b).x);
            const readerLeft = ordered[0];
            const readerRight = ordered[ordered.length - 1];
            expect(readerLeft, `${side} has a glyph`).toBeDefined();
            expect(readerRight, `${side} has a glyph`).toBeDefined();
            if (!readerLeft || !readerRight) return;
            const advance = plantarView(readerRight).x - plantarView(readerLeft).x;
            expect(advance, `${side} reads left to right`).toBeGreaterThan(20);
            readSign[side] = Math.sign(advance);

            let jay = placed.flat.groups[0];
            let jayX = Infinity;
            placed.flat.groups.forEach((group, index) => {
                const centroid = placed.meta.centroids[index];
                if (!centroid) return;
                const x = plantarView(centroid).x;
                if (x < jayX) {
                    jayX = x;
                    jay = group;
                }
            });
            expect(jay, `${side} has a J`).toBeDefined();
            if (!jay) return;
            expect(jHookExtendsLeft(jay.outer), `${side} J is not mirrored`).toBe(true);

            const ys = jay.outer.map((p) => p.y);
            const glyphH = Math.max(...ys) - Math.min(...ys);
            expect(glyphH, `${side} glyph height`).toBeGreaterThan(11);
            expect(glyphH, `${side} glyph height`).toBeLessThan(14);
            geo.dispose();
        }
        expect(readSign.left).toBe(1);
        expect(readSign.right).toBe(1);
    }, 240_000);
});
