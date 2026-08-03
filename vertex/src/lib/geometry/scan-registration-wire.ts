// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Phase 2 registration wiring: dorsal-derived chirality feed into frozen Kabsch,
 * side identification, and landmark mirroring for the right slot.
 *
 * marker-frame.ts / kabsch.ts are frozen — this module composes around them.
 */

import type { BufferGeometry } from "three";
import * as THREE from "three";
import { KabschError, type KabschResult, kabschRigid } from "@/lib/geometry/kabsch";
import {
    type BaseLandmarks,
    getMarkerFrame,
    mirrorBaseLandmarks,
    registerRawBaseGeometry,
    scaleBaseLandmarksToInsoleSize,
} from "@/lib/geometry/marker-frame";
import { registerScanToBase } from "@/lib/geometry/registration";
import { deriveScanDorsal, ScanDorsalError } from "@/lib/geometry/scan-dorsal";
import { footprintScaleFromNativeGeometry } from "@/lib/geometry/shoe-size";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side } from "@/types";

export type { BaseLandmarks };
export { mirrorBaseLandmarks };

export type ScanRegistrationWireErrorCode =
    | "wrong_foot_marker_order"
    | "side_assignment_mismatch"
    | "degenerate_marker_set"
    | "plantar_normal_disagreement"
    | "no_base_landmarks"
    | "incomplete_markers";

export class ScanRegistrationWireError extends Error {
    readonly code: ScanRegistrationWireErrorCode;

    constructor(code: ScanRegistrationWireErrorCode, message: string) {
        super(message);
        this.name = "ScanRegistrationWireError";
        this.code = code;
    }
}

type V3 = THREE.Vector3;

/**
 * Build R such that R * dorsal = +Z. `twistRad` is the free rotation about
 * dorsal (must not leak into the composed Kabsch result — see T13).
 */
export function rotationAligningDorsalToZ(dorsal: THREE.Vector3, twistRad = 0): THREE.Matrix4 {
    const z = dorsal.clone().normalize();
    const tmp = Math.abs(z.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const x0 = new THREE.Vector3().crossVectors(tmp, z).normalize();
    const y0 = new THREE.Vector3().crossVectors(z, x0).normalize();
    const c = Math.cos(twistRad);
    const s = Math.sin(twistRad);
    const x = new THREE.Vector3().addScaledVector(x0, c).addScaledVector(y0, s);
    const y = new THREE.Vector3().addScaledVector(y0, c).addScaledVector(x0, -s);
    // Columns of basis map local→world; we need world→local so dorsal→+Z.
    return new THREE.Matrix4().makeBasis(x, y, z).invert();
}

function applyMat4ToPoints(pts: readonly [V3, V3, V3], m: THREE.Matrix4): [V3, V3, V3] {
    return [pts[0].clone().applyMatrix4(m), pts[1].clone().applyMatrix4(m), pts[2].clone().applyMatrix4(m)];
}

/** Kabsch-compatible triangle normal (matches frozen landmarkNormal call order). */
function markerNormal(m1: V3, m2: V3, m3: V3): THREE.Vector3 {
    return new THREE.Vector3().subVectors(m2, m1).cross(new THREE.Vector3().subVectors(m3, m1));
}

/**
 * Identify which foot the markers describe using scan-derived dorsal as the
 * out-of-plane reference, compared against the registered LEFT base landmarks.
 */
export function identifySideFromMarkers(
    scanMarkers: [V3, V3, V3],
    dorsal: THREE.Vector3,
    leftLandmarks: BaseLandmarks,
): Side {
    const nScan = markerNormal(scanMarkers[0], scanMarkers[1], scanMarkers[2]);
    const scanSign = Math.sign(nScan.dot(dorsal));
    const nLeft = markerNormal(leftLandmarks.B1, leftLandmarks.B2, leftLandmarks.B3);
    const leftSign = Math.sign(nLeft.z);
    if (scanSign === 0 || leftSign === 0) {
        throw new ScanRegistrationWireError(
            "degenerate_marker_set",
            "Cannot identify foot: degenerate marker normal",
        );
    }
    return scanSign === leftSign ? "left" : "right";
}

export type WiredRegistrationResult = KabschResult & {
    identifiedSide: Side;
    /** Composed scan-local → base-local rigid transform (never bakes vertices). */
    matrix: THREE.Matrix4;
};

/** Discrete mm/cm/m correction only — never a fitted Kabsch scale. */
function resolveUnitScale(unitScale: number | undefined): number {
    return unitScale && Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1;
}

function markerResidualRmsMm(
    from: readonly [V3, V3, V3],
    to: readonly [V3, V3, V3],
    rotation: THREE.Matrix3,
    translation: THREE.Vector3,
): number {
    let sum = 0;
    for (let i = 0; i < 3; i++) {
        const p = from[i]!.clone().applyMatrix3(rotation).add(translation);
        sum += p.distanceToSquared(to[i]!);
    }
    return Math.sqrt(sum / 3);
}

/**
 * Kabsch centroid-fit centers the marker triple front-to-back. Clinically the
 * heel must seat in the heel cup: keep Kabsch rotation + ML/height translation,
 * then slide along footprint +X so M3.x lands on B3.x.
 */
export function seatHeelLongitudinally(
    kabsch: KabschResult,
    scanMarkersM1M2M3: readonly [V3, V3, V3],
    baseLandmarksB1B2B3: readonly [V3, V3, V3],
): KabschResult {
    const m3 = scanMarkersM1M2M3[2]!;
    const b3 = baseLandmarksB1B2B3[2]!;
    const m3Prime = m3.clone().applyMatrix3(kabsch.rotation).add(kabsch.translation);
    const dx = b3.x - m3Prime.x;
    if (Math.abs(dx) < 1e-12) return kabsch;

    const translation = kabsch.translation.clone();
    translation.x += dx;
    const e = kabsch.rotation.elements;
    const matrix = new THREE.Matrix4().set(
        e[0]!,
        e[3]!,
        e[6]!,
        translation.x,
        e[1]!,
        e[4]!,
        e[7]!,
        translation.y,
        e[2]!,
        e[5]!,
        e[8]!,
        translation.z,
        0,
        0,
        0,
        1,
    );
    return {
        rotation: kabsch.rotation,
        translation,
        residualRmsMm: markerResidualRmsMm(
            scanMarkersM1M2M3,
            baseLandmarksB1B2B3,
            kabsch.rotation,
            translation,
        ),
        matrix,
    };
}

/**
 * Derive dorsal from the scan surface, reorient moving markers so +Z = dorsal
 * (feeds the frozen chirality gate), run Kabsch, seat heel on +X, compose
 * matrixFinal = M * R_d * S.
 *
 * `unitScale` is the discrete Amendment-M units correction (1|10|1000). It is
 * not the provisional display matrix and not a free Kabsch scale.
 *
 * Optional `dorsalTwistRad` only for T13 — production callers omit it.
 */
export function registerScanWithDerivedDorsal(
    scanGeometry: BufferGeometry,
    scanMarkersM1M2M3: [V3, V3, V3],
    baseLandmarksB1B2B3: [V3, V3, V3],
    options?: { dorsalTwistRad?: number; unitScale?: number },
): WiredRegistrationResult {
    const unitScale = resolveUnitScale(options?.unitScale);
    // Neighbourhood radius is specified in mm; convert to raw scan units.
    const radiusRaw = 5 / unitScale;
    const dorsal = deriveScanDorsal(scanGeometry, scanMarkersM1M2M3, radiusRaw);
    const R_d = rotationAligningDorsalToZ(dorsal, options?.dorsalTwistRad ?? 0);
    const S = new THREE.Matrix4().makeScale(unitScale, unitScale, unitScale);
    // Markers → mm (S) then dorsal frame (R_d), then rigid Kabsch to base.
    const fromDorsal = applyMat4ToPoints(scanMarkersM1M2M3, R_d.clone().multiply(S));

    let kabsch: KabschResult;
    try {
        kabsch = registerScanToBase(fromDorsal, baseLandmarksB1B2B3);
    } catch (e) {
        if (e instanceof KabschError) {
            if (e.code === "wrong_foot_marker_order") {
                throw new ScanRegistrationWireError(
                    "wrong_foot_marker_order",
                    "markers indicate the opposite foot",
                );
            }
            throw new ScanRegistrationWireError("degenerate_marker_set", e.message);
        }
        throw e;
    }

    // Heel→heel cup seating (not front-to-back centroid centering).
    kabsch = seatHeelLongitudinally(kabsch, fromDorsal, baseLandmarksB1B2B3);

    const matrix = kabsch.matrix.clone().multiply(R_d).multiply(S);
    // identifiedSide filled by caller who has left landmarks; placeholder left here
    // when only this function is used in isolation — callers should prefer
    // `runScanRegistration` which sets it from anatomy.
    return {
        ...kabsch,
        matrix,
        identifiedSide: "left",
    };
}

/**
 * Full registration path: dorsal, side ID vs assigned, Kabsch against assigned
 * side landmarks. On any clinical mismatch the scan must NOT move.
 */
export function runScanRegistration(args: {
    scanGeometry: BufferGeometry;
    scanMarkersM1M2M3: [V3, V3, V3];
    assignedSide: Side;
    sourceAssetId: string;
    /** Discrete units correction (1|10|1000). Optional; defaults to 1 (mm). */
    unitScale?: number;
    /**
     * When set with nativeGeometry, Kabsch targets sized B1/B2/B3 so registration
     * matches the shoe-size-scaled base mesh (same map as scaleGeometryToInsoleSize).
     * Rigid registration — no similarity scale inside Kabsch.
     */
    targetLayout?: {
        lengthMm: number;
        widthMm: number;
        nativeGeometry: BufferGeometry;
    };
}): WiredRegistrationResult {
    const frame = getMarkerFrame(args.sourceAssetId);
    if (!frame) {
        throw new ScanRegistrationWireError(
            "no_base_landmarks",
            "Base landmarks not registered for this asset — wait for base load",
        );
    }
    const unitScale = resolveUnitScale(args.unitScale);
    let leftLm = frame.landmarks;
    if (args.targetLayout) {
        const scale = footprintScaleFromNativeGeometry(
            args.targetLayout.nativeGeometry,
            args.targetLayout.lengthMm,
            args.targetLayout.widthMm,
        );
        if (scale) {
            leftLm = scaleBaseLandmarksToInsoleSize(leftLm, scale, args.targetLayout.lengthMm);
        }
    }
    const dorsal = deriveScanDorsal(args.scanGeometry, args.scanMarkersM1M2M3, 5 / unitScale);
    const identified = identifySideFromMarkers(args.scanMarkersM1M2M3, dorsal, leftLm);

    // J5 / T3 — chirality vs assignment. Same clinical error as swapped M1/M2.
    // Name both values; do not move; do not auto-reassign.
    if (identified !== args.assignedSide) {
        throw new ScanRegistrationWireError(
            "side_assignment_mismatch",
            `markers indicate the opposite foot (markers identify ${identified}, scan assigned ${args.assignedSide})`,
        );
    }

    const landmarks = args.assignedSide === "right" ? mirrorBaseLandmarks(leftLm) : leftLm;
    const baseTriple: [V3, V3, V3] = [landmarks.B1, landmarks.B2, landmarks.B3];
    const result = registerScanWithDerivedDorsal(args.scanGeometry, args.scanMarkersM1M2M3, baseTriple, {
        unitScale,
    });
    return { ...result, identifiedSide: identified };
}

/**
 * J1 — register raw L0 under the SOURCE asset id.
 * Unmirrored: register directly.
 * Mirrored-only: if source not yet registered, inverse-mirror clone → derive →
 * register under source id → dispose clone. Still one derivation per source.
 */
export function ensureRawBaseRegistered(args: {
    assetId: string;
    geometry: BufferGeometry;
    mirrored: boolean;
    mirroredFrom?: string | null;
    primarySide: Side;
}): void {
    const sourceId = args.mirrored ? (args.mirroredFrom ?? args.assetId) : args.assetId;
    if (getMarkerFrame(sourceId)) return;

    if (!args.mirrored) {
        registerRawBaseGeometry(sourceId, args.geometry, { primarySide: args.primarySide });
        return;
    }

    // Inverse of production mirrorGeometry (reflection is an involution).
    const clone = mirrorGeometry(args.geometry);
    try {
        registerRawBaseGeometry(sourceId, clone, { primarySide: args.primarySide });
    } finally {
        clone.dispose();
    }
}

/** Direct Kabsch on the same markers (no dorsal pre-rotation) — T13 reference. */
export function directKabschMatrix(scanMarkers: [V3, V3, V3], baseMarkers: [V3, V3, V3]): THREE.Matrix4 {
    return kabschRigid(scanMarkers, baseMarkers).matrix;
}

export { ScanDorsalError };
