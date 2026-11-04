// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { applyBaseModifiers, BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { DEFAULT_INSOLE_THICKNESS_MM, resolveInsoleThicknessOffsetMm } from "@/lib/geometry/insole-thickness";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    buildProceduralExportSolid,
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { SideCorrections } from "@/types";

const SAMPLE_TOP = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const POSTING_BASELINE = resolve(
    process.cwd(),
    "vertex/src/lib/geometry/procedural-wall/baselines/sample-top-posting-4-composed.stl.md5",
);

function neutral(): SideCorrections {
    return {
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
}

function field(insoleThicknessMm?: number): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        insoleThicknessMm,
        corrections: {
            ...neutral(),
            rearfootWedge: { side: "lateral", value: 4, unit: "deg" },
        },
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

async function loadSampleTop(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function stlMd5(geo: BufferGeometry): string {
    return createHash("md5")
        .update(Buffer.from(geometryToBinarySTL(geo)))
        .digest("hex");
}

describe("insole thickness rigid top offset", () => {
    test("legacy resolve: missing field ⇒ 0; new default design ⇒ 2 mm", () => {
        expect(resolveInsoleThicknessOffsetMm(undefined)).toBe(0);
        expect(resolveInsoleThicknessOffsetMm(null)).toBe(0);
        expect(defaultDesign().insoleThicknessMm).toBe(DEFAULT_INSOLE_THICKNESS_MM);
        useDesignStore.getState().loadDesign({
            ...defaultDesign(),
            insoleThicknessMm: undefined,
        });
        expect(useDesignStore.getState().design.insoleThicknessMm).toBe(0);
    });

    test("offset 0 keeps composed posting golden md5 pinned (c887250c…)", async () => {
        const raw = await loadSampleTop();
        const composed = await composePrintSolidTop(raw, { sourceField: field(0) });
        const withoutField = await composePrintSolidTop(raw, { sourceField: field(undefined) });
        const md5 = stlMd5(composed);
        const md5Absent = stlMd5(withoutField);
        expect(md5).toBe(md5Absent);
        const frozen = readFileSync(POSTING_BASELINE, "utf8").trim();
        expect(md5).toBe(frozen);
        composed.dispose();
        withoutField.dispose();
        raw.dispose();
    });

    test("offset 2 lifts every top vertex +2 mm; bottom plantar stays at z=0; XY unchanged", async () => {
        const raw = await loadSampleTop();
        const topN = (raw.userData as { topVertexCount: number }).topVertexCount;
        const zeroOffset = applyBaseModifiers(raw, field(0), 0, { skipBottomSync: true });
        const lifted = applyBaseModifiers(raw, field(2), 0, { skipBottomSync: true });
        const a = zeroOffset.getAttribute("position")!.array as Float32Array;
        const b = lifted.getAttribute("position")!.array as Float32Array;
        const total = a.length / 3;
        let maxTopErr = 0;
        for (let i = 0; i < topN; i++) {
            const dz = b[i * 3 + 2]! - a[i * 3 + 2]! - 2;
            maxTopErr = Math.max(maxTopErr, Math.abs(dz));
            expect(b[i * 3]! - a[i * 3]!).toBeLessThan(1e-6);
            expect(b[i * 3 + 1]! - a[i * 3 + 1]!).toBeLessThan(1e-6);
        }
        expect(maxTopErr).toBeLessThan(1e-3);
        let maxPlantar = 0;
        for (let i = topN; i < total; i++) {
            if (a[i * 3 + 2]! > 1.01) continue;
            maxPlantar = Math.max(maxPlantar, Math.abs(b[i * 3 + 2]! - a[i * 3 + 2]!));
        }
        expect(maxPlantar).toBeLessThan(1e-3);
        zeroOffset.dispose();
        lifted.dispose();
        raw.dispose();
    });

    test("offset 2 procedural solid is watertight with Euler characteristic 2", async () => {
        const raw = await loadSampleTop();
        const design = createDesignWithStockPlaceholder({
            ...defaultDesign(),
            insoleThicknessMm: 2,
            thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        });
        const fieldAuth = baseModifierFieldAuthoritative(design, "left", design.thicknessMm);
        const solid = await reconstructProceduralPreview(
            raw,
            printSolidOptions({
                design,
                side: "left",
                field: fieldAuth,
                viewer: { wallStyle: "straight" },
                trimline: null,
                bottomPattern: null,
            }),
        );
        const report = validateManifold(solid.geometry);
        expect(report.isWatertight).toBe(true);
        expect(report.eulerCharacteristic).toBe(2);
        expect(analyzeManifold(solid.geometry).openEdges).toBe(0);
        solid.geometry.dispose();
        raw.dispose();
    }, 120_000);

    test("compose pipeline applies insole lift before elements and sinks", () => {
        const src = readFileSync(
            resolve(process.cwd(), "vertex/src/lib/geometry/procedural-wall/print-solid-compose.ts"),
            "utf8",
        );
        const modifiers = src.indexOf("applyBaseModifiers(");
        const elements = src.indexOf("applyElementsToTopMeshLast");
        const sinks = src.indexOf("applyViewerSinkHeight");
        expect(modifiers).toBeGreaterThan(0);
        expect(elements).toBeGreaterThan(modifiers);
        expect(sinks).toBeGreaterThan(elements);
    });

    test("preview and export solids match at 2 mm (max vertex diff 0)", async () => {
        const raw = await loadSampleTop();
        const design = createDesignWithStockPlaceholder({
            ...defaultDesign(),
            insoleThicknessMm: 2,
            thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        });
        const fieldAuth = baseModifierFieldAuthoritative(design, "left", design.thicknessMm);
        const opts = printSolidOptions({
            design,
            side: "left",
            field: fieldAuth,
            viewer: { wallStyle: "straight" },
            trimline: null,
            bottomPattern: null,
        });
        const preview = await reconstructProceduralPreview(raw, opts);
        const exported = await buildProceduralExportSolid(opts);
        const pa = preview.geometry.getAttribute("position")!.array as Float32Array;
        const pb = exported.geometry.getAttribute("position")!.array as Float32Array;
        expect(pa.length).toBe(pb.length);
        let max = 0;
        for (let i = 0; i < pa.length; i++) {
            max = Math.max(max, Math.abs(pa[i]! - pb[i]!));
        }
        expect(max).toBe(0);
        preview.geometry.dispose();
        exported.geometry.dispose();
        raw.dispose();
    }, 180_000);

    test("viewer and export composed tops match for offset 2 (max vertex diff 0)", async () => {
        const raw = await loadSampleTop();
        const design = createDesignWithStockPlaceholder({
            ...defaultDesign(),
            insoleThicknessMm: 2,
            thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        });
        const fieldAuth = baseModifierFieldAuthoritative(design, "left", design.thicknessMm);
        expect(fieldAuth.insoleThicknessMm).toBe(2);
        const exportTop = await composePrintSolidTop(raw, { sourceField: fieldAuth });
        const viewerTop = await composePrintSolidTop(raw, {
            sourceField: baseModifierFieldAuthoritative(design, "left", design.thicknessMm),
        });
        const pa = exportTop.getAttribute("position")!.array as Float32Array;
        const pb = viewerTop.getAttribute("position")!.array as Float32Array;
        expect(pa.length).toBe(pb.length);
        let max = 0;
        for (let i = 0; i < pa.length; i++) {
            max = Math.max(max, Math.abs(pa[i]! - pb[i]!));
        }
        expect(max).toBe(0);
        exportTop.dispose();
        viewerTop.dispose();
        raw.dispose();
    });
});
