// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import type { SideCorrections } from "@/types";
import { applyInsoleFootprintScale, insoleFootprintAnchorFromBounds } from "./pattern-hygiene";
import {
    applySharedSizeXY,
    composePrintSolidTop,
    type SharedInsoleSizeTransform,
    sharedInsoleSizeTransformFromGeometry,
} from "./print-solid-compose";
import { reconstructProceduralPreview, sampleTopFromArrayBuffer } from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const SIZES = [1, 8.5, 16] as const;

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

function field(lengthMm: number, widthMm: number): HeightFieldParams {
    return {
        side: "left",
        lengthMm,
        widthMm,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zero(),
        elements: [],
        includeSkives: false,
        includeElements: true,
        trimline: null,
    };
}

async function loadSampleTop() {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function bbox(geo: {
    computeBoundingBox: () => void;
    boundingBox: { min: { x: number; y: number }; max: { x: number; y: number } } | null;
}) {
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) throw new Error("no bounds");
    return {
        minX: box.min.x,
        maxX: box.max.x,
        minY: box.min.y,
        maxY: box.max.y,
        length: box.max.x - box.min.x,
        width: box.max.y - box.min.y,
    };
}

/** Column-major XY affine of #204's pattern transform. Identity scales do not shift. */
function patternMatrix(
    lengthMm: number,
    widthMm: number,
    anchor: {
        x0: number;
        yMid: number;
        nativeLengthMm: number;
        nativeWidthMm: number;
    },
): Float64Array {
    const sx = lengthMm / anchor.nativeLengthMm;
    const sy = widthMm / anchor.nativeWidthMm;
    if (Math.abs(sx - 1) < 1e-12 && Math.abs(sy - 1) < 1e-12) {
        return new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }
    return new Float64Array([sx, 0, -anchor.x0 * sx, 0, sy, -anchor.yMid * sy, 0, 0, 1]);
}

function sharedMatrix(t: SharedInsoleSizeTransform): Float64Array {
    if (Math.abs(t.sx - 1) < 1e-12 && Math.abs(t.sy - 1) < 1e-12) {
        return new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }
    return new Float64Array([t.sx, 0, -t.x0 * t.sx, 0, t.sy, -t.yMid * t.sy, 0, 0, 1]);
}

function sameBytes(a: Float64Array, b: Float64Array): boolean {
    return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
        Buffer.from(b.buffer, b.byteOffset, b.byteLength),
    );
}

describe("shared size transform on composed SAMPLE_Top", () => {
    test("M1, M8.5 and M16 match the size table and #204's pattern matrix", async () => {
        const raw = await loadSampleTop();
        const native = bbox(raw);
        const anchor = insoleFootprintAnchorFromBounds({
            minX: native.minX,
            maxX: native.maxX,
            minY: native.minY,
            maxY: native.maxY,
        });
        const rows: string[] = [];
        for (const menSize of SIZES) {
            const layout = insoleLayoutForUsMenSize(menSize);
            const sizeTransform = sharedInsoleSizeTransformFromGeometry(raw, layout.lengthMm, layout.widthMm);
            expect(sizeTransform.sx).toBe(layout.lengthMm / anchor.nativeLengthMm);
            expect(sizeTransform.sy).toBe(layout.widthMm / anchor.nativeWidthMm);
            expect(sizeTransform.x0).toBe(anchor.x0);
            expect(sizeTransform.yMid).toBe(anchor.yMid);
            expect(
                sameBytes(
                    sharedMatrix(sizeTransform),
                    patternMatrix(layout.lengthMm, layout.widthMm, anchor),
                ),
            ).toBe(true);
            const probes = [
                { x: anchor.x0, y: anchor.yMid, z: 0 },
                { x: anchor.x0 + anchor.nativeLengthMm, y: anchor.yMid, z: 1 },
                {
                    x: anchor.x0 + anchor.nativeLengthMm * 0.66,
                    y: anchor.yMid + anchor.nativeWidthMm * 0.5,
                    z: 2,
                },
            ];
            for (const probe of probes) {
                const viaShared = applySharedSizeXY(probe.x, probe.y, sizeTransform);
                const viaPattern = applyInsoleFootprintScale(
                    [probe],
                    anchor,
                    layout.lengthMm,
                    layout.widthMm,
                )[0];
                if (!viaPattern) throw new Error("pattern transform dropped a probe");
                expect(viaShared.x).toBe(viaPattern.x);
                expect(viaShared.y).toBe(viaPattern.y);
            }
            const composed = await composePrintSolidTop(raw, {
                sourceField: field(layout.lengthMm, layout.widthMm),
                sizeTransform,
            });
            expect(composed.userData.sizeTransform).toBe(sizeTransform);
            const out = bbox(composed);
            const heelToToe = out.length;
            const ballWidth = out.width;
            rows.push(
                `US M${menSize}\theel-to-toe\t${layout.lengthMm.toFixed(4)}\t${heelToToe.toFixed(4)}\tball width\t${layout.widthMm.toFixed(4)}\t${ballWidth.toFixed(4)}`,
            );
            expect(Math.abs(heelToToe - layout.lengthMm)).toBeLessThanOrEqual(0.2);
            expect(Math.abs(ballWidth - layout.widthMm)).toBeLessThanOrEqual(0.2);
            composed.dispose();
        }
        console.log(["size\tmeasure\ttarget\tactual\tmeasure\ttarget\tactual", ...rows].join("\n"));
        raw.dispose();
    }, 60_000);

    test("compose never consumes an unscaled SAMPLE_Top", async () => {
        const raw = await loadSampleTop();
        const native = bbox(raw);
        const layout = insoleLayoutForUsMenSize(8.5);
        const sizeTransform = sharedInsoleSizeTransformFromGeometry(raw, layout.lengthMm, layout.widthMm);
        const unscaled: SharedInsoleSizeTransform = { ...sizeTransform, sx: 1, sy: 1 };
        await expect(
            composePrintSolidTop(raw, {
                sourceField: field(layout.lengthMm, layout.widthMm),
                sizeTransform: unscaled,
            }),
        ).rejects.toThrow(/unscaled SAMPLE_Top/);
        const composed = await composePrintSolidTop(raw, {
            sourceField: field(layout.lengthMm, layout.widthMm),
            sizeTransform,
        });
        const out = bbox(composed);
        expect(Math.abs(out.length - native.length)).toBeGreaterThan(0.2);
        expect(composed.userData.sizeTransform).toBe(sizeTransform);
        composed.dispose();
        raw.dispose();
    }, 30_000);

    test("preview lofts the caller's sized sheet and does not rebuild the transform", async () => {
        const raw = await loadSampleTop();
        const layout = insoleLayoutForUsMenSize(8.5);
        const sizeTransform = sharedInsoleSizeTransformFromGeometry(raw, layout.lengthMm, layout.widthMm);
        const preview = await reconstructProceduralPreview(raw, {
            sourceField: field(layout.lengthMm, layout.widthMm),
            composedTop: true,
            sizeTransform,
            footprintLengthMm: layout.lengthMm,
            footprintWidthMm: layout.widthMm,
        });
        const heelToToe = preview.model.bounds.maxX - preview.model.bounds.minX;
        const ballWidth = preview.model.bounds.maxY - preview.model.bounds.minY;
        expect(preview.model).toBeTruthy();
        expect(Math.abs(heelToToe - layout.lengthMm)).toBeLessThanOrEqual(0.2);
        expect(Math.abs(ballWidth - layout.widthMm)).toBeLessThanOrEqual(0.2);
        expect(Math.abs(heelToToe - bbox(raw).length)).toBeGreaterThan(0.2);
        preview.geometry.dispose();
        raw.dispose();
    }, 180_000);
});
