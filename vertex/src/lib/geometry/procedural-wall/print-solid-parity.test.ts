// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { maxVertexDeltaMm } from "@/lib/geometry/procedural-wall/metrics";
import type { SideCorrections } from "@/types";
import { composePrintSolidTop } from "./print-solid-compose";
import { reconstructProceduralPreview, sampleTopFromArrayBuffer } from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const PARITY_MM = 0.05;

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

function field(corrections: SideCorrections): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections,
        elements: [],
        includeSkives: false,
        includeElements: true,
        trimline: null,
        shapeFinish: {
            topCoverAccommodateMm: 1.25,
            trimmableForefoot: true,
            trimmableForefootExtraMm: 5,
            archGrindDepthMm: 0,
            archSkiveMm: 0,
            archSkiveSide: "medial",
        },
    };
}

async function loadSampleTop() {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe("Print solid composed-top parity", () => {
    test("loft top matches composePrintSolidTop within 0.05 mm; skive raise + S1 gates", async () => {
        const raw = await loadSampleTop();
        const sourceField = field({ ...zero(), medialSkiveMm: 4, heelLiftMm: 4 });
        const composed = composePrintSolidTop(raw, { sourceField });
        const preview = reconstructProceduralPreview(raw, {
            sourceField,
            composedTop: true,
            corrections: sourceField.corrections,
            wallStyle: "straight",
            scanPattern: "full_contact",
        });
        const topN = (preview.geometry.userData as { topVertexCount?: number }).topVertexCount ?? 0;
        const sourcePos = preview.model.top.meshPositions;
        const loftPos = preview.geometry.getAttribute("position")!;
        expect(sourcePos).toBeTruthy();
        expect(topN).toBeGreaterThan(1000);
        expect(preview.geometry.userData.composedTop).toBe(true);
        expect((preview.geometry.userData as { stationCount?: number }).stationCount ?? 0).toBeGreaterThan(3);
        expect(preview.geometry.userData.inwardWallFaces ?? 0).toBe(0);
        expect(preview.geometry.userData.columnCrossings ?? 0).toBe(0);

        const n = Math.min(topN, (sourcePos!.length / 3) | 0, loftPos.count);
        const a = sourcePos!.subarray(0, n * 3);
        const b = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            b[i * 3] = loftPos.getX(i);
            b[i * 3 + 1] = loftPos.getY(i);
            b[i * 3 + 2] = loftPos.getZ(i);
        }
        expect(maxVertexDeltaMm(a, b)).toBeLessThanOrEqual(PARITY_MM);

        const composedPos = composed.getAttribute("position")!;
        const plain = composePrintSolidTop(raw, { sourceField: field(zero()) });
        const pPos = plain.getAttribute("position")!;
        let maxSkive = 0;
        composed.computeBoundingBox();
        const minX = composed.boundingBox?.min.x ?? 0;
        const maxX = composed.boundingBox?.max.x ?? 1;
        for (let i = 0; i < Math.min(pPos.count, composedPos.count); i++) {
            const u = (composedPos.getX(i) - minX) / Math.max(1e-3, maxX - minX);
            if (u > 0.28 || composedPos.getY(i) > 0) continue;
            maxSkive = Math.max(maxSkive, composedPos.getZ(i) - pPos.getZ(i));
        }
        expect(maxSkive).toBeGreaterThan(0.4);

        preview.geometry.dispose();
        composed.dispose();
        plain.dispose();
        raw.dispose();
    }, 180_000);
});
