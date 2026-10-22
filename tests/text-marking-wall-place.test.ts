// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { TextMarkingError } from "@/lib/geometry/text-marking/errors";
import { loadTextFont } from "@/lib/geometry/text-marking/font";
import { extractHostTextContext, placeBottomText, placeWallText } from "@/lib/geometry/text-marking/place";
import type { FlattenedText } from "@/lib/geometry/text-marking/types";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { TextMarking, TextMode, TextSurface } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

const JOHN = "JOHN SMITH 10/15";
const FISHER = "FISHER INSOLE";
const SHORT = "BO";
const LONG = "JONATHAN";

function marking(surface: TextSurface, text: string, extras: Partial<TextMarking> = {}): TextMarking {
    return { ...defaultTextMarking(surface), text, capHeightMm: 6, mode: "engrave", ...extras };
}

describe("SAMPLE_Top wall text placement", () => {
    test("engrave and emboss place on the outer and inner wall at 6 mm", async () => {
        const font = await loadTextFont();
        const raw = await loadSampleTopGlb();
        try {
            const preview = await reconstructProceduralPreview(raw, { wallStyle: "straight" });
            const ctx = extractHostTextContext(preview.geometry);
            for (const text of [JOHN, FISHER]) {
                const flat = flattenText(font, text, 6, 0.6, true);
                for (const surface of ["wall", "medial"] as const) {
                    for (const mode of ["engrave", "emboss"] as TextMode[]) {
                        for (const placementU of [0.2, 0.42, 0.8]) {
                            const placed = placeWallText(
                                preview.geometry,
                                ctx,
                                marking(surface, text, { mode, placementU, depthMm: 0.4, heightMm: 0.4 }),
                                flat,
                            );
                            expect(placed.meta.wallUMin).toBeGreaterThanOrEqual(0.2 - 1e-3);
                            expect(placed.meta.wallUMax).toBeLessThanOrEqual(0.8 + 1e-3);
                            expect(placed.meta.centroids.length).toBeGreaterThan(2);
                        }
                    }
                }
            }
            preview.geometry.dispose();
        } finally {
            raw.dispose();
        }
    }, 120_000);

    test("letters are not mirrored between the left and right foot", async () => {
        const font = await loadTextFont();
        const flat = flattenText(font, JOHN, 6, 0.6, true);
        const raw = await loadSampleTopGlb();
        try {
            const rightGeo = await reconstructProceduralPreview(raw, { wallStyle: "straight" });
            const mirrored = mirrorGeometry(raw);
            const leftGeo = await reconstructProceduralPreview(mirrored, { wallStyle: "straight" });
            mirrored.dispose();
            const signOf = (geo: typeof rightGeo.geometry) => {
                const ctx = extractHostTextContext(geo);
                const wall = placeWallText(geo, ctx, marking("wall", JOHN, { placementU: 0.42 }), flat);
                const c = wall.meta.centroids as Array<{ u?: number; x: number }>;
                const u0 = c[0]?.u ?? 0;
                const u1 = c[c.length - 1]?.u ?? 0;
                const bottom = placeBottomText(geo, ctx, marking("bottom", JOHN), flat, "right");
                const b = bottom.meta.centroids;
                return {
                    wall: Math.sign((u1 ?? 0) - (u0 ?? 0)),
                    bottom: Math.sign((b[b.length - 1]?.x ?? 0) - (b[0]?.x ?? 0)),
                };
            };
            const right = signOf(rightGeo.geometry);
            const left = signOf(leftGeo.geometry);
            expect(right.wall).not.toBe(0);
            expect(left.wall).toBe(right.wall);
            expect(right.bottom).not.toBe(0);
            expect(left.bottom).toBe(right.bottom);
            rightGeo.geometry.dispose();
            leftGeo.geometry.dispose();
        } finally {
            raw.dispose();
        }
    }, 120_000);

    test("JOHN SMITH fits the right wall", async () => {
        const font = await loadTextFont();
        const raw = await loadSampleTopGlb();
        try {
            const preview = await reconstructProceduralPreview(raw, { wallStyle: "straight" });
            const ctx = extractHostTextContext(preview.geometry);
            const flat = flattenText(font, "JOHN SMITH", 6, 0.6, true);
            const placed = placeWallText(preview.geometry, ctx, marking("wall", "JOHN SMITH"), flat);
            expect(placed.meta.centroids.length).toBeGreaterThan(4);
            expect(placed.meta.wallUMin).toBeGreaterThanOrEqual(0.2 - 1e-3);
            expect(placed.meta.wallUMax).toBeLessThanOrEqual(0.8 + 1e-3);
            expect(placed.vRoomDownMm).toBeGreaterThanOrEqual(0);
            preview.geometry.dispose();
        } finally {
            raw.dispose();
        }
    }, 120_000);

    test("long and short names fit both walls at M1, M8.5 and M16", async () => {
        const font = await loadTextFont();
        const flats = new Map<string, ReturnType<typeof flattenText>>();
        for (const text of [SHORT, LONG]) flats.set(text, flattenText(font, text, 6, 0.6, true));
        for (const size of [1, 8.5, 16]) {
            const raw = await loadSampleTopGlb();
            const scale = insoleLayoutForUsMenSize(size).scale;
            const sized = raw.clone();
            sized.computeBoundingBox();
            const box = sized.boundingBox;
            const pos = sized.getAttribute("position");
            if (box && pos) {
                const cx = (box.min.x + box.max.x) / 2;
                const cy = (box.min.y + box.max.y) / 2;
                for (let i = 0; i < pos.count; i++) {
                    pos.setX(i, cx + (pos.getX(i) - cx) * scale);
                    pos.setY(i, cy + (pos.getY(i) - cy) * scale);
                }
                pos.needsUpdate = true;
                sized.computeBoundingBox();
            }
            raw.dispose();
            try {
                const preview = await reconstructProceduralPreview(sized, { wallStyle: "straight" });
                const ctx = extractHostTextContext(preview.geometry);
                for (const text of [SHORT, LONG]) {
                    const flat = flats.get(text);
                    if (!flat) throw new Error(`missing flat for ${text}`);
                    for (const surface of ["wall", "medial"] as const) {
                        let placed: ReturnType<typeof placeWallText>;
                        try {
                            placed = placeWallText(preview.geometry, ctx, marking(surface, text), flat);
                        } catch (e) {
                            const msg = e instanceof Error ? e.message : String(e);
                            throw new Error(`M${size} ${surface} "${text}" ${msg}`);
                        }
                        expect(placed.meta.centroids.length).toBeGreaterThan(0);
                        expect(placed.meta.wallUMin).toBeGreaterThanOrEqual(0.2 - 1e-3);
                        expect(placed.meta.wallUMax).toBeLessThanOrEqual(0.8 + 1e-3);
                    }
                }
                preview.geometry.dispose();
            } finally {
                sized.dispose();
            }
        }
    }, 180_000);

    test("a block that cannot fit the band errors cleanly", async () => {
        const raw = await loadSampleTopGlb();
        try {
            const preview = await reconstructProceduralPreview(raw, { wallStyle: "straight" });
            const ctx = extractHostTextContext(preview.geometry);
            const flat: FlattenedText = {
                groups: [
                    {
                        outer: [
                            { x: 0, y: 0 },
                            { x: 500, y: 0 },
                            { x: 500, y: 6 },
                            { x: 0, y: 6 },
                        ],
                        holes: [],
                    },
                ],
                advanceMm: 500,
                capHeightMm: 6,
                bold: true,
                minStrokeMm: 1,
                centroids: [{ x: 250, y: 3 }],
            };
            expect(() => placeWallText(preview.geometry, ctx, marking("wall", "TOO LONG"), flat)).toThrow(
                TextMarkingError,
            );
            try {
                placeWallText(preview.geometry, ctx, marking("wall", "TOO LONG"), flat);
                expect(true).toBe(false);
            } catch (e) {
                expect(e).toBeInstanceOf(TextMarkingError);
                expect((e as TextMarkingError).code).toBe("too-long");
                expect((e as Error).message).toMatch(/does not fit the placement zone/);
            }
            preview.geometry.dispose();
        } finally {
            raw.dispose();
        }
    }, 120_000);
});
