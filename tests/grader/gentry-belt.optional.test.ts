// Independent belt grade for PR #453. Synthetic name only. No patient string.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { buildFinalizedFootFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
import { baseModifierField, baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { defaultElementPose } from "@/lib/geometry/elements";
import { buildExportStl } from "@/lib/geometry/export-geometry";
import { meshYSign } from "@/lib/geometry/handedness";
import { assertProductionFootStl } from "@/lib/geometry/procedural-wall/manufacturing-foot-guard";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { hausdorffReport } from "@/lib/geometry/procedural-wall/metrics";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    buildProceduralExportSolid,
    primeSampleTopGeometry,
    reconstructProceduralPreview,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { printedPlantarView } from "@/lib/geometry/text-marking/belt-print-frame";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import { mirrorGeometry } from "@/lib/library/loaders";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { DesignState, PlacedElement, Side } from "@/types";
import {
    defaultBottomTextMarking,
    markingWithComposedText,
    normalizeBottomTextMarking,
} from "../../vertex/shared/bottom-text-marking";
import { designSettingsEnvelope } from "../../vertex/shared/design-settings";

const SYNTHETIC = "JABBOUR";
const SAMPLE = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const FONT = resolve(process.cwd(), "vertex/public/fonts/Inter-Bold.ttf");
const ELEMENTS = resolve(process.cwd(), "vertex/public/elements");

/** Frozen on main. Parsed from the pin file, which G5 shows is unchanged at both mains. */
const LEFT_PINS: Record<string, { hash: string; verts: number }> = {
    "m6-narrow-height9-met": {
        hash: "c7b5f0ac597e561592bf240466d8e60555fa10f5121ef65a2be3368b57bc75cc",
        verts: 57406,
    },
    "m8-narrow-height9-met": {
        hash: "d5eeff5ea07c452fc10c71577d58ee090ed9b73d2a682888f565cf0aa3a055ce",
        verts: 59169,
    },
};

const HEEL_LIFT_ZERO: Record<Side, string> = {
    right: "3eb6109ced32cff9db8d19ce6d16e3a54b16d0ed684f86eb23da59671f752e27",
    left: "474e0f99d0ac907682452871fe08e053353962c39d8ac041ff0a827eb4e92797",
};

let sampleTop: ArrayBuffer;
let fontBytes: ArrayBuffer;

function bytesOf(path: string): ArrayBuffer {
    const file = readFileSync(path);
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

async function prime(): Promise<void> {
    resetSampleTopGeometryCache();
    resetManufacturingSolidCache();
    primeSampleTopGeometry(await sampleTopFromArrayBuffer(sampleTop.slice(0)));
    primeTextFont(fontBytes.slice(0));
}

function install(design: DesignState): void {
    resetManufacturingSolidCache();
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({ design, viewer: { ...viewer, wallModel: "procedural" } });
}

function narrowPinDesign(size: number, side: Side): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.usMenSize = size;
    design.shoeWidth = "narrow";
    design.shoeWidthBySide = { left: "narrow", right: "narrow" };
    design.corrections = {
        ...design.corrections,
        linked: true,
        left: { ...design.corrections.left, heelCupHeightMm: 9 },
        right: { ...design.corrections.right, heelCupHeightMm: 9 },
    };
    const layout = insoleLayoutFromDesign(design);
    const pose = defaultElementPose("met_pad", side, layout.lengthMm, layout.widthMm);
    const element: PlacedElement = {
        id: side === "left" ? "met-left" : "met-right",
        kind: "met_pad",
        side,
        position: pose.position,
        rotationDeg: pose.rotationDeg,
        scale: pose.scale,
        heightMm: pose.heightMm,
        ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
    };
    design.elements = [element];
    return design;
}

function incidentDesign(usMenSize: number): DesignState {
    const design = narrowPinDesign(usMenSize, "left");
    const layout = insoleLayoutFromDesign(design);
    design.elements = (["left", "right"] as const).map((side) => {
        const pose = defaultElementPose("met_pad", side, layout.lengthMm, layout.widthMm);
        return {
            id: `met-${side}`,
            kind: "met_pad" as const,
            side,
            position: pose.position,
            rotationDeg: pose.rotationDeg,
            scale: pose.scale,
            heightMm: pose.heightMm,
            ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
        };
    });
    design.textMarking = normalizeBottomTextMarking({
        ...defaultBottomTextMarking(),
        text: "",
        addPatientName: true,
        feet: "both",
        mode: "engrave",
    });
    return design;
}

function composedFor(design: DesignState, side: Side): DesignState {
    const marking = design.textMarking ?? defaultBottomTextMarking();
    return { ...design, textMarking: markingWithComposedText(marking, side, SYNTHETIC) };
}

async function loftSolid(design: DesignState, side: Side) {
    const field = baseModifierFieldAuthoritative(design, side, design.thicknessMm);
    const options = printSolidOptions({
        design,
        side,
        field,
        viewer: { wallModel: "procedural", wallStyle: "round" },
        trimline: null,
        bottomPattern: null,
    });
    return buildProceduralExportSolid(side === "right" ? { ...options, mirrored: true } : options);
}

function meshHash(pos: ArrayBufferView, idx: ArrayBufferView): string {
    const hash = createHash("sha256");
    hash.update(Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength));
    hash.update(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength));
    return hash.digest("hex");
}

function framesOf(geometry: BufferGeometry) {
    return geometry.userData as {
        outlineRing?: Array<{ x: number; y: number; z?: number }>;
        bottomOutlineB?: Array<{ x: number; y: number; z?: number }>;
        wallFrames?: Array<{ R: { x: number; y: number; z: number }; sideSign?: number }>;
    };
}

function reflectY<T extends { x: number; y: number; z?: number }>(point: T, center: number): T {
    return { ...point, y: 2 * center - point.y };
}

function maxGap(
    actual: Array<{ x: number; y: number; z?: number }>,
    expected: Array<{ x: number; y: number; z?: number }>,
): number {
    expect(actual.length).toBe(expected.length);
    let worst = 0;
    for (let i = 0; i < actual.length; i++) {
        const a = actual[i]!;
        const b = expected[i]!;
        worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)));
    }
    return worst;
}

function ringToVertices(ring: Array<{ x: number; y: number }>, geometry: BufferGeometry): number {
    const pos = geometry.getAttribute("position").array as Float32Array;
    let worst = 0;
    for (const point of ring) {
        let best = Infinity;
        for (let i = 0; i < pos.length; i += 3) {
            const d = (pos[i]! - point.x) ** 2 + (pos[i + 1]! - point.y) ** 2;
            if (d < best) best = d;
        }
        worst = Math.max(worst, Math.sqrt(best));
    }
    return worst;
}

function stlXy(stl: ArrayBuffer, minX: number, maxX: number): Array<{ x: number; y: number }> {
    const view = new DataView(stl);
    const triangles = view.getUint32(80, true);
    const points = [];
    let offset = 84;
    for (let triangle = 0; triangle < triangles; triangle++) {
        offset += 12;
        for (let corner = 0; corner < 3; corner++) {
            const x = view.getFloat32(offset, true);
            const y = view.getFloat32(offset + 4, true);
            offset += 12;
            if (x >= minX && x <= maxX) points.push({ x, y });
        }
        offset += 2;
    }
    return points;
}

function boundsX(stl: ArrayBuffer): { minX: number; maxX: number } {
    const view = new DataView(stl);
    const triangles = view.getUint32(80, true);
    let minX = Infinity;
    let maxX = -Infinity;
    let offset = 84;
    for (let triangle = 0; triangle < triangles; triangle++) {
        offset += 12;
        for (let corner = 0; corner < 3; corner++) {
            const x = view.getFloat32(offset, true);
            offset += 12;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
        }
        offset += 2;
    }
    return { minX, maxX };
}

function silhouette(points: Array<{ x: number; y: number }>, minX: number, maxX: number) {
    const bins = 64;
    const lo = new Array<number>(bins).fill(Infinity);
    const hi = new Array<number>(bins).fill(-Infinity);
    const span = Math.max(1e-6, maxX - minX);
    for (const point of points) {
        let bin = Math.floor(((point.x - minX) / span) * (bins - 1));
        if (bin < 0) bin = 0;
        if (bin >= bins) bin = bins - 1;
        if (point.y < lo[bin]!) lo[bin] = point.y;
        if (point.y > hi[bin]!) hi[bin] = point.y;
    }
    return { lo, hi };
}

function outlineIoU(
    a: Array<{ x: number; y: number }>,
    b: Array<{ x: number; y: number }>,
    minX: number,
    maxX: number,
) {
    const left = silhouette(a, minX, maxX);
    const right = silhouette(b, minX, maxX);
    let inter = 0;
    let union = 0;
    for (let i = 0; i < left.lo.length; i++) {
        if (!Number.isFinite(left.lo[i]) || !Number.isFinite(right.lo[i])) continue;
        inter += Math.max(0, Math.min(left.hi[i]!, right.hi[i]!) - Math.max(left.lo[i]!, right.lo[i]!));
        union += Math.max(left.hi[i]!, right.hi[i]!) - Math.min(left.lo[i]!, right.lo[i]!);
    }
    return union > 0 ? inter / union : 0;
}

function footSamples(
    stl: ArrayBuffer,
    minX: number,
    maxX: number,
): Array<{ x: number; y: number; z: number }> {
    const view = new DataView(stl);
    const triangles = view.getUint32(80, true);
    const points = [];
    let offset = 84;
    for (let triangle = 0; triangle < triangles; triangle++) {
        offset += 12;
        for (let corner = 0; corner < 3; corner++) {
            const x = view.getFloat32(offset, true);
            const y = view.getFloat32(offset + 4, true);
            const z = view.getFloat32(offset + 8, true);
            offset += 12;
            if (x >= minX && x <= maxX) points.push({ x, y, z });
        }
        offset += 2;
    }
    return points;
}

function hookReading(points: Array<{ x: number; y: number; z?: number }>): string {
    const viewed = points.map((point) => printedPlantarView(point));
    const ys = viewed.map((point) => point.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = maxY - minY;
    const hook = viewed.filter((point) => point.y <= minY + span * 0.28);
    const cap = viewed.filter((point) => point.y >= maxY - span * 0.28);
    const edge = (group: Array<{ x: number }>) =>
        group.length === 0
            ? "empty"
            : `${Math.min(...group.map((point) => point.x)).toFixed(2)}..${Math.max(...group.map((point) => point.x)).toFixed(2)}`;
    return `span=${span.toFixed(2)} hook=${edge(hook)} n=${hook.length} cap=${edge(cap)} n=${cap.length}`;
}

function jHookExtendsLeft(points: Array<{ x: number; y: number; z?: number }>): boolean {
    const viewed = points.map((point) => printedPlantarView(point));
    const ys = viewed.map((point) => point.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = maxY - minY;
    if (!(span > 4)) return false;
    const hook = viewed.filter((point) => point.y <= minY + span * 0.28);
    const cap = viewed.filter((point) => point.y >= maxY - span * 0.28);
    if (hook.length < 8 || cap.length < 8) return false;
    const hookMin = Math.min(...hook.map((point) => point.x));
    const hookMax = Math.max(...hook.map((point) => point.x));
    const capMin = Math.min(...cap.map((point) => point.x));
    const capMax = Math.max(...cap.map((point) => point.x));
    return hookMin < capMin - 1.5 && hookMax <= capMax + 0.75;
}

function letterComponents(
    points: Array<{ x: number; y: number; z: number }>,
): Array<Array<{ x: number; y: number }>> {
    const floor = points.filter((point) => point.z >= 0.45 && point.z <= 0.85);
    const cell = 1.25;
    const buckets = new Map<string, Array<{ x: number; y: number }>>();
    for (const point of floor) {
        const key = `${Math.round(point.x / cell)},${Math.round(point.y / cell)}`;
        const list = buckets.get(key) ?? [];
        list.push({ x: point.x, y: point.y });
        buckets.set(key, list);
    }
    const keys = [...buckets.keys()];
    const parent = new Map(keys.map((key) => [key, key]));
    const find = (key: string): string => {
        let cursor = key;
        while (parent.get(cursor) !== cursor) cursor = parent.get(cursor)!;
        return cursor;
    };
    const union = (a: string, b: string) => {
        const left = find(a);
        const right = find(b);
        if (left !== right) parent.set(left, right);
    };
    for (const key of keys) {
        const [ix, iy] = key.split(",").map(Number);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const next = `${(ix ?? 0) + dx},${(iy ?? 0) + dy}`;
                if (buckets.has(next)) union(key, next);
            }
        }
    }
    const groups = new Map<string, Array<{ x: number; y: number }>>();
    for (const key of keys) {
        const root = find(key);
        const list = groups.get(root) ?? [];
        list.push(...(buckets.get(key) ?? []));
        groups.set(root, list);
    }
    const split: Array<Array<{ x: number; y: number }>> = [];
    const cleave = (group: Array<{ x: number; y: number }>, depth: number) => {
        let minX = Infinity;
        let maxX = -Infinity;
        for (const point of group) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
        }
        const width = maxX - minX;
        if (width <= 14 || depth > 6 || group.length < 40) {
            split.push(group);
            return;
        }
        const bin = 0.5;
        const n = Math.max(1, Math.ceil(width / bin));
        const counts = new Array<number>(n).fill(0);
        for (const point of group) counts[Math.min(n - 1, Math.floor((point.x - minX) / bin))]!++;
        let valley = Math.floor(n * 0.35);
        for (let i = Math.floor(n * 0.3); i <= Math.floor(n * 0.7); i++) {
            if (counts[i]! < counts[valley]!) valley = i;
        }
        const cut = minX + (valley + 0.5) * bin;
        const left = group.filter((point) => point.x < cut);
        const right = group.filter((point) => point.x >= cut);
        if (left.length < 20 || right.length < 20) {
            split.push(group);
            return;
        }
        cleave(left, depth + 1);
        cleave(right, depth + 1);
    };
    for (const group of groups.values()) cleave(group, 0);
    let midY = 0;
    let count = 0;
    for (const group of split) {
        for (const point of group) {
            midY += point.y;
            count++;
        }
    }
    midY = count > 0 ? midY / count : 0;
    return split.filter((group) => {
        if (group.length < 30) return false;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        let sumY = 0;
        for (const point of group) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
            sumY += point.y;
        }
        const width = maxX - minX;
        const height = maxY - minY;
        const centerY = sumY / group.length;
        return width >= 6 && width <= 16 && height >= 10 && height <= 18 && Math.abs(centerY - midY) < 16;
    });
}

function gradeFoot(label: string, stl: ArrayBuffer, ui: ArrayBuffer, side: Side): void {
    const span = boundsX(ui);
    const iou = outlineIoU(
        stlXy(stl, span.minX - 1, span.maxX + 1),
        stlXy(ui, span.minX, span.maxX),
        span.minX,
        span.maxX,
    );
    expect(iou, `${label} outline IoU vs UI`).toBeGreaterThanOrEqual(0.98);

    const samples = footSamples(stl, span.minX, span.maxX);
    const length = Math.max(1e-6, span.maxX - span.minX);
    let heelZ = -Infinity;
    let toeZ = -Infinity;
    let medialZ = -Infinity;
    let lateralZ = -Infinity;
    const medial = meshYSign(side, "medial");
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of samples) {
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
    }
    const midY = (minY + maxY) / 2;
    let heelSpin = 0;
    let heelN = 0;
    let toeSpin = 0;
    let toeN = 0;
    for (const point of samples) {
        const u = (point.x - span.minX) / length;
        if (u < 0.2) {
            heelZ = Math.max(heelZ, point.z);
            heelSpin += -point.x;
            heelN++;
        }
        if (u > 0.8) {
            toeZ = Math.max(toeZ, point.z);
            toeSpin += -point.x;
            toeN++;
        }
        if (u >= 0.4 && u < 0.6) {
            const onMedial = medial < 0 ? point.y < midY : point.y > midY;
            if (onMedial) medialZ = Math.max(medialZ, point.z);
            else lateralZ = Math.max(lateralZ, point.z);
        }
    }
    expect(heelZ, `${label} heel thicker than toe`).toBeGreaterThan(toeZ + 1);
    expect(heelN, `${label} heel samples`).toBeGreaterThan(20);
    expect(toeN, `${label} toe samples`).toBeGreaterThan(20);
    expect(toeSpin / toeN, `${label} toe-first after Rz270`).toBeLessThan(heelSpin / heelN);
    expect(medialZ - lateralZ, `${label} medial arch`).toBeGreaterThan(1);

    const letters = letterComponents(samples);
    const ordered = [...letters].sort((a, b) => {
        const ax = a.reduce((sum, point) => sum + point.x, 0) / a.length;
        const bx = b.reduce((sum, point) => sum + point.x, 0) / b.length;
        return ax - bx;
    });
    expect(ordered.length, `${label} letter blobs`).toBeGreaterThanOrEqual(5);
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    const advance =
        last.reduce((sum, point) => sum + point.x, 0) / last.length -
        first.reduce((sum, point) => sum + point.x, 0) / first.length;
    expect(advance, `${label} name reads left to right`).toBeGreaterThan(20);
    const sizes = ordered
        .map((group) => {
            const xs = group.map((point) => point.x);
            const ys = group.map((point) => point.y);
            return `${(Math.max(...xs) - Math.min(...xs)).toFixed(1)}x${(Math.max(...ys) - Math.min(...ys)).toFixed(1)}`;
        })
        .join(",");
    expect(
        jHookExtendsLeft(first),
        `${label} J is upright on the plantar face (${hookReading(first)}; blobs ${sizes})`,
    ).toBe(true);
}

describe("gentry belt grade", () => {
    test("left narrow pins match main and the right mirror frames follow the vertices", async () => {
        sampleTop = bytesOf(SAMPLE);
        fontBytes = bytesOf(FONT);
        await prime();
        const probe = narrowPinDesign(6, "left").elements[0];
        expect(probe?.heightMm, "met pad is 5 mm").toBe(5);
        const leftBySize = new Map<number, BufferGeometry>();
        for (const size of [6, 8] as const) {
            const built = await loftSolid(narrowPinDesign(size, "left"), "left");
            const position = built.geometry.getAttribute("position").array as Float32Array;
            const index = built.geometry.getIndex();
            const pin = LEFT_PINS[`m${size}-narrow-height9-met`];
            expect(index, `m${size} index`).toBeTruthy();
            expect(position.length / 3, `m${size} verts`).toBe(pin?.verts);
            expect(meshHash(position, index!.array), `m${size} sha256`).toBe(pin?.hash);
            leftBySize.set(size, built.geometry);
        }
        for (const size of [6, 8] as const) {
            const left = leftBySize.get(size)!;
            const right = await loftSolid(narrowPinDesign(size, "right"), "right");
            const mirrored = mirrorGeometry(left);
            const gap = hausdorffReport(mirrored, right.geometry);
            expect(gap.maxMm, `US M${size} vertices follow the mirror`).toBeLessThanOrEqual(0.05);
            mirrored.dispose();
            left.computeBoundingBox();
            const box = left.boundingBox!;
            const widths: Array<[number, number]> = [
                [0, box.max.x - box.min.x],
                [1, box.max.y - box.min.y],
                [2, box.max.z - box.min.z],
            ];
            widths.sort((a, b) => a[1] - b[1]);
            expect(widths[1]?.[0], `US M${size} mirror axis is Y`).toBe(1);
            const center = (box.min.y + box.max.y) / 2;
            const leftFrames = framesOf(left);
            const rightFrames = framesOf(right.geometry);
            expect(leftFrames.outlineRing?.length, "outline").toBeGreaterThan(8);
            expect(leftFrames.bottomOutlineB?.length, "bottom").toBeGreaterThan(8);
            expect(leftFrames.wallFrames?.length, "frames").toBeGreaterThan(8);
            const reflectedRing = leftFrames.outlineRing!.map((point) => reflectY(point, center));
            const reflectedBottom = leftFrames.bottomOutlineB!.map((point) => reflectY(point, center));
            const reflectedR = leftFrames.wallFrames!.map((frame) => reflectY(frame.R, center));
            expect(maxGap(rightFrames.outlineRing!, reflectedRing), `US M${size} outlineRing`).toBeLessThan(
                0.25,
            );
            expect(
                maxGap(rightFrames.bottomOutlineB!, reflectedBottom),
                `US M${size} bottomOutlineB`,
            ).toBeLessThan(0.25);
            expect(
                maxGap(
                    rightFrames.wallFrames!.map((frame) => frame.R),
                    reflectedR,
                ),
                `US M${size} wallFrames`,
            ).toBeLessThan(0.25);
            expect(
                maxGap(rightFrames.outlineRing!, leftFrames.outlineRing!),
                `US M${size} not the stale left ring`,
            ).toBeGreaterThan(2);
            for (let i = 0; i < leftFrames.wallFrames!.length; i++) {
                const before = leftFrames.wallFrames![i]!.sideSign;
                const after = rightFrames.wallFrames![i]!.sideSign;
                if (before == null) expect(after, `sideSign ${i}`).toBeUndefined();
                else expect(after, `sideSign ${i}`).toBe(-before);
            }
            expect(
                ringToVertices(rightFrames.outlineRing!, right.geometry),
                `US M${size} ring on vertices`,
            ).toBeLessThan(3);
            expect(
                ringToVertices(rightFrames.bottomOutlineB!, right.geometry),
                `US M${size} bottom on vertices`,
            ).toBeLessThan(3);
            expect(
                ringToVertices(
                    rightFrames.wallFrames!.map((frame) => frame.R),
                    right.geometry,
                ),
                `US M${size} frames on vertices`,
            ).toBeLessThan(3);
            right.geometry.dispose();
            left.dispose();
        }
    }, 900_000);

    test("US M6 and US M8 narrow belt exports engrave an upright name on both feet", async () => {
        sampleTop = bytesOf(SAMPLE);
        fontBytes = bytesOf(FONT);
        await prime();
        for (const size of [6, 8] as const) {
            const design = incidentDesign(size);
            for (const side of ["left", "right"] as const) {
                const saved = composedFor(design, side);
                expect(saved.textMarking?.text, `${size} ${side} composed`).toBe(SYNTHETIC);
                install(saved);
                const ui = await buildExportStl(side, { exportMode: "manufacturing" });
                const head = await buildFinalizedFootFromSavedSettings({
                    settingsJson: designSettingsEnvelope(saved as unknown as Record<string, unknown>),
                    side,
                    sampleTopBytes: sampleTop,
                    includeLeader: true,
                    fontBytes,
                    elementsBaseDir: ELEMENTS,
                });
                const reference = await sampleTopFromArrayBuffer(sampleTop.slice(0));
                primeSampleTopGeometry(reference);
                await expect(
                    assertProductionFootStl({
                        stl: head.stl,
                        design: saved,
                        side,
                        native: reference,
                    }),
                    `US M${size} ${side} guard`,
                ).resolves.toBeUndefined();
                reference.dispose();
                gradeFoot(`US M${size} ${side}`, head.stl, ui, side);
            }
        }
    }, 1_800_000);

    test("0d3db1c0 and ad1e0cc5 production feet pass the guard with the name", async () => {
        sampleTop = bytesOf(SAMPLE);
        fontBytes = bytesOf(FONT);
        await prime();
        const medium = createDesignWithStockPlaceholder();
        medium.method = "printing_solid";
        medium.shoeWidth = "medium";
        medium.usMenSize = 11.5;
        medium.corrections = {
            ...medium.corrections,
            linked: false,
            right: { ...medium.corrections.right, heelLiftMm: 12 },
        };
        medium.textMarking = normalizeBottomTextMarking({
            ...defaultBottomTextMarking(),
            text: "",
            addPatientName: true,
            feet: "both",
        });
        const linked = createDesignWithStockPlaceholder();
        linked.method = "printing_solid";
        linked.shoeWidth = "medium";
        linked.corrections = { ...linked.corrections, linked: true };
        linked.textMarking = normalizeBottomTextMarking({
            ...defaultBottomTextMarking(),
            text: SYNTHETIC,
            addPatientName: false,
            feet: "both",
        });
        const jobs: Array<{ label: string; design: DesignState; side: Side }> = [
            { label: "0d3db1c0 left", design: medium, side: "left" },
            { label: "0d3db1c0 right", design: medium, side: "right" },
            { label: "ad1e0cc5 left", design: linked, side: "left" },
            { label: "ad1e0cc5 right", design: linked, side: "right" },
        ];
        for (const job of jobs) {
            const saved = composedFor(job.design, job.side);
            const head = await buildFinalizedFootFromSavedSettings({
                settingsJson: designSettingsEnvelope(saved as unknown as Record<string, unknown>),
                side: job.side,
                sampleTopBytes: sampleTop,
                includeLeader: true,
                fontBytes,
                elementsBaseDir: ELEMENTS,
            });
            const reference = await sampleTopFromArrayBuffer(sampleTop.slice(0));
            await expect(
                assertProductionFootStl({ stl: head.stl, design: saved, side: job.side, native: reference }),
                job.label,
            ).resolves.toBeUndefined();
            reference.dispose();
            const span = boundsX(head.stl);
            const kept = footSamples(head.stl, span.minX, span.maxX - 25);
            const letters = letterComponents(kept);
            expect(letters.length, `${job.label} engraved letters`).toBeGreaterThanOrEqual(5);
        }
    }, 1_800_000);

    test("zero heel-lift STLs stay on the main pin", async () => {
        sampleTop = bytesOf(SAMPLE);
        const fixture = bytesOf(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
        for (const side of ["right", "left"] as const) {
            const loaded = await sampleTopFromArrayBuffer(fixture.slice(0));
            const raw = side === "left" ? mirrorGeometry(loaded) : loaded;
            if (side === "left") loaded.dispose();
            const design = defaultDesign();
            design.usMenSize = 11;
            design.shoeWidth = "medium";
            design.method = "printing_solid";
            design.pattern = "full_contact";
            const field = baseModifierField(design, side, design.thicknessMm);
            const options = printSolidOptions({
                design,
                side,
                field,
                viewer: { wallStyle: "round" },
                trimline: null,
                bottomPattern: null,
            });
            const built = await reconstructProceduralPreview(raw, options);
            raw.dispose();
            const hash = createHash("sha256")
                .update(Buffer.from(geometryToBinarySTL(built.geometry)))
                .digest("hex");
            expect(hash, `${side} heel lift 0`).toBe(HEEL_LIFT_ZERO[side]);
            built.geometry.dispose();
        }
    }, 900_000);
});
