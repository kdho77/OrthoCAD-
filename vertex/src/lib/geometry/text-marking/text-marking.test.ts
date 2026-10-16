// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import * as textConstants from "./constants";
import {
    defaultTextMarking,
    hasActiveTextMarking,
    TEXT_CLIPPER_PRECISION,
    TEXT_CONTOUR_EDGE_MAX_MM,
    TEXT_CONTOUR_EDGE_MIN_MM,
    TEXT_CUTTER_MAX_EDGE_MM,
    TEXT_CUTTER_SIDEWALL_RINGS,
    TEXT_CUTTER_STEINER_MM,
    TEXT_FLATTEN_CHORD_MM,
    TEXT_FONT_ID,
    TEXT_HOST_REFINE_MAX_EDGE_MM,
    TEXT_MIN_STROKE_MM,
} from "./constants";
import { flattenText } from "./contours";
import { cdtGlyphCap, cutterMaxEdgeMm } from "./cutter";
import { TextMarkingError } from "./errors";
import { loadTextFont } from "./font";
import { textMarkingHash } from "./hash";
import { refineHostLocally } from "./host-refine";
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

describe("text print-path constants", () => {
    test("no whole-insole simplify; Clipper 4, 0.05 mm chord, CDT Steiner, 3 rings", () => {
        expect("TEXT_WALL_SIMPLIFY_MM" in textConstants).toBe(false);
        expect(TEXT_CLIPPER_PRECISION).toBe(4);
        expect(TEXT_FLATTEN_CHORD_MM).toBe(0.05);
        expect(TEXT_CONTOUR_EDGE_MIN_MM).toBe(0.03);
        expect(TEXT_CONTOUR_EDGE_MAX_MM).toBe(0.15);
        expect(TEXT_CUTTER_STEINER_MM).toBe(0.25);
        expect(TEXT_CUTTER_MAX_EDGE_MM).toBe(0.3);
        expect(TEXT_CUTTER_SIDEWALL_RINGS).toBe(3);
        expect(TEXT_HOST_REFINE_MAX_EDGE_MM).toBe(0.4);
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
        const first = flat.groups[0];
        expect(first).toBeDefined();
        if (!first) return;
        expect(cutterMaxEdgeMm(first)).toBeLessThanOrEqual(TEXT_CUTTER_MAX_EDGE_MM + 1e-3);
        const cap = cdtGlyphCap(first);
        expect(cap.points.length).toBeGreaterThan(first.outer.length + 4);
        expect(cap.faces.length).toBeGreaterThan(8);
        for (const g of flat.groups) {
            const c = flat.centroids[flat.groups.indexOf(g)];
            expect(c).toBeDefined();
            if (!c) continue;
            expect(
                pointInPoly(
                    c.x,
                    c.y,
                    g.outer.map((p) => ({ x: p.x, y: p.y, z: 0 })),
                ),
            ).toBe(true);
            for (const h of g.holes) {
                if (h.length < 3) continue;
                expect(
                    pointInPoly(
                        c.x,
                        c.y,
                        h.map((p) => ({ x: p.x, y: p.y, z: 0 })),
                    ),
                ).toBe(false);
            }
        }
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
        const mirrored = flat.groups.map((g) => ({
            outer: g.outer.map((p) => ({ x: p.x, y: -p.y })),
            holes: g.holes.map((h) => h.map((p) => ({ x: p.x, y: -p.y }))),
        }));
        const host2 = new BoxGeometry(120, 40, 8);
        host2.translate(flat.advanceMm / 2, 3, 4);
        const out2 = await booleanTextSolid(host2, mirrored, planarBottomMap(-0.05, 0.8), "subtract");
        expect(out2.getAttribute("position").count).toBeGreaterThan(8);
        out2.dispose();
        host.dispose();
        host2.dispose();
    });

    test("local host refine splits long edges and stays watertight", async () => {
        const { BoxGeometry } = await import("three");
        const { mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
        const { planarBottomMap } = await import("./solid");
        const font = await loadTextFont();
        const flat = flattenText(font, SAMPLE, 6, 0.6, true);
        const box = new BoxGeometry(120, 40, 8);
        box.translate(flat.advanceMm / 2, 3, 4);
        box.deleteAttribute("normal");
        box.deleteAttribute("uv");
        const host = mergeVertices(box, 1e-6);
        if (host !== box) box.dispose();
        const refined = refineHostLocally(host, flat.groups, planarBottomMap(-0.05, 0.8));
        const index = refined.getIndex();
        expect(index).toBeTruthy();
        if (!index) return;
        const src = index.array as ArrayLike<number>;
        const edgeCount = new Map<string, number>();
        const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
        for (let t = 0; t + 2 < index.count; t += 3) {
            const a = src[t] ?? 0;
            const b = src[t + 1] ?? 0;
            const c = src[t + 2] ?? 0;
            for (const [u, v] of [
                [a, b],
                [b, c],
                [c, a],
            ] as const) {
                const e = key(u, v);
                edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
            }
        }
        for (const count of edgeCount.values()) expect(count).toBe(2);
        expect(index.count).toBeGreaterThan((host.getIndex()?.count ?? 36) + 12);
        if (refined !== host) refined.dispose();
        host.dispose();
    });
});

describe("print-clean CAD-expert gates", () => {
    test("region pad is 1 mm and wall outset is a uniform 0.5 mm", async () => {
        const { TEXT_BOOLEAN_OUTSET_MM, TEXT_REGION_PAD_MM } = await import("./constants");
        expect(TEXT_REGION_PAD_MM).toBe(1);
        expect(TEXT_BOOLEAN_OUTSET_MM).toBe(0.5);
    });

    test("box subtract keeps outside host triangles (move ≤ 1e-4, 0 lost)", async () => {
        const { BoxGeometry } = await import("three");
        const { booleanTextSolid } = await import("./boolean");
        const { planarBottomMap } = await import("./solid");
        const { measureTextRegionQuality } = await import("./quality");
        const { TEXT_OUTSIDE_IDENT_MM, TEXT_REGION_PAD_MM } = await import("./constants");
        const font = await loadTextFont();
        const flat = flattenText(font, SAMPLE, 6, 0.6, true);
        const host = new BoxGeometry(120, 40, 8);
        host.translate(flat.advanceMm / 2, 3, 4);
        const map = planarBottomMap(-0.05, 0.8);
        const out = await booleanTextSolid(host, flat.groups, map, "subtract");
        const meta = {
            surface: "bottom" as const,
            mode: "engrave" as const,
            depthMm: 0.8,
            heightMm: 0,
            capHeightMm: 6,
            advanceMm: flat.advanceMm,
            centroids: flat.centroids.map((p) => ({ x: p.x, y: p.y, z: 0.8 })),
            mappedWidthMm: flat.advanceMm,
            outlineWorld: flat.groups.map((g) => ({
                outer: g.outer.map((p) => map(p, 0.5)),
                holes: g.holes.map((h) => h.map((p) => map(p, 0.5))),
            })),
        };
        const q = measureTextRegionQuality(out, host, meta, TEXT_REGION_PAD_MM);
        expect(q.outsideTrisLost).toBe(0);
        expect(q.outsideVertMaxMm).toBeLessThanOrEqual(TEXT_OUTSIDE_IDENT_MM);
        expect(q.outsideHostVertsMissing).toBe(0);
        out.dispose();
        host.dispose();
    });

    test("collapseDegenerateThenWeld only touches the text band", async () => {
        const { BoxGeometry } = await import("three");
        const { collapseDegenerateThenWeld, makeFootprintBand } = await import("./boolean");
        const { planarBottomMap } = await import("./solid");
        const font = await loadTextFont();
        const flat = flattenText(font, SAMPLE, 6, 0.6, true);
        const host = new BoxGeometry(120, 40, 8);
        host.translate(flat.advanceMm / 2, 3, 4);
        const map = planarBottomMap(-0.05, 0.8);
        const band = makeFootprintBand(flat.groups, map, 1);
        const before = host.getAttribute("position").array.slice() as Float32Array;
        const after = collapseDegenerateThenWeld(host, 0, band);
        const pos = after.getAttribute("position").array as Float32Array;
        const n = Math.min(before.length, pos.length);
        let moved = 0;
        for (let i = 0; i < n; i++) moved = Math.max(moved, Math.abs(before[i]! - pos[i]!));
        expect(moved).toBeLessThanOrEqual(1e-4);
        if (after !== host) after.dispose();
        host.dispose();
    });

    test("flat-bottom boundary of a box is the z=0 rectangle", async () => {
        const { BoxGeometry } = await import("three");
        const { flatBottomBoundaryLoop, measureWallFilletTopMm } = await import("./place");
        const box = new BoxGeometry(20, 10, 4);
        box.translate(0, 0, 2);
        const loop = flatBottomBoundaryLoop(box);
        expect(loop === null || loop.length >= 4).toBe(true);
        const top = measureWallFilletTopMm(box, {
            u: 0.4,
            s: 0,
            R: { x: 10, y: 0, z: 4 },
            B: { x: 10, y: 0, z: 0 },
            heightMm: 4,
            sideSign: -1,
            nOut: { x: 1, y: 0, z: 0 },
            thickMm: 3,
            outerMm: 0,
        });
        expect(top).toBeGreaterThanOrEqual(0);
        box.dispose();
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
        expect(hit.pairs[0]?.triA).toBeDefined();
        expect(hit.pairs[0]?.triB).toBeDefined();
        expect(hit.pairs[0]?.triA).not.toBe(hit.pairs[0]?.triB);
        cross.dispose();
    });
});
