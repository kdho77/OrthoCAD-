// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import type { PolyPoint } from "@/lib/geometry/procedural-wall/curves";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize, scaleGeometryToInsoleSize } from "@/lib/geometry/shoe-size";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side, SideCorrections } from "@/types";
import { defaultTextMarking } from "./constants";
import { flattenText } from "./contours";
import { loadTextFont } from "./font";
import {
    extractHostTextContext,
    flatBottomBoundaryLoop,
    type HostTextContext,
    placeBottomText,
} from "./place";
import type { FlattenedText } from "./types";

function mesh(positions: number[], indices: number[]): BufferGeometry {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
    return geo;
}

function absArea(loop: Array<{ x: number; y: number }>): number {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
        const p = loop[i]!;
        const q = loop[(i + 1) % loop.length]!;
        a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
}

/** CCW rectangle with exterior 6-cycles pinched onto the bottom edge. Slivers are indexed first. */
function pinchedRect(nSliver: number): BufferGeometry {
    const pos: number[] = [];
    const boundary: number[] = [];
    const bottomX = [0];
    for (let s = 0; s < nSliver; s++) bottomX.push(10 + s * (80 / Math.max(nSliver, 1)));
    bottomX.push(100);
    for (const x of bottomX) {
        boundary.push(pos.length / 3);
        pos.push(x, 0, 0);
    }
    boundary.push(pos.length / 3);
    pos.push(100, 40, 0);
    boundary.push(pos.length / 3);
    pos.push(0, 40, 0);
    const fan = pos.length / 3;
    pos.push(50, 20, 0);
    const indices: number[] = [];
    for (let s = 0; s < nSliver; s++) {
        const px = bottomX[s + 1]!;
        const base = pos.length / 3;
        pos.push(px + 1, -0.01, 0, px + 3, -0.01, 0, px + 4, 0, 0, px + 3, 0.01, 0, px + 1, 0.01, 0);
        const pinch = boundary[s + 1]!;
        const a = base;
        const b = base + 1;
        const c = base + 2;
        const d = base + 3;
        const e = base + 4;
        indices.push(pinch, a, e, a, b, d, b, c, d, a, d, e);
    }
    for (let i = 0; i < boundary.length; i++) {
        indices.push(boundary[i]!, boundary[(i + 1) % boundary.length]!, fan);
    }
    return mesh(pos, indices);
}

function tinyFlat(): FlattenedText {
    return {
        groups: [
            {
                outer: [
                    { x: 0, y: 0 },
                    { x: 2, y: 0 },
                    { x: 2, y: 2 },
                    { x: 0, y: 2 },
                ],
                holes: [],
            },
        ],
        advanceMm: 2,
        capHeightMm: 2,
        bold: true,
        minStrokeMm: 1,
        centroids: [{ x: 1, y: 1 }],
    };
}

function wideCtx(): HostTextContext {
    const outline: PolyPoint[] = [
        { x: 0, y: -40, z: 0 },
        { x: 200, y: -40, z: 0 },
        { x: 200, y: 40, z: 0 },
        { x: 0, y: 40, z: 0 },
    ];
    return { outline, stations: [], minX: 0, maxX: 200, midY: 0 };
}

describe("flat bottom boundary pinches", () => {
    test("a rectangle without pinches stays the outer loop", () => {
        const geo = pinchedRect(0);
        const loop = flatBottomBoundaryLoop(geo);
        expect(loop).not.toBeNull();
        expect(loop!.length).toBe(4);
        expect(absArea(loop!)).toBeCloseTo(4000, 4);
        expect(pointInPoly(50, 20, loop!)).toBe(true);
        expect(pointInPoly(50, -5, loop!)).toBe(false);
        geo.dispose();
    });

    test("pinch points keep the outer boundary, not the zero-area sliver", () => {
        for (const n of [4, 8]) {
            const geo = pinchedRect(n);
            const loop = flatBottomBoundaryLoop(geo);
            expect(loop).not.toBeNull();
            expect(loop!.length).toBeGreaterThan(6);
            expect(absArea(loop!)).toBeCloseTo(4000, 3);
            expect(pointInPoly(50, 20, loop!)).toBe(true);
            expect(pointInPoly(50, -5, loop!)).toBe(false);
            geo.dispose();
        }
    });

    test("an untraced flat bottom reports that the boundary could not be traced", () => {
        const geo = mesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
        expect(flatBottomBoundaryLoop(geo)).toBeNull();
        expect(() =>
            placeBottomText(
                geo,
                wideCtx(),
                { ...defaultTextMarking("bottom"), text: "A", capHeightMm: 12, bold: true },
                tinyFlat(),
                "right",
            ),
        ).toThrow(/flat bottom boundary could not be traced/);
        geo.dispose();
    });

    test("a traced loop under half the outline area falls back to the outline", () => {
        const geo = mesh([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]);
        const warn = console.warn;
        const messages: string[] = [];
        console.warn = (msg?: unknown) => {
            messages.push(String(msg));
        };
        try {
            const placed = placeBottomText(
                geo,
                wideCtx(),
                { ...defaultTextMarking("bottom"), text: "A", capHeightMm: 2, bold: true, mode: "emboss" },
                tinyFlat(),
                "right",
            );
            expect(placed.meta.mappedWidthMm).toBeCloseTo(2, 4);
            expect(messages.some((m) => m.includes("under half the foot outline"))).toBe(true);
        } finally {
            console.warn = warn;
            geo.dispose();
        }
    });
});

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
 * Centroids of "W. Rodriguez" at 12 mm on feet that already placed before the
 * pinch fix. Sizes 11.5 right and 12 left traced a sliver and could not place;
 * their centroids are the full-cap result after the fix.
 */
const PLACEMENT_MM: Record<string, Array<{ x: number; y: number }>> = {
    "7:left": [
        { x: 95.549, y: -12.08 },
        { x: 30.855, y: -0.715 },
        { x: 58.286, y: -6.097 },
        { x: 80.793, y: -6.148 },
        { x: 89.126, y: -6.081 },
        { x: 69.355, y: -5.134 },
        { x: 103.58, y: -3.018 },
        { x: 125.484, y: -4.679 },
        { x: 95.547, y: -5.161 },
        { x: 113.588, y: -0.656 },
        { x: 135.417, y: -5.112 },
        { x: 44.986, y: -1.89 },
    ],
    "7:right": [
        { x: 95.587, y: 1.084 },
        { x: 30.893, y: 12.449 },
        { x: 58.325, y: 7.067 },
        { x: 80.831, y: 7.016 },
        { x: 89.165, y: 7.083 },
        { x: 69.393, y: 8.03 },
        { x: 103.618, y: 10.146 },
        { x: 125.522, y: 8.485 },
        { x: 95.585, y: 8.003 },
        { x: 113.626, y: 12.508 },
        { x: 135.455, y: 8.052 },
        { x: 45.024, y: 11.274 },
    ],
    "11.5:left": [
        { x: 107.746, y: -13.266 },
        { x: 43.053, y: -1.901 },
        { x: 70.484, y: -7.283 },
        { x: 92.99, y: -7.334 },
        { x: 101.324, y: -7.267 },
        { x: 81.552, y: -6.32 },
        { x: 115.777, y: -4.204 },
        { x: 137.681, y: -5.865 },
        { x: 107.745, y: -6.347 },
        { x: 125.786, y: -1.842 },
        { x: 147.614, y: -6.298 },
        { x: 57.183, y: -3.076 },
    ],
    "11.5:right": [
        { x: 107.536, y: 2.004 },
        { x: 42.842, y: 13.369 },
        { x: 70.274, y: 7.987 },
        { x: 92.78, y: 7.936 },
        { x: 101.114, y: 8.003 },
        { x: 81.342, y: 8.95 },
        { x: 115.567, y: 11.066 },
        { x: 137.471, y: 9.405 },
        { x: 107.534, y: 8.923 },
        { x: 125.575, y: 13.428 },
        { x: 147.404, y: 8.972 },
        { x: 56.973, y: 12.194 },
    ],
    "12:left": [
        { x: 108.967, y: -13.175 },
        { x: 44.274, y: -1.81 },
        { x: 71.705, y: -7.192 },
        { x: 94.211, y: -7.243 },
        { x: 102.545, y: -7.175 },
        { x: 82.773, y: -6.229 },
        { x: 116.998, y: -4.113 },
        { x: 138.902, y: -5.774 },
        { x: 108.965, y: -6.256 },
        { x: 127.007, y: -1.751 },
        { x: 148.835, y: -6.207 },
        { x: 58.404, y: -2.984 },
    ],
    "12:right": [
        { x: 109.419, y: 2.273 },
        { x: 44.725, y: 13.638 },
        { x: 72.156, y: 8.256 },
        { x: 94.662, y: 8.205 },
        { x: 102.996, y: 8.272 },
        { x: 83.225, y: 9.219 },
        { x: 117.449, y: 11.335 },
        { x: 139.353, y: 9.674 },
        { x: 109.417, y: 9.192 },
        { x: 127.458, y: 13.697 },
        { x: 149.286, y: 9.241 },
        { x: 58.856, y: 12.463 },
    ],
    "9:right": [
        { x: 104.606, y: 2.189 },
        { x: 39.912, y: 13.555 },
        { x: 67.343, y: 8.172 },
        { x: 89.85, y: 8.122 },
        { x: 98.183, y: 8.189 },
        { x: 78.412, y: 9.135 },
        { x: 112.636, y: 11.252 },
        { x: 134.54, y: 9.591 },
        { x: 104.604, y: 9.108 },
        { x: 122.645, y: 13.613 },
        { x: 144.474, y: 9.158 },
        { x: 54.043, y: 12.38 },
    ],
};

async function loftFoot(side: Side, menSize: number, archHeightMm: number) {
    const buf = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "left") {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    // US 9 is the procedural template. Mapping that sheet onto exactly 260×95
    // drops the top rim, so size 9 stays on the native mesh.
    if (menSize !== 9) {
        const layout = insoleLayoutForUsMenSize(menSize);
        const sized = scaleGeometryToInsoleSize(raw, layout.lengthMm, layout.widthMm);
        raw.dispose();
        raw = sized;
    }
    const preview = await reconstructProceduralPreview(raw, {
        corrections: { ...ZERO, archHeightMm },
        wallStyle: "straight",
        scanPattern: "full_contact",
        side,
    });
    raw.dispose();
    return preview.geometry;
}

describe("bottom text on sized feet", () => {
    test("size 9 right fits W. Rodriguez at 12 mm on arch 0 and low arch", async () => {
        const font = await loadTextFont();
        const flat = flattenText(font, "W. Rodriguez", 12, 0.6, true);
        const marking = {
            ...defaultTextMarking("bottom"),
            text: "W. Rodriguez",
            capHeightMm: 12,
            bold: true,
        };
        for (const arch of [0, -3.5]) {
            const geo = await loftFoot("right", 9, arch);
            const ctx = extractHostTextContext(geo);
            const loop = flatBottomBoundaryLoop(geo);
            expect(loop).not.toBeNull();
            expect(absArea(loop!)).toBeGreaterThan(0.5 * absArea(ctx.outline));
            const placed = placeBottomText(geo, ctx, marking, flat, "right");
            const cap = 12 * (placed.meta.mappedWidthMm / flat.advanceMm);
            expect(cap).toBeGreaterThanOrEqual(11.5);
            const want = PLACEMENT_MM["9:right"]!;
            expect(placed.meta.centroids.length).toBe(want.length);
            for (let i = 0; i < want.length; i++) {
                expect(placed.meta.centroids[i]!.x).toBeCloseTo(want[i]!.x, 2);
                expect(placed.meta.centroids[i]!.y).toBeCloseTo(want[i]!.y, 2);
            }
            geo.dispose();
        }
    }, 180_000);

    test("sizes 7, 11.5 and 12 keep the same bottom placement", async () => {
        const font = await loadTextFont();
        const flat = flattenText(font, "W. Rodriguez", 12, 0.6, true);
        const marking = {
            ...defaultTextMarking("bottom"),
            text: "W. Rodriguez",
            capHeightMm: 12,
            bold: true,
        };
        for (const size of [7, 11.5, 12]) {
            for (const side of ["left", "right"] as const) {
                const geo = await loftFoot(side, size, 0);
                const ctx = extractHostTextContext(geo);
                const loop = flatBottomBoundaryLoop(geo);
                expect(absArea(loop!)).toBeGreaterThan(0.5 * absArea(ctx.outline));
                const placed = placeBottomText(geo, ctx, marking, flat, side);
                const cap = 12 * (placed.meta.mappedWidthMm / flat.advanceMm);
                expect(cap).toBeGreaterThanOrEqual(11.5);
                const want = PLACEMENT_MM[`${size}:${side}`]!;
                expect(placed.meta.centroids.length).toBe(want.length);
                for (let i = 0; i < want.length; i++) {
                    expect(placed.meta.centroids[i]!.x).toBeCloseTo(want[i]!.x, 2);
                    expect(placed.meta.centroids[i]!.y).toBeCloseTo(want[i]!.y, 2);
                }
                geo.dispose();
            }
        }
    }, 400_000);
});
