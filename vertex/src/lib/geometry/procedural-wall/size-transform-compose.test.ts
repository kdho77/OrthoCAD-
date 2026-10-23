// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { extractBoundaryLoops } from "@/lib/geometry/mesh-close";
import {
    formatHalfSize,
    insoleLayoutForUsMenSize,
    listUsMenSizes,
    US_MEN_SIZE_MAX,
    US_MEN_SIZE_MIN,
    usWomenFromMen,
} from "@/lib/geometry/shoe-size";
import type { SideCorrections } from "@/types";
import { applyInsoleFootprintScale, insoleFootprintAnchorFromBounds } from "./pattern-hygiene";
import {
    applySharedInsoleSizeToGeometry,
    applySharedSizeXY,
    composePrintSolidTop,
    composeViewerPrintSolidTop,
    type SharedInsoleSizeTransform,
    sharedInsoleSizeTransformFromGeometry,
} from "./print-solid-compose";
import { reconstructProceduralPreview, sampleTopFromArrayBuffer } from "./sample-top-preview";

/** Same tolerance as `copyTopMesh` / `extractTopSheet` and the quant-key rim walk. */
const RIM_WELD_MM = 1e-4;

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

/** A weld chord across the outline is tens of millimetres. Tessellation stays under 3 mm. */
const CHORD_MM = 10;

function num(value: number | undefined): number {
    return value ?? 0;
}

function halfSizes(): number[] {
    const out: number[] = [];
    for (let s = US_MEN_SIZE_MIN; s <= US_MEN_SIZE_MAX + 1e-9; s += 0.5) out.push(Math.round(s * 2) / 2);
    return out;
}

function quantKey(x: number, y: number, z: number): string {
    return `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
}

/** Vertices mergeVertices(1e-4) will collapse. Positions are the pre-weld mesh. */
function coincidentWeldPairs(geo: BufferGeometry): string[] {
    const names = Object.keys(geo.attributes);
    const hashMultiplier = 1e4;
    const hashAdditive = RIM_WELD_MM * 0.5 * hashMultiplier;
    const groups = new Map<string, number[]>();
    const pos = geo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
        let hash = "";
        for (const name of names) {
            const attr = geo.getAttribute(name);
            if (!attr) continue;
            for (let k = 0; k < attr.itemSize; k++) {
                const getter = ["getX", "getY", "getZ", "getW"][k] as "getX" | "getY" | "getZ" | "getW";
                hash += `${~~(attr[getter](i) * hashMultiplier + hashAdditive)},`;
            }
        }
        const list = groups.get(hash);
        if (list) list.push(i);
        else groups.set(hash, [i]);
    }
    const lines: string[] = [];
    for (const ids of groups.values()) {
        const a = ids[0];
        const b = ids[1];
        if (a === undefined || b === undefined) continue;
        const distance = Math.hypot(
            pos.getX(a) - pos.getX(b),
            pos.getY(a) - pos.getY(b),
            pos.getZ(a) - pos.getZ(b),
        );
        lines.push(
            `v${a} (${pos.getX(a).toFixed(4)}, ${pos.getY(a).toFixed(4)}, ${pos.getZ(a).toFixed(4)}) ` +
                `v${b} (${pos.getX(b).toFixed(4)}, ${pos.getY(b).toFixed(4)}, ${pos.getZ(b).toFixed(4)}) ` +
                `d=${distance.toFixed(6)} mm`,
        );
    }
    return lines;
}

/**
 * Production later weld: mergeVertices(1e-4), then the position-quant boundary.
 * A chord is a naked edge of CHORD_MM or more. An open chain is not an outline.
 */
function weldedRimReport(geo: BufferGeometry): {
    loopCount: number;
    maxEdge: number;
    chords: string[];
    openEnds: string[];
} {
    const welded = mergeVertices(geo.clone(), RIM_WELD_MM);
    try {
        const loops = extractBoundaryLoops(welded);
        const pos = welded.getAttribute("position");
        const index = welded.getIndex();
        const triN = index ? index.count / 3 : pos.count / 3;
        const edges = new Map<string, { a: string; b: string; n: number }>();
        const at = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
        for (let t = 0; t < triN; t++) {
            const keys = [0, 1, 2].map((k) =>
                quantKey(pos.getX(at(t, k)), pos.getY(at(t, k)), pos.getZ(at(t, k))),
            );
            for (let k = 0; k < 3; k++) {
                const a = keys[k];
                const b = keys[(k + 1) % 3];
                if (a === undefined || b === undefined || a === b) continue;
                const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
                const hit = edges.get(ek);
                if (hit) hit.n++;
                else edges.set(ek, { a, b, n: 1 });
            }
        }
        const degree = new Map<string, number>();
        const chords: string[] = [];
        let maxEdge = 0;
        for (const edge of edges.values()) {
            if (edge.n !== 1) continue;
            degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
            degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
            const [ax, ay, az] = edge.a.split(",").map(Number);
            const [bx, by, bz] = edge.b.split(",").map(Number);
            const length = Math.hypot(num(ax) - num(bx), num(ay) - num(by), num(az) - num(bz)) / 1e4;
            if (length > maxEdge) maxEdge = length;
            if (length >= CHORD_MM) {
                chords.push(
                    `${length.toFixed(3)} mm ` +
                        `(${(num(ax) / 1e4).toFixed(3)}, ${(num(ay) / 1e4).toFixed(3)}, ${(num(az) / 1e4).toFixed(3)}) -> ` +
                        `(${(num(bx) / 1e4).toFixed(3)}, ${(num(by) / 1e4).toFixed(3)}, ${(num(bz) / 1e4).toFixed(3)})`,
                );
            }
        }
        const openEnds = [...degree.entries()]
            .filter(([, d]) => d !== 2)
            .map(([key, d]) => {
                const [x, y, z] = key.split(",").map(Number);
                return `deg ${d} at (${(num(x) / 1e4).toFixed(4)}, ${(num(y) / 1e4).toFixed(4)}, ${(num(z) / 1e4).toFixed(4)})`;
            });
        return { loopCount: loops.length, maxEdge, chords, openEnds };
    } finally {
        welded.dispose();
    }
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

    test("sized rim outline has no chord after the later weld", async () => {
        const raw = await loadSampleTop();
        const findings: string[] = [];
        const check = (label: string, geo: BufferGeometry) => {
            const pairs = coincidentWeldPairs(geo);
            const rim = weldedRimReport(geo);
            if (rim.chords.length === 0 && rim.loopCount === 1 && rim.openEnds.length === 0) return;
            findings.push(
                [
                    label,
                    `loops=${rim.loopCount}`,
                    `longestNaked=${rim.maxEdge.toFixed(3)} mm`,
                    pairs.length ? `coincident ${pairs.join(" ; ")}` : "",
                    rim.chords.length ? `chord ${rim.chords.join(" ; ")}` : "",
                    rim.openEnds.length ? `open ${rim.openEnds.join(" ; ")}` : "",
                ]
                    .filter(Boolean)
                    .join(" | "),
            );
        };
        for (const menSize of halfSizes()) {
            const layout = insoleLayoutForUsMenSize(menSize);
            const sizeTransform = sharedInsoleSizeTransformFromGeometry(raw, layout.lengthMm, layout.widthMm);
            const sized = applySharedInsoleSizeToGeometry(raw, sizeTransform);
            check(`US M${menSize}`, sized);
            sized.dispose();
        }
        for (const menSize of SIZES) {
            const layout = insoleLayoutForUsMenSize(menSize);
            const sizeTransform = sharedInsoleSizeTransformFromGeometry(raw, layout.lengthMm, layout.widthMm);
            const composed = await composePrintSolidTop(raw, {
                sourceField: field(layout.lengthMm, layout.widthMm),
                sizeTransform,
            });
            check(`composed US M${menSize}`, composed);
            composed.dispose();
        }
        raw.dispose();
        expect(findings, findings.join("\n")).toEqual([]);
    }, 120_000);

    test("every men's and women's size matches the composed top", async () => {
        const raw = await loadSampleTop();
        const rows = ["men\twomen\theel target\theel actual\tball target\tball actual"];
        for (const menSize of listUsMenSizes()) {
            const layout = insoleLayoutForUsMenSize(menSize);
            const onTemplate =
                Math.abs(layout.lengthMm - INSOLE_LENGTH_MM) <= 1e-3 &&
                Math.abs(layout.widthMm - INSOLE_WIDTH_MM) <= 1e-3;
            const sizeTransform = onTemplate
                ? null
                : sharedInsoleSizeTransformFromGeometry(raw, layout.lengthMm, layout.widthMm);
            const composed = await composeViewerPrintSolidTop({
                raw,
                sourceField: field(layout.lengthMm, layout.widthMm),
                sizeTransform,
            });
            expect(composed.userData.sizeTransform ?? null).toBe(sizeTransform);
            const out = bbox(composed);
            rows.push(
                [
                    formatHalfSize(layout.usMenSize),
                    formatHalfSize(usWomenFromMen(layout.usMenSize)),
                    layout.lengthMm.toFixed(4),
                    out.length.toFixed(4),
                    layout.widthMm.toFixed(4),
                    out.width.toFixed(4),
                ].join("\t"),
            );
            if (sizeTransform) {
                expect(Math.abs(out.length - layout.lengthMm)).toBeLessThanOrEqual(0.2);
                expect(Math.abs(out.width - layout.widthMm)).toBeLessThanOrEqual(0.2);
            } else {
                expect(Math.abs(out.length - layout.lengthMm)).toBeGreaterThan(0.2);
            }
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
