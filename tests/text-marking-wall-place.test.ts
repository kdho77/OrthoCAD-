// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { loadTextFont } from "@/lib/geometry/text-marking/font";
import { extractHostTextContext, placeBottomText, placeWallText } from "@/lib/geometry/text-marking/place";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { TextMarking, TextMode, TextSurface } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

const JOHN = "JOHN SMITH 10/15";
const FISHER = "FISHER INSOLE";

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

    test("JOHN SMITH right-wall glyphs clear the lateral fold", async () => {
        const font = await loadTextFont();
        const raw = await loadSampleTopGlb();
        const fold = { x: 66.63, y: 35.87, z: 14.45 };
        try {
            const preview = await reconstructProceduralPreview(raw, { wallStyle: "straight" });
            const ctx = extractHostTextContext(preview.geometry);
            for (const text of [JOHN, "JOHN SMITH"]) {
                const flat = flattenText(font, text, 6, 0.6, true);
                const placed = placeWallText(preview.geometry, ctx, marking("wall", text), flat);
                let minD = Infinity;
                for (const g of placed.flat.groups) {
                    for (const p of g.outer) {
                        const w = placed.map(p, 0.45);
                        minD = Math.min(minD, Math.hypot(w.x - fold.x, w.y - fold.y, w.z - fold.z));
                    }
                }
                expect(minD).toBeGreaterThanOrEqual(1.5);
            }
            preview.geometry.dispose();
        } finally {
            raw.dispose();
        }
    }, 120_000);
});
