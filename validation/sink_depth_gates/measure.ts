// Measure remaining floor thickness in the export mesh, and the cut on a
// flat 3 mm sheet with no wall. Imports product code. Does not modify it.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BufferGeometry } from "three";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import {
    applyAnalyticSinkToLoftedSolid,
    meshYToAnatomical,
    SINK_PROFILES,
    type SinkSurfaceContext,
    sinkContextForMesh,
    sinkCutMm,
} from "@/lib/geometry/sink";
import { defaultDesign } from "@/stores/design-store";
import type { PlacedSink, SinkKind } from "@/types";
import type { FlatMeasurement, FloorMeasurement } from "./judge";
import {
    FLAT_STEP_MM,
    INTERIOR_WEIGHT,
    PLATEAU_WEIGHT,
    RING_WEIGHT_MAX,
    SAMPLE_STEP_MM,
    SHELL_MM,
} from "./thresholds";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

export interface MeshBundle {
    geometry: BufferGeometry;
    positions: Float32Array;
    topCount: number;
    medialYSign: 1 | -1;
    ctx: SinkSurfaceContext;
}

interface Accel {
    positions: Float32Array;
    index: ArrayLike<number>;
    cell: number;
    originX: number;
    originY: number;
    nx: number;
    ny: number;
    bins: number[][];
}

function median(values: number[]): number {
    if (!values.length) return Number.NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
    return sorted[mid]!;
}

function hashPositions(positions: Float32Array): string {
    return createHash("sha256")
        .update(Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength))
        .digest("hex");
}

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
    const orig = console.log;
    console.log = (...args: unknown[]) => {
        const head = String(args[0] ?? "");
        if (head.startsWith("[S1") || head.startsWith("[RND") || head.startsWith("[S2")) return;
        orig(...args);
    };
    try {
        return await fn();
    } finally {
        console.log = orig;
    }
}

export async function loadSampleTop(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function uniformField(thicknessMm: number) {
    const design = defaultDesign();
    design.thicknessMm = thicknessMm;
    design.shellThicknessMode = "uniform";
    return baseModifierField(design, "left", thicknessMm);
}

export async function loftExport(
    raw: BufferGeometry,
    sinks: PlacedSink[] | undefined,
    mode: "default" | "uniform",
    thicknessMm = SHELL_MM,
): Promise<BufferGeometry> {
    const top = raw.clone();
    try {
        const preview = await quiet(() =>
            reconstructProceduralPreview(
                top,
                mode === "default"
                    ? { side: "left", wallStyle: "round" }
                    : {
                          side: "left",
                          wallStyle: "round",
                          thicknessMm,
                          stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
                          sourceField: sinks?.length
                              ? { ...uniformField(thicknessMm), sinks }
                              : uniformField(thicknessMm),
                          composedTop: true,
                          ...(sinks?.length ? { sinks } : {}),
                      },
            ),
        );
        return preview.geometry;
    } finally {
        top.dispose();
    }
}

export function positionHash(geo: BufferGeometry): string {
    return hashPositions(geo.getAttribute("position").array as Float32Array);
}

function indexArray(geo: BufferGeometry): ArrayLike<number> {
    const index = geo.getIndex();
    if (!index) throw new Error("export mesh has no index");
    return index.array as ArrayLike<number>;
}

function buildAccel(positions: Float32Array, index: ArrayLike<number>, cell = 8): Accel {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const triCount = index.length / 3;
    for (let t = 0; t < triCount; t++) {
        for (let k = 0; k < 3; k++) {
            const i = index[t * 3 + k]!;
            const x = positions[i * 3]!;
            const y = positions[i * 3 + 1]!;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }
    const nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    const ny = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
    const bins: number[][] = new Array(nx * ny);
    const push = (ix: number, iy: number, tri: number) => {
        if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return;
        const slot = ix + iy * nx;
        const bin = bins[slot];
        if (bin) bin.push(tri);
        else bins[slot] = [tri];
    };
    for (let t = 0; t < triCount; t++) {
        let tMinX = Infinity;
        let tMinY = Infinity;
        let tMaxX = -Infinity;
        let tMaxY = -Infinity;
        for (let k = 0; k < 3; k++) {
            const i = index[t * 3 + k]!;
            const x = positions[i * 3]!;
            const y = positions[i * 3 + 1]!;
            if (x < tMinX) tMinX = x;
            if (y < tMinY) tMinY = y;
            if (x > tMaxX) tMaxX = x;
            if (y > tMaxY) tMaxY = y;
        }
        const ix0 = Math.floor((tMinX - minX) / cell);
        const iy0 = Math.floor((tMinY - minY) / cell);
        const ix1 = Math.floor((tMaxX - minX) / cell);
        const iy1 = Math.floor((tMaxY - minY) / cell);
        for (let ix = ix0; ix <= ix1; ix++) {
            for (let iy = iy0; iy <= iy1; iy++) push(ix, iy, t);
        }
    }
    return { positions, index, cell, originX: minX, originY: minY, nx, ny, bins };
}

/** Downward ray. Returns distinct hit Z values, highest first. */
function hitZs(accel: Accel, x: number, y: number): number[] {
    const ix = Math.floor((x - accel.originX) / accel.cell);
    const iy = Math.floor((y - accel.originY) / accel.cell);
    if (ix < 0 || iy < 0 || ix >= accel.nx || iy >= accel.ny) return [];
    const bin = accel.bins[ix + iy * accel.nx];
    if (!bin) return [];
    const pos = accel.positions;
    const index = accel.index;
    const found: number[] = [];
    const oz = 1e6;
    for (const t of bin) {
        const ia = index[t * 3]!;
        const ib = index[t * 3 + 1]!;
        const ic = index[t * 3 + 2]!;
        const ax = pos[ia * 3]!;
        const ay = pos[ia * 3 + 1]!;
        const az = pos[ia * 3 + 2]!;
        const bx = pos[ib * 3]!;
        const by = pos[ib * 3 + 1]!;
        const bz = pos[ib * 3 + 2]!;
        const cx = pos[ic * 3]!;
        const cy = pos[ic * 3 + 1]!;
        const cz = pos[ic * 3 + 2]!;
        const e1x = bx - ax;
        const e1y = by - ay;
        const e1z = bz - az;
        const e2x = cx - ax;
        const e2y = cy - ay;
        const e2z = cz - az;
        // dir = (0, 0, -1). pvec = dir × e2 = (e2y, -e2x, 0)
        const px = e2y;
        const py = -e2x;
        const det = e1x * px + e1y * py;
        if (det > -1e-10 && det < 1e-10) continue;
        const inv = 1 / det;
        const tx = x - ax;
        const ty = y - ay;
        const tz = oz - az;
        const u = (tx * px + ty * py) * inv;
        if (u < -1e-5 || u > 1 + 1e-5) continue;
        // qvec = tvec × e1
        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const v = -qz * inv;
        if (v < -1e-5 || u + v > 1 + 1e-5) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist < 0) continue;
        const z = oz - dist;
        if (z > oz || z < -1) continue;
        found.push(z);
    }
    found.sort((a, b) => b - a);
    const unique: number[] = [];
    for (const z of found) {
        if (unique.length === 0 || unique[unique.length - 1]! - z > 0.01) unique.push(z);
    }
    return unique;
}

function gapAt(accel: Accel, x: number, y: number): { top: number; under: number; gap: number } | null {
    const hits = hitZs(accel, x, y);
    if (hits.length < 2) {
        // A vertex that lands on an edge can miss. Nudge within the cell.
        for (const [dx, dy] of [
            [0.05, 0],
            [-0.05, 0],
            [0, 0.05],
            [0, -0.05],
        ] as const) {
            const nudged = hitZs(accel, x + dx, y + dy);
            if (nudged.length >= 2) {
                return { top: nudged[0]!, under: nudged[1]!, gap: nudged[0]! - nudged[1]! };
            }
        }
        return null;
    }
    return { top: hits[0]!, under: hits[1]!, gap: hits[0]! - hits[1]! };
}

export function bundleFromGeometry(geo: BufferGeometry, sink: PlacedSink): MeshBundle {
    const positions = geo.getAttribute("position").array as Float32Array;
    const topCount = geo.userData.topVertexCount as number;
    if (!topCount || topCount < 10) throw new Error("export mesh is missing topVertexCount");
    const medialYSign = (geo.userData.medialYSign as 1 | -1 | undefined) ?? -1;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < topCount; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const ctx = sinkContextForMesh(
        {
            side: "left",
            lengthMm: Math.max(1e-3, maxX - minX),
            widthMm: Math.max(1e-3, maxY - minY),
            sinks: [sink],
            medialYSign,
        },
        positions,
        topCount,
        0,
        1,
    );
    return { geometry: geo, positions, topCount, medialYSign, ctx };
}

function weightAt(bundle: MeshBundle, x: number, y: number): number {
    const yAnat = meshYToAnatomical(y, "left", bundle.medialYSign);
    return sinkCutMm(x, yAnat, bundle.ctx).weight;
}

export interface FloorSample extends FloorMeasurement {
    kind: SinkKind;
}

export function measureFloor(
    sunk: MeshBundle,
    unsunkPositions: Float32Array,
    unsunkIndex: ArrayLike<number>,
    depthMm: number,
): FloorSample {
    const sunkAccel = buildAccel(sunk.positions, indexArray(sunk.geometry));
    const unsunkAccel = buildAccel(unsunkPositions, unsunkIndex);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let plateauVerts = 0;
    for (let i = 0; i < sunk.topCount; i++) {
        const x = sunk.positions[i * 3]!;
        const y = sunk.positions[i * 3 + 1]!;
        if (weightAt(sunk, x, y) < PLATEAU_WEIGHT) continue;
        plateauVerts++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const gaps: number[] = [];
    const vertexGaps: number[] = [];
    const drops: number[] = [];
    const unsunkGaps: number[] = [];
    const lowShell: number[] = [];
    const ringDelta: number[] = [];
    const roomyDrops: number[] = [];
    const ring: number[] = [];
    let rayMisses = 0;
    const consider = (x: number, y: number, into: number[] | null) => {
        const w = weightAt(sunk, x, y);
        if (w < 1e-4) return;
        const sunkGap = gapAt(sunkAccel, x, y);
        const bare = gapAt(unsunkAccel, x, y);
        if (w >= PLATEAU_WEIGHT) {
            if (!sunkGap || !bare) {
                if (into) rayMisses++;
                return;
            }
            if (into) {
                into.push(sunkGap.gap);
                drops.push(bare.top - sunkGap.top);
                unsunkGaps.push(bare.gap);
                if (bare.gap <= 3.15) lowShell.push(sunkGap.gap);
                if (bare.gap >= depthMm + 1 - 0.05) roomyDrops.push(bare.top - sunkGap.top);
            } else {
                vertexGaps.push(sunkGap.gap);
            }
        } else if (into && w <= RING_WEIGHT_MAX && sunkGap && bare && sunkGap.under < 0.35) {
            ring.push(sunkGap.gap);
            ringDelta.push(Math.abs(sunkGap.gap - bare.gap));
        }
    };
    for (let i = 0; i < sunk.topCount; i++) {
        consider(sunk.positions[i * 3]!, sunk.positions[i * 3 + 1]!, null);
    }
    if (plateauVerts > 0) {
        const x0 = minX - 8;
        const x1 = maxX + 8;
        const y0 = minY - 8;
        const y1 = maxY + 8;
        for (let x = x0; x <= x1; x += SAMPLE_STEP_MM) {
            for (let y = y0; y <= y1; y += SAMPLE_STEP_MM) consider(x, y, gaps);
        }
    }
    if (vertexGaps.length) {
        const vertexMin = Math.min(...vertexGaps);
        if (!gaps.length || vertexMin < Math.min(...gaps)) gaps.push(vertexMin);
    }
    let belt = 0;
    let xy = 0;
    const n = Math.min(sunk.positions.length, unsunkPositions.length) / 3;
    const topCount = Math.min(sunk.topCount, n);
    for (let i = 0; i < topCount; i++) {
        const dx = sunk.positions[i * 3]! - unsunkPositions[i * 3]!;
        const dy = sunk.positions[i * 3 + 1]! - unsunkPositions[i * 3 + 1]!;
        const plan = Math.hypot(dx, dy);
        if (plan > xy) xy = plan;
    }
    for (let i = 0; i < n; i++) {
        if (unsunkPositions[i * 3 + 2]! > 1e-3) continue;
        const dx = sunk.positions[i * 3]! - unsunkPositions[i * 3]!;
        const dy = sunk.positions[i * 3 + 1]! - unsunkPositions[i * 3 + 1]!;
        const dz = sunk.positions[i * 3 + 2]! - unsunkPositions[i * 3 + 2]!;
        const move = Math.hypot(dx, dy, dz);
        if (move > belt) belt = move;
    }
    const kind = sunk.ctx.sinks![0]!.kind;
    return {
        id: kind,
        kind,
        side: "left",
        depthMm,
        thicknessMm: SHELL_MM,
        plateauCount: gaps.length,
        rayMisses,
        minMm: gaps.length ? Math.min(...gaps) : Number.NaN,
        medianMm: median(gaps),
        ringCount: ring.length,
        ringMedianMm: median(ring),
        dropMedianMm: median(drops),
        dropMaxMm: drops.length ? Math.max(...drops) : Number.NaN,
        beltMoveMm: belt,
        xyMoveMm: xy,
        unsunkMedianMm: median(unsunkGaps),
        lowShellCount: lowShell.length,
        lowShellMedianMm: median(lowShell),
        ringDeltaMm: median(ringDelta),
        roomyCount: roomyDrops.length,
        roomyDropMedianMm: median(roomyDrops),
    };
}

/**
 * Move plateau top vertices so the vertical gap to the surface underneath
 * becomes `targetGapMm`. Used only by the no-op and bad-change proofs.
 */
export function retargetPlateauGap(bundle: MeshBundle, targetGapMm: number): number {
    const accel = buildAccel(bundle.positions, indexArray(bundle.geometry));
    let moved = 0;
    for (let i = 0; i < bundle.topCount; i++) {
        const x = bundle.positions[i * 3]!;
        const y = bundle.positions[i * 3 + 1]!;
        if (weightAt(bundle, x, y) < PLATEAU_WEIGHT) continue;
        const gap = gapAt(accel, x, y);
        if (!gap) continue;
        bundle.positions[i * 3 + 2] = gap.under + targetGapMm;
        moved++;
    }
    const attr = bundle.geometry.getAttribute("position");
    attr.needsUpdate = true;
    return moved;
}

const FLAT_LENGTH = 260;
const FLAT_WIDTH = 95;

export function measureFlat(kind: SinkKind, depthMm: number, shellMm = SHELL_MM): FlatMeasurement {
    const depth = Math.min(depthMm, SINK_PROFILES[kind].maxDepthMm);
    const step = FLAT_STEP_MM;
    const nx = Math.floor(FLAT_LENGTH / step) + 1;
    const ny = Math.floor(FLAT_WIDTH / step) + 1;
    const count = nx * ny;
    const positions = new Array<number>(count * 3);
    const minY = -FLAT_WIDTH / 2;
    for (let ix = 0; ix < nx; ix++) {
        for (let iy = 0; iy < ny; iy++) {
            const i = ix * ny + iy;
            positions[i * 3] = ix * step;
            positions[i * 3 + 1] = minY + iy * step;
            positions[i * 3 + 2] = shellMm;
        }
    }
    const corner = (ix: number, iy: number) => ix * ny + iy;
    const sink: PlacedSink = { id: kind, kind, depthMm: depth };
    applyAnalyticSinkToLoftedSolid({
        positions,
        topCount: count,
        nS: 4,
        nJ: 1,
        vertAt: (_row, station) => {
            if (station === 0) return corner(0, 0);
            if (station === 1) return corner(nx - 1, 0);
            if (station === 2) return corner(0, ny - 1);
            return corner(nx - 1, ny - 1);
        },
        bounds: { minX: 0, maxX: FLAT_LENGTH, minY, maxY: FLAT_WIDTH / 2 },
        medialYSign: -1,
        side: "left",
        sinks: [sink],
    });
    const ctx = sinkContextForMesh(
        {
            side: "left",
            lengthMm: FLAT_LENGTH,
            widthMm: FLAT_WIDTH,
            sinks: [sink],
            medialYSign: -1,
        },
        positions,
        count,
        0,
        1,
    );
    const interiorRemoved: number[] = [];
    const plateauRemain: number[] = [];
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        const z = positions[i * 3 + 2]!;
        const w = sinkCutMm(x, meshYToAnatomical(y, "left", -1), ctx).weight;
        if (w >= INTERIOR_WEIGHT) interiorRemoved.push(shellMm - z);
        if (w >= PLATEAU_WEIGHT) plateauRemain.push(z);
    }
    return {
        kind,
        depthMm: depth,
        shellMm,
        interiorCount: interiorRemoved.length,
        plateauCount: plateauRemain.length,
        removedMedianMm: median(interiorRemoved),
        removedMinMm: interiorRemoved.length ? Math.min(...interiorRemoved) : Number.NaN,
        removedMaxMm: interiorRemoved.length ? Math.max(...interiorRemoved) : Number.NaN,
        remainMinMm: plateauRemain.length ? Math.min(...plateauRemain) : Number.NaN,
        remainMedianMm: median(plateauRemain),
    };
}

/** Lower the flat-sheet interior by an extra amount. Returns a broken specimen. */
export function breakFlat(kind: SinkKind, depthMm: number, extraMm: number): FlatMeasurement {
    const step = FLAT_STEP_MM;
    const nx = Math.floor(FLAT_LENGTH / step) + 1;
    const ny = Math.floor(FLAT_WIDTH / step) + 1;
    const count = nx * ny;
    const positions = new Array<number>(count * 3);
    const minY = -FLAT_WIDTH / 2;
    for (let ix = 0; ix < nx; ix++) {
        for (let iy = 0; iy < ny; iy++) {
            const i = ix * ny + iy;
            positions[i * 3] = ix * step;
            positions[i * 3 + 1] = minY + iy * step;
            positions[i * 3 + 2] = SHELL_MM;
        }
    }
    const corner = (ix: number, iy: number) => ix * ny + iy;
    const depth = Math.min(depthMm, SINK_PROFILES[kind].maxDepthMm);
    const sink: PlacedSink = { id: kind, kind, depthMm: depth };
    applyAnalyticSinkToLoftedSolid({
        positions,
        topCount: count,
        nS: 4,
        nJ: 1,
        vertAt: (_row, station) => {
            if (station === 0) return corner(0, 0);
            if (station === 1) return corner(nx - 1, 0);
            if (station === 2) return corner(0, ny - 1);
            return corner(nx - 1, ny - 1);
        },
        bounds: { minX: 0, maxX: FLAT_LENGTH, minY, maxY: FLAT_WIDTH / 2 },
        medialYSign: -1,
        side: "left",
        sinks: [sink],
    });
    const ctx = sinkContextForMesh(
        {
            side: "left",
            lengthMm: FLAT_LENGTH,
            widthMm: FLAT_WIDTH,
            sinks: [sink],
            medialYSign: -1,
        },
        positions,
        count,
        0,
        1,
    );
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        const w = sinkCutMm(x, meshYToAnatomical(y, "left", -1), ctx).weight;
        if (w >= INTERIOR_WEIGHT) positions[i * 3 + 2] = Math.max(0, positions[i * 3 + 2]! - extraMm);
    }
    const interiorRemoved: number[] = [];
    const plateauRemain: number[] = [];
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        const z = positions[i * 3 + 2]!;
        const w = sinkCutMm(x, meshYToAnatomical(y, "left", -1), ctx).weight;
        if (w >= INTERIOR_WEIGHT) interiorRemoved.push(SHELL_MM - z);
        if (w >= PLATEAU_WEIGHT) plateauRemain.push(z);
    }
    return {
        kind,
        depthMm: depth,
        shellMm: SHELL_MM,
        interiorCount: interiorRemoved.length,
        plateauCount: plateauRemain.length,
        removedMedianMm: median(interiorRemoved),
        removedMinMm: interiorRemoved.length ? Math.min(...interiorRemoved) : Number.NaN,
        removedMaxMm: interiorRemoved.length ? Math.max(...interiorRemoved) : Number.NaN,
        remainMinMm: plateauRemain.length ? Math.min(...plateauRemain) : Number.NaN,
        remainMedianMm: median(plateauRemain),
    };
}
