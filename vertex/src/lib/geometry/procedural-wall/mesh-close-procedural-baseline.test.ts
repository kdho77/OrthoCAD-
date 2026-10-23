// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { defaultElementPose } from "@/lib/geometry/elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    assertClosedSolidAcceptable,
    closeGlbInsoleToSolid,
    DEFAULT_GLB_CLOSED_BASELINE,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { defaultSideShapeFinish } from "@/lib/geometry/shape-finish-modifiers";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import type { PlacedElement, Side, SideCorrections } from "@/types";
import { reconstructProceduralPreview, sampleTopFromArrayBuffer } from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function zero(): SideCorrections {
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

function dancer(side: Side, lengthMm: number, widthMm: number): PlacedElement {
    return {
        id: `dancer-${side}`,
        kind: "dancers_pad",
        side,
        hardnessClass: "Extra Soft",
        ...defaultElementPose("dancers_pad", side, lengthMm, widthMm),
    };
}

async function loadSampleTop(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

interface LoftReport {
    verts: number;
    edges: number;
    tris: number;
    euler: number;
    watertight: boolean;
    openEdges: number;
    nonManifold: number;
    topVertexCount: number;
    wallModel: string | null;
    exportError: string | null;
}

/**
 * Same gate as `buildExportStl` after the procedural loft: close, then the
 * Default.glb baseline whenever `topVertexCount > 0`.
 */
function exportGateError(geometry: BufferGeometry): string | null {
    const solid = closeGlbInsoleToSolid(geometry);
    try {
        const topN = (solid.userData as { topVertexCount?: number }).topVertexCount ?? 0;
        assertClosedSolidAcceptable(solid, topN, topN > 0 ? DEFAULT_GLB_CLOSED_BASELINE : null);
        return null;
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    } finally {
        solid.dispose();
    }
}

async function loft(raw: BufferGeometry, withPad: boolean): Promise<LoftReport> {
    const layout = insoleLayoutForUsMenSize(8.5);
    const side: Side = "right";
    const field: HeightFieldParams = {
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zero(),
        elements: withPad ? [dancer(side, layout.lengthMm, layout.widthMm)] : [],
        includeSkives: false,
        includeElements: true,
        trimline: null,
        shapeFinish: defaultSideShapeFinish("printing_solid"),
    };
    const preview = await reconstructProceduralPreview(raw, {
        corrections: field.corrections,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
        wallStyle: "hybrid",
        scanPattern: "full_contact",
        side,
        sourceField: field,
        composedTop: true,
        shoeWidth: {
            width: "medium",
            ballWidthMm: layout.widthMm,
            heelWidthMm: layout.widthMm * 0.62,
        },
        trimline: null,
    });
    const geo = preview.geometry;
    try {
        const pre = validateManifold(geo);
        const ud = geo.userData as { topVertexCount?: number; wallModel?: string };
        return {
            verts: pre.vertexCount,
            edges: pre.edgeCount,
            tris: pre.triangleCount,
            euler: pre.eulerCharacteristic,
            watertight: pre.isWatertight,
            openEdges: pre.openEdges,
            nonManifold: pre.nonManifoldEdges,
            topVertexCount: ud.topVertexCount ?? 0,
            wallModel: ud.wallModel ?? null,
            exportError: exportGateError(geo),
        };
    } finally {
        geo.dispose();
    }
}

describe("MESH-CLOSE euler baseline on a procedural solid", () => {
    test("US M8.5 Medium Full Contact export accepts a closed genus-0 loft with or without dancers_pad", async () => {
        const raw = await loadSampleTop();
        try {
            const withPad = await loft(raw, true);
            const noPad = await loft(raw, false);

            expect(withPad.wallModel).toBe("procedural");
            expect(withPad.topVertexCount).toBeGreaterThan(0);
            expect(withPad.euler).toBe(2);
            expect(withPad.watertight).toBe(true);
            expect(withPad.openEdges).toBe(0);
            expect(withPad.nonManifold).toBe(0);
            expect(withPad.verts - withPad.edges + withPad.tris).toBe(2);

            expect(noPad.euler).toBe(2);
            expect(noPad.watertight).toBe(true);
            expect(noPad.openEdges).toBe(0);
            expect(noPad.verts).toBe(withPad.verts);
            expect(noPad.edges).toBe(withPad.edges);
            expect(noPad.tris).toBe(withPad.tris);

            expect(DEFAULT_GLB_CLOSED_BASELINE.eulerCharacteristic).toBe(3);
            expect(withPad.exportError).toBeNull();
            expect(noPad.exportError).toBeNull();
        } finally {
            raw.dispose();
        }
    });
});
