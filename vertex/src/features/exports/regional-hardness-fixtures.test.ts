// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Real Export G-code solids: US M9 SAMPLE_Top, leader block, Medium base,
// Soft met pad (element, only while Split elements is on), Extra Soft heel zone.
// Regenerate with vertex/scripts/regenerate-regional-hardness-fixtures.mjs.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import { buildVertexSliceModel } from "@/features/exports/vertexslice-regional-model";
import { defaultElementPose } from "@/lib/geometry/elements";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { readPackedHardness3mf } from "@/lib/hardness/export-3mf";
import { BOTTOM_CLAMP_MM, type TriangleMesh } from "@/lib/hardness/mesh";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { PlacedElement, Side } from "@/types";
import { migratePrintRecipe } from "../../../shared/print-recipe/print-recipe";

const FIXTURE_DIR = resolve("vertex/tests/fixtures/regional-hardness");
const LEFT_NAME = "Sample_Patient_ApexCore_L.3mf";
const RIGHT_NAME = "Sample_Patient_ApexCore_R.3mf";

function installSampleTopFetch(): void {
    const glb = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
    const font = readFileSync(resolve("vertex/public/fonts/Inter-Bold.ttf"));
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        const bytes = url.includes(".ttf") || url.toLowerCase().includes("font") ? font : glb;
        return new Response(bytes);
    }) as typeof fetch;
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
}

function heelZone(side: Side) {
    return {
        regionId: `heel-${side}`,
        kind: "zone" as const,
        hardnessClass: "Extra Soft" as const,
        priority: 1,
        depth: { type: "mm" as const, mm: 1 },
        side,
        label: `heel-${side}`,
        polygon: [
            { x: 36, y: -10 },
            { x: 78, y: -10 },
            { x: 78, y: 10 },
            { x: 36, y: 10 },
        ],
    };
}

function metPad(side: Side, lengthMm: number, widthMm: number): PlacedElement {
    const pose = defaultElementPose("met_pad", side, lengthMm, widthMm);
    return {
        id: `met-pad-${side}`,
        kind: "met_pad",
        side,
        ...pose,
        regionId: `met-pad-${side}`,
        hardnessClass: "Soft",
        priority: 2,
        depth: { type: "element", depthBelowMm: 2 },
        customName: `met-pad-${side}`,
    };
}

/** US M9 stock insole, Split elements on, Soft met pads, Extra Soft heel zones. */
function installM9RegionalDesign(): void {
    const design = createDesignWithStockPlaceholder();
    const layout = insoleLayoutFromDesign(design);
    const recipe = migratePrintRecipe(design.printRecipe);
    design.method = "printing_solid";
    design.splitElements = true;
    design.usMenSize = 9;
    design.elements = [
        metPad("left", layout.lengthMm, layout.widthMm),
        metPad("right", layout.lengthMm, layout.widthMm),
    ];
    design.printRecipe = {
        ...recipe,
        defaultHardness: "Medium",
        zones: [heelZone("left"), heelZone("right")],
    };
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({ design, viewer: { ...viewer, wallModel: "procedural" } });
}

function triZ(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    x: number,
    y: number,
): { z: number; nz: number } | null {
    const abx = bx - ax;
    const aby = by - ay;
    const acx = cx - ax;
    const acy = cy - ay;
    const nz = abx * acy - aby * acx;
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) < 1e-9) return null;
    const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom;
    const wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom;
    const wc = 1 - wa - wb;
    if (wa < -1e-3 || wb < -1e-3 || wc < -1e-3) return null;
    return { z: wa * az + wb * bz + wc * cz, nz };
}

function hitsAt(mesh: TriangleMesh, x: number, y: number): Array<{ z: number; nz: number }> {
    const out: Array<{ z: number; nz: number }> = [];
    const p = mesh.positions;
    const idx = mesh.indices;
    for (let t = 0; t < idx.length; t += 3) {
        const ia = idx[t]! * 3;
        const ib = idx[t + 1]! * 3;
        const ic = idx[t + 2]! * 3;
        const hit = triZ(
            p[ia]!,
            p[ia + 1]!,
            p[ia + 2]!,
            p[ib]!,
            p[ib + 1]!,
            p[ib + 2]!,
            p[ic]!,
            p[ic + 1]!,
            p[ic + 2]!,
            x,
            y,
        );
        if (hit) out.push(hit);
    }
    return out;
}

export interface RegionMeasure {
    name: string;
    hardnessClass: string;
    density: string;
    pattern: string;
    depth: string;
    samples: number;
    shellHits: number;
    meanTopDeltaMm: number;
    meanDepthBelowLoftMm: number;
    minZ: number;
    maxZ: number;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

function meshBbox(mesh: TriangleMesh): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    minZ: number;
    maxZ: number;
} {
    const p = mesh.positions;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
        minX = Math.min(minX, p[i]!);
        minY = Math.min(minY, p[i + 1]!);
        minZ = Math.min(minZ, p[i + 2]!);
        maxX = Math.max(maxX, p[i]!);
        maxY = Math.max(maxY, p[i + 1]!);
        maxZ = Math.max(maxZ, p[i + 2]!);
    }
    return { minX, minY, maxX, maxY, minZ, maxZ };
}

/** Modifier samples against the loft shell stored in the same 3MF. */
export function measureModifier(
    shell: TriangleMesh,
    modifier: TriangleMesh,
    meta: Omit<
        RegionMeasure,
        "samples" | "shellHits" | "meanTopDeltaMm" | "meanDepthBelowLoftMm" | "minZ" | "maxZ" | "bbox"
    >,
): RegionMeasure {
    const box = meshBbox(modifier);
    let samples = 0;
    let shellHits = 0;
    let topSum = 0;
    let depthSum = 0;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let x = box.minX; x <= box.maxX; x += 4) {
        for (let y = box.minY; y <= box.maxY; y += 4) {
            const modHits = hitsAt(modifier, x, y);
            if (modHits.length < 2) continue;
            samples += 1;
            const modTop = Math.max(...modHits.map((hit) => hit.z));
            const modBot = Math.min(...modHits.map((hit) => hit.z));
            minZ = Math.min(minZ, modBot);
            maxZ = Math.max(maxZ, modTop);
            const shellHitsHere = hitsAt(shell, x, y).filter((hit) => hit.nz > 0);
            if (shellHitsHere.length === 0) continue;
            const shellTop = Math.max(...shellHitsHere.map((hit) => hit.z));
            shellHits += 1;
            topSum += modTop - shellTop;
            depthSum += shellTop - modBot;
        }
    }
    return {
        ...meta,
        samples,
        shellHits,
        meanTopDeltaMm: shellHits > 0 ? topSum / shellHits : Number.NaN,
        meanDepthBelowLoftMm: shellHits > 0 ? depthSum / shellHits : Number.NaN,
        minZ,
        maxZ,
        bbox: { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY },
    };
}

async function buildFixture(side: Side): Promise<Uint8Array> {
    const built = await buildPrinterFootManufacturingStl(side, true);
    const model = await buildVertexSliceModel({
        design: useDesignStore.getState().design,
        side,
        manufacturingStl: built.stl,
        stlFilename: `${side}.stl`,
        regional3mfEnabled: true,
    });
    if (model.contentType !== "model/3mf") {
        throw new Error(`${side} fixture was not a 3MF`);
    }
    return model.bytes;
}

describe("regional hardness production fixtures", () => {
    test("left and right M9 3MF modifiers overlap the loft", async () => {
        if (process.env.REGENERATE_REGIONAL_FIXTURES === "1") {
            installSampleTopFetch();
            installM9RegionalDesign();
            mkdirSync(FIXTURE_DIR, { recursive: true });
            writeFileSync(resolve(FIXTURE_DIR, LEFT_NAME), await buildFixture("left"));
            writeFileSync(resolve(FIXTURE_DIR, RIGHT_NAME), await buildFixture("right"));
        }

        const files = [
            ["left", LEFT_NAME],
            ["right", RIGHT_NAME],
        ] as const;
        const report: Record<string, unknown> = {};
        for (const [side, name] of files) {
            const bytes = new Uint8Array(readFileSync(resolve(FIXTURE_DIR, name)));
            const packed = await readPackedHardness3mf(bytes);
            const shellBox = meshBbox(packed.shell);
            const measures = packed.modifiers.map((part) =>
                measureModifier(packed.shell, part.mesh, {
                    name: part.name,
                    hardnessClass: part.hardnessClass,
                    density: part.density,
                    pattern: part.pattern,
                    depth: part.depth,
                }),
            );
            report[side] = { file: name, shell: shellBox, regions: measures };
            console.log(`REGIONAL_FIXTURE_MEASURE ${side} ${JSON.stringify(report[side])}`);
            expect(shellBox.maxX).toBeGreaterThan(280);
            expect(shellBox.maxX).toBeLessThan(300);
            expect(packed.modifiers.map((part) => part.density).sort()).toEqual(["14%", "20%"]);
            expect(packed.modifiers.every((part) => part.pattern === "gyroid")).toBe(true);
            for (const region of measures) {
                expect(region.shellHits).toBe(region.samples);
                expect(region.samples).toBeGreaterThan(20);
                expect(region.minZ).toBeGreaterThan(BOTTOM_CLAMP_MM + 0.2);
                expect(region.bbox.minX).toBeGreaterThan(shellBox.minX - 1);
                expect(region.bbox.maxX).toBeLessThan(shellBox.maxX - 15);
                const depth = JSON.parse(region.depth) as { type: string; mm?: number };
                // Modifier top is samplerTop + 0.5mm. A negative top delta means the
                // production loft sits above that sampler. Measured 2026-11-12:
                // heel ≈ −1.0mm (loft about 1.5mm above the sampler), met pad ≈ −4.5mm
                // (loft about 5mm above the sampler). The met-pad mesh therefore
                // reaches Z=0 even though its spec is only 2mm below the sampler base.
                if (depth.type === "mm") {
                    expect(region.meanTopDeltaMm).toBeGreaterThan(-1.3);
                    expect(region.meanTopDeltaMm).toBeLessThan(-0.7);
                    expect(region.meanDepthBelowLoftMm).toBeGreaterThan(2.2);
                    expect(region.meanDepthBelowLoftMm).toBeLessThan(2.8);
                    expect(region.minZ).toBeGreaterThan(0.8);
                }
                if (depth.type === "element") {
                    expect(region.meanTopDeltaMm).toBeGreaterThan(-5.2);
                    expect(region.meanTopDeltaMm).toBeLessThan(-4.1);
                    expect(region.meanDepthBelowLoftMm).toBeGreaterThan(9.2);
                    expect(region.meanDepthBelowLoftMm).toBeLessThan(10.1);
                    expect(region.minZ).toBeLessThan(0.05);
                }
            }
        }
    }, 600_000);
});
