// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM, getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { weldAndLabelComponents } from "@/lib/geometry/scan-components";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { defaultElementPose } from "@/lib/geometry/elements";
import type { ElementKind, PlacedElement, SideCorrections } from "@/types";
import { applyElementsToTopMeshLast } from "./apply-elements";
import { assertElementAssetBytes, isHtmlAssetPayload, resolvePlacedAssetContexts } from "./element-asset";
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

async function loadSampleTop(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function fieldFor(raw: BufferGeometry, el: PlacedElement): HeightFieldParams {
    const frame = getBaseFootprintFrame(raw, "right");
    return {
        side: "right",
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

function maxZ(geo: BufferGeometry): number {
    const pos = geo.getAttribute("position")!;
    let max = -Infinity;
    for (let i = 0; i < pos.count; i++) max = Math.max(max, pos.getZ(i));
    return max;
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
        const baseCount = baseline.getAttribute("position")!.count;
        const baseMaxZ = maxZ(baseline);
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

            const count = composed.getAttribute("position")!.count;
            const z = maxZ(composed);
            const stl = stlDigest(viaCompose);
            const composeZ = maxZ(viaCompose);

            expect(count).toBeGreaterThan(baseCount);
            expect(z).toBeGreaterThan(baseMaxZ + 0.4);
            expect(composeZ).toBeGreaterThan(baseMaxZ + 0.4);
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
});
