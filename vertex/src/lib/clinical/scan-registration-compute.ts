// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type * as THREE from "three";
import type { BufferGeometry } from "three";
import { getMarkerFrame, MarkerFrameError } from "@/lib/geometry/marker-frame";
import type { ScanDisplayInfo } from "@/lib/geometry/scan-display";
import { runScanRegistration, ScanRegistrationWireError } from "@/lib/geometry/scan-registration-wire";
import type { ScanMarkers, ScanRegistrationState } from "@/stores/scan-store";
import type { Side } from "@/types";

export type RegistrationTargetLayout = {
    lengthMm: number;
    widthMm: number;
};

function emptyRegistration(incomplete: boolean): ScanRegistrationState {
    return {
        matrixElements: null,
        residualRmsMm: null,
        identifiedSide: null,
        b1b2SeparationPct: null,
        error: null,
        incomplete,
    };
}

export function registrationKabschReady(
    m: ScanMarkers,
): m is { M1: THREE.Vector3; M2: THREE.Vector3; M3: THREE.Vector3; ARCH: THREE.Vector3 | null } {
    return !!(m.M1 && m.M2 && m.M3);
}

export function registrationMarkersReady(
    m: ScanMarkers,
): m is { M1: THREE.Vector3; M2: THREE.Vector3; M3: THREE.Vector3; ARCH: THREE.Vector3 } {
    return !!(m.M1 && m.M2 && m.M3 && m.ARCH);
}

function captureError(e: unknown): { code: string; message: string } {
    if (e instanceof ScanRegistrationWireError) {
        return { code: e.code, message: e.message };
    }
    if (e instanceof MarkerFrameError) {
        return { code: e.code, message: e.message };
    }
    return { code: "unknown", message: e instanceof Error ? e.message : String(e) };
}

/** Pure registration compute (mirrors scan-store). */
export function computeScanRegistration(args: {
    scanGeometry: BufferGeometry;
    scanSide: Side;
    display: ScanDisplayInfo;
    markers: ScanMarkers;
    sourceAssetId: string | null;
    rawBaseGeometry: BufferGeometry | undefined;
    targetLayout?: RegistrationTargetLayout | null;
}): ScanRegistrationState {
    if (!registrationKabschReady(args.markers)) {
        return emptyRegistration(true);
    }
    if (!args.sourceAssetId) {
        return {
            ...emptyRegistration(false),
            error: {
                code: "no_base_landmarks",
                message: "Base geometry not loaded — registration unavailable",
            },
        };
    }
    try {
        const nativeGeometry = args.rawBaseGeometry;
        const result = runScanRegistration({
            scanGeometry: args.scanGeometry,
            scanMarkersM1M2M3: [args.markers.M1, args.markers.M2, args.markers.M3],
            assignedSide: args.scanSide,
            sourceAssetId: args.sourceAssetId,
            unitScale: args.display.displayScale,
            targetLayout:
                nativeGeometry && args.targetLayout
                    ? {
                          lengthMm: args.targetLayout.lengthMm,
                          widthMm: args.targetLayout.widthMm,
                          nativeGeometry,
                      }
                    : undefined,
        });
        const frame = getMarkerFrame(args.sourceAssetId);
        return {
            matrixElements: Array.from(result.matrix.elements),
            residualRmsMm: result.residualRmsMm,
            identifiedSide: result.identifiedSide,
            b1b2SeparationPct: frame?.landmarks.b1b2SeparationPct ?? null,
            error: null,
            incomplete: false,
        };
    } catch (e) {
        return {
            ...emptyRegistration(false),
            error: captureError(e),
        };
    }
}
