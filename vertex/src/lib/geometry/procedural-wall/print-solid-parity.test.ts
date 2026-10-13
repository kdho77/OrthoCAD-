// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { maxVertexDeltaMm, outlineExactOnBMm } from "@/lib/geometry/procedural-wall/metrics";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side, SideCorrections } from "@/types";
import { composePrintSolidTop, composeViewerPrintSolidTop } from "./print-solid-compose";
import { reconstructProceduralPreview, sampleTopFromArrayBuffer } from "./sample-top-preview";
import { polylineHausdorffMm } from "./windows-trace";

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

function field(side: Side, corrections: SideCorrections): HeightFieldParams {
    return {
        side,
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

function stlMd5(geo: BufferGeometry): string {
    return createHash("md5")
        .update(Buffer.from(geometryToBinarySTL(geo)))
        .digest("hex");
}

async function loadSampleTop(side: Side) {
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

describe("Print solid composed-top parity", () => {
    test("composeViewerPrintSolidTop STL md5 matches composePrintSolidTop", async () => {
        const raw = await loadSampleTop("right");
        const sourceField = field("right", { ...zero(), medialSkiveMm: 2 });
        const viaPrint = composePrintSolidTop(raw, { sourceField });
        const viaViewer = composeViewerPrintSolidTop({ raw, sourceField });
        expect(stlMd5(viaViewer)).toBe(stlMd5(viaPrint));
        viaPrint.dispose();
        viaViewer.dispose();
        raw.dispose();
    });

    test("loft top matches composePrintSolidTop within 0.05 mm; skive raise + S1 gates", async () => {
        const raw = await loadSampleTop("right");
        const sourceField = field("right", { ...zero(), medialSkiveMm: 4, heelLiftMm: 4 });
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
        expect((preview.geometry.userData as { loftN?: number }).loftN ?? 0).toBeGreaterThan(3);
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

        const ud = preview.geometry.userData as {
            bottomOutlineB?: Array<{ x: number; y: number }>;
            outlineRing?: Array<{ x: number; y: number }>;
        };
        const solidBottom = ud.bottomOutlineB;
        const outlineRing = ud.outlineRing;
        expect(solidBottom?.length ?? 0).toBeGreaterThan(16);
        expect(outlineExactOnBMm(preview.geometry)).toBeLessThanOrEqual(0.05);
        expect(solidBottom?.length).toBe(outlineRing?.length);

        const composedPos = composed.getAttribute("position")!;
        const plain = composePrintSolidTop(raw, { sourceField: field("right", zero()) });
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

    for (const side of ["left", "right"] as Side[]) {
        test(`viewer overlay B matches loft bottomOutlineB (Hausdorff ≤ ${PARITY_MM} mm) — ${side}`, async () => {
            const raw = await loadSampleTop(side);
            const sourceField = field(side, {
                ...zero(),
                forefootWedge: { side: "lateral", value: 4, unit: "deg" },
            });
            const preview = reconstructProceduralPreview(raw, {
                sourceField,
                composedTop: true,
                corrections: sourceField.corrections,
                wallStyle: "straight",
                scanPattern: "full_contact",
            });
            const solidBottom = (
                preview.geometry.userData as {
                    bottomOutlineB?: Array<{ x: number; y: number; z?: number }>;
                }
            ).bottomOutlineB;
            expect(solidBottom?.length ?? 0).toBeGreaterThan(16);
            const loftB = (solidBottom ?? []).map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
            expect(polylineHausdorffMm(preview.pattern, loftB)).toBeLessThanOrEqual(PARITY_MM);
            preview.geometry.dispose();
            raw.dispose();
        }, 180_000);
    }
});
