// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { medialWidthSignForSide } from "@/lib/clinical/medial-sign";
import type {
    ScanArchAssignmentSource,
    ScanArchTierName,
    ScanCaptureMode,
    ScanDrivenArchRecord,
    Side,
} from "@/types";

/**
 * Scan arch measurement. The scan is analysis only.
 *
 * Landmarks (M1, M5, heel) define the floor. Plantar triangles in the medial
 * midfoot are searched. Winding is detected from the lowest layer, so a steep
 * medial wall is not the arch and an up-facing grid still measures.
 * The result is a Low / Medium / High tier on the default parametric mesh.
 */

export const SCAN_ARCH_REFERENCE_LENGTH_MM = 260;

/** Bin edges, tier deltas, and capture offsets. Decisions read this object. */
export const SCAN_ARCH_TIER_CONFIG = {
    /** normalizedArchMm = measuredArchMm * referenceLengthMm / L. Off treats tiers as absolute mm. */
    lengthNormalization: true,
    referenceLengthMm: SCAN_ARCH_REFERENCE_LENGTH_MM,
    /** Added to the normalized height before binning. 0 until capture mode is calibrated. */
    scanModeOffsetMm: {
        NWB: 0,
        "semi-WB": 0,
        FWB: 0,
    } satisfies Record<ScanCaptureMode, number>,
    /** < lowBelowMm → Low. lowBelowMm…mediumMaxMm → Medium. Above mediumMaxMm → High. */
    lowBelowMm: 21.75,
    mediumMaxMm: 25,
    tiers: {
        low: { absoluteMm: 20 as const, deltaMm: -3.5 },
        medium: { absoluteMm: 23.5 as const, deltaMm: 0 },
        high: { absoluteMm: 26.5 as const, deltaMm: 3 },
    },
    searchUMin: 0.35,
    searchUMax: 0.55,
    searchVMin: 0,
    searchVMax: 0.35,
    /**
     * Steepness gate. The sign of the plantar normal is detected per mesh;
     * this value's magnitude is the |nz| cutoff (0.5 keeps faces steeper than 60°).
     */
    plantarNormalZMax: -0.5,
    /** In-plane median window. A lone spike inside the window cannot set the peak. */
    smoothRadiusMm: 4,
    /** Apex candidates need this many other samples inside the window. */
    minApexNeighbors: 5,
    /** Hole edges need at least half of these sectors occupied. */
    apexSectorCount: 8,
    /** Robust foot length uses this percentile band of plantar vertices. */
    lengthPercentileLow: 0.005,
    lengthPercentileHigh: 0.995,
    minBandTriangles: 8,
    artifactMinMm: 5,
    artifactMaxMm: 45,
    reviewBelowMm: 18,
    rxWarnAbsDeltaMm: 5,
    heelU: 0.15,
    heelHalfWidthU: 0.03,
};

export type ArchPoint = { x: number; y: number; z: number };

export type ArchLandmarks = {
    heel: ArchPoint;
    /** 1st met head (medial). */
    m1: ArchPoint;
    /** 5th met head (lateral). */
    m5: ArchPoint;
};

export type PlantarArchMeasurement = {
    measuredArchMm: number | null;
    archApexU: number | null;
    /** Detected apex in the same unscaled space as the scan positions. */
    apexLocal: ArchPoint | null;
    footLengthMm: number | null;
    forefootWidthMm: number | null;
    heelWidthMm: number | null;
    forefootVarusDeg: number | null;
    rearfootAngleDeg: number | null;
    plantarBandTriangles: number;
    lowCoverage: boolean;
    likelyArtifact: boolean;
    /** True when M1, M5, and heel were supplied rather than inferred. */
    landmarksPlaced: boolean;
    reviewFlags: string[];
};

type V3 = { x: number; y: number; z: number };

const markerSourceByScanId = new Map<string, "scan_measured" | "manual_override">();

export function setScanArchMarkerSource(
    scanId: string,
    source: "scan_measured" | "manual_override" | null,
): void {
    if (source == null) markerSourceByScanId.delete(scanId);
    else markerSourceByScanId.set(scanId, source);
}

export function scanArchMarkerSource(scanId: string): "scan_measured" | "manual_override" | null {
    return markerSourceByScanId.get(scanId) ?? null;
}

function sub(a: V3, b: V3): V3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: V3, b: V3): V3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: V3, s: number): V3 {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: V3, b: V3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: V3, b: V3): V3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function len(a: V3): number {
    return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: V3): V3 | null {
    const l = len(a);
    if (l < 1e-9) return null;
    return scale(a, 1 / l);
}

function mid(a: V3, b: V3): V3 {
    return scale(add(a, b), 0.5);
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const midIndex = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return ((sorted[midIndex - 1] ?? 0) + (sorted[midIndex] ?? 0)) / 2;
    return sorted[midIndex] ?? 0;
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
    return sorted[index] ?? 0;
}

type IndexLike = { count: number; getX: (i: number) => number };

function triangleCount(vertexCount: number, index: IndexLike | null): number {
    if (index) return Math.floor(index.count / 3);
    return Math.floor(vertexCount / 3);
}

function triangleVertices(tri: number, index: IndexLike | null): [number, number, number] {
    if (index) return [index.getX(tri * 3)!, index.getX(tri * 3 + 1)!, index.getX(tri * 3 + 2)!];
    return [tri * 3, tri * 3 + 1, tri * 3 + 2];
}

function readPoint(positions: ArrayLike<number>, index: number, displayScale: number): V3 {
    return {
        x: positions[index * 3]! * displayScale,
        y: positions[index * 3 + 1]! * displayScale,
        z: positions[index * 3 + 2]! * displayScale,
    };
}

type Axis = "x" | "y" | "z";

function dominantLengthAxis(positions: ArrayLike<number>, count: number, displayScale: number): Axis {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
        const p = readPoint(positions, i, displayScale);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
    }
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    if (sizeY > sizeX && sizeY >= sizeZ) return "y";
    if (sizeZ > sizeX && sizeZ >= sizeY) return "z";
    return "x";
}

function remap(p: V3, axis: Axis): [number, number, number] {
    if (axis === "y") return [p.y, -p.x, p.z];
    if (axis === "z") return [p.z, p.y, -p.x];
    return [p.x, p.y, p.z];
}

function inferLandmarks(
    positions: ArrayLike<number>,
    count: number,
    displayScale: number,
    side: Side,
): ArchLandmarks | null {
    if (count < 30) return null;
    const axis = dominantLengthAxis(positions, count, displayScale);
    let lenMin = Infinity;
    let lenMax = -Infinity;
    for (let i = 0; i < count; i++) {
        const [length] = remap(readPoint(positions, i, displayScale), axis);
        if (length < lenMin) lenMin = length;
        if (length > lenMax) lenMax = length;
    }
    const span = Math.max(1e-6, lenMax - lenMin);
    const medial = medialWidthSignForSide(side);
    const heelIdx: number[] = [];
    const foreIdx: number[] = [];
    for (let i = 0; i < count; i++) {
        const [length] = remap(readPoint(positions, i, displayScale), axis);
        const u = (length - lenMin) / span;
        if (u <= 0.18) heelIdx.push(i);
        if (u >= 0.72) foreIdx.push(i);
    }
    if (heelIdx.length < 4 || foreIdx.length < 4) return null;

    const heelWidths = heelIdx
        .map((i) => remap(readPoint(positions, i, displayScale), axis)[1])
        .sort((a, b) => a - b);
    const heelUps = heelIdx
        .map((i) => remap(readPoint(positions, i, displayScale), axis)[2])
        .sort((a, b) => a - b);
    const heelMedianW = percentile(heelWidths, 0.5);
    const heelContact = percentile(heelUps, 0.15);
    let heelBest = heelIdx[0]!;
    let heelScore = Infinity;
    for (const i of heelIdx) {
        const [, width, up] = remap(readPoint(positions, i, displayScale), axis);
        const score = Math.abs(width - heelMedianW) + Math.abs(up - heelContact) * 3;
        if (score < heelScore) {
            heelScore = score;
            heelBest = i;
        }
    }

    const pickMet = (wantMedial: boolean): number | null => {
        let best = -1;
        let bestScore = Infinity;
        const ups = foreIdx
            .map((i) => remap(readPoint(positions, i, displayScale), axis)[2])
            .sort((a, b) => a - b);
        const contact = percentile(ups, 0.2);
        for (const i of foreIdx) {
            const [, width, up] = remap(readPoint(positions, i, displayScale), axis);
            const sideScore = width * medial;
            if (wantMedial ? sideScore <= 0 : sideScore >= 0) continue;
            const score = (wantMedial ? -sideScore : sideScore) + Math.max(0, up - contact) * 2;
            if (score < bestScore) {
                bestScore = score;
                best = i;
            }
        }
        return best >= 0 ? best : null;
    };

    const m1 = pickMet(true);
    const m5 = pickMet(false);
    if (m1 == null || m5 == null) return null;
    return {
        heel: readPoint(positions, heelBest, displayScale),
        m1: readPoint(positions, m1, displayScale),
        m5: readPoint(positions, m5, displayScale),
    };
}

type Frame = {
    heel: V3;
    up: V3;
    lengthAxis: V3;
    lateral: V3;
    footLengthMm: number;
    uOriginMm: number;
    sMedial: number;
    forefootWidthMm: number;
    m1Height: number;
    m5Height: number;
};

function buildFrame(
    landmarks: ArchLandmarks,
    positions: ArrayLike<number>,
    count: number,
    displayScale: number,
): Frame | null {
    const heel = landmarks.heel;
    const m1 = landmarks.m1;
    const m5 = landmarks.m5;
    const towardToe = sub(mid(m1, m5), heel);
    let up = normalize(cross(sub(m1, heel), sub(m5, heel)));
    if (!up) up = normalize(cross(towardToe, { x: 0, y: 0, z: 1 }));
    if (!up) return null;
    let upSum = 0;
    const step = Math.max(1, Math.floor(count / 4000));
    for (let i = 0; i < count; i += step) {
        upSum += dot(sub(readPoint(positions, i, displayScale), heel), up);
    }
    if (upSum < 0) up = scale(up, -1);

    const axisRaw = sub(towardToe, scale(up, dot(towardToe, up)));
    const lengthAxis = normalize(axisRaw);
    if (!lengthAxis) return null;
    let lateral = normalize(cross(lengthAxis, up));
    if (!lateral) return null;
    if (dot(lateral, sub(m5, m1)) < 0) lateral = scale(lateral, -1);

    let minAlong = Infinity;
    let maxAlong = -Infinity;
    for (let i = 0; i < count; i++) {
        const along = dot(sub(readPoint(positions, i, displayScale), heel), lengthAxis);
        if (along < minAlong) minAlong = along;
        if (along > maxAlong) maxAlong = along;
    }
    const footLengthMm = maxAlong - minAlong;
    if (footLengthMm < 20) return null;
    const sMedial = dot(sub(m1, heel), lateral);
    const sLateral = dot(sub(m5, heel), lateral);
    const forefootWidthMm = sLateral - sMedial;
    if (forefootWidthMm < 5) return null;
    return {
        heel,
        up,
        lengthAxis,
        lateral,
        footLengthMm,
        uOriginMm: minAlong,
        sMedial,
        forefootWidthMm,
        m1Height: dot(sub(m1, heel), up),
        m5Height: dot(sub(m5, heel), up),
    };
}

function frameCoords(
    frame: Frame,
    p: V3,
): { u: number; v: number; height: number; along: number; lat: number } {
    const d = sub(p, frame.heel);
    const along = dot(d, frame.lengthAxis);
    const lat = dot(d, frame.lateral);
    return {
        u: (along - frame.uOriginMm) / frame.footLengthMm,
        v: (lat - frame.sMedial) / frame.forefootWidthMm,
        height: dot(d, frame.up),
        along,
        lat,
    };
}

type Sample = {
    u: number;
    v: number;
    height: number;
    along: number;
    lat: number;
    raw: V3;
    smooth: number;
    apexCandidate: boolean;
};

function emptyMeasurement(landmarksPlaced: boolean): PlantarArchMeasurement {
    return {
        measuredArchMm: null,
        archApexU: null,
        apexLocal: null,
        footLengthMm: null,
        forefootWidthMm: null,
        heelWidthMm: null,
        forefootVarusDeg: null,
        rearfootAngleDeg: null,
        plantarBandTriangles: 0,
        lowCoverage: true,
        likelyArtifact: false,
        landmarksPlaced,
        reviewFlags: ["No plantar arch apex — Medium until the scan is reviewed"],
    };
}

type Face = {
    nz: number;
    nLen: number;
    height: number;
    centroid: V3;
    aAlong: number;
    bAlong: number;
    cAlong: number;
};

function resolveTriangleIndex(
    geometry: BufferGeometry | undefined,
    explicit?: IndexLike | null,
): IndexLike | null {
    if (explicit) return explicit;
    const indexAttr = geometry?.getIndex();
    if (!indexAttr) return null;
    return { count: indexAttr.count, getX: (i) => indexAttr.getX(i) };
}

function collectFaces(
    positions: ArrayLike<number>,
    vertexCount: number,
    index: IndexLike | null,
    displayScale: number,
    frame: Frame,
): Face[] {
    const faces: Face[] = [];
    const triN = triangleCount(vertexCount, index);
    for (let t = 0; t < triN; t++) {
        const [ia, ib, ic] = triangleVertices(t, index);
        if (ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) continue;
        const a = readPoint(positions, ia, displayScale);
        const b = readPoint(positions, ib, displayScale);
        const c = readPoint(positions, ic, displayScale);
        const n = cross(sub(b, a), sub(c, a));
        const nLen = len(n);
        if (nLen < 1e-8) continue;
        const centroid = scale(add(add(a, b), c), 1 / 3);
        faces.push({
            nz: dot(n, frame.up) / nLen,
            nLen,
            height: frameCoords(frame, centroid).height,
            centroid,
            aAlong: dot(sub(a, frame.heel), frame.lengthAxis),
            bAlong: dot(sub(b, frame.heel), frame.lengthAxis),
            cAlong: dot(sub(c, frame.heel), frame.lengthAxis),
        });
    }
    return faces;
}

/** Sign of the plantar normal from area-weighted nz on the lowest horizontal layer. */
function plantarNormalSign(faces: Face[]): number {
    const horizontal = faces.filter((face) => Math.abs(face.nz) > 0.35);
    if (horizontal.length === 0) return -1;
    const heights = horizontal.map((face) => face.height).sort((a, b) => a - b);
    const floorH = percentile(heights, 0.02);
    let weighted = 0;
    for (const face of horizontal) {
        if (face.height > floorH + 8) continue;
        weighted += face.nz * face.nLen;
    }
    return weighted >= 0 ? 1 : -1;
}

/** 0.5–99.5 percentile of plantar vertices. A few stray points no longer set L. */
function applyRobustLength(frame: Frame, plantarAlongs: number[]): void {
    if (plantarAlongs.length < 20) return;
    const sorted = [...plantarAlongs].sort((a, b) => a - b);
    const start = percentile(sorted, SCAN_ARCH_TIER_CONFIG.lengthPercentileLow);
    const end = percentile(sorted, SCAN_ARCH_TIER_CONFIG.lengthPercentileHigh);
    if (end - start < 20) return;
    frame.uOriginMm = start;
    frame.footLengthMm = end - start;
}

const APEX_RADIUS_SAMPLE_CAP = 1500;

/** Stride subsample. Exact 5-NN stays on the small fixtures; dense bands stay bounded. */
function radiusEstimateSamples(samples: Sample[]): Sample[] {
    if (samples.length <= APEX_RADIUS_SAMPLE_CAP) return samples;
    const stride = Math.ceil(samples.length / APEX_RADIUS_SAMPLE_CAP);
    const picked: Sample[] = [];
    for (let i = 0; i < samples.length && picked.length < APEX_RADIUS_SAMPLE_CAP; i += stride) {
        const sample = samples[i];
        if (sample) picked.push(sample);
    }
    return picked.length >= 6 ? picked : samples;
}

/**
 * p90 of each sample's 5th-nearest-neighbor distance.
 * Buckets replace the all-pairs scan. Above 1500 samples the radius is estimated
 * from a stride subsample so a dense band does not go quadratic.
 */
function apexWindowRadius(samples: Sample[], floorMm: number): number {
    if (samples.length < 6) return floorMm;
    const estimate = radiusEstimateSamples(samples);
    const fifth = fifthNearestDistances(estimate);
    fifth.sort((a, b) => a - b);
    const p90 = fifth[Math.min(fifth.length - 1, Math.floor(0.9 * (fifth.length - 1)))] ?? floorMm;
    return Math.max(floorMm, Number.isFinite(p90) ? p90 : floorMm);
}

function fifthNearestDistances(samples: Sample[]): number[] {
    const n = samples.length;
    let minA = Infinity;
    let maxA = -Infinity;
    let minL = Infinity;
    let maxL = -Infinity;
    for (const sample of samples) {
        if (sample.along < minA) minA = sample.along;
        if (sample.along > maxA) maxA = sample.along;
        if (sample.lat < minL) minL = sample.lat;
        if (sample.lat > maxL) maxL = sample.lat;
    }
    const spanA = Math.max(1e-3, maxA - minA);
    const spanL = Math.max(1e-3, maxL - minL);
    const cell = Math.max(1e-3, Math.sqrt((spanA * spanL) / Math.max(1, n / 4)));
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        const sample = samples[i];
        if (!sample) continue;
        const key = `${Math.floor(sample.along / cell)},${Math.floor(sample.lat / cell)}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(i);
        else buckets.set(key, [i]);
    }
    const fifth: number[] = [];
    const cand: number[] = [];
    const maxRing = Math.ceil(Math.max(spanA, spanL) / cell) + 2;
    for (let i = 0; i < n; i++) {
        const origin = samples[i];
        if (!origin) continue;
        const qx = Math.floor(origin.along / cell);
        const qy = Math.floor(origin.lat / cell);
        const localX = origin.along - qx * cell;
        const localY = origin.lat - qy * cell;
        cand.length = 0;
        let proven = false;
        for (let ring = 0; ring <= maxRing && !proven; ring++) {
            for (let dx = -ring; dx <= ring; dx++) {
                for (let dy = -ring; dy <= ring; dy++) {
                    if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
                    const bucket = buckets.get(`${qx + dx},${qy + dy}`);
                    if (!bucket) continue;
                    for (const j of bucket) {
                        if (j === i) continue;
                        const other = samples[j];
                        if (!other) continue;
                        const du = other.along - origin.along;
                        const dv = other.lat - origin.lat;
                        cand.push(du * du + dv * dv);
                    }
                }
            }
            const gapX = Math.min((ring + 1) * cell - localX, ring * cell + localX);
            const gapY = Math.min((ring + 1) * cell - localY, ring * cell + localY);
            const minNext = Math.min(gapX, gapY);
            if (cand.length >= 5 && minNext > 0) {
                const limit = minNext * minNext;
                let within = 0;
                for (const d2 of cand) {
                    if (d2 <= limit) within++;
                    if (within >= 5) break;
                }
                if (within >= 5) proven = true;
            }
        }
        if (cand.length < 5) {
            fifth.push(Number.POSITIVE_INFINITY);
            continue;
        }
        cand.sort((a, b) => a - b);
        fifth.push(Math.sqrt(cand[4] ?? Number.POSITIVE_INFINITY));
    }
    return fifth;
}

function markApexCandidates(
    samples: Sample[],
    floorRadiusMm: number,
    minNeighbors: number,
    sectorCount: number,
): void {
    const radius = apexWindowRadius(samples, floorRadiusMm);
    const radius2 = radius * radius;
    const buckets = new Map<string, Sample[]>();
    const cell = radius;
    // Sparse fixtures keep every neighbor. A dense band stores a spatial cap per cell
    // so the 4 mm window does not scan tens of millions of pairs.
    const perCellCap = samples.length > 2500 ? 16 : Number.POSITIVE_INFINITY;
    for (const sample of samples) {
        const key = `${Math.floor(sample.along / cell)},${Math.floor(sample.lat / cell)}`;
        const bucket = buckets.get(key);
        if (bucket) {
            if (bucket.length < perCellCap) bucket.push(sample);
        } else buckets.set(key, [sample]);
    }
    for (const sample of samples) {
        const ix = Math.floor(sample.along / cell);
        const iy = Math.floor(sample.lat / cell);
        const heights: number[] = [sample.height];
        const sectors = new Uint8Array(sectorCount);
        let neighbors = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const bucket = buckets.get(`${ix + dx},${iy + dy}`);
                if (!bucket) continue;
                for (const other of bucket) {
                    if (other === sample) continue;
                    const du = other.along - sample.along;
                    const dv = other.lat - sample.lat;
                    const d2 = du * du + dv * dv;
                    if (d2 > radius2 || d2 < 1e-8) continue;
                    neighbors++;
                    heights.push(other.height);
                    let bin = Math.floor(((Math.atan2(dv, du) + Math.PI) / (2 * Math.PI)) * sectorCount);
                    if (bin >= sectorCount) bin = sectorCount - 1;
                    if (bin < 0) bin = 0;
                    sectors[bin] = 1;
                }
            }
        }
        let occupied = 0;
        for (const hit of sectors) occupied += hit;
        sample.smooth = median(heights);
        sample.apexCandidate = neighbors >= minNeighbors && occupied >= Math.ceil(sectorCount / 2);
    }
}

/**
 * Plantar medial-arch height above the M1 / M5 / heel plane.
 * Landmarks are in the same unscaled space as `positions`. When omitted, they
 * are inferred from the plantar contact points so an unlabeled height grid
 * still measures.
 */
export function measurePlantarArch(args: {
    geometry?: BufferGeometry;
    positions?: ArrayLike<number>;
    vertexCount?: number;
    /** Indexed triangle list. Without it, a welded buffer is read as a triangle soup. */
    index?: IndexLike | null;
    side: Side;
    displayScale?: number;
    landmarks?: ArchLandmarks | null;
    /** When set, the arch height is this point's height above the floor (marker drag). */
    manualApex?: ArchPoint | null;
    /** Overrides `SCAN_ARCH_TIER_CONFIG.plantarNormalZMax` for the steepness gate. */
    plantarNormalZMax?: number;
}): PlantarArchMeasurement {
    const geometry = args.geometry;
    const positions =
        args.positions ?? (geometry?.getAttribute("position")?.array as ArrayLike<number> | undefined);
    const vertexCount = args.vertexCount ?? geometry?.getAttribute("position")?.count ?? 0;
    const displayScale =
        Number.isFinite(args.displayScale) && (args.displayScale ?? 0) > 0 ? args.displayScale! : 1;
    const landmarksPlaced = Boolean(args.landmarks?.heel && args.landmarks.m1 && args.landmarks.m5);
    if (!positions || vertexCount < 9) return emptyMeasurement(landmarksPlaced);

    const index = resolveTriangleIndex(geometry, args.index);
    const scaledLandmarks = args.landmarks
        ? {
              heel: scale(args.landmarks.heel, displayScale),
              m1: scale(args.landmarks.m1, displayScale),
              m5: scale(args.landmarks.m5, displayScale),
          }
        : inferLandmarks(positions, vertexCount, displayScale, args.side);
    if (!scaledLandmarks) return emptyMeasurement(landmarksPlaced);

    const frame = buildFrame(scaledLandmarks, positions, vertexCount, displayScale);
    if (!frame) return emptyMeasurement(landmarksPlaced);

    const cfg = SCAN_ARCH_TIER_CONFIG;
    const steep = Math.abs(
        args.plantarNormalZMax !== undefined && Number.isFinite(args.plantarNormalZMax)
            ? args.plantarNormalZMax
            : cfg.plantarNormalZMax,
    );
    const faces = collectFaces(positions, vertexCount, index, displayScale, frame);
    const plantarSign = plantarNormalSign(faces);
    const plantarAlongs: number[] = [];
    const accepted: Face[] = [];
    for (const face of faces) {
        if (face.nz * plantarSign <= steep) continue;
        accepted.push(face);
        plantarAlongs.push(face.aAlong, face.bAlong, face.cAlong);
    }
    applyRobustLength(frame, plantarAlongs);

    const samples: Sample[] = [];
    let bandTriangles = 0;
    const heelLats: number[] = [];
    const heelHeights: number[] = [];
    for (const face of accepted) {
        const coords = frameCoords(frame, face.centroid);
        if (Math.abs(coords.u - cfg.heelU) <= cfg.heelHalfWidthU && coords.v >= -0.05 && coords.v <= 1.05) {
            heelLats.push(coords.lat);
            heelHeights.push(coords.height);
        }
        if (coords.u < cfg.searchUMin || coords.u > cfg.searchUMax) continue;
        if (coords.v < cfg.searchVMin || coords.v > cfg.searchVMax) continue;
        bandTriangles++;
        samples.push({
            ...coords,
            raw: scale(face.centroid, 1 / displayScale),
            smooth: coords.height,
            apexCandidate: false,
        });
    }

    markApexCandidates(samples, cfg.smoothRadiusMm, cfg.minApexNeighbors, cfg.apexSectorCount);

    let winner: Sample | null = null;
    for (const sample of samples) {
        if (!sample.apexCandidate) continue;
        if (!winner) {
            winner = sample;
            continue;
        }
        if (sample.smooth > winner.smooth + 1e-6) {
            winner = sample;
            continue;
        }
        if (Math.abs(sample.smooth - winner.smooth) <= 1e-6) {
            const du = Math.abs(sample.u - 0.45) - Math.abs(winner.u - 0.45);
            if (du < -1e-6 || (Math.abs(du) <= 1e-6 && sample.v < winner.v)) winner = sample;
        }
    }

    const lowCoverage = bandTriangles < cfg.minBandTriangles || samples.length < cfg.minBandTriangles;
    let measured = winner?.smooth ?? null;
    let apexU = winner?.u ?? null;
    let apexLocal = winner?.raw ?? null;
    if (args.manualApex) {
        const manualMm = scale(args.manualApex, displayScale);
        const coords = frameCoords(frame, manualMm);
        measured = coords.height;
        apexU = coords.u;
        apexLocal = { x: args.manualApex.x, y: args.manualApex.y, z: args.manualApex.z };
    }

    let heelWidthMm: number | null = null;
    if (heelLats.length >= 4) {
        const sorted = [...heelLats].sort((a, b) => a - b);
        heelWidthMm = percentile(sorted, 0.95) - percentile(sorted, 0.05);
        if (heelWidthMm < 1) heelWidthMm = null;
    }
    let rearfootAngleDeg: number | null = null;
    if (heelLats.length >= 6 && heelWidthMm) {
        const meanL = heelLats.reduce((s, v) => s + v, 0) / heelLats.length;
        const meanH = heelHeights.reduce((s, v) => s + v, 0) / heelHeights.length;
        let num = 0;
        let den = 0;
        for (let i = 0; i < heelLats.length; i++) {
            const dl = heelLats[i]! - meanL;
            num += dl * (heelHeights[i]! - meanH);
            den += dl * dl;
        }
        if (den > 1e-6) {
            const slope = num / den;
            rearfootAngleDeg = (Math.atan(-slope) * 180) / Math.PI;
        }
    }
    const forefootVarusDeg =
        (Math.atan2(frame.m1Height - frame.m5Height, frame.forefootWidthMm) * 180) / Math.PI;

    const flags: string[] = [];
    const likelyArtifact = measured != null && (measured < cfg.artifactMinMm || measured > cfg.artifactMaxMm);
    if (likelyArtifact && measured != null) {
        flags.push(
            `Measured arch ${measured.toFixed(1)} mm is outside ${cfg.artifactMinMm}–${cfg.artifactMaxMm} mm — likely artifact`,
        );
    }
    if (measured != null && measured < cfg.reviewBelowMm) {
        flags.push(`arch ${measured.toFixed(1)} mm is below ${cfg.reviewBelowMm} mm — Low, review the scan`);
    }
    if (!args.manualApex && (lowCoverage || measured == null)) {
        flags.push("Low plantar coverage in the arch band — Medium until the scan is reviewed");
    }

    return {
        measuredArchMm: measured,
        archApexU: apexU,
        apexLocal,
        footLengthMm: frame.footLengthMm,
        forefootWidthMm: frame.forefootWidthMm,
        heelWidthMm,
        forefootVarusDeg,
        rearfootAngleDeg,
        plantarBandTriangles: bandTriangles,
        lowCoverage: !args.manualApex && (lowCoverage || measured == null),
        likelyArtifact,
        landmarksPlaced,
        reviewFlags: flags,
    };
}

export type ArchHeightMeasurement = {
    heightMm: number;
    /** Arch apex height before display scale. */
    rawHeight: number;
};

/**
 * Absolute medial-arch height in millimetres, from plantar triangles only.
 * Returns null when the plantar band is missing so a side wall cannot stand in.
 */
export function measureScanArchHeightMm(
    geometry: BufferGeometry,
    side: Side,
    displayScale = 1,
): ArchHeightMeasurement | null {
    const measured = measurePlantarArch({ geometry, side, displayScale });
    if (measured.lowCoverage || measured.measuredArchMm == null) return null;
    const scale = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;
    return { heightMm: measured.measuredArchMm, rawHeight: measured.measuredArchMm / scale };
}

export function tierForNormalizedArchMm(
    binMm: number,
    config: Pick<typeof SCAN_ARCH_TIER_CONFIG, "lowBelowMm" | "mediumMaxMm"> = SCAN_ARCH_TIER_CONFIG,
): ScanArchTierName {
    if (binMm < config.lowBelowMm) return "low";
    if (binMm <= config.mediumMaxMm) return "medium";
    return "high";
}

function tierAbsolute(tier: ScanArchTierName): 20 | 23.5 | 26.5 {
    return SCAN_ARCH_TIER_CONFIG.tiers[tier].absoluteMm;
}

function tierDelta(tier: ScanArchTierName): number {
    return SCAN_ARCH_TIER_CONFIG.tiers[tier].deltaMm;
}

/**
 * Normalize, add the capture-mode offset, and bin. Explicit Rx replaces the
 * slider. A pronation note does not raise the tier.
 */
export function resolveScanArchAssignment(args: {
    measurement: PlantarArchMeasurement | null;
    captureMode?: ScanCaptureMode;
    lengthNormalization?: boolean;
    markerSource?: "scan_measured" | "manual_override" | null;
    explicitArchHeightMm?: number;
    explicitTier?: ScanArchTierName | null;
    pathologyBlocksArchRaise?: boolean;
}): { record: ScanDrivenArchRecord; warnings: string[] } {
    const captureMode = args.captureMode ?? "NWB";
    const lengthNormalization = args.lengthNormalization ?? SCAN_ARCH_TIER_CONFIG.lengthNormalization;
    const measurement = args.measurement;
    const warnings: string[] = [];
    const usable =
        measurement != null &&
        measurement.measuredArchMm != null &&
        !measurement.lowCoverage &&
        Number.isFinite(measurement.measuredArchMm);

    let tier: ScanArchTierName = "medium";
    let source: ScanArchAssignmentSource = "fallback_no_scan";
    let normalized: number | null = null;
    const measured = usable ? measurement!.measuredArchMm : null;
    const footLength = measurement?.footLengthMm ?? null;
    if (usable && measured != null) {
        const offset = SCAN_ARCH_TIER_CONFIG.scanModeOffsetMm[captureMode];
        if (lengthNormalization && footLength != null && footLength > 1) {
            normalized = (measured * SCAN_ARCH_TIER_CONFIG.referenceLengthMm) / footLength;
        } else {
            normalized = measured;
        }
        tier = tierForNormalizedArchMm(normalized + offset);
        source = args.markerSource === "manual_override" ? "manual_override" : "scan_measured";
    }

    const scanDelta = tierDelta(tier);
    if (args.pathologyBlocksArchRaise && args.explicitArchHeightMm === undefined && !args.explicitTier) {
        if (source === "scan_measured") source = "pathology_guardrail";
        warnings.push(
            "Pronation is not treated by raising the arch. Corrections stay on the rearfoot and forefoot.",
        );
    }

    if (args.explicitTier) {
        tier = args.explicitTier;
        source = "rx_explicit_override";
    }
    let delta = tierDelta(tier);
    if (args.explicitArchHeightMm !== undefined && Number.isFinite(args.explicitArchHeightMm)) {
        delta = args.explicitArchHeightMm;
        source = "rx_explicit_override";
    }
    if (
        source === "rx_explicit_override" &&
        Math.abs(delta - scanDelta) > SCAN_ARCH_TIER_CONFIG.rxWarnAbsDeltaMm
    ) {
        warnings.push("Rx arch differs from the scan tier by more than 5 mm");
    }

    const reviewFlags = [...(measurement?.reviewFlags ?? [])];
    if (!usable && !reviewFlags.some((flag) => flag.includes("plantar"))) {
        reviewFlags.push("No plantar arch apex — Medium until the scan is reviewed");
    }

    return {
        warnings,
        record: {
            measuredArchMm: measurement?.measuredArchMm ?? null,
            normalizedArchMm: usable ? normalized : null,
            archApexU: measurement?.archApexU ?? null,
            scanCaptureMode: captureMode,
            assignedArchTier: tier,
            assignedArchHeightMm: tierAbsolute(tier),
            assignmentSource: source,
            archHeightDeltaMm: delta,
            footLengthMm: footLength,
            forefootWidthMm: measurement?.forefootWidthMm ?? null,
            heelWidthMm: measurement?.heelWidthMm ?? null,
            forefootVarusDeg: measurement?.forefootVarusDeg ?? null,
            rearfootAngleDeg: measurement?.rearfootAngleDeg ?? null,
            lengthNormalization,
            reviewFlags,
        },
    };
}

export function formatScanArchReadout(record: ScanDrivenArchRecord): string {
    const tier = record.assignedArchTier[0]!.toUpperCase() + record.assignedArchTier.slice(1);
    const measured =
        record.measuredArchMm == null ? "no plantar apex" : `${record.measuredArchMm.toFixed(1)} mm`;
    const normalized =
        record.normalizedArchMm == null ? "" : ` · normalized ${record.normalizedArchMm.toFixed(1)} mm`;
    const flags = record.reviewFlags.length > 0 ? ` · ${record.reviewFlags[0]}` : "";
    return `Arch ${measured}${normalized} → ${tier} (${record.assignedArchHeightMm.toFixed(1)} mm)${flags}`;
}

/** Half the M1–M5 vs template-width difference, clamped by the caller. */
export function forefootWidthDeltaMm(measuredForefootMm: number, templateWidthMm: number): number {
    if (!Number.isFinite(measuredForefootMm) || !Number.isFinite(templateWidthMm) || templateWidthMm <= 1) {
        return 0;
    }
    return Math.round(((measuredForefootMm - templateWidthMm) / 2) * 10) / 10;
}
