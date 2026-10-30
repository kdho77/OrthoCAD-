// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { foldReport } from "@/lib/geometry/procedural-wall/metrics";
import { footprintVSignedFromMeshY } from "@/lib/geometry/procedural-wall/modifiers";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import {
    FOREFOOT_THICKNESS_CLEARANCE_MM,
    SINK_DEFAULT_DEPTH_MM,
    SINK_KIND_ORDER,
    SINK_PROFILES,
    sinkCutAt,
    specVFromVSigned,
} from "@/lib/geometry/sink";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import type { PlacedSink, SideCorrections } from "@/types";

/**
 * SHA-256 of geometryToBinarySTL(reconstructProceduralPreview(native SAMPLE_Top)).
 * Straight is the 37472-vertex solid. These pins are the no-sink bytes of this tree.
 */
const STL_SHA256 = {
    straight: "6c67e279aa33ea15bd6ffb0c9ba8feecee907d73dfdc5eacadda24e09052df14",
    round: "19e7ad197d94d6c63268052c33fe4640e793acdc09bf712077e3cf10e2c621b7",
    hybrid: "159832145396adcd8a90bbda16abf2abd4d7a20d05c06c9de86868a098519cad",
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
        corrections: zeroCorrections(),
        elements: [],
        includeElements: false,
        includeSkives: false,
        trimline: null,
        ...(sinks && sinks.length > 0 ? { sinks } : {}),
    };
}

describe("SAMPLE_Top M9 left preview sink gates", () => {
    test("no-sink identity and 1st MPJ at 4 mm stay z-only on the fixed wall", async () => {
        const raw = await sampleTop();
        const hashes: Record<string, { stl: string; pos: string; count: number }> = {};
        const plains: Record<string, BufferGeometry> = {};
        let plain: BufferGeometry | null = null;
        for (const wallStyle of ["straight", "round", "hybrid"] as const) {
            const preview = await reconstructProceduralPreview(raw, { wallStyle, side: "left" });
            const stl = sha256Stl(preview.geometry);
            const pos = sha256Positions(preview.geometry);
            const count = preview.geometry.getAttribute("position").count;
            hashes[wallStyle] = { stl, pos, count };
            console.log("[SINK-PREVIEW-SHA]", wallStyle, hashes[wallStyle]);
            plains[wallStyle] = preview.geometry;
            if (wallStyle === "straight") plain = preview.geometry;
        }
        expect(hashes.straight?.count).toBe(37472);
        expect(hashes.straight?.stl).toBe(STL_SHA256.straight);
        expect(hashes.round?.stl).toBe(STL_SHA256.round);
        expect(hashes.hybrid?.stl).toBe(STL_SHA256.hybrid);

        const sunk = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sinks: [MPJ1],
        });
        const composedPlain = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sourceField: field(),
            composedTop: true,
        });
        const composedSunk = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sourceField: field([MPJ1]),
            composedTop: true,
        });
        const analytic = compareSolids(plain!, sunk.geometry);
        const composed = compareSolids(composedPlain.geometry, composedSunk.geometry);
        console.log("[SINK-F1]", JSON.stringify({ analytic, composed, hashes }));
        expect(analytic.baseVertexCount).toBe(37472);
        expect(analytic.vertexCount).toBe(analytic.baseVertexCount);
        expect(analytic.outlineMm).toBeLessThanOrEqual(0.02);
        expect(analytic.rearfootDzMm).toBeLessThanOrEqual(1e-6);
        expect(composed.vertexCount).toBe(composed.baseVertexCount);
        expect(composed.outlineMm).toBeLessThanOrEqual(0.02);
        expect(composed.rearfootDzMm).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(analytic.floorDzMm - 0.5)).toBeLessThanOrEqual(0.05);
        expect(Math.abs(composed.floorDzMm - 0.5)).toBeLessThanOrEqual(0.05);

        const six = SINK_KIND_ORDER.map((kind) => ({ id: kind, kind, depthMm: SINK_DEFAULT_DEPTH_MM }));
        const floors: Record<string, Record<string, { dz: number; weight: number }>> = {};
        for (const wallStyle of ["straight", "round", "hybrid"] as const) {
            const all = await reconstructProceduralPreview(raw, {
                wallStyle,
                side: "left",
                sinks: six,
            });
            const solid = compareSolids(plains[wallStyle]!, all.geometry);
            const perSink = deepestFloor(plains[wallStyle]!, all.geometry, six);
            floors[wallStyle] = perSink;
            console.log(
                "[SINK-F4-FLOOR]",
                wallStyle,
                JSON.stringify({ perSink, outlineMm: solid.outlineMm }),
            );
            expect(solid.vertexCount).toBe(solid.baseVertexCount);
            expect(solid.outlineMm).toBeLessThanOrEqual(0.02);
            for (const kind of SINK_KIND_ORDER) {
                if (!SINK_PROFILES[kind].forefoot) continue;
                const hit = perSink[kind];
                expect(hit, `${wallStyle} ${kind}`).toBeTruthy();
                expect(Math.abs(hit!.dz - FOREFOOT_THICKNESS_CLEARANCE_MM)).toBeLessThanOrEqual(0.05);
            }
            all.geometry.dispose();
        }

        const styloid2 = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sinks: [{ id: "styloid", kind: "styloid", depthMm: SINK_DEFAULT_DEPTH_MM }],
        });
        const styloid3 = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sinks: [{ id: "styloid", kind: "styloid", depthMm: 3 }],
        });
        const drop2 = wallTopDropMm(plains.straight!, styloid2.geometry);
        const drop3 = wallTopDropMm(plains.straight!, styloid3.geometry);
        const angled = await reconstructProceduralPreview(raw, {
            wallStyle: "straight",
            side: "left",
            sinks: [MPJ1, { id: "styloid", kind: "styloid", depthMm: 3 }],
        });
        const wallAngleDeg = wallFoldDeg(angled.geometry);
        const plainWallDeg = wallFoldDeg(plains.straight!);
        console.log("[SINK-F4]", JSON.stringify({ floors, drop2, drop3, wallAngleDeg, plainWallDeg }));
        // Depth 2 used to drop 0.000 while ~1.3 mm of clearance remained above the 3 mm wall minimum.
        expect(drop2).toBeGreaterThan(0.5);
        expect(drop2).toBeLessThan(1.95);
        expect(drop3).toBeGreaterThan(drop2);
        expect(drop3).toBeLessThan(2.95);
        expect(wallAngleDeg).toBeLessThanOrEqual(60);

        for (const geo of Object.values(plains)) geo.dispose();
        sunk.geometry.dispose();
        composedPlain.geometry.dispose();
        composedSunk.geometry.dispose();
        styloid2.geometry.dispose();
        styloid3.geometry.dispose();
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
    const medialYSign = ((base.userData as { medialYSign?: 1 | -1 }).medialYSign ?? 1) as 1 | -1;
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
    const ctx = { side: "left" as const, lengthMm, widthMm, sinks };
    const bounds = { minY, maxY };
    const best: Record<string, { dz: number; weight: number }> = {};
    for (let i = 0; i < limit; i++) {
        const u = Math.max(0, Math.min(1, (a.getX(i) - minX) / lengthMm));
        const vSigned = footprintVSignedFromMeshY(a.getY(i), bounds, "left", medialYSign);
        const sample = sinkCutAt(u, vSigned, ctx);
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
