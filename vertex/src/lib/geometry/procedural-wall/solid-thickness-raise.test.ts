// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { buildExportGeometry } from "@/lib/geometry/export-geometry";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { DesignState, ProductionMethod } from "@/types";
import { composePrintSolidTop } from "./print-solid-compose";
import { resetSampleTopGeometryCache, sampleTopFromArrayBuffer } from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const THICK_MM = 6;
const LIFT_MM = THICK_MM - BASE_REFERENCE_THICKNESS_MM;

function designAt(method: ProductionMethod, thicknessMm: number): DesignState {
    const design = defaultDesign();
    design.method = method;
    design.thicknessMm = thicknessMm;
    design.shellThicknessMode = "zonal";
    return design;
}

function fieldFor(method: ProductionMethod, thicknessMm: number): HeightFieldParams {
    return baseModifierField(designAt(method, thicknessMm), "left", thicknessMm);
}

async function loadSampleTop(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function positionArray(geo: BufferGeometry): Float32Array {
    const pos = geo.getAttribute("position");
    if (!pos) throw new Error("geometry has no position");
    return pos.array as Float32Array;
}

/** Max |Δ| on x/y, and the z error against `expectedDz` (mm). */
function surfaceDelta(thin: Float32Array, thick: Float32Array, expectedDz: number) {
    const n = Math.min(thin.length, thick.length);
    let maxPlan = 0;
    let maxZErr = 0;
    let minThinZ = Infinity;
    let minThickZ = Infinity;
    for (let i = 0; i < n; i += 3) {
        maxPlan = Math.max(maxPlan, Math.abs(thick[i]! - thin[i]!), Math.abs(thick[i + 1]! - thin[i + 1]!));
        const dz = thick[i + 2]! - thin[i + 2]!;
        maxZErr = Math.max(maxZErr, Math.abs(dz - expectedDz));
        minThinZ = Math.min(minThinZ, thin[i + 2]!);
        minThickZ = Math.min(minThickZ, thick[i + 2]!);
    }
    return { count: n / 3, maxPlan, maxZErr, minThinZ, minThickZ };
}

function spanX(geo: BufferGeometry): number {
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) throw new Error("no bounds");
    return box.max.x - box.min.x;
}

describe("insole thickness raises the SAMPLE_Top sheet over the bottom pattern", () => {
    test("2 mm Solid print matches the pre-slider mesh bit for bit", async () => {
        const raw = await loadSampleTop();
        const live = fieldFor("printing_solid", BASE_REFERENCE_THICKNESS_MM);
        const legacy = { ...live, method: undefined };
        const a = await composePrintSolidTop(raw, { sourceField: live });
        const b = await composePrintSolidTop(raw, { sourceField: legacy });
        const pa = positionArray(a);
        const pb = positionArray(b);
        expect(pa.length).toBe(pb.length);
        expect(pa.length).toBeGreaterThan(1000);
        let mismatches = 0;
        for (let i = 0; i < pa.length; i++) {
            if (pa[i] !== pb[i]) mismatches++;
        }
        expect(mismatches).toBe(0);
        a.dispose();
        b.dispose();
        raw.dispose();
    }, 60_000);

    test.each([
        "printing_solid",
        "milling_3axis",
    ] as const)("%s: 6 mm lifts every top vertex 4 mm above the 2 mm sheet; planform stays put", async (method) => {
        const raw = await loadSampleTop();
        const thin = await composePrintSolidTop(raw, {
            sourceField: fieldFor(method, BASE_REFERENCE_THICKNESS_MM),
        });
        const thick = await composePrintSolidTop(raw, {
            sourceField: fieldFor(method, THICK_MM),
        });
        const delta = surfaceDelta(positionArray(thin), positionArray(thick), LIFT_MM);
        expect(delta.count).toBeGreaterThan(1000);
        expect(delta.maxPlan).toBe(0);
        expect(delta.maxZErr).toBeLessThan(1e-4);
        // Bottom pattern is the z = 0 bed. The sheet floor moves with the slider.
        expect(delta.minThickZ - delta.minThinZ).toBeCloseTo(LIFT_MM, 3);
        expect(delta.minThickZ).toBeGreaterThan(delta.minThinZ + LIFT_MM - 1e-3);
        thin.dispose();
        thick.dispose();
        raw.dispose();
    }, 60_000);

    test("printing_shell zonal controls do not take the solid-print lift", async () => {
        const raw = await loadSampleTop();
        const thin = await composePrintSolidTop(raw, {
            sourceField: fieldFor("printing_shell", BASE_REFERENCE_THICKNESS_MM),
        });
        const thick = await composePrintSolidTop(raw, {
            sourceField: fieldFor("printing_shell", THICK_MM),
        });
        const delta = surfaceDelta(positionArray(thin), positionArray(thick), 0);
        expect(delta.maxPlan).toBe(0);
        expect(delta.maxZErr).toBeLessThan(1e-4);
        thin.dispose();
        thick.dispose();
        raw.dispose();
    }, 60_000);
});

describe("export mesh uses the insole thickness slider", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        resetSampleTopGeometryCache();
        useBottomPatternStore.getState().clear();
    });

    async function exportedMesh(method: ProductionMethod, thicknessMm: number): Promise<BufferGeometry> {
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        globalThis.fetch = async () => new Response(bytes);
        resetSampleTopGeometryCache();
        useBottomPatternStore.getState().clear();
        const design = createDesignWithStockPlaceholder(designAt(method, thicknessMm));
        if (!design.paired) throw new Error("stock design has no paired bases");
        design.paired = {
            ...design.paired,
            leftThicknessMm: thicknessMm,
            rightThicknessMm: thicknessMm,
            leftMethod: method,
            rightMethod: method,
        };
        useDesignStore.setState({ design });
        return buildExportGeometry("left");
    }

    test.each([
        "printing_solid",
        "milling_3axis",
    ] as const)("%s export top sheet is 4 mm higher at 6 mm and the M9 length is unchanged", async (method) => {
        const thin = await exportedMesh(method, BASE_REFERENCE_THICKNESS_MM);
        const thick = await exportedMesh(method, THICK_MM);
        try {
            const topN = (thin.userData as { topVertexCount?: number }).topVertexCount ?? 0;
            const topNThick = (thick.userData as { topVertexCount?: number }).topVertexCount ?? 0;
            expect(topN).toBeGreaterThan(1000);
            expect(topNThick).toBe(topN);
            const a = positionArray(thin);
            const b = positionArray(thick);
            let maxPlan = 0;
            let maxZErr = 0;
            for (let i = 0; i < topN; i++) {
                maxPlan = Math.max(
                    maxPlan,
                    Math.abs(b[i * 3]! - a[i * 3]!),
                    Math.abs(b[i * 3 + 1]! - a[i * 3 + 1]!),
                );
                maxZErr = Math.max(maxZErr, Math.abs(b[i * 3 + 2]! - a[i * 3 + 2]! - LIFT_MM));
            }
            expect(maxPlan).toBe(0);
            expect(maxZErr).toBeLessThan(1e-3);

            // Generated plantar plate stays on the z=0 bed. Wall rows are
            // a fraction of rim height, so pairing them by index moves.
            const plate = (geo: BufferGeometry) =>
                geo.userData as { plantarAbsMaxZ?: number; meshMinZ?: number };
            expect(plate(thin).plantarAbsMaxZ ?? 1).toBeLessThan(0.05);
            expect(plate(thick).plantarAbsMaxZ ?? 1).toBeLessThan(0.05);
            expect(plate(thick).meshMinZ ?? 1).toBeLessThan(0.05);
            expect(plate(thin).meshMinZ ?? 1).toBeLessThan(0.05);

            // Default 2 mm geometry is unchanged, so the M9 footprint length
            // stays put. A taller wall may flare the solid bounds slightly;
            // the top sheet planform above is identical.
            const lengthThin = spanX(thin);
            const lengthThick = spanX(thick);
            expect(Math.abs(lengthThick - lengthThin)).toBeLessThan(0.25);
            expect(lengthThin).toBeGreaterThan(270);
            expect(lengthThin).toBeLessThan(276);
        } finally {
            thin.dispose();
            thick.dispose();
        }
    }, 240_000);
});
