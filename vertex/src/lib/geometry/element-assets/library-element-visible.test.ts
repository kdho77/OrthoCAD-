// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM, getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { weldAndLabelComponents } from "@/lib/geometry/scan-components";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { defaultElementPose } from "@/lib/geometry/elements";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { ElementKind, PlacedElement, Side, SideCorrections } from "@/types";
import { applyElementsToTopMeshLast } from "./apply-elements";
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
): Promise<{ maxDz: number; nInside: number; gridMaxZ: number; footprintAreaMm2: number }> {
    const ctx = await resolvePlacedAssetContexts([el], el.side, 1, 1, base);
    expect(ctx.length).toBe(1);
    const { grid } = await loadTransformedAssetPositions(ctx[0]!.assetId, ctx[0]!.transform);
    const anchor = anchorMmFromPlacement(base, el.side, el.position.x, el.position.y);
    const ta = anchor.frame.thickAxis;
    const a = base.getAttribute("position")!.array as Float32Array;
    const b = composed.getAttribute("position")!.array as Float32Array;
    let maxDz = 0;
    let nInside = 0;
    let occupied = 0;
    for (let i = 0; i < grid.z.length; i++) {
        const z = grid.z[i]!;
        if (Number.isFinite(z) && z >= 0.05) occupied++;
    }
    for (let i = 0; i < a.length / 3; i++) {
        const h = sampleGridBilinear(grid, a[i * 3]! - anchor.x, a[i * 3 + 1]! - anchor.y);
        if (h <= 1e-9) continue;
        nInside++;
        maxDz = Math.max(maxDz, b[i * 3 + ta]! - a[i * 3 + ta]!);
    }
    return {
        maxDz,
        nInside,
        gridMaxZ: grid.maxZ,
        footprintAreaMm2: occupied * grid.cellMm * grid.cellMm,
    };
}

function stlDigest(geo: BufferGeometry): string {
    return createHash("sha256").update(Buffer.from(geometryToBinarySTL(geo))).digest("hex");
}

describe("library element visible placement", () => {
    test("HTML payload is rejected so SPA index.html cannot be parsed as a GLB", () => {
        const html = new TextEncoder().encode("<!doctype html><html lang=\"en\"><title>Vertex</title>");
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

    test("Met pad 1 and Cluffy wedge 1 peak Δz equals default height ±0.2 mm on L and R", async () => {
        const cases: { kind: ElementKind; expectedMm: number }[] = [
            { kind: "met_pad", expectedMm: 5.0 },
            { kind: "cluffy_wedge", expectedMm: 2.4 },
        ];
        for (const spec of cases) {
            for (const side of ["right", "left"] as Side[]) {
                const raw = await loadSampleTop(side);
                const pose = defaultElementPose(spec.kind, side, INSOLE_LENGTH_MM, INSOLE_WIDTH_MM);
                const placed: PlacedElement = { id: `${spec.kind}-${side}`, kind: spec.kind, side, ...pose };
                const field = fieldFor(raw, placed);
                const composed = raw.clone();
                await applyElementsToTopMeshLast(composed, raw, field);
                const local = await maxDeltaZInsideFootprint(raw, composed, placed);
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
                expect(local.maxDz).toBeGreaterThan(spec.expectedMm - 0.2);
                expect(local.maxDz).toBeLessThan(spec.expectedMm + 0.2);

                const viaCompose = await composePrintSolidTop(raw, { sourceField: field });
                expect(weldAndLabelComponents(viaCompose).components).toHaveLength(1);

                composed.dispose();
                viaCompose.dispose();
                raw.dispose();
            }
        }
    }, 300_000);
});
