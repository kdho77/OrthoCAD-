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
import { applyTextMarkingToPrintSolid } from "./apply";
import { beltPrintedPoint, beltPrintFrameDet, printedPlantarView } from "./belt-print-frame";
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
 * Gantry plot, looking toward −height. At z = 0 this is (mesh X, mesh Y).
 * An X-unmirrored glyph reads here. The physical face is the X flip of this plot.
 */
function gantryFromAbove(p: TextXy & { z?: number }): TextXy {
    const part = beltPrintedPoint({ x: p.x, y: p.y, z: p.z ?? 0 });
    return { x: -part.along, y: part.across };
}

/**
 * 90° turn of {@link printedPlantarView} (det +1). Cap is screen-up and the
 * baseline runs left to right. The toe stays toward the viewer in the unturned view.
 */
function readingView(p: TextXy & { z?: number }): TextXy {
    const viewed = printedPlantarView(p);
    return { x: viewed.y, y: -viewed.x };
}

/**
 * Capital J in the reading turn of the physical plantar view. The hook is the
 * lower-left. A mirrored J puts that hook on the right of the stem.
 */
function jHookExtendsLeft(outer: TextXy[]): boolean {
    const viewed = outer.map((p) => readingView(p));
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

function groupAt(
    placed: {
        flat: { groups: TextGlyphGroup[] };
        meta: { centroids: Array<{ x: number; y: number; z?: number }> };
    },
    end: "left" | "right",
): TextGlyphGroup | undefined {
    let found: TextGlyphGroup | undefined;
    let best = end === "left" ? Infinity : -Infinity;
    placed.flat.groups.forEach((group, index) => {
        const centroid = placed.meta.centroids[index];
        if (!centroid) return;
        const x = readingView(centroid).x;
        if (end === "left" ? x < best : x > best) {
            best = x;
            found = group;
        }
    });
    return found;
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

function glyphBounds(groups: TextGlyphGroup[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const group of groups) {
        for (const loop of [group.outer, ...group.holes]) {
            for (const p of loop) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            }
        }
    }
    return { minX, minY, maxX, maxY };
}

describe("printed bottom name in the belt frame", () => {
    test("VertexSlice toe-first plus belt forward has det -1", () => {
        expect(beltPrintFrameDet()).toBeCloseTo(-1, 6);
    });

    test("flip-over view points the toe at the viewer and mirrors the gantry plot", () => {
        const heel = { x: 0, y: 0, z: 0 };
        const toe = { x: 30, y: 0, z: 0 };
        const across = { x: 0, y: 12, z: 0 };
        const toeView = printedPlantarView(toe);
        const heelView = printedPlantarView(heel);
        expect(toeView.y, "toe is toward the viewer").toBeLessThan(heelView.y - 20);
        for (const p of [heel, toe, across]) {
            const gantry = gantryFromAbove(p);
            const physical = printedPlantarView(p);
            expect(physical.x).toBeCloseTo(-gantry.y, 6);
            expect(physical.y).toBeCloseTo(-gantry.x, 6);
        }
    });

    test("both feet read JABBOUR on the physical plantar face", async () => {
        const font = await loadTextFont();
        const legacy = normalizeBottomTextMarking({
            ...defaultTextMarking("bottom"),
            text: NAME,
            capHeightMm: 6,
            bold: false,
        });
        expect(legacy.mode).toBe("engrave");
        expect(legacy.depthMm).toBe(0.6);
        expect(legacy.capHeightMm).toBe(12);
        expect(legacy.bold).toBe(true);
        const flat = flattenText(font, legacy.text, legacy.capHeightMm, legacy.letterSpacingMm, legacy.bold);

        for (const side of ["left", "right"] as const) {
            const geo = await loftInternal(side);
            const ctx = extractHostTextContext(geo);
            const design = placeBottomText(geo, ctx, legacy, flat, side);
            const printed = placeBottomText(geo, ctx, legacy, flat, side, { beltPrint: true });
            const designJay = groupAt(design, "right");
            expect(designJay, `${side} design J`).toBeDefined();
            if (!designJay) return;
            expect(
                jHookExtendsLeft(designJay.outer),
                `${side} design-mesh placement stays on the viewer camera`,
            ).toBe(false);

            const jay = groupAt(printed, "left");
            expect(jay, `${side} has a J`).toBeDefined();
            if (!jay) return;
            expect(jHookExtendsLeft(jay.outer), `${side} J hook is on the reader's left`).toBe(true);

            const ordered = [...printed.meta.centroids].sort((a, b) => readingView(a).x - readingView(b).x);
            const left = ordered[0];
            const right = ordered[ordered.length - 1];
            expect(left, `${side} has a glyph`).toBeDefined();
            expect(right, `${side} has a glyph`).toBeDefined();
            if (!left || !right) return;
            expect(readingView(right).x - readingView(left).x, `${side} reads left to right`).toBeGreaterThan(
                20,
            );
            expect(printedPlantarView(left).y, `${side} first letter sits toward the toe`).toBeLessThan(
                printedPlantarView(right).y,
            );

            expect(printed.meta.centroids.length).toBe(design.meta.centroids.length);
            const belt0 = printed.meta.centroids[0];
            const viewer0 = design.meta.centroids[0];
            expect(belt0, `${side} centroid`).toBeDefined();
            expect(viewer0, `${side} centroid`).toBeDefined();
            if (!belt0 || !viewer0) return;
            const anchorX = (belt0.x + viewer0.x) / 2;
            const anchorY = (belt0.y + viewer0.y) / 2;
            for (let i = 0; i < printed.meta.centroids.length; i++) {
                const belt = printed.meta.centroids[i];
                const viewer = design.meta.centroids[i];
                if (!belt || !viewer) return;
                expect(Math.abs((belt.x + viewer.x) / 2 - anchorX), `${side} cx`).toBeLessThan(0.2);
                expect(Math.abs((belt.y + viewer.y) / 2 - anchorY), `${side} cy`).toBeLessThan(0.2);
                expect(belt.z, `${side} depth`).toBeCloseTo(legacy.depthMm, 5);
            }

            const cap = legacy.capHeightMm * (printed.meta.mappedWidthMm / flat.advanceMm);
            expect(cap, `${side} cap`).toBeGreaterThan(11.5);
            expect(cap, `${side} cap`).toBeLessThanOrEqual(12);
            const ys = jay.outer.map((p) => p.y);
            const glyphH = Math.max(...ys) - Math.min(...ys);
            expect(glyphH, `${side} glyph height`).toBeGreaterThan(11);
            expect(glyphH, `${side} glyph height`).toBeLessThan(14);

            const hostPos = geo.getAttribute("position");
            const hostIndex = geo.getIndex();
            expect(hostIndex, `${side} host index`).toBeTruthy();
            let hostMinZ = Infinity;
            for (let i = 0; i < hostPos.count; i++) hostMinZ = Math.min(hostMinZ, hostPos.getZ(i));
            const box = glyphBounds(printed.flat.groups);
            const margin = 8;
            const marked = await applyTextMarkingToPrintSolid(geo, legacy, { side, beltPrint: true });
            const outPos = marked.getAttribute("position");
            const outIndex = marked.getIndex();
            expect(outIndex, `${side} engraved index`).toBeTruthy();
            if (!hostIndex || !outIndex) return;
            for (let i = 0; i < hostPos.count; i++) {
                expect(outPos.getX(i), `${side} host x ${i}`).toBeCloseTo(hostPos.getX(i), 5);
                expect(outPos.getY(i), `${side} host y ${i}`).toBeCloseTo(hostPos.getY(i), 5);
                expect(outPos.getZ(i), `${side} host z ${i}`).toBeCloseTo(hostPos.getZ(i), 5);
            }
            let outMinZ = Infinity;
            for (let i = 0; i < outPos.count; i++) {
                const x = outPos.getX(i);
                const y = outPos.getY(i);
                const z = outPos.getZ(i);
                outMinZ = Math.min(outMinZ, z);
                if (i >= hostPos.count) {
                    expect(x, `${side} new vertex x`).toBeGreaterThanOrEqual(box.minX - margin);
                    expect(x, `${side} new vertex x`).toBeLessThanOrEqual(box.maxX + margin);
                    expect(y, `${side} new vertex y`).toBeGreaterThanOrEqual(box.minY - margin);
                    expect(y, `${side} new vertex y`).toBeLessThanOrEqual(box.maxY + margin);
                }
            }
            expect(outMinZ, `${side} sole`).toBeCloseTo(hostMinZ, 4);
            const outside = (x: number, y: number) =>
                x < box.minX - margin ||
                x > box.maxX + margin ||
                y < box.minY - margin ||
                y > box.maxY + margin;
            const triKey = (a: number, b: number, c: number) => [a, b, c].sort((p, q) => p - q).join("|");
            const hostOutside = new Set<string>();
            for (let t = 0; t + 2 < hostIndex.count; t += 3) {
                const a = hostIndex.getX(t);
                const b = hostIndex.getX(t + 1);
                const c = hostIndex.getX(t + 2);
                if (
                    outside(hostPos.getX(a), hostPos.getY(a)) &&
                    outside(hostPos.getX(b), hostPos.getY(b)) &&
                    outside(hostPos.getX(c), hostPos.getY(c))
                ) {
                    hostOutside.add(triKey(a, b, c));
                }
            }
            expect(hostOutside.size, `${side} outside triangles`).toBeGreaterThan(0);
            for (let t = 0; t + 2 < outIndex.count; t += 3) {
                const a = outIndex.getX(t);
                const b = outIndex.getX(t + 1);
                const c = outIndex.getX(t + 2);
                if (
                    outside(outPos.getX(a), outPos.getY(a)) &&
                    outside(outPos.getX(b), outPos.getY(b)) &&
                    outside(outPos.getX(c), outPos.getY(c))
                ) {
                    expect(hostOutside.has(triKey(a, b, c)), `${side} outside tri`).toBe(true);
                }
            }
            marked.dispose();
            geo.dispose();
        }
    }, 360_000);
});
