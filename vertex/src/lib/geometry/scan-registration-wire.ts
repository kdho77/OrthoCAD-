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
} from "@/lib/geometry/marker-frame";
import { registerScanToBase } from "@/lib/geometry/registration";
import { deriveScanDorsal, ScanDorsalError } from "@/lib/geometry/scan-dorsal";
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

/**
 * Derive dorsal from the scan surface, reorient moving markers so +Z = dorsal
 * (feeds the frozen chirality gate), run Kabsch, compose matrixFinal = M * R_d.
 *
 * Optional `dorsalTwistRad` only for T13 — production callers omit it.
 */
export function registerScanWithDerivedDorsal(
    scanGeometry: BufferGeometry,
    scanMarkersM1M2M3: [V3, V3, V3],
    baseLandmarksB1B2B3: [V3, V3, V3],
    options?: { dorsalTwistRad?: number },
): WiredRegistrationResult {
    const dorsal = deriveScanDorsal(scanGeometry, scanMarkersM1M2M3);
    const R_d = rotationAligningDorsalToZ(dorsal, options?.dorsalTwistRad ?? 0);
    const fromDorsal = applyMat4ToPoints(scanMarkersM1M2M3, R_d);

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

    const matrix = kabsch.matrix.clone().multiply(R_d);
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
}): WiredRegistrationResult {
    const frame = getMarkerFrame(args.sourceAssetId);
    if (!frame) {
        throw new ScanRegistrationWireError(
            "no_base_landmarks",
            "Base landmarks not registered for this asset — wait for base load",
        );
    }
    const leftLm = frame.landmarks;
    const dorsal = deriveScanDorsal(args.scanGeometry, args.scanMarkersM1M2M3);
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
    const result = registerScanWithDerivedDorsal(args.scanGeometry, args.scanMarkersM1M2M3, baseTriple);
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
