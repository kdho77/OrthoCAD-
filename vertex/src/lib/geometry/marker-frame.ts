// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import * as THREE from "three";
import { detectArchSideSign } from "@/lib/geometry/base-modifier";
import { deriveNativeShellThicknessDatum } from "@/lib/geometry/native-shell-thickness";
import type { Side } from "@/types";

/** XY map from native footprint bbox → sized insole (matches scaleGeometryToInsoleSize). */
export type FootprintScale = {
    sx: number;
    sy: number;
    x0: number;
    yMid: number;
};

/**
 * Marker support frame — Phase 1 datum infrastructure.
 *
 * B1/B2/B3 are derived once per base asset in the production-reoriented
 * footprint frame (X=length heel→toe, Y=width centred, Z=thickness). The plane
 * through those points is a per-asset CONSTANT in base coordinates: patient
 * scans register onto it; it never moves to meet the scan.
 *
 * Cache rule (C1): registration accepts geometry once; lookup never does.
 * `getMarkerFrame(assetId)` has no geometry parameter, so a conformed mesh
 * cannot be passed in and cannot silently re-key the cache (R3).
 */

export type MarkerFrameErrorCode =
    | "no_geometry"
    | "not_multi_mesh"
    | "degenerate_landmarks"
    | "empty_forefoot_side"
    | "degenerate_plane"
    | "laterality_mismatch";

export class MarkerFrameError extends Error {
    readonly code: MarkerFrameErrorCode;

    constructor(code: MarkerFrameErrorCode, message: string) {
        super(message);
        this.name = "MarkerFrameError";
        this.code = code;
    }
}

export interface BaseLandmarks {
    /** Medial metatarsal head (1st MPJ prominence). */
    B1: THREE.Vector3;
    /** Lateral metatarsal head (5th MPJ prominence). */
    B2: THREE.Vector3;
    /** Heel centre (plantar centroid of heel third). */
    B3: THREE.Vector3;
    footLengthMm: number;
    /**
     * Signed longitudinal separation as % of foot length: (u_B1 − u_B2) × 100.
     * Positive when B2 (5th) is proximal to B1 (1st), as required anatomically.
     */
    b1b2SeparationPct: number;
    /** Width-axis sign of the medial (arch) side: +1 → +Y, −1 → −Y. */
    medialWidthSign: number;
    /** Band half-width used for crest centroids (0.5 or widened 1.0). */
    crestBandMm: number;
    /** Vertices in the medial / lateral crest bands. */
    crestBandCounts: { medial: number; lateral: number };
}

export interface MarkerFrame {
    /** Rigid map: reoriented-base → marker frame. det = +1. */
    matrix: THREE.Matrix4;
    inverse: THREE.Matrix4;
    landmarks: BaseLandmarks;
    origin: THREE.Vector3;
    xAxis: THREE.Vector3;
    yAxis: THREE.Vector3;
    zAxis: THREE.Vector3;
    assetId: string;
}

export interface HeightDatumDelta {
    /** Angle between B-plane and AABB XY (plantar) plane, degrees. */
    angleDeg: number;
    /** Signed perpendicular offset of B-plane above the plantar plane at B3. */
    offsetHeelMm: number;
    /** Offset at arch-apex station (u ≈ 0.42 on midline). */
    offsetArchApexMm: number;
    /** Offset at mid(B1,B2) station. */
    offsetMetMm: number;
    maxAbsOffsetMm: number;
    plantarPlaneZ: number;
}

/** T12 — separate rigid translation from tilt so they are never re-conflated. */
export interface HeightDatumDecomposition {
    /** Plane angle (degrees). */
    rotationDeg: number;
    /** Axis of rotation (unit), or null when planes are parallel within 1e-9. */
    rotationAxis: THREE.Vector3 | null;
    /**
     * Rigid translation along reoriented +Z (mm): B-plane height above plantar
     * after the linear tilt relative to the heel station is removed.
     * Uniform across heel / arch / met within 0.01mm when the offset field is
     * exactly a plane (shell thickness + tilt).
     */
    translationMm: number;
    /** Per-station translation after tilt removal (should match translationMm). */
    translationAtStationsMm: {
        heel: number;
        archApex: number;
        met: number;
    };
    /** Max |T_station − T_heel| after tilt removal (mm). */
    translationUniformityMm: number;
}

const FOREFOOT_U_MIN = 0.55;
const FOREFOOT_U_MAX = 0.95;
const HEEL_U_MAX = 1 / 3;
const HEEL_PLANTAR_Z_FRAC = 0.15;
const ARCH_APEX_U = 0.42;
const CREST_BAND_MM = 0.5;
const CREST_BAND_WIDE_MM = 1.0;
const CREST_BAND_MIN_COUNT = 15;
const REGISTRY_CAP = 16;
/** Midfoot band for medial-arch laterality (matches detectArchSideSign). */
const MIDFOOT_U_MIN = 0.32;
const MIDFOOT_U_MAX = 0.62;

interface RegistryEntry {
    assetId: string;
    geometryUuid: string;
    frame: MarkerFrame;
    lastUsed: number;
}

const registry = new Map<string, RegistryEntry>();
let lruClock = 0;

function requireTopSplit(base: BufferGeometry): {
    arr: Float32Array;
    topN: number;
} {
    const pos = base.getAttribute("position");
    if (!pos) {
        throw new MarkerFrameError("no_geometry", "Base geometry has no position attribute");
    }
    const ud = base.userData as { isMultiMeshBase?: boolean; topVertexCount?: number };
    const topN =
        ud.isMultiMeshBase && typeof ud.topVertexCount === "number" && ud.topVertexCount > 0
            ? ud.topVertexCount
            : 0;
    if (topN <= 0 || topN >= pos.count) {
        throw new MarkerFrameError(
            "not_multi_mesh",
            "Marker landmarks require a multi-mesh base with userData.topVertexCount",
        );
    }
    return { arr: pos.array as Float32Array, topN };
}

function topBounds(
    arr: Float32Array,
    topN: number,
): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    lengthMm: number;
} {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < topN; i++) {
        const x = arr[i * 3]!;
        const y = arr[i * 3 + 1]!;
        const z = arr[i * 3 + 2]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    return { minX, maxX, minY, maxY, minZ, maxZ, lengthMm: maxX - minX || 1 };
}

/**
 * Derive medial width-axis sign from midfoot plantar height asymmetry.
 * Returns +1 when the arch (higher midfoot) sits on +Y, −1 on −Y.
 */
export function deriveMedialWidthSign(base: BufferGeometry): number {
    const { arr, topN } = requireTopSplit(base);
    const { minX, lengthMm } = topBounds(arr, topN);

    let posSum = 0;
    let posN = 0;
    let negSum = 0;
    let negN = 0;
    for (let i = 0; i < topN; i++) {
        const u = (arr[i * 3]! - minX) / lengthMm;
        if (u < MIDFOOT_U_MIN || u > MIDFOOT_U_MAX) continue;
        const y = arr[i * 3 + 1]!;
        const z = arr[i * 3 + 2]!;
        if (y > 0) {
            posSum += z;
            posN++;
        } else if (y < 0) {
            negSum += z;
            negN++;
        }
    }
    if (posN === 0 || negN === 0) {
        throw new MarkerFrameError("laterality_mismatch", "Cannot derive medial sign: empty midfoot half");
    }
    const diff = posSum / posN - negSum / negN;
    if (Math.abs(diff) < 1e-6) {
        throw new MarkerFrameError(
            "laterality_mismatch",
            "Cannot derive medial sign: midfoot height symmetry",
        );
    }
    return diff > 0 ? 1 : -1;
}

function crestCentroid(
    arr: Float32Array,
    topN: number,
    minX: number,
    lengthMm: number,
    scoreOf: (y: number) => number,
    bandMm: number,
): { centroid: THREE.Vector3; count: number; maxScore: number; bandMm: number } {
    let maxScore = -Infinity;
    for (let i = 0; i < topN; i++) {
        const u = (arr[i * 3]! - minX) / lengthMm;
        if (u < FOREFOOT_U_MIN || u > FOREFOOT_U_MAX) continue;
        const s = scoreOf(arr[i * 3 + 1]!);
        if (s > maxScore) maxScore = s;
    }
    if (!Number.isFinite(maxScore)) {
        throw new MarkerFrameError("empty_forefoot_side", "Forefoot window has no vertices on side");
    }

    const collect = (band: number) => {
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (let i = 0; i < topN; i++) {
            const u = (arr[i * 3]! - minX) / lengthMm;
            if (u < FOREFOOT_U_MIN || u > FOREFOOT_U_MAX) continue;
            const y = arr[i * 3 + 1]!;
            if (scoreOf(y) < maxScore - band) continue;
            sx += arr[i * 3]!;
            sy += y;
            sz += arr[i * 3 + 2]!;
            n++;
        }
        return { sx, sy, sz, n, band };
    };

    let hit = collect(bandMm);
    let usedBand = bandMm;
    if (hit.n < CREST_BAND_MIN_COUNT) {
        hit = collect(CREST_BAND_WIDE_MM);
        usedBand = CREST_BAND_WIDE_MM;
    }
    if (hit.n === 0) {
        throw new MarkerFrameError("empty_forefoot_side", "Crest band empty after widen");
    }
    return {
        centroid: new THREE.Vector3(hit.sx / hit.n, hit.sy / hit.n, hit.sz / hit.n),
        count: hit.n,
        maxScore,
        bandMm: usedBand,
    };
}

/**
 * Pure landmark derivation on a production-reoriented multi-mesh base (TOP only).
 * Does not touch the registry.
 */
export function deriveBaseLandmarks(
    base: BufferGeometry | null | undefined,
    _options: { primarySide: Side } = { primarySide: "left" },
): BaseLandmarks | null {
    if (!base) return null;

    const { arr, topN } = requireTopSplit(base);
    const { minX, lengthMm } = topBounds(arr, topN);

    const medialWidthSign = deriveMedialWidthSign(base);
    const archSign = detectArchSideSign(base);
    if (medialWidthSign !== archSign) {
        throw new MarkerFrameError(
            "laterality_mismatch",
            `Derived medialWidthSign=${medialWidthSign} disagrees with detectArchSideSign=${archSign}`,
        );
    }

    // B3 — heel-third plantar centroid
    let heelMinZ = Infinity;
    let heelMaxZ = -Infinity;
    for (let i = 0; i < topN; i++) {
        const u = (arr[i * 3]! - minX) / lengthMm;
        if (u > HEEL_U_MAX) continue;
        const z = arr[i * 3 + 2]!;
        if (z < heelMinZ) heelMinZ = z;
        if (z > heelMaxZ) heelMaxZ = z;
    }
    const heelZCut = heelMinZ + HEEL_PLANTAR_Z_FRAC * (heelMaxZ - heelMinZ || 1);
    let hSx = 0;
    let hSy = 0;
    let hSz = 0;
    let hN = 0;
    for (let i = 0; i < topN; i++) {
        const u = (arr[i * 3]! - minX) / lengthMm;
        if (u > HEEL_U_MAX) continue;
        const z = arr[i * 3 + 2]!;
        if (z > heelZCut) continue;
        hSx += arr[i * 3]!;
        hSy += arr[i * 3 + 1]!;
        hSz += z;
        hN++;
    }
    if (hN === 0) {
        throw new MarkerFrameError("degenerate_landmarks", "Heel plantar band empty");
    }
    const B3 = new THREE.Vector3(hSx / hN, hSy / hN, hSz / hN);

    // B1/B2 — independent crest centroids (C2). Medial score = y * medialWidthSign.
    const medial = crestCentroid(arr, topN, minX, lengthMm, (y) => y * medialWidthSign, CREST_BAND_MM);
    const lateral = crestCentroid(arr, topN, minX, lengthMm, (y) => -y * medialWidthSign, CREST_BAND_MM);
    const B1 = medial.centroid;
    const B2 = lateral.centroid;

    const crestBandMm = Math.max(medial.bandMm, lateral.bandMm);
    if (medial.bandMm > CREST_BAND_MM || lateral.bandMm > CREST_BAND_MM) {
        if (typeof console !== "undefined") {
            console.warn(
                `[marker-frame] crest band widened to ${crestBandMm}mm ` +
                    `(medial n=${medial.count}, lateral n=${lateral.count})`,
            );
        }
    }

    // Degeneracy: coincident or near-collinear
    const d12 = B1.distanceTo(B2);
    const d13 = B1.distanceTo(B3);
    const d23 = B2.distanceTo(B3);
    if (d12 < 1e-3 || d13 < 1e-3 || d23 < 1e-3) {
        throw new MarkerFrameError("degenerate_landmarks", "Coincident B1/B2/B3");
    }
    const area2 = new THREE.Vector3().subVectors(B2, B3).cross(new THREE.Vector3().subVectors(B1, B3));
    if (area2.length() < 1e-3) {
        throw new MarkerFrameError("degenerate_landmarks", "Collinear B1/B2/B3");
    }

    const uB1 = (B1.x - minX) / lengthMm;
    const uB2 = (B2.x - minX) / lengthMm;
    // Signed: positive when B2 proximal (smaller u) to B1 (C4).
    const b1b2SeparationPct = (uB1 - uB2) * 100;

    return {
        B1,
        B2,
        B3,
        footLengthMm: lengthMm,
        b1b2SeparationPct,
        medialWidthSign,
        crestBandMm,
        crestBandCounts: { medial: medial.count, lateral: lateral.count },
    };
}

/** Build rigid T_marker: reoriented base → marker frame. */
export function buildMarkerFrame(landmarks: BaseLandmarks, assetId = ""): MarkerFrame {
    const { B1, B2, B3 } = landmarks;
    const v2 = new THREE.Vector3().subVectors(B2, B3);
    const v1 = new THREE.Vector3().subVectors(B1, B3);
    const zAxis = new THREE.Vector3().crossVectors(v2, v1);
    if (zAxis.lengthSq() < 1e-12) {
        throw new MarkerFrameError("degenerate_plane", "B1/B2/B3 do not span a plane");
    }
    zAxis.normalize();
    // Orient dorsally (+Z of reoriented frame).
    if (zAxis.z < 0) zAxis.negate();

    const mid = new THREE.Vector3().addVectors(B1, B2).multiplyScalar(0.5);
    const toMid = new THREE.Vector3().subVectors(mid, B3);
    // Project into plane.
    const xAxis = toMid.sub(zAxis.clone().multiplyScalar(toMid.dot(zAxis)));
    if (xAxis.lengthSq() < 1e-12) {
        throw new MarkerFrameError("degenerate_plane", "mid(B1,B2) projects to origin");
    }
    xAxis.normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

    // Columns = basis in reoriented space → maps marker-local → base.
    // Invert for T_marker: base → marker.
    const basisDet = xAxis.dot(new THREE.Vector3().crossVectors(yAxis, zAxis));
    if (basisDet < 0 || Math.abs(basisDet - 1) > 1e-6) {
        throw new MarkerFrameError(
            "degenerate_plane",
            `Marker basis det=${basisDet}, require +1 (got reflection or non-orthonormal)`,
        );
    }

    const markerToBase = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    markerToBase.setPosition(B3);
    const matrix = markerToBase.clone().invert();
    const rDet = rotationDeterminant(matrix);
    if (rDet < 0 || Math.abs(rDet - 1) > 1e-6) {
        throw new MarkerFrameError("degenerate_plane", `det(T_marker)=${rDet}, require +1`);
    }

    return {
        matrix,
        inverse: markerToBase.clone(),
        landmarks: {
            ...landmarks,
            B1: B1.clone(),
            B2: B2.clone(),
            B3: B3.clone(),
        },
        origin: B3.clone(),
        xAxis: xAxis.clone(),
        yAxis: yAxis.clone(),
        zAxis: zAxis.clone(),
        assetId,
    };
}

function rotationDeterminant(m: THREE.Matrix4): number {
    const e = new THREE.Matrix4().extractRotation(m).elements;
    return (
        e[0]! * (e[5]! * e[10]! - e[6]! * e[9]!) -
        e[1]! * (e[4]! * e[10]! - e[6]! * e[8]!) +
        e[2]! * (e[4]! * e[9]! - e[5]! * e[8]!)
    );
}

function evictLru(): void {
    if (registry.size < REGISTRY_CAP) return;
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [k, v] of registry) {
        if (v.lastUsed < oldest) {
            oldest = v.lastUsed;
            oldestKey = k;
        }
    }
    if (oldestKey) registry.delete(oldestKey);
}

/**
 * Register the raw L0 base geometry for an asset. Call once at load.
 * Re-registering the same assetId with a different geometry replaces the entry
 * and logs (legitimate reload). Cap 16, LRU.
 *
 * NOT wired into any production load site in Phase 1 — tests call it directly.
 */
export function registerRawBaseGeometry(
    assetId: string,
    rawGeometry: BufferGeometry,
    options: { primarySide: Side } = { primarySide: "left" },
): MarkerFrame {
    const existing = registry.get(assetId);
    if (existing && existing.geometryUuid !== rawGeometry.uuid) {
        if (typeof console !== "undefined") {
            console.warn(
                `[marker-frame] re-registering assetId="${assetId}" with new geometry uuid ` +
                    `(was ${existing.geometryUuid}, now ${rawGeometry.uuid})`,
            );
        }
    }

    const landmarks = deriveBaseLandmarks(rawGeometry, options);
    if (!landmarks) {
        throw new MarkerFrameError("no_geometry", "deriveBaseLandmarks returned null");
    }
    // Anatomical sanity: B2 proximal to B1 (signed separation > 0)
    if (landmarks.b1b2SeparationPct <= 0) {
        throw new MarkerFrameError(
            "degenerate_landmarks",
            `B2 is not proximal to B1 (signed separation ${landmarks.b1b2SeparationPct.toFixed(2)}%)`,
        );
    }

    const frame = buildMarkerFrame(landmarks, assetId);
    const rDet = rotationDeterminant(frame.matrix);
    if (Math.abs(rDet - 1) > 1e-6) {
        throw new MarkerFrameError("degenerate_plane", `det(T_marker)=${rDet}, require +1`);
    }

    evictLru();
    lruClock += 1;
    registry.set(assetId, {
        assetId,
        geometryUuid: rawGeometry.uuid,
        frame,
        lastUsed: lruClock,
    });
    return frame;
}

/**
 * Cached accessor — NO geometry parameter (C1 / T6).
 * Returns null when the asset has not been registered.
 */
export function getMarkerFrame(assetId: string): MarkerFrame | null {
    const entry = registry.get(assetId);
    if (!entry) return null;
    lruClock += 1;
    entry.lastUsed = lruClock;
    return entry.frame;
}

/** Test helper. */
export function clearMarkerFrameRegistry(): void {
    registry.clear();
    lruClock = 0;
}

/** Scale B1/B2/B3 into the shoe-size footprint frame (Z unchanged). */
export function scaleBaseLandmarksToInsoleSize(
    landmarks: BaseLandmarks,
    scale: FootprintScale,
    lengthMm: number,
): BaseLandmarks {
    const map = (v: THREE.Vector3) =>
        new THREE.Vector3((v.x - scale.x0) * scale.sx, (v.y - scale.yMid) * scale.sy, v.z);
    return {
        ...landmarks,
        B1: map(landmarks.B1),
        B2: map(landmarks.B2),
        B3: map(landmarks.B3),
        footLengthMm: lengthMm,
    };
}

/** Mirror landmarks across the sagittal (Y) plane — for right-slot carry. */
export function mirrorBaseLandmarks(landmarks: BaseLandmarks): BaseLandmarks {
    const flip = (v: THREE.Vector3) => new THREE.Vector3(v.x, -v.y, v.z);
    return {
        ...landmarks,
        B1: flip(landmarks.B1),
        B2: flip(landmarks.B2),
        B3: flip(landmarks.B3),
        medialWidthSign: -landmarks.medialWidthSign,
    };
}

function planeSignedDistance(
    point: THREE.Vector3,
    planePoint: THREE.Vector3,
    planeNormal: THREE.Vector3,
): number {
    return new THREE.Vector3().subVectors(point, planePoint).dot(planeNormal);
}

/**
 * Phase 1C — angle / offset between B-plane and the current AABB plantar datum.
 * Read-only use of deriveNativeShellThicknessDatum.
 */
export function measureHeightDatumDelta(rawBase: BufferGeometry, frame: MarkerFrame): HeightDatumDelta {
    const datum = deriveNativeShellThicknessDatum(rawBase);
    if (!datum) {
        throw new MarkerFrameError(
            "not_multi_mesh",
            "Cannot measure height datum delta without thickness datum",
        );
    }
    const plantarPlaneZ = datum.plantarPlaneZ;
    const aabbNormal = new THREE.Vector3(0, 0, 1);
    const bNormal = frame.zAxis.clone().normalize();
    const cos = Math.max(-1, Math.min(1, aabbNormal.dot(bNormal)));
    const angleDeg = (Math.acos(cos) * 180) / Math.PI;

    // B-plane through B3 with normal bNormal. Plantar plane: z = plantarPlaneZ, n=+Z.
    // Perpendicular offset from plantar plane to B-plane, evaluated at stations
    // projected onto the plantar plane (x,y,*) — i.e. signed distance of the
    // B-plane point at that (x,y) above z=plantarPlaneZ along +Z, OR the true
    // perpendicular distance between planes along bNormal.
    //
    // For "Z displacement corrections would experience", use the difference in
    // Z between the two planes at each station's (x,y):
    //   B-plane: n·(p - B3) = 0 → nz*(z - B3.z) = -nx*(x-B3.x)-ny*(y-B3.y)
    //   z_B = B3.z - (nx*(x-B3.x)+ny*(y-B3.y))/nz
    //   offset = z_B - plantarPlaneZ
    const nz = bNormal.z;
    if (Math.abs(nz) < 1e-9) {
        throw new MarkerFrameError("degenerate_plane", "B-plane normal is horizontal");
    }
    const zOnB = (x: number, y: number) => {
        const nx = bNormal.x;
        const ny = bNormal.y;
        return (
            frame.landmarks.B3.z - (nx * (x - frame.landmarks.B3.x) + ny * (y - frame.landmarks.B3.y)) / nz
        );
    };

    const heelZ = zOnB(frame.landmarks.B3.x, frame.landmarks.B3.y);
    const offsetHeelMm = heelZ - plantarPlaneZ;

    const { arr, topN } = requireTopSplit(rawBase);
    const { minX, lengthMm } = topBounds(arr, topN);
    // Arch apex station: mean Y of top verts near u=0.42
    let archSx = 0;
    let archSy = 0;
    let archN = 0;
    for (let i = 0; i < topN; i++) {
        const u = (arr[i * 3]! - minX) / lengthMm;
        if (Math.abs(u - ARCH_APEX_U) > 0.02) continue;
        archSx += arr[i * 3]!;
        archSy += arr[i * 3 + 1]!;
        archN++;
    }
    const archX = archN > 0 ? archSx / archN : minX + ARCH_APEX_U * lengthMm;
    const archY = archN > 0 ? archSy / archN : 0;
    const offsetArchApexMm = zOnB(archX, archY) - plantarPlaneZ;

    const metX = 0.5 * (frame.landmarks.B1.x + frame.landmarks.B2.x);
    const metY = 0.5 * (frame.landmarks.B1.y + frame.landmarks.B2.y);
    const offsetMetMm = zOnB(metX, metY) - plantarPlaneZ;

    // Also report true plane-to-plane separation along normal at heel (sanity)
    void planeSignedDistance(
        new THREE.Vector3(frame.landmarks.B3.x, frame.landmarks.B3.y, plantarPlaneZ),
        frame.landmarks.B3,
        bNormal,
    );

    const maxAbsOffsetMm = Math.max(
        Math.abs(offsetHeelMm),
        Math.abs(offsetArchApexMm),
        Math.abs(offsetMetMm),
    );

    return {
        angleDeg,
        offsetHeelMm,
        offsetArchApexMm,
        offsetMetMm,
        maxAbsOffsetMm,
        plantarPlaneZ,
    };
}

/**
 * T12 — decompose B-plane vs plantar into rigid +Z translation and tilt.
 * Does NOT project landmarks toward plantarPlaneZ.
 */
export function decomposeHeightDatumRelationship(
    rawBase: BufferGeometry,
    frame: MarkerFrame,
): HeightDatumDecomposition {
    const delta = measureHeightDatumDelta(rawBase, frame);
    const bNormal = frame.zAxis.clone().normalize();
    const aabbNormal = new THREE.Vector3(0, 0, 1);
    const axis = new THREE.Vector3().crossVectors(aabbNormal, bNormal);
    const axisLen = axis.length();
    const rotationAxis = axisLen > 1e-12 ? axis.multiplyScalar(1 / axisLen) : null;

    const nz = bNormal.z;
    if (Math.abs(nz) < 1e-9) {
        throw new MarkerFrameError("degenerate_plane", "B-plane normal is horizontal");
    }
    const slopeX = -bNormal.x / nz;
    const slopeY = -bNormal.y / nz;

    const heel = frame.landmarks.B3;
    const { arr, topN } = requireTopSplit(rawBase);
    const { minX, lengthMm } = topBounds(arr, topN);
    let archSx = 0;
    let archSy = 0;
    let archN = 0;
    for (let i = 0; i < topN; i++) {
        const u = (arr[i * 3]! - minX) / lengthMm;
        if (Math.abs(u - ARCH_APEX_U) > 0.02) continue;
        archSx += arr[i * 3]!;
        archSy += arr[i * 3 + 1]!;
        archN++;
    }
    const arch = {
        x: archN > 0 ? archSx / archN : minX + ARCH_APEX_U * lengthMm,
        y: archN > 0 ? archSy / archN : 0,
    };
    const met = {
        x: 0.5 * (frame.landmarks.B1.x + frame.landmarks.B2.x),
        y: 0.5 * (frame.landmarks.B1.y + frame.landmarks.B2.y),
    };

    const zOnB = (x: number, y: number) =>
        heel.z - (bNormal.x * (x - heel.x) + bNormal.y * (y - heel.y)) / nz;

    const offsetAt = (x: number, y: number) => zOnB(x, y) - delta.plantarPlaneZ;
    // Tilt relative to heel: Δz from plane slopes (heel pivot → tilt contribution 0).
    const tiltFromHeel = (x: number, y: number) => slopeX * (x - heel.x) + slopeY * (y - heel.y);

    const tHeel = offsetAt(heel.x, heel.y) - tiltFromHeel(heel.x, heel.y);
    const tArch = offsetAt(arch.x, arch.y) - tiltFromHeel(arch.x, arch.y);
    const tMet = offsetAt(met.x, met.y) - tiltFromHeel(met.x, met.y);

    const translationUniformityMm = Math.max(
        Math.abs(tArch - tHeel),
        Math.abs(tMet - tHeel),
        Math.abs(tArch - tMet),
    );

    return {
        rotationDeg: delta.angleDeg,
        rotationAxis,
        translationMm: tHeel,
        translationAtStationsMm: { heel: tHeel, archApex: tArch, met: tMet },
        translationUniformityMm,
    };
}

/**
 * Shared-station widest-section search — Phase 0 plateau tombstone helper.
 * Returns stations within 1mm of the max width in the forefoot window.
 * NOT used for landmark derivation.
 */
export function sharedStationWidthPlateau(
    base: BufferGeometry,
    stations = 80,
): { u: number; widthMm: number }[] {
    const { arr, topN } = requireTopSplit(base);
    const { minX, lengthMm } = topBounds(arr, topN);
    const bins = Array.from({ length: stations }, () => ({
        minY: Infinity,
        maxY: -Infinity,
        c: 0,
    }));
    for (let i = 0; i < topN; i++) {
        const u = (arr[i * 3]! - minX) / lengthMm;
        if (u < FOREFOOT_U_MIN || u > FOREFOOT_U_MAX) continue;
        const bi = Math.min(stations - 1, Math.max(0, Math.floor(u * stations)));
        const b = bins[bi]!;
        const y = arr[i * 3 + 1]!;
        b.c++;
        if (y < b.minY) b.minY = y;
        if (y > b.maxY) b.maxY = y;
    }
    const widths = bins
        .map((b, i) => ({
            u: (i + 0.5) / stations,
            widthMm: Number.isFinite(b.minY) ? b.maxY - b.minY : 0,
            c: b.c,
        }))
        .filter((w) => w.u >= FOREFOOT_U_MIN && w.u <= FOREFOOT_U_MAX && w.c > 20);
    widths.sort((a, b) => b.widthMm - a.widthMm);
    if (widths.length === 0) return [];
    const maxW = widths[0]!.widthMm;
    return widths.filter((w) => maxW - w.widthMm <= 1.0).map((w) => ({ u: w.u, widthMm: w.widthMm }));
}
