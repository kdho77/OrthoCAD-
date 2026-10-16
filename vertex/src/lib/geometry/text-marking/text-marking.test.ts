// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    defaultTextMarking,
    hasActiveTextMarking,
    TEXT_CONTOUR_EDGE_MAX_MM,
    TEXT_CONTOUR_EDGE_MIN_MM,
    TEXT_CUTTER_MAX_EDGE_MM,
    TEXT_FONT_ID,
    TEXT_MIN_STROKE_MM,
} from "./constants";
import { flattenText } from "./contours";
import { cutterMaxEdgeMm } from "./cutter";
import { TextMarkingError } from "./errors";
import { loadTextFont } from "./font";
import { textMarkingHash } from "./hash";
import { assertTextMarkingInRange, normalizeTextMarking, textControlBounds } from "./validate";

const SAMPLE = "JOHN SMITH 10/15";

describe("text marking design-state hash", () => {
    test("empty text matches missing marking (frozen hashes stay identical)", () => {
        expect(textMarkingHash(undefined)).toBe("");
        expect(textMarkingHash(null)).toBe("");
        expect(textMarkingHash(defaultTextMarking())).toBe("");
        expect(textMarkingHash({ ...defaultTextMarking(), text: "   " })).toBe("");
        expect(hasActiveTextMarking(defaultTextMarking())).toBe(false);
    });

    test("text/font/size/depth/mode/surface/placement/bold change the hash", () => {
        const base = { ...defaultTextMarking(), text: SAMPLE };
        const h = textMarkingHash(base);
        expect(h).toMatch(/^[0-9a-f]{64}$/);
        expect(textMarkingHash({ ...base, capHeightMm: 7 })).not.toBe(h);
        expect(textMarkingHash({ ...base, depthMm: 1.0 })).not.toBe(h);
        expect(textMarkingHash({ ...base, bold: false })).not.toBe(h);
        expect(textMarkingHash({ ...base, surface: "wall", capHeightMm: 6, placementU: 0.55 })).not.toBe(h);
        expect(TEXT_FONT_ID).toBe("Inter-Bold");
    });
});

describe("text marking controls", () => {
    test("UI/geometry bounds: cap, depth, u per surface", () => {
        const bottom = textControlBounds("bottom");
        expect(bottom.capMin).toBe(6);
        expect(bottom.capDefault).toBe(8);
        expect(bottom.capMax).toBe(14);
        expect(bottom.depthMin).toBe(0.6);
        expect(bottom.depthDefault).toBe(0.8);
        expect(bottom.depthMax).toBe(1.5);
        expect(bottom.uMin).toBe(0.15);
        expect(bottom.uMax).toBe(0.45);
        const wall = textControlBounds("wall", { wallHeightMm: 12 });
        expect(wall.capMin).toBe(5);
        expect(wall.capDefault).toBe(6);
        expect(wall.capMax).toBe(9);
        expect(wall.depthMax).toBe(1.2);
        expect(wall.uMin).toBe(0.2);
        expect(wall.uMax).toBe(0.8);
        expect(textControlBounds("wall", { wallHeightMm: 7 }).wallAvailable).toBe(false);
    });

    test("bottom emboss is rejected", () => {
        expect(() =>
            assertTextMarkingInRange({ ...defaultTextMarking(), text: SAMPLE, mode: "emboss" }),
        ).toThrow(/bottom emboss is disabled/i);
    });

    test("too long is rejected", () => {
        const long = "A".repeat(41);
        expect(() => assertTextMarkingInRange({ ...defaultTextMarking(), text: long })).toThrow(/too long/i);
    });

    test("out-of-range cap height is rejected", () => {
        expect(() =>
            assertTextMarkingInRange({ ...defaultTextMarking(), text: SAMPLE, capHeightMm: 3 }),
        ).toThrow(/out of range/i);
        expect(() =>
            assertTextMarkingInRange({ ...defaultTextMarking(), text: SAMPLE, capHeightMm: 20 }),
        ).toThrow(/out of range/i);
    });

    test("normalize clamps and forces bottom engrave", () => {
        const n = normalizeTextMarking({
            text: SAMPLE,
            surface: "bottom",
            mode: "emboss",
            capHeightMm: 99,
            depthMm: 0.73,
            letterSpacingMm: 0.1,
            rotationDeg: 180,
            placementU: 0.9,
        });
        expect(n.mode).toBe("engrave");
        expect(n.capHeightMm).toBe(14);
        expect(n.depthMm).toBe(0.8);
        expect(n.letterSpacingMm).toBeGreaterThanOrEqual(0.6);
        expect(n.rotationDeg).toBe(90);
        expect(n.placementU).toBe(0.45);
        expect(n.bold).toBe(true);
    });
});

describe("text flatten / Clipper / stroke", () => {
    test("JOHN SMITH 10/15 at 6 mm bold meets 0.9 mm min stroke", async () => {
        const font = await loadTextFont();
        const flat = flattenText(font, SAMPLE, 6, 0.6, true);
        expect(flat.groups.length).toBeGreaterThan(0);
        expect(flat.minStrokeMm).toBeGreaterThanOrEqual(TEXT_MIN_STROKE_MM);
        expect(flat.advanceMm).toBeGreaterThan(20);
        expect(flat.capHeightMm).toBe(6);
        let minE = Infinity;
        let maxE = 0;
        const measure = (loop: Array<{ x: number; y: number }>) => {
            for (let i = 0; i < loop.length; i++) {
                const a = loop[i]!;
                const b = loop[(i + 1) % loop.length]!;
                const e = Math.hypot(a.x - b.x, a.y - b.y);
                if (e < minE) minE = e;
                if (e > maxE) maxE = e;
            }
        };
        for (const g of flat.groups) {
            measure(g.outer);
            for (const h of g.holes) measure(h);
        }
        expect(minE).toBeGreaterThanOrEqual(TEXT_CONTOUR_EDGE_MIN_MM * 0.9);
        expect(maxE).toBeLessThanOrEqual(TEXT_CONTOUR_EDGE_MAX_MM + 1e-3);
        expect(cutterMaxEdgeMm(flat.groups[0]!)).toBeLessThanOrEqual(TEXT_CUTTER_MAX_EDGE_MM + 1e-3);
    });

    test("regular weight at tiny size is too thin", async () => {
        const font = await loadTextFont();
        expect(() => flattenText(font, "I", 1.2, 0.6, false)).toThrow(TextMarkingError);
        try {
            flattenText(font, "I", 1.2, 0.6, false);
        } catch (e) {
            expect((e as Error).message).toMatch(/too thin, enable Bold or increase size/);
        }
    });

    test("text prism subtracts from a box (manifold-3d)", async () => {
        const { BoxGeometry } = await import("three");
        const { booleanTextSolid } = await import("./boolean");
        const { planarBottomMap } = await import("./solid");
        const font = await loadTextFont();
        const flat = flattenText(font, SAMPLE, 6, 0.6, true);
        const host = new BoxGeometry(120, 40, 8);
        host.translate(flat.advanceMm / 2, 3, 4);
        const out = await booleanTextSolid(host, flat.groups, planarBottomMap(-0.05, 0.8), "subtract");
        expect(out.getAttribute("position").count).toBeGreaterThan(8);
        out.dispose();
        host.dispose();
    });
});

describe("exported-STL soup self-intersections", () => {
    test("a box STL has 0 hits; two crossing triangles report a pair", async () => {
        const { BoxGeometry, BufferAttribute, BufferGeometry } = await import("three");
        const { binaryStlToGeometry, geometryToBinarySTL } = await import("@/lib/geometry/stl");
        const { countSoupSelfIntersections } = await import("./soup-intersect");
        const box = new BoxGeometry(10, 10, 10);
        const stl = geometryToBinarySTL(box);
        const soup = binaryStlToGeometry(stl);
        const boxTris = (box.getIndex()?.count ?? box.getAttribute("position").count) / 3;
        expect(soup.getAttribute("position").count / 3).toBe(boxTris);
        expect(countSoupSelfIntersections(soup).real).toBe(0);
        soup.dispose();
        box.dispose();

        const cross = new BufferGeometry();
        cross.setAttribute(
            "position",
            new BufferAttribute(
                new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1, 0, 0, -0.5, -1, 0, 1.5, -1, 0, 0.5, 1]),
                3,
            ),
        );
        const hit = countSoupSelfIntersections(cross);
        expect(hit.real).toBeGreaterThan(0);
        expect(hit.pairs[0]?.centroid).toBeDefined();
        cross.dispose();
    });
});
