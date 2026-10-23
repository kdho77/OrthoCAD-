// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import {
    formatHalfSize,
    insoleLayoutForUsMenSize,
    listUsMenSizes,
    usWomenFromMen,
} from "@/lib/geometry/shoe-size";
import type { SideCorrections } from "@/types";
import { positionKeyedRim } from "./extract";
import { maxRimVertexDelta, RIM_RING_STATION_N } from "./outline-clean";
import { applyInsoleFootprintScale, insoleFootprintAnchorFromBounds } from "./pattern-hygiene";
import {
    applySharedSizeXY,
    composePrintSolidTop,
    composeViewerPrintSolidTop,
    M9_TARGET_SOURCE,
    type SharedInsoleSizeTransform,
    sharedInsoleSizeTransformFromGeometry,
    sharedSizeTarget,
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

/** Index topology of a closed triangle mesh. Position is not used to merge vertices. */
function solidTopology(geo: BufferGeometry): { naked: number; nonManifold: number; euler: number } {
    const index = geo.getIndex();
    const pos = geo.getAttribute("position");
    if (!index || !pos) throw new Error("mesh has no index");
    const edges = new Map<string, number>();
    const used = new Set<number>();
    let faces = 0;
    for (let t = 0; t < index.count; t += 3) {
        const vs = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
        const a = vs[0]!;
        const b = vs[1]!;
        const c = vs[2]!;
        if (a === b || b === c || c === a) continue;
        faces++;
        used.add(a);
        used.add(b);
        used.add(c);
        for (let k = 0; k < 3; k++) {
            const u = vs[k]!;
            const v = vs[(k + 1) % 3]!;
            const key = u < v ? `${u},${v}` : `${v},${u}`;
            edges.set(key, (edges.get(key) ?? 0) + 1);
        }
    }
    let naked = 0;
    let nonManifold = 0;
    for (const n of edges.values()) {
        if (n === 1) naked++;
        else if (n !== 2) nonManifold++;
    }
    return { naked, nonManifold, euler: used.size - edges.size + faces };
}

function bboxOf(points: { x: number; y: number }[]): {
    length: number;
    width: number;
    minX: number;
    minY: number;
} {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return { length: maxX - minX, width: maxY - minY, minX, minY };
}

function composedRim(geo: BufferGeometry): { x: number; y: number; z: number }[] {
    return positionKeyedRim(geo);
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

    test("M9 uses the shared size transform and is not identity", async () => {
        const raw = await loadSampleTop();
        const native = bbox(raw);
        const layout = insoleLayoutForUsMenSize(9);
        const target = sharedSizeTarget(layout.lengthMm, layout.widthMm);
        expect(target.lengthMm).toBe(M9_TARGET_SOURCE.lengthMm);
        expect(target.widthMm).toBe(M9_TARGET_SOURCE.widthMm);
        expect(M9_TARGET_SOURCE.lengthMm).toBe(INSOLE_LENGTH_MM);
        expect(M9_TARGET_SOURCE.widthMm).toBe(INSOLE_WIDTH_MM);
        const sizeTransform = sharedInsoleSizeTransformFromGeometry(raw, target.lengthMm, target.widthMm);
        expect(sizeTransform.sx).not.toBe(1);
        expect(sizeTransform.sy).not.toBe(1);
        const composed = await composeViewerPrintSolidTop({
            raw,
            sourceField: field(target.lengthMm, target.widthMm),
            sizeTransform,
        });
        expect(composed.userData.sizeTransform).toBe(sizeTransform);
        const out = bbox(composed);
        expect(Math.abs(out.length - target.lengthMm)).toBeLessThanOrEqual(0.2);
        expect(Math.abs(out.width - target.widthMm)).toBeLessThanOrEqual(0.2);
        expect(Math.abs(out.length - native.length)).toBeGreaterThan(0.2);
        expect(Math.abs(out.width - native.width)).toBeGreaterThan(0.2);
        composed.dispose();
        raw.dispose();
    }, 30_000);

    test("indexed rim ring is a closed solid at every table size", async () => {
        const raw = await loadSampleTop();
        const rows = ["size\tnaked\tnonManifold\teuler\trimDelta\theel\tball"];
        for (const menSize of listUsMenSizes()) {
            const layout = insoleLayoutForUsMenSize(menSize);
            const target = sharedSizeTarget(layout.lengthMm, layout.widthMm);
            const sizeTransform = sharedInsoleSizeTransformFromGeometry(raw, target.lengthMm, target.widthMm);
            const composed = await composePrintSolidTop(raw, {
                sourceField: field(target.lengthMm, target.widthMm),
                sizeTransform,
            });
            const rim = composedRim(composed);
            composed.dispose();
            let preview: Awaited<ReturnType<typeof reconstructProceduralPreview>>;
            try {
                preview = await reconstructProceduralPreview(raw, {
                    sourceField: field(target.lengthMm, target.widthMm),
                    composedTop: true,
                    sizeTransform,
                    footprintLengthMm: target.lengthMm,
                    footprintWidthMm: target.widthMm,
                });
            } catch (err) {
                rows.push(
                    `M${formatHalfSize(menSize)}\tFAIL\t\t\t\t${(err as Error).message.split("\n")[0]}`,
                );
                continue;
            }
            const top = preview.model.top;
            const rimLocal = top.rimLocal ?? [];
            const mesh = top.meshPositions;
            if (!mesh || rimLocal.length !== RIM_RING_STATION_N) {
                throw new Error(`US M${menSize} rim ring has ${rimLocal.length} vertices`);
            }
            expect(new Set(rimLocal).size).toBe(RIM_RING_STATION_N);
            const ring = rimLocal.map((i) => ({
                x: mesh[i * 3]!,
                y: mesh[i * 3 + 1]!,
                z: mesh[i * 3 + 2]!,
            }));
            const delta = maxRimVertexDelta(ring, rim);
            const topo = solidTopology(preview.geometry);
            const out = bboxOf(ring);
            rows.push(
                [
                    `M${formatHalfSize(menSize)}`,
                    String(topo.naked),
                    String(topo.nonManifold),
                    String(topo.euler),
                    delta.toFixed(4),
                    out.length.toFixed(4),
                    out.width.toFixed(4),
                ].join("\t"),
            );
            expect(topo.naked).toBe(0);
            expect(topo.nonManifold).toBe(0);
            expect(topo.euler).toBe(2);
            expect(delta).toBeLessThanOrEqual(0.01);
            expect(Math.abs(out.length - target.lengthMm)).toBeLessThanOrEqual(0.2);
            expect(Math.abs(out.width - target.widthMm)).toBeLessThanOrEqual(0.2);
            preview.geometry.dispose();
        }
        const failed = rows.filter((row) => row.includes("\tFAIL\t"));
        expect(failed, rows.join("\n")).toEqual([]);
        raw.dispose();
    }, 1_800_000);

    test("every men's and women's size matches the composed top", async () => {
        const raw = await loadSampleTop();
        const rows = ["men\twomen\theel target\theel actual\tball target\tball actual"];
        let prevLength = -Infinity;
        let prevWidth = -Infinity;
        for (const menSize of listUsMenSizes()) {
            const layout = insoleLayoutForUsMenSize(menSize);
            const target = sharedSizeTarget(layout.lengthMm, layout.widthMm);
            const sizeTransform = sharedInsoleSizeTransformFromGeometry(raw, target.lengthMm, target.widthMm);
            const composed = await composeViewerPrintSolidTop({
                raw,
                sourceField: field(target.lengthMm, target.widthMm),
                sizeTransform,
            });
            expect(composed.userData.sizeTransform).toBe(sizeTransform);
            const out = bbox(composed);
            rows.push(
                [
                    formatHalfSize(layout.usMenSize),
                    formatHalfSize(usWomenFromMen(layout.usMenSize)),
                    target.lengthMm.toFixed(4),
                    out.length.toFixed(4),
                    target.widthMm.toFixed(4),
                    out.width.toFixed(4),
                ].join("\t"),
            );
            expect(Math.abs(out.length - target.lengthMm)).toBeLessThanOrEqual(0.2);
            expect(Math.abs(out.width - target.widthMm)).toBeLessThanOrEqual(0.2);
            expect(out.length).toBeGreaterThan(prevLength);
            expect(out.width).toBeGreaterThan(prevWidth);
            prevLength = out.length;
            prevWidth = out.width;
            composed.dispose();
        }
        console.log(rows.join("\n"));
        raw.dispose();
    }, 180_000);

    test("composed scaled top is non-empty at M1, M8.5 and M16", async () => {
        const raw = await loadSampleTop();
        for (const menSize of SIZES) {
            const layout = insoleLayoutForUsMenSize(menSize);
            const sizeTransform = sharedInsoleSizeTransformFromGeometry(raw, layout.lengthMm, layout.widthMm);
            const composed = await composeViewerPrintSolidTop({
                raw,
                sourceField: field(layout.lengthMm, layout.widthMm),
                sizeTransform,
            });
            const positions = composed.getAttribute("position");
            if (!positions || positions.count < 3) {
                throw new Error(`US M${menSize} composed top is empty`);
            }
            const out = bbox(composed);
            expect(out.length).toBeGreaterThan(1);
            expect(out.width).toBeGreaterThan(1);
            expect(Math.abs(out.length - layout.lengthMm)).toBeLessThanOrEqual(0.2);
            expect(Math.abs(out.width - layout.widthMm)).toBeLessThanOrEqual(0.2);
            expect(composed.userData.sizeTransform).toBe(sizeTransform);
            composed.dispose();
        }
        raw.dispose();
    }, 60_000);

    test("switching US M8.5 to M11 recomposes the top with the new transform", async () => {
        const raw = await loadSampleTop();
        const m85 = insoleLayoutForUsMenSize(8.5);
        const m11 = insoleLayoutForUsMenSize(11);
        const t85 = sharedInsoleSizeTransformFromGeometry(raw, m85.lengthMm, m85.widthMm);
        const first = await composeViewerPrintSolidTop({
            raw,
            sourceField: field(m85.lengthMm, m85.widthMm),
            sizeTransform: t85,
        });
        const length85 = bbox(first).length;
        expect(first.userData.sizeTransform).toBe(t85);
        first.dispose();

        const t11 = sharedInsoleSizeTransformFromGeometry(raw, m11.lengthMm, m11.widthMm);
        expect(t11).not.toBe(t85);
        const second = await composeViewerPrintSolidTop({
            raw,
            sourceField: field(m11.lengthMm, m11.widthMm),
            sizeTransform: t11,
        });
        const length11 = bbox(second).length;
        expect(second.userData.sizeTransform).toBe(t11);
        expect(Math.abs(length85 - m85.lengthMm)).toBeLessThanOrEqual(0.2);
        expect(Math.abs(length11 - m11.lengthMm)).toBeLessThanOrEqual(0.2);
        expect(length11 - length85).toBeGreaterThan(0.2);
        second.dispose();
        raw.dispose();
    }, 60_000);
});
