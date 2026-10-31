// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    BASE_REFERENCE_THICKNESS_MM,
    getBaseFootprintFrame,
    vertexFootprintAt,
} from "@/lib/geometry/base-modifier";
import { defaultElementPose } from "@/lib/geometry/elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { weldAndLabelComponents } from "@/lib/geometry/scan-components";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { ElementKind, PlacedElement, Side, SideCorrections } from "@/types";
import { applyElementsToTopMeshLast, rimBandFadeFactor } from "./apply-elements";
import {
    assertElementAssetBytes,
    isHtmlAssetPayload,
    loadTransformedAssetPositions,
    resolvePlacedAssetContexts,
} from "./element-asset";
import { sampleGridBilinear } from "./height-grid";
import { anchorMmFromPlacement } from "./no-flow-blend";
import { LIBRARY_HEIGHT_FIELD_KINDS } from "./types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function zero(): SideCorrections {
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

async function loadSampleTop(side: Side = "right"): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "left") {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    return raw;
}

function fieldFor(raw: BufferGeometry, el: PlacedElement): HeightFieldParams {
    const frame = getBaseFootprintFrame(raw, el.side);
    return {
        side: el.side,
        lengthMm: frame.lenSize,
        widthMm: frame.widSize,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zero(),
        elements: [el],
        includeSkives: false,
        includeElements: true,
        trimline: null,
    };
}

/** Max composed-vs-base Δz (mm) on vertices that sample the asset footprint. */
async function maxDeltaZInsideFootprint(
    base: BufferGeometry,
    composed: BufferGeometry,
    el: PlacedElement,
    flowField?: HeightFieldParams,
): Promise<{
    maxDz: number;
    nInside: number;
    gridMaxZ: number;
    footprintAreaMm2: number;
    sampledMaxZ: number;
    expectedFlowMaxDz: number;
    maxFlowError: number;
}> {
    const ctx = await resolvePlacedAssetContexts([el], el.side, 1, 1, base);
    expect(ctx.length).toBe(1);
    const { grid } = await loadTransformedAssetPositions(ctx[0]!.assetId, ctx[0]!.transform);
    const anchor = anchorMmFromPlacement(base, el.side, el.position.x, el.position.y);
    const ta = anchor.frame.thickAxis;
    const a = base.getAttribute("position")!.array as Float32Array;
    const b = composed.getAttribute("position")!.array as Float32Array;
    let maxDz = 0;
    let sampledMaxZ = 0;
    let expectedFlowMaxDz = 0;
    let maxFlowError = 0;
    let nInside = 0;
    let occupied = 0;
    for (let i = 0; i < grid.z.length; i++) {
        const z = grid.z[i]!;
        if (Number.isFinite(z) && z >= 0.05) occupied++;
    }
    for (let i = 0; i < a.length / 3; i++) {
        const h = sampleGridBilinear(grid, a[i * 3]! - anchor.x, a[i * 3 + 1]! - anchor.y);
        if (flowField) {
            const { u, vSigned } = vertexFootprintAt(anchor.frame, a, i);
            // Cluffy has zero additional edge feather: the authored GLB height
            // is attenuated only by the existing insole rim blend.
            const expected = h * rimBandFadeFactor(u, vSigned, flowField);
            expectedFlowMaxDz = Math.max(expectedFlowMaxDz, expected);
            maxFlowError = Math.max(maxFlowError, Math.abs(b[i * 3 + ta]! - a[i * 3 + ta]! - expected));
        }
        sampledMaxZ = Math.max(sampledMaxZ, h);
        if (h <= 1e-9) continue;
        nInside++;
        maxDz = Math.max(maxDz, b[i * 3 + ta]! - a[i * 3 + ta]!);
    }
    return {
        maxDz,
        sampledMaxZ,
        expectedFlowMaxDz,
        maxFlowError,
        nInside,
        gridMaxZ: grid.maxZ,
        footprintAreaMm2: occupied * grid.cellMm * grid.cellMm,
    };
}

function stlDigest(geo: BufferGeometry): string {
    return createHash("sha256")
        .update(Buffer.from(geometryToBinarySTL(geo)))
        .digest("hex");
}

describe("library element visible placement", () => {
    test("HTML payload is rejected so SPA index.html cannot be parsed as a GLB", () => {
        const html = new TextEncoder().encode('<!doctype html><html lang="en"><title>Vertex</title>');
        expect(isHtmlAssetPayload(html)).toBe(true);
        expect(() => assertElementAssetBytes("new_element_2.right.glb", html)).toThrow(/HTML/);
        const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]);
        expect(isHtmlAssetPayload(glb)).toBe(false);
    });

    test("adding each library element increases mesh, heightmap, and exported STL", async () => {
        const raw = await loadSampleTop();
        const kinds = LIBRARY_HEIGHT_FIELD_KINDS as readonly ElementKind[];
        expect(kinds).toHaveLength(6);

        const emptyField = fieldFor(raw, {
            id: "none",
            kind: "met_pad",
            side: "right",
            position: { x: 0, y: 0 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 0,
            placementMode: "flow",
        });
        const baseline = await composePrintSolidTop(raw, {
            sourceField: { ...emptyField, elements: [], includeElements: false },
        });
        const baseStl = stlDigest(baseline);

        for (const kind of kinds) {
            const pose = defaultElementPose(kind, "right", emptyField.lengthMm, emptyField.widthMm);
            const placed: PlacedElement = { id: kind, kind, side: "right", ...pose };
            const ctx = await resolvePlacedAssetContexts([placed], "right", 1, 1, raw);
            expect(ctx.length).toBe(1);
            const field = fieldFor(raw, placed);
            const composed = raw.clone();
            await applyElementsToTopMeshLast(composed, raw, field);
            const viaCompose = await composePrintSolidTop(raw, { sourceField: field });

            const local = await maxDeltaZInsideFootprint(raw, composed, placed);
            const stl = stlDigest(viaCompose);
            expect(local.nInside).toBeGreaterThan(20);
            expect(local.maxDz).toBeGreaterThan(0.4);
            expect(stl).not.toBe(baseStl);

            // Height-field lift only — no disconnected coin/cylinder shell.
            const labeled = weldAndLabelComponents(viaCompose);
            expect(labeled.components).toHaveLength(1);

            composed.dispose();
            viaCompose.dispose();
        }

        baseline.dispose();
        raw.dispose();
    }, 300_000);

    test("Met pad and Cluffy preserve authored height and apply the print rim blend at their default anchors", async () => {
        const cases: { kind: ElementKind; expectedMm: number }[] = [
            { kind: "met_pad", expectedMm: 5.0 },
            { kind: "cluffy_wedge", expectedMm: 2.4 },
        ];
        for (const spec of cases) {
            for (const side of ["right", "left"] as Side[]) {
                const raw = await loadSampleTop(side);
                const frame = getBaseFootprintFrame(raw, side);
                const pose = defaultElementPose(spec.kind, side, frame.lenSize, frame.widSize);
                const placed: PlacedElement = { id: `${spec.kind}-${side}`, kind: spec.kind, side, ...pose };
                const field = fieldFor(raw, placed);
                const composed = raw.clone();
                await applyElementsToTopMeshLast(composed, raw, field);
                const local = await maxDeltaZInsideFootprint(
                    raw,
                    composed,
                    placed,
                    spec.kind === "cluffy_wedge" ? field : undefined,
                );
                console.log("PEAK-DZ", spec.kind, side, {
                    expectedMm: spec.expectedMm,
                    gridMaxZ: local.gridMaxZ,
                    maxDz: local.maxDz,
                    nInside: local.nInside,
                    footprintAreaMm2: local.footprintAreaMm2,
                });
                expect(local.nInside).toBeGreaterThan(20);
                expect(local.gridMaxZ).toBeGreaterThan(spec.expectedMm - 0.05);
                expect(local.gridMaxZ).toBeLessThan(spec.expectedMm + 0.05);
                expect(local.sampledMaxZ).toBeGreaterThan(spec.expectedMm - 0.2);
                expect(local.maxDz).toBeGreaterThan(0.4);
                if (spec.kind === "cluffy_wedge") {
                    expect(local.maxDz).toBeCloseTo(local.expectedFlowMaxDz, 4);
                    expect(local.maxFlowError).toBeLessThan(0.00001);
                    // The approved medial hallux anchor lies in the print rim blend.
                    // It must not be moved laterally or inflated to bypass that blend.
                    expect(placed.position.y * (side === "right" ? 1 : -1)).toBeGreaterThan(0);
                    expect(local.maxDz).toBeLessThan(local.sampledMaxZ - 0.1);
                } else {
                    expect(local.maxDz).toBeGreaterThan(spec.expectedMm - 0.2);
                    expect(local.maxDz).toBeLessThan(spec.expectedMm + 0.2);
                }

                // Away from the rim, the same asset must deliver its full requested
                // height. This independently guards against height loss or rescaling.
                const interior = { ...placed, position: { ...placed.position, y: 0 } };
                const interiorMesh = raw.clone();
                await applyElementsToTopMeshLast(interiorMesh, raw, fieldFor(raw, interior));
                const interiorPeak = await maxDeltaZInsideFootprint(raw, interiorMesh, interior);
                expect(interiorPeak.maxDz).toBeGreaterThan(spec.expectedMm - 0.2);
                expect(interiorPeak.maxDz).toBeLessThan(spec.expectedMm + 0.2);
                interiorMesh.dispose();

                const viaCompose = await composePrintSolidTop(raw, { sourceField: field });
                expect(weldAndLabelComponents(viaCompose).components).toHaveLength(1);

                composed.dispose();
                viaCompose.dispose();
                raw.dispose();
            }
        }
    }, 300_000);
});
