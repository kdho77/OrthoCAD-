// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { analyzeManifold } from "@/lib/geometry/manifold";
import * as meshClose from "@/lib/geometry/mesh-close";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import { SAMPLE_TOP_PUBLIC_PATH } from "@/lib/geometry/procedural-wall/sample-top-id";
import {
    reconstructProceduralPreview,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import {
    insoleLayoutForFootLengthMm,
    insoleLayoutForUkSize,
    insoleLayoutForUsMenSize,
    insoleLayoutFromDesign,
    listFootLengthMmOptions,
    listUkSizes,
    listUsMenSizes,
    scaleSourceShapeToFootprint,
    TOP_SHEET_XY_ANCHOR_SCALE,
    usWomenFromMen,
} from "@/lib/geometry/shoe-size";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

const SAMPLE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

/** Relief crest on current main, measured on the M9 top sheet before this anchor. */
const MAIN_M9_TOP_MAX_Z_MM = 25.811349868774414;

const previewKernel = {
    name: "three-procedural",
    ready: true,
    tier: "preview" as const,
    buildInsole: buildInsoleGeometry,
    buildInsoleSolid(params: Parameters<typeof buildInsoleGeometry>[0]) {
        const geometry = buildInsoleGeometry(params);
        const mesh = analyzeManifold(geometry);
        return { geometry, manifold: { ...mesh, solidClosed: false, isWatertight: mesh.isWatertight } };
    },
    buildFromBase(base: BufferGeometry) {
        const geometry = base.clone();
        const mesh = analyzeManifold(geometry);
        return { geometry, manifold: { ...mesh, solidClosed: false, isWatertight: mesh.isWatertight } };
    },
    async exportSTL(geometry: BufferGeometry) {
        return geometryToBinarySTL(geometry);
    },
};

rs.mock("@/lib/geometry/geometry-kernel", () => ({
    getKernel: () => previewKernel,
    isAuthoritativeKernel: () => false,
    isKernelInitFailed: () => false,
    ensureKernelReady: async () => false,
}));

function spanOf(
    pos: {
        count: number;
        getX: (i: number) => number;
        getY: (i: number) => number;
        getZ: (i: number) => number;
    },
    n: number,
) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    return {
        length: maxX - minX,
        width: maxY - minY,
        minZ,
        maxZ,
        height: maxZ - minZ,
    };
}

function sheetSpan(geo: BufferGeometry) {
    const pos = geo.getAttribute("position");
    const topN = (geo.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    if (topN <= 0) throw new Error("topVertexCount missing");
    return { topN, top: spanOf(pos, topN), solid: spanOf(pos, pos.count) };
}

async function loadNative(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe("Men's 9 top-sheet XY anchor", () => {
    afterEach(() => {
        rs.restoreAllMocks();
        resetSampleTopGeometryCache();
    });

    test("every supported size keeps an even XY anchor and an unanchored relief scale", async () => {
        expect(TOP_SHEET_XY_ANCHOR_SCALE).toBe(1.011273);
        expect(insoleLayoutForUsMenSize(9).scale).toBeCloseTo(1, 6);

        const native = await loadNative();
        const pos = native.getAttribute("position");
        const nativeBox = spanOf(pos, pos.count);
        const rows: Array<Record<string, number | string>> = [];
        const check = (label: string, scale: number, women = "") => {
            const g = native.clone();
            scaleSourceShapeToFootprint(g, scale, BASE_REFERENCE_THICKNESS_MM);
            const box = spanOf(g.getAttribute("position"), g.getAttribute("position").count);
            g.dispose();
            const beforeL = nativeBox.length * scale;
            const beforeW = nativeBox.width * scale;
            const afterL = beforeL * TOP_SHEET_XY_ANCHOR_SCALE;
            const afterW = beforeW * TOP_SHEET_XY_ANCHOR_SCALE;
            expect(box.length, `${label} length`).toBeCloseTo(afterL, 2);
            expect(box.width, `${label} width`).toBeCloseTo(afterW, 2);
            expect(box.length / box.width, `${label} even`).toBeCloseTo(
                nativeBox.length / nativeBox.width,
                4,
            );
            const relief =
                BASE_REFERENCE_THICKNESS_MM + (nativeBox.maxZ - BASE_REFERENCE_THICKNESS_MM) * scale;
            expect(box.maxZ, `${label} relief`).toBeCloseTo(relief, 2);
            expect(box.maxZ, `${label} not anchor-scaled`).not.toBeCloseTo(
                BASE_REFERENCE_THICKNESS_MM +
                    (nativeBox.maxZ - BASE_REFERENCE_THICKNESS_MM) * scale * TOP_SHEET_XY_ANCHOR_SCALE,
                2,
            );
            rows.push({
                label,
                women,
                scale: Number(scale.toFixed(6)),
                beforeL: Number(beforeL.toFixed(2)),
                beforeW: Number(beforeW.toFixed(2)),
                afterL: Number(box.length.toFixed(2)),
                afterW: Number(box.width.toFixed(2)),
                reliefZ: Number(box.maxZ.toFixed(2)),
            });
        };

        for (const size of listUsMenSizes()) {
            const layout = insoleLayoutForUsMenSize(size);
            check(`M${size}`, layout.scale, `W${usWomenFromMen(size)}`);
        }
        for (const uk of listUkSizes()) check(`UK${uk}`, insoleLayoutForUkSize(uk).scale);
        for (const mm of listFootLengthMmOptions())
            check(`${mm}mm`, insoleLayoutForFootLengthMm(mm, "mm").scale);

        const chart = rows.filter((row) => {
            const label = String(row.label);
            const size = Number(label.slice(1));
            return label.startsWith("M") && size >= 7 && size <= 13;
        });
        expect(chart.length).toBeGreaterThanOrEqual(13);
        writeFileSync("/tmp/m9-size-chart.json", JSON.stringify({ native: nativeBox, chart, rows }, null, 2));
        native.dispose();
    });

    test("M9 left and right export top sheets are 275.0 × 92.73 and match preview", async () => {
        const native = await loadNative();
        rs.spyOn(meshClose, "assertClosedSolidAcceptable").mockImplementation(() => undefined);
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.includes("SAMPLE_Top") || url === SAMPLE_TOP_PUBLIC_PATH) {
                return new Response(readFileSync(SAMPLE), { status: 200 });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof fetch;

        const layout = insoleLayoutFromDesign({ sizeSystem: "us", usMenSize: 9 });
        expect(layout.scale).toBeCloseTo(1, 6);
        const design = createDesignWithStockPlaceholder({
            ...defaultDesign(),
            sizeSystem: "us",
            usMenSize: 9,
            footLengthMm: layout.footLengthMm,
            thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        });
        const viewer = {
            transparent: false,
            heightmap: false,
            showLeft: true,
            showRight: true,
            showScans: true,
            view: "iso" as const,
            wallModel: "procedural" as const,
            wallStyle: "straight" as const,
        };
        useDesignStore.setState({ design, viewer });

        const { buildValidatedExportGeometry } = await import("@/lib/geometry/export-geometry");
        const measured = [];
        for (const side of ["left", "right"] as Side[]) {
            const field = baseModifierFieldAuthoritative(design, side, design.thicknessMm);
            const sheet = side === "left" ? native.clone() : mirrorGeometry(native);
            const preview = await reconstructProceduralPreview(
                sheet,
                printSolidOptions({ design, side, field, viewer, trimline: null, bottomPattern: null }),
            );
            const solid = await buildValidatedExportGeometry(side);
            const previewSpan = sheetSpan(preview.geometry);
            const exportSpan = sheetSpan(solid);
            expect(exportSpan.topN, side).toBeGreaterThan(1000);
            expect(exportSpan.top.length, `${side} top length`).toBeCloseTo(275, 1);
            expect(exportSpan.top.length, `${side} top length tol`).toBeGreaterThan(274.95);
            expect(exportSpan.top.length, `${side} top length tol`).toBeLessThan(275.05);
            expect(exportSpan.top.width, `${side} top width`).toBeGreaterThan(92.68);
            expect(exportSpan.top.width, `${side} top width`).toBeLessThan(92.78);
            expect(exportSpan.top.maxZ, `${side} relief`).toBeCloseTo(MAIN_M9_TOP_MAX_Z_MM, 2);
            expect(exportSpan.top.maxZ, `${side} relief not grown`).toBeLessThan(26);
            expect(
                Math.abs(previewSpan.top.length - exportSpan.top.length),
                `${side} preview L`,
            ).toBeLessThan(0.05);
            expect(Math.abs(previewSpan.top.width - exportSpan.top.width), `${side} preview W`).toBeLessThan(
                0.05,
            );
            expect(Math.abs(previewSpan.top.maxZ - exportSpan.top.maxZ), `${side} preview Z`).toBeLessThan(
                0.05,
            );
            // The closed solid is the top sheet plus the loft. It is not 275.
            expect(exportSpan.solid.length, `${side} solid`).toBeGreaterThan(275.5);
            expect(exportSpan.solid.length, `${side} solid`).toBeLessThan(277);
            measured.push({ side, preview: previewSpan, export: exportSpan });
            preview.geometry.dispose();
            solid.dispose();
        }
        writeFileSync("/tmp/m9-after.json", JSON.stringify(measured, null, 2));
        native.dispose();
    }, 300_000);
});
