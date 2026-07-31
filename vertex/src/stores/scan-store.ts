// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import * as THREE from "three";
import { create } from "zustand";
import type { ImportFormat } from "@/lib/geometry/import";
import { KabschError } from "@/lib/geometry/kabsch";
import type { ManifoldReport } from "@/lib/geometry/manifold";
import { getMarkerFrame, MarkerFrameError } from "@/lib/geometry/marker-frame";
import { ScanDorsalError } from "@/lib/geometry/scan-dorsal";
import { runScanRegistration, ScanRegistrationWireError } from "@/lib/geometry/scan-registration-wire";
import type { Side } from "@/types";

export interface ImportedScan {
    id: string;
    name: string;
    side: Side;
    format: ImportFormat;
    triangleCount: number;
    geometry: BufferGeometry;
    manifold: ManifoldReport;
    visible: boolean;
}

export type MarkerId = "M1" | "M2" | "M3";

export interface ScanMarkers {
    M1: THREE.Vector3 | null;
    M2: THREE.Vector3 | null;
    M3: THREE.Vector3 | null;
}

export interface ScanRegistrationState {
    /** Elements of Matrix4 (column-major) — never persist a live Matrix4 object. */
    matrixElements: number[] | null;
    residualRmsMm: number | null;
    identifiedSide: Side | null;
    b1b2SeparationPct: number | null;
    error: { code: string; message: string } | null;
    incomplete: boolean;
}

export interface PlacementMode {
    scanId: string;
    next: MarkerId;
}

const EMPTY_MARKERS: ScanMarkers = { M1: null, M2: null, M3: null };

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

function nextMarker(m: ScanMarkers): MarkerId {
    if (!m.M1) return "M1";
    if (!m.M2) return "M2";
    return "M3";
}

function allPlaced(m: ScanMarkers): m is { M1: THREE.Vector3; M2: THREE.Vector3; M3: THREE.Vector3 } {
    return !!(m.M1 && m.M2 && m.M3);
}

interface ScanStore {
    scans: ImportedScan[];
    markersByScanId: Record<string, ScanMarkers>;
    registrationByScanId: Record<string, ScanRegistrationState>;
    placementMode: PlacementMode | null;
    deviationOverlay: boolean;
    /** True while deviation colour field is being computed (K3 busy treatment). */
    deviationBusy: boolean;
    /** Source asset id used for landmark lookup (unmirrored registry key). */
    landmarkSourceAssetId: string | null;
    /** RAW L0 geometry clones keyed by source asset id — deviation measures against these. */
    rawBaseBySourceId: Record<string, BufferGeometry>;

    addScan: (scan: Omit<ImportedScan, "visible">) => void;
    removeScan: (id: string) => void;
    setSide: (id: string, side: Side) => void;
    toggleVisible: (id: string) => void;
    clear: () => void;

    enterPlacement: (scanId: string) => void;
    exitPlacement: () => void;
    setMarker: (scanId: string, id: MarkerId, point: THREE.Vector3) => void;
    resetMarkers: (scanId: string) => void;
    setDeviationOverlay: (on: boolean) => void;
    setDeviationBusy: (busy: boolean) => void;
    setLandmarkSourceAssetId: (assetId: string | null) => void;
    setRawBaseGeometry: (sourceAssetId: string, geo: BufferGeometry) => void;
    /** Re-run registration for a scan (after marker drag / side change). */
    recomputeRegistration: (scanId: string) => void;
}

function captureError(e: unknown): { code: string; message: string } {
    if (e instanceof ScanRegistrationWireError) {
        return { code: e.code, message: e.message };
    }
    if (e instanceof ScanDorsalError) {
        return { code: e.code, message: e.message };
    }
    if (e instanceof KabschError) {
        return {
            code: e.code,
            message: e.code === "wrong_foot_marker_order" ? "markers indicate the opposite foot" : e.message,
        };
    }
    if (e instanceof MarkerFrameError) {
        return { code: e.code, message: e.message };
    }
    return { code: "unknown", message: e instanceof Error ? e.message : String(e) };
}

function computeRegistration(
    scan: ImportedScan,
    markers: ScanMarkers,
    sourceAssetId: string | null,
): ScanRegistrationState {
    if (!allPlaced(markers)) {
        return emptyRegistration(true);
    }
    if (!sourceAssetId) {
        return {
            ...emptyRegistration(false),
            error: {
                code: "no_base_landmarks",
                message: "Base geometry not loaded — placement registration unavailable",
            },
        };
    }
    try {
        const result = runScanRegistration({
            scanGeometry: scan.geometry,
            scanMarkersM1M2M3: [markers.M1, markers.M2, markers.M3],
            assignedSide: scan.side,
            sourceAssetId,
        });
        // Separation % is identical after mirror (signed length ratio).
        const frame = getMarkerFrame(sourceAssetId);
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

export const useScanStore = create<ScanStore>((set, get) => ({
    scans: [],
    markersByScanId: {},
    registrationByScanId: {},
    placementMode: null,
    deviationOverlay: false,
    deviationBusy: false,
    landmarkSourceAssetId: null,
    rawBaseBySourceId: {},

    addScan: (scan) =>
        set((s) => ({
            scans: [...s.scans, { ...scan, visible: true }],
            // Re-import / new mesh: never retain markers pointing at a deleted mesh.
            markersByScanId: { ...s.markersByScanId, [scan.id]: { ...EMPTY_MARKERS } },
            registrationByScanId: {
                ...s.registrationByScanId,
                [scan.id]: emptyRegistration(true),
            },
        })),

    removeScan: (id) =>
        set((s) => {
            const target = s.scans.find((x) => x.id === id);
            target?.geometry.dispose();
            const { [id]: _m, ...markersByScanId } = s.markersByScanId;
            const { [id]: _r, ...registrationByScanId } = s.registrationByScanId;
            return {
                scans: s.scans.filter((x) => x.id !== id),
                markersByScanId,
                registrationByScanId,
                placementMode: s.placementMode?.scanId === id ? null : s.placementMode,
            };
        }),

    setSide: (id, side) => {
        set((s) => ({
            scans: s.scans.map((x) => (x.id === id ? { ...x, side } : x)),
        }));
        get().recomputeRegistration(id);
    },

    toggleVisible: (id) =>
        set((s) => ({
            scans: s.scans.map((x) => (x.id === id ? { ...x, visible: !x.visible } : x)),
        })),

    clear: () =>
        set((s) => {
            for (const sc of s.scans) sc.geometry.dispose();
            for (const g of Object.values(s.rawBaseBySourceId)) g.dispose();
            return {
                scans: [],
                markersByScanId: {},
                registrationByScanId: {},
                placementMode: null,
                rawBaseBySourceId: {},
            };
        }),

    enterPlacement: (scanId) => {
        const markers = get().markersByScanId[scanId] ?? { ...EMPTY_MARKERS };
        set({ placementMode: { scanId, next: nextMarker(markers) } });
    },

    exitPlacement: () => set({ placementMode: null }),

    setMarker: (scanId, id, point) => {
        const markers = {
            ...(get().markersByScanId[scanId] ?? { ...EMPTY_MARKERS }),
            [id]: point.clone(),
        };
        set((s) => ({
            markersByScanId: { ...s.markersByScanId, [scanId]: markers },
            placementMode:
                s.placementMode?.scanId === scanId ? { scanId, next: nextMarker(markers) } : s.placementMode,
        }));
        get().recomputeRegistration(scanId);
    },

    resetMarkers: (scanId) => {
        set((s) => ({
            markersByScanId: { ...s.markersByScanId, [scanId]: { ...EMPTY_MARKERS } },
            registrationByScanId: {
                ...s.registrationByScanId,
                [scanId]: emptyRegistration(true),
            },
            placementMode: s.placementMode?.scanId === scanId ? { scanId, next: "M1" } : s.placementMode,
        }));
    },

    setDeviationOverlay: (on) =>
        set((s) => {
            // L3 — while a deviation compute is in flight the toggle is disabled in UI;
            // also ignore stacked "on" calls so overlapping computations cannot start.
            if (s.deviationBusy && on) return s;
            return { deviationOverlay: on, deviationBusy: on };
        }),

    setDeviationBusy: (busy) => set({ deviationBusy: busy }),

    setLandmarkSourceAssetId: (assetId) => set({ landmarkSourceAssetId: assetId }),

    setRawBaseGeometry: (sourceAssetId, geo) =>
        set((s) => {
            const prev = s.rawBaseBySourceId[sourceAssetId];
            if (prev && prev !== geo) prev.dispose();
            return {
                rawBaseBySourceId: {
                    ...s.rawBaseBySourceId,
                    [sourceAssetId]: geo.clone(),
                },
            };
        }),

    recomputeRegistration: (scanId) => {
        const scan = get().scans.find((x) => x.id === scanId);
        if (!scan) return;
        const markers = get().markersByScanId[scanId] ?? { ...EMPTY_MARKERS };
        const reg = computeRegistration(scan, markers, get().landmarkSourceAssetId);
        set((s) => ({
            registrationByScanId: { ...s.registrationByScanId, [scanId]: reg },
        }));
    },
}));

/** Read registration matrix for a scan (null if unregistered / error). */
export function getScanRegistrationMatrix(state: ScanRegistrationState | undefined): THREE.Matrix4 | null {
    if (!state?.matrixElements || state.error) return null;
    return new THREE.Matrix4().fromArray(state.matrixElements);
}
