// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { foldReport } from "@/lib/geometry/procedural-wall/metrics";
import { footprintVSignedFromMeshY } from "@/lib/geometry/procedural-wall/modifiers";
import { withDefaultPrintShell } from "@/lib/geometry/procedural-wall/print-solid-compose";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import {
    footOutlineFromGeometry,
    meshYToAnatomical,
    SINK_DEFAULT_DEPTH_MM,
    SINK_KIND_ORDER,
    SINK_PROFILES,
    sinkCutMm,
    specVFromVSigned,
} from "@/lib/geometry/sink";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { defaultDesign } from "@/stores/design-store";
import type { PlacedSink, SideCorrections } from "@/types";

/**
 * SHA-256 of geometryToBinarySTL(reconstructProceduralPreview(native SAMPLE_Top)).
 * Straight is the 37924-vertex solid (zonal shell adds one floor-fillet ring).
 * These pins are the no-sink bytes of this tree.
 */
const STL_SHA256 = {
    straight: "4c0e3fa857504ddf81f2722737c83f47b20eac9b642e406656e06ed3deab13e1",
    round: "ad742f2e7e6f2ad36053de3a1713237b60fff21bf84ebad5a15d854050bbe85f",
    hybrid: "c19a58cdd99387eb6a2eb4b34f8442eb8317ce1779583c4f8734a9d64d1b383f",
} as const;

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const MPJ1: PlacedSink = { id: "mpj1", kind: "mpj1", depthMm: 4 };

function zeroCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

async function sampleTop(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function sha256Stl(geo: BufferGeometry): string {
    return createHash("sha256")
        .update(Buffer.from(geometryToBinarySTL(geo)))
        .digest("hex");
}

function sha256Positions(geo: BufferGeometry): string {
    const pos = geo.getAttribute("position").array as Float32Array;
    return createHash("sha256")
        .update(Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength))
        .digest("hex");
}

function field(sinks?: PlacedSink[]): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        method: "printing_solid",
        corrections: zeroCorrections(),
        elements: [],
        includeElements: false,
        includeSkives: false,
        trimline: null,
        ...(sinks && sinks.length > 0 ? { sinks } : {}),
    };
}

/** Shell at `mm`, resolved the same way a sink raises the Setup thickness. */
function sliderField(mm: number): HeightFieldParams {
    const shelled = withDefaultPrintShell(field());
    return { ...shelled, thicknessMm: mm };
}

describe("SAMPLE_Top M9 left preview sink gates", () => {
    test("no-sink identity and 1st MPJ at 4 mm stay z-only on the fixed wall", async () => {
        const raw = await sampleTop();
        const hashes: Record<string, { stl: string; pos: string; count: number }> = {};
        const plains: Record<string, BufferGeometry> = {};
        for (const wallStyle of ["straight", "round", "hybrid"] as const) {
            const preview = await reconstructProceduralPreview(raw, { wallStyle, side: "left" });
            const stl = sha256Stl(preview.geometry);
            const pos = sha256Positions(preview.geometry);
            const count = preview.geometry.getAttribute("position").count;
            hashes[wallStyle] = { stl, pos, count };
            console.log("[SINK-PREVIEW-SHA]", wallStyle, hashes[wallStyle]);
            plains[wallStyle] = preview.geometry;
        }
        expect(hashes.straight?.count).toBe(37924);
        expect(hashes.straight?.stl).toBe(STL_SHA256.straight);
        expect(hashes.round?.stl).toBe(STL_SHA256.round);
        expect(hashes.hybrid?.stl).toBe(STL_SHA256.hybrid);

        const sunk = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sinks: [MPJ1],
        });
        const raised45 = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sourceField: baseModifierField(defaultDesign(), "left", 4.5),
            composedTop: true,
            thicknessMm: 4.5,
            stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
        });
        const composedRaised = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sourceField: sliderField(4.5),
            composedTop: true,
            thicknessMm: 4.5,
            stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
        });
        const composedSunk = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sourceField: field([MPJ1]),
            composedTop: true,
        });
        const analytic = compareSolids(raised45.geometry, sunk.geometry);
        const composed = compareSolids(composedRaised.geometry, composedSunk.geometry);
        console.log("[SINK-F1]", JSON.stringify({ analytic, composed, hashes }));
        expect(hashes.straight?.count).toBe(37924);
        // The 4 mm sink is the 4.5 mm slider shell, then a 4 mm cut. No local mound.
        expect(analytic.vertexCount).toBe(analytic.baseVertexCount);
        expect(analytic.outlineMm).toBeLessThanOrEqual(0.02);
        expect(analytic.rearfootDzMm).toBeLessThanOrEqual(0.05);
        expect(analytic.floorDzMm).toBeGreaterThanOrEqual(-4.05);
        expect(analytic.floorDzMm).toBeLessThanOrEqual(-3.95);
        expect(composed.vertexCount).toBe(composed.baseVertexCount);
        expect(composed.outlineMm).toBeLessThanOrEqual(0.02);
        expect(composed.rearfootDzMm).toBeLessThanOrEqual(0.05);
        expect(composed.floorDzMm).toBeGreaterThanOrEqual(-4.05);
        expect(composed.floorDzMm).toBeLessThanOrEqual(-3.95);

        const nonRkw = SINK_KIND_ORDER.filter((kind) => kind !== "rkw").map((kind) => ({
            id: kind,
            kind,
            depthMm: SINK_DEFAULT_DEPTH_MM,
        }));
        const floors: Record<string, Record<string, { dz: number; weight: number }>> = {};
        const raised25: Record<string, BufferGeometry> = {};
        for (const wallStyle of ["straight", "round", "hybrid"] as const) {
            const shell = await reconstructProceduralPreview(raw, {
                wallStyle,
                side: "left",
                sourceField: baseModifierField(defaultDesign(), "left", 2.5),
                composedTop: true,
                thicknessMm: 2.5,
                stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
            });
            raised25[wallStyle] = shell.geometry;
            const all = await reconstructProceduralPreview(raw, {
                wallStyle,
                side: "left",
                sinks: nonRkw,
            });
            const solid = compareSolids(shell.geometry, all.geometry);
            const perSink = deepestFloor(shell.geometry, all.geometry, nonRkw);
            floors[wallStyle] = perSink;
            console.log(
                "[SINK-F4-FLOOR]",
                wallStyle,
                JSON.stringify({ perSink, outlineMm: solid.outlineMm }),
            );
            expect(solid.vertexCount).toBe(solid.baseVertexCount);
            expect(solid.outlineMm).toBeLessThanOrEqual(0.02);
            for (const kind of SINK_KIND_ORDER) {
                if (kind === "rkw" || !SINK_PROFILES[kind].forefoot) continue;
                const hit = perSink[kind];
                expect(hit, `${wallStyle} ${kind}`).toBeTruthy();
                expect(Math.abs(hit!.dz - -SINK_DEFAULT_DEPTH_MM)).toBeLessThanOrEqual(0.05);
            }
            all.geometry.dispose();
        }

        const withRkw = [...nonRkw, { id: "rkw", kind: "rkw" as const, depthMm: SINK_DEFAULT_DEPTH_MM }];
        const suppressed = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sinks: withRkw,
        });
        const whileOn = deepestFloor(raised25.straight!, suppressed.geometry, withRkw);
        expect(whileOn.mpj1, "RKW suppresses the MPJ1 floor hit").toBeUndefined();
        expect(whileOn.rkw, "RKW still cuts").toBeTruthy();
        expect(Math.abs(whileOn.rkw!.dz - -SINK_DEFAULT_DEPTH_MM)).toBeLessThanOrEqual(0.05);
        const restoredSinks = withRkw.filter((sink) => sink.kind !== "rkw");
        const restored = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sinks: restoredSinks,
        });
        const after = deepestFloor(raised25.straight!, restored.geometry, restoredSinks);
        expect(after.mpj1, "removing RKW restores the MPJ1 floor hit").toBeTruthy();
        suppressed.geometry.dispose();
        restored.geometry.dispose();

        const styloid2 = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sinks: [{ id: "styloid", kind: "styloid", depthMm: SINK_DEFAULT_DEPTH_MM }],
        });
        const raised35 = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sourceField: baseModifierField(defaultDesign(), "left", 3.5),
            composedTop: true,
            thicknessMm: 3.5,
            stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
        });
        const styloid3 = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sinks: [{ id: "styloid", kind: "styloid", depthMm: 3 }],
        });
        const drop2 = wallTopDropMm(raised25.straight!, styloid2.geometry);
        const drop3 = wallTopDropMm(raised35.geometry, styloid3.geometry);
        const angled = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sinks: [MPJ1, { id: "styloid", kind: "styloid", depthMm: 3 }],
        });
        const wallAngleDeg = wallFoldDeg(angled.geometry);
        const plainWallDeg = wallFoldDeg(plains.straight!);
        console.log("[SINK-F4]", JSON.stringify({ floors, drop2, drop3, wallAngleDeg, plainWallDeg }));
        // The styloid shifts medially, so the outer rim band stays full thickness.
        expect(drop2).toBeLessThan(0.2);
        expect(drop3).toBeLessThan(0.2);
        expect(wallAngleDeg).toBeLessThanOrEqual(60);

        for (const geo of Object.values(plains)) geo.dispose();
        for (const geo of Object.values(raised25)) geo.dispose();
        sunk.geometry.dispose();
        raised45.geometry.dispose();
        composedRaised.geometry.dispose();
        composedSunk.geometry.dispose();
        styloid2.geometry.dispose();
        styloid3.geometry.dispose();
        raised35.geometry.dispose();
        angled.geometry.dispose();
        raw.dispose();
    }, 900_000);
});

function compareSolids(base: BufferGeometry, sunk: BufferGeometry) {
    const a = base.getAttribute("position").array as Float32Array;
    const b = sunk.getAttribute("position").array as Float32Array;
    const count = sunk.getAttribute("position").count;
    const baseCount = base.getAttribute("position").count;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < a.length; i += 3) {
        minX = Math.min(minX, a[i]!);
        maxX = Math.max(maxX, a[i]!);
    }
    const length = Math.max(1e-3, maxX - minX);
    const rearfootX = minX + 0.4 * length;
    let outlineMm = 0;
    let rearfootDzMm = 0;
    let heelDzMm = 0;
    const n = Math.min(a.length, b.length);
    let bandTop = -Infinity;
    for (let i = 0; i < n; i += 3) {
        outlineMm = Math.max(outlineMm, Math.hypot(b[i]! - a[i]!, b[i + 1]! - a[i + 1]!));
        const dz = b[i + 2]! - a[i + 2]!;
        if (a[i]! <= rearfootX) rearfootDzMm = Math.max(rearfootDzMm, Math.abs(dz));
        if (Math.abs(a[i]! - 26) < 4) heelDzMm = Math.max(heelDzMm, Math.abs(dz));
        const u = (a[i]! - minX) / length;
        if (u >= 0.62 && u <= 0.82 && a[i + 2]! > bandTop) bandTop = a[i + 2]!;
    }
    let floorDzMm = Infinity;
    for (let i = 0; i < n; i += 3) {
        const u = (a[i]! - minX) / length;
        if (u < 0.62 || u > 0.82) continue;
        if (a[i + 2]! < bandTop - 1.5) continue;
        floorDzMm = Math.min(floorDzMm, b[i + 2]! - a[i + 2]!);
    }
    return { baseVertexCount: baseCount, vertexCount: count, outlineMm, rearfootDzMm, heelDzMm, floorDzMm };
}

/** dz at the top-sheet vertex where each sink's cut weight is highest. */
function deepestFloor(
    base: BufferGeometry,
    sunk: BufferGeometry,
    sinks: PlacedSink[],
): Record<string, { dz: number; weight: number }> {
    const a = base.getAttribute("position");
    const b = sunk.getAttribute("position");
    const topN = (base.userData as { topVertexCount?: number }).topVertexCount ?? a.count;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const limit = Math.min(topN, a.count, b.count);
    for (let i = 0; i < limit; i++) {
        minX = Math.min(minX, a.getX(i));
        maxX = Math.max(maxX, a.getX(i));
        minY = Math.min(minY, a.getY(i));
        maxY = Math.max(maxY, a.getY(i));
    }
    const lengthMm = Math.max(1e-3, maxX - minX);
    const widthMm = Math.max(1e-3, maxY - minY);
    const medialYSign = ((base.userData as { medialYSign?: 1 | -1 }).medialYSign ?? 1) as 1 | -1;
    const ctx = {
        side: "left" as const,
        lengthMm,
        widthMm,
        sinks,
        medialYSign,
        footOutline: footOutlineFromGeometry(base, 0, 1, limit),
    };
    const best: Record<string, { dz: number; weight: number }> = {};
    for (let i = 0; i < limit; i++) {
        const sample = sinkCutMm(a.getX(i), meshYToAnatomical(a.getY(i), "left", medialYSign), ctx);
        if (!sample.sinkId || sample.weight <= 0) continue;
        const prev = best[sample.sinkId];
        if (prev && sample.weight <= prev.weight) continue;
        best[sample.sinkId] = { dz: b.getZ(i) - a.getZ(i), weight: sample.weight };
    }
    return best;
}

/** Drop of the lateral crest beside the styloid. Inboard of v 0.936 the top sheet takes the full cut. */
function wallTopDropMm(base: BufferGeometry, sunk: BufferGeometry): number {
    const a = base.getAttribute("position");
    const b = sunk.getAttribute("position");
    const medialYSign = ((base.userData as { medialYSign?: 1 | -1 }).medialYSign ?? 1) as 1 | -1;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const n = Math.min(a.count, b.count);
    for (let i = 0; i < n; i++) {
        minX = Math.min(minX, a.getX(i));
        maxX = Math.max(maxX, a.getX(i));
        minY = Math.min(minY, a.getY(i));
        maxY = Math.max(maxY, a.getY(i));
    }
    const length = Math.max(1e-3, maxX - minX);
    const bounds = { minY, maxY };
    let drop = 0;
    for (let i = 0; i < n; i++) {
        const u = (a.getX(i) - minX) / length;
        if (u < 0.43 || u > 0.49) continue;
        const v = specVFromVSigned(footprintVSignedFromMeshY(a.getY(i), bounds, "left", medialYSign), "left");
        if (v < 0.937 || v > 0.955) continue;
        drop = Math.max(drop, a.getZ(i) - b.getZ(i));
    }
    return drop;
}

/** Sharpest wall fold, ignoring stock top-sheet creases. */
function wallFoldDeg(geo: BufferGeometry): number {
    const ud = geo.userData as {
        topVertexCount?: number;
        outlineVertexCount?: number;
        outlineVertexStart?: number;
        plantarStart?: number;
        plantarEnd?: number;
    };
    return foldReport(geo, {
        wholeInsole: true,
        topVertexCount: ud.topVertexCount,
        outlineVertexCount: ud.outlineVertexCount,
        outlineVertexStart: ud.outlineVertexStart,
        plantarVertexStart: ud.plantarStart,
        plantarVertexEnd: ud.plantarEnd,
    }).worstDeg;
}
