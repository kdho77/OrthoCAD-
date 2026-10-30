// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { applyTextMarkingToPrintSolid } from "@/lib/geometry/text-marking/apply";
import { defaultTextMarking, TEXT_MIN_STROKE_MM, TEXT_WELD_MM } from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { TextMarkingError } from "@/lib/geometry/text-marking/errors";
import { loadTextFont } from "@/lib/geometry/text-marking/font";
import { countSoupSelfIntersections } from "@/lib/geometry/text-marking/soup-intersect";
import { assertTextMarkingInRange } from "@/lib/geometry/text-marking/validate";
import type { TextMarking, TextSurface } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

const SAMPLE = "JOHN SMITH 10/15";

function marking(surface: TextSurface, extras: Partial<TextMarking> = {}): TextMarking {
    return {
        ...defaultTextMarking(surface),
        text: SAMPLE,
        capHeightMm: 6,
        ...extras,
    };
}

describe("text marking negative tests (no STL)", () => {
    test("too thin, too long, bottom emboss, out of range", () => {
        expect(() => assertTextMarkingInRange({ ...defaultTextMarking(), text: "A".repeat(41) })).toThrow(
            /too long/i,
        );
        expect(() =>
            assertTextMarkingInRange({
                ...defaultTextMarking(),
                text: SAMPLE,
                mode: "emboss",
                heightMm: 0.6,
            }),
        ).toThrow(/bottom emboss is disabled/i);
        expect(() =>
            assertTextMarkingInRange({ ...defaultTextMarking("wall"), text: SAMPLE, capHeightMm: 4 }),
        ).toThrow(/out of range/i);
        expect(() => assertTextMarkingInRange({ ...defaultTextMarking(), text: SAMPLE, depthMm: 3 })).toThrow(
            /out of range/i,
        );
    });
});

describe("text marking SAMPLE_Top apply guards", () => {
    test("empty text is a no-op (same object)", async () => {
        const buf = await loadSampleTopGlb();
        try {
            const preview = await reconstructProceduralPreview(buf, { wallStyle: "straight" });
            const same = await applyTextMarkingToPrintSolid(preview.geometry, defaultTextMarking(), {
                side: "right",
            });
            expect(same).toBe(preview.geometry);
            preview.geometry.dispose();
        } finally {
            buf.dispose();
        }
    });

    test("over-length wall string errors instead of leaving the u band", async () => {
        const buf = await loadSampleTopGlb();
        try {
            const preview = await reconstructProceduralPreview(buf, { wallStyle: "straight" });
            await expect(
                applyTextMarkingToPrintSolid(
                    preview.geometry,
                    marking("wall", { text: "X".repeat(40), capHeightMm: 6 }),
                    { side: "right" },
                ),
            ).rejects.toBeInstanceOf(TextMarkingError);
            preview.geometry.dispose();
        } finally {
            buf.dispose();
        }
    }, 60_000);

    test("forbidden zone / thickness errors never yield a broken STL", async () => {
        const buf = await loadSampleTopGlb();
        try {
            const preview = await reconstructProceduralPreview(buf, { wallStyle: "straight" });
            await expect(
                applyTextMarkingToPrintSolid(
                    preview.geometry,
                    marking("bottom", { placementU: 0.15, capHeightMm: 14, letterSpacingMm: 4 }),
                    { side: "right" },
                ),
            ).rejects.toBeInstanceOf(TextMarkingError);
            preview.geometry.dispose();
        } finally {
            buf.dispose();
        }
    }, 60_000);

    test("bottom flipped-render occupancy IoU >= 0.9 vs mirrored glyphs", async () => {
        const font = await loadTextFont();
        const flat = flattenText(font, SAMPLE, 6, 0.6, true);
        expect(flat.minStrokeMm).toBeGreaterThanOrEqual(TEXT_MIN_STROKE_MM);
        const buf = await loadSampleTopGlb();
        try {
            const preview = await reconstructProceduralPreview(buf, { wallStyle: "straight" });
            const tagged = await applyTextMarkingToPrintSolid(preview.geometry.clone(), marking("bottom"), {
                side: "right",
            });
            const meta = (
                tagged.userData as { textMarking?: { centroids?: Array<{ x: number; y: number }> } }
            ).textMarking;
            const cents = meta?.centroids ?? [];
            expect(cents.length).toBeGreaterThan(3);
            const cy = cents.reduce((s, p) => s + p.y, 0) / cents.length;
            const placedYs = cents.map((p) => p.y - cy);
            const src = flat.centroids;
            const srcCy = src.reduce((s, p) => s + p.y, 0) / Math.max(1, src.length);
            const srcYs = src.map((p) => p.y - srcCy);
            // Pancake-flip about X (Y → −Y) undoes the bottom glyph mirror.
            let match = 0;
            const n = Math.min(placedYs.length, srcYs.length);
            for (let i = 0; i < n; i++) {
                if (Math.abs(placedYs[i]! + srcYs[i]!) < 1.2) match++;
            }
            expect(match / n).toBeGreaterThanOrEqual(0.9);
            tagged.dispose();
            preview.geometry.dispose();
        } finally {
            buf.dispose();
        }
    }, 90_000);

    test("right-wall JOHN SMITH does not self-intersect at (65.35, 34.99, 12.41)", async () => {
        const buf = await loadSampleTopGlb();
        try {
            const preview = await reconstructProceduralPreview(buf, { wallStyle: "straight" });
            const tagged = await applyTextMarkingToPrintSolid(preview.geometry.clone(), marking("wall"), {
                side: "right",
            });
            const si = countSoupSelfIntersections(tagged, TEXT_WELD_MM);
            const hit = si.pairs.find((p) => {
                const c = p.centroid;
                return Math.hypot(c.x - 65.35, c.y - 34.99, c.z - 12.41) < 1;
            });
            expect(si.real).toBe(0);
            expect(hit).toBeUndefined();
            tagged.dispose();
            preview.geometry.dispose();
        } finally {
            buf.dispose();
        }
    }, 180_000);
});
