// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import * as THREE from "three";
import { create } from "zustand";
import type { ImportFormat } from "@/lib/geometry/import";
import { KabschError } from "@/lib/geometry/kabsch";
import type { ManifoldReport } from "@/lib/geometry/manifold";
import { getMarkerFrame, MarkerFrameError } from "@/lib/geometry/marker-frame";
import {
    extractKeptGeometry,
    rankComponents,
    type ScanComponentLabeling,
    type ScanComponentStats,
    selectedComponentsBBox,
} from "@/lib/geometry/scan-components";
import {
    buildScanDisplayInfo,
    buildScanDisplayInfoFromBBox,
    type ScanDisplayInfo,
    type ScanManualOffset,
    ZERO_SCAN_OFFSET,
} from "@/lib/geometry/scan-display";
import { ScanDorsalError } from "@/lib/geometry/scan-dorsal";
import type { SuggestedScanLandmarks } from "@/lib/geometry/scan-landmark-suggest";
import { applyScanSlicePlanes, type ScanSlicePlane } from "@/lib/geometry/scan-plane-slice";
import { runScanRegistration, ScanRegistrationWireError } from "@/lib/geometry/scan-registration-wire";
import type { Side } from "@/types";

export interface ImportedScan {
    id: string;
    name: string;
    side: Side;
    format: ImportFormat;
    triangleCount: number;
    /** Currently rendered (kept-component + slices) geometry. */
    geometry: BufferGeometry;
    /** Original import buffer — never discarded for the session. */
    rawGeometry: BufferGeometry;
    manifold: ManifoldReport;
    visible: boolean;
    /**
     * Framing meta: provisional matrix is display-only (never export / Kabsch).
     * `displayScale` is the discrete mm/cm/m units correction used by registration.
     */
    display: ScanDisplayInfo;
    /** Ranked connected components (analysis). Empty when unlabeled. */
    components: ScanComponentStats[];
    keptComponentIds: number[];
    /** Per-triangle component map for extraction; session memory only. */
    triangleComponentOf: Int32Array | null;
    labelingMeta: {
        degenerateTriangleCount: number;
        weldTolerance: number;
        elapsedMs: number;
        originalTriangleCount: number;
    } | null;
    /** Applied plane slices in scan-local space (session memory only). */
    slicePlanes: ScanSlicePlane[];
    /** Heuristic suggestions — not confirmed markers. */
    suggestedLandmarks: SuggestedScanLandmarks | null;
    /** Clinician-facing reason when markers/registration were cleared. */
    cleanupMessage: string | null;
}

export type { ScanSlicePlane };

/** Draft line for an in-progress plane slice (world-space sketch points). */
export type SliceDraft = {
    scanId: string;
    /** 0 = need first point, 1 = need second, 2 = ready to apply (flip/apply). */
    step: 0 | 1 | 2;
    p0World: [number, number, number] | null;
    p1World: [number, number, number] | null;
    /** Preview plane in scan-local space. */
    previewLocal: ScanSlicePlane | null;
};

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

const MARKERS_INVALIDATED_MSG =
    "Markers and registration cleared — kept components changed. Re-place markers on the cleaned scan.";

const MARKERS_INVALIDATED_SLICE_MSG =
    "Markers and registration cleared — plane slice changed the scan surface. Re-place markers on the cleaned scan.";

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

function disposeScanGeometry(scan: ImportedScan): void {
    if (scan.rawGeometry && scan.rawGeometry !== scan.geometry) {
        scan.rawGeometry.dispose();
    }
    scan.geometry.dispose();
}

function labelingFromScan(scan: ImportedScan): ScanComponentLabeling | null {
    if (!scan.triangleComponentOf || !scan.labelingMeta) return null;
    return {
        components: scan.components,
        triangleComponentOf: scan.triangleComponentOf,
        originalTriangleCount: scan.labelingMeta.originalTriangleCount,
        degenerateTriangleCount: scan.labelingMeta.degenerateTriangleCount,
        weldTolerance: scan.labelingMeta.weldTolerance,
        longestBbox: scan.display.rawLongest,
        elapsedMs: scan.labelingMeta.elapsedMs,
    };
}

function triangleCountOf(geo: BufferGeometry): number {
    const index = geo.getIndex();
    return index ? index.count / 3 : geo.getAttribute("position").count / 3;
}

/** Extract kept components from raw, then apply slice planes. */
function rebuildWorkingGeometry(
    scan: ImportedScan,
    keptIds: number[],
    planes: ScanSlicePlane[],
): BufferGeometry {
    const labeling = labelingFromScan(scan);
    let base: BufferGeometry;
    if (labeling && keptIds.length > 0) {
        base = extractKeptGeometry(scan.rawGeometry, labeling, keptIds);
    } else {
        base = scan.rawGeometry.clone();
    }
    if (planes.length === 0) return base;
    const sliced = applyScanSlicePlanes(base, planes);
    if (sliced !== base) base.dispose();
    return sliced;
}

function displayForKept(
    rawGeometry: BufferGeometry,
    components: ScanComponentStats[],
    keptIds: number[],
): ScanDisplayInfo {
    const prior = buildScanDisplayInfo(rawGeometry);
    const bbox = selectedComponentsBBox(components, keptIds);
    if (!bbox) return prior;
    return buildScanDisplayInfoFromBBox(bbox.min, bbox.max, {
        inferredUnit: prior.inferredUnit,
        dominantRawAxis: prior.dominantRawAxis,
        rawLongest: prior.rawLongest,
    });
}

export type AddScanInput = Omit<
    ImportedScan,
    | "visible"
    | "display"
    | "rawGeometry"
    | "components"
    | "keptComponentIds"
    | "triangleComponentOf"
    | "labelingMeta"
    | "slicePlanes"
    | "suggestedLandmarks"
    | "cleanupMessage"
> & {
    display?: ScanDisplayInfo;
    rawGeometry?: BufferGeometry;
    components?: ScanComponentStats[];
    keptComponentIds?: number[];
    triangleComponentOf?: Int32Array | null;
    labelingMeta?: ImportedScan["labelingMeta"];
    slicePlanes?: ScanSlicePlane[];
    suggestedLandmarks?: SuggestedScanLandmarks | null;
};

interface ScanStore {
    scans: ImportedScan[];
    markersByScanId: Record<string, ScanMarkers>;
    registrationByScanId: Record<string, ScanRegistrationState>;
    /** Post-registration clinician translation (base-local mm). Session only. */
    manualOffsetByScanId: Record<string, ScanManualOffset>;
    /** Selected scan for manual reposition (drag / arrow keys). */
    selectedScanId: string | null;
    placementMode: PlacementMode | null;
    /** Active plane-slice drawing session (mutually exclusive with marker placement). */
    sliceDraft: SliceDraft | null;
    deviationOverlay: boolean;
    /** True while deviation colour field is being computed (K3 busy treatment). */
    deviationBusy: boolean;
    /** True while weld/label exceeds ~250ms (cleanup busy treatment). */
    cleanupBusy: boolean;
    hoveredComponentId: { scanId: string; componentId: number } | null;
    /** Source asset id used for landmark lookup (unmirrored registry key). */
    landmarkSourceAssetId: string | null;
    /** RAW L0 geometry clones keyed by source asset id — deviation measures against these. */
    rawBaseBySourceId: Record<string, BufferGeometry>;

    addScan: (scan: AddScanInput) => void;
    removeScan: (id: string) => void;
    setSide: (id: string, side: Side) => void;
    toggleVisible: (id: string) => void;
    clear: () => void;

    selectScan: (scanId: string | null) => void;
    setManualOffset: (scanId: string, offset: ScanManualOffset) => void;
    nudgeManualOffset: (scanId: string, dx: number, dy: number, dz?: number) => void;
    resetManualOffset: (scanId: string) => void;

    enterPlacement: (scanId: string) => void;
    exitPlacement: () => void;
    setMarker: (scanId: string, id: MarkerId, point: THREE.Vector3) => void;
    resetMarkers: (scanId: string) => void;
    setDeviationOverlay: (on: boolean) => void;
    setDeviationBusy: (busy: boolean) => void;
    setCleanupBusy: (busy: boolean) => void;
    setHoveredComponentId: (hover: { scanId: string; componentId: number } | null) => void;
    setLandmarkSourceAssetId: (assetId: string | null) => void;
    setRawBaseGeometry: (sourceAssetId: string, geo: BufferGeometry) => void;
    /** Re-run registration for a scan (after marker drag / side change). */
    recomputeRegistration: (scanId: string) => void;

    /**
     * Update kept component set. Non-destructive: rawGeometry retained.
     * Invalidates markers + registration. Blocks empty kept set.
     */
    setKeptComponents: (scanId: string, keptIds: number[]) => { ok: true } | { ok: false; reason: string };
    /** Restore all components from the raw import (also clears plane slices). */
    restoreAllComponents: (scanId: string) => void;
    setSuggestedLandmarks: (scanId: string, suggestions: SuggestedScanLandmarks | null) => void;
    clearCleanupMessage: (scanId: string) => void;

    beginSlice: (scanId: string) => void;
    cancelSlice: () => void;
    setSliceDraft: (draft: SliceDraft | null) => void;
    /** Commit previewLocal plane onto the scan; rebuilds geometry. */
    applySlicePlane: (scanId: string, plane: ScanSlicePlane) => { ok: true } | { ok: false; reason: string };
    undoLastSlice: (scanId: string) => void;
    clearSlicePlanes: (scanId: string) => void;
    flipSliceKeepSide: () => void;
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
            // Discrete mm/cm/m correction from provisional display inference — not a fitted scale.
            unitScale: scan.display.displayScale,
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

function invalidateMarkersRegistration(
    s: {
        markersByScanId: Record<string, ScanMarkers>;
        registrationByScanId: Record<string, ScanRegistrationState>;
        manualOffsetByScanId: Record<string, ScanManualOffset>;
        selectedScanId: string | null;
        placementMode: PlacementMode | null;
    },
    scanId: string,
) {
    const { [scanId]: _o, ...manualOffsetByScanId } = s.manualOffsetByScanId;
    return {
        markersByScanId: { ...s.markersByScanId, [scanId]: { ...EMPTY_MARKERS } },
        registrationByScanId: {
            ...s.registrationByScanId,
            [scanId]: emptyRegistration(true),
        },
        manualOffsetByScanId,
        selectedScanId: s.selectedScanId === scanId ? null : s.selectedScanId,
        placementMode:
            s.placementMode?.scanId === scanId ? { scanId, next: "M1" as MarkerId } : s.placementMode,
    };
}

export const useScanStore = create<ScanStore>((set, get) => ({
    scans: [],
    markersByScanId: {},
    registrationByScanId: {},
    manualOffsetByScanId: {},
    selectedScanId: null,
    placementMode: null,
    sliceDraft: null,
    deviationOverlay: false,
    deviationBusy: false,
    cleanupBusy: false,
    hoveredComponentId: null,
    landmarkSourceAssetId: null,
    rawBaseBySourceId: {},

    addScan: (scan) =>
        set((s) => {
            const rawGeometry = scan.rawGeometry ?? scan.geometry;
            const components = scan.components ?? [];
            const keptComponentIds =
                scan.keptComponentIds ?? (components.length > 0 ? components.map((c) => c.id) : []);
            const display =
                scan.display ??
                (components.length > 0 && keptComponentIds.length > 0
                    ? displayForKept(rawGeometry, components, keptComponentIds)
                    : buildScanDisplayInfo(scan.geometry));
            const imported: ImportedScan = {
                ...scan,
                visible: true,
                display,
                rawGeometry,
                components,
                keptComponentIds,
                triangleComponentOf: scan.triangleComponentOf ?? null,
                labelingMeta: scan.labelingMeta ?? null,
                slicePlanes: scan.slicePlanes ?? [],
                suggestedLandmarks: scan.suggestedLandmarks ?? null,
                cleanupMessage: null,
            };
            const { [scan.id]: _o, ...manualOffsetByScanId } = s.manualOffsetByScanId;
            return {
                scans: [...s.scans, imported],
                // Re-import / new mesh: never retain markers pointing at a deleted mesh.
                markersByScanId: { ...s.markersByScanId, [scan.id]: { ...EMPTY_MARKERS } },
                registrationByScanId: {
                    ...s.registrationByScanId,
                    [scan.id]: emptyRegistration(true),
                },
                manualOffsetByScanId,
                selectedScanId: s.selectedScanId === scan.id ? null : s.selectedScanId,
                hoveredComponentId: s.hoveredComponentId?.scanId === scan.id ? null : s.hoveredComponentId,
                sliceDraft: s.sliceDraft?.scanId === scan.id ? null : s.sliceDraft,
            };
        }),

    removeScan: (id) =>
        set((s) => {
            const target = s.scans.find((x) => x.id === id);
            if (target) disposeScanGeometry(target);
            const { [id]: _m, ...markersByScanId } = s.markersByScanId;
            const { [id]: _r, ...registrationByScanId } = s.registrationByScanId;
            const { [id]: _o, ...manualOffsetByScanId } = s.manualOffsetByScanId;
            return {
                scans: s.scans.filter((x) => x.id !== id),
                markersByScanId,
                registrationByScanId,
                manualOffsetByScanId,
                selectedScanId: s.selectedScanId === id ? null : s.selectedScanId,
                placementMode: s.placementMode?.scanId === id ? null : s.placementMode,
                hoveredComponentId: s.hoveredComponentId?.scanId === id ? null : s.hoveredComponentId,
                sliceDraft: s.sliceDraft?.scanId === id ? null : s.sliceDraft,
            };
        }),

    setSide: (id, side) => {
        set((s) => ({
            scans: s.scans.map((x) => (x.id === id ? { ...x, side, suggestedLandmarks: null } : x)),
        }));
        get().recomputeRegistration(id);
    },

    toggleVisible: (id) =>
        set((s) => ({
            scans: s.scans.map((x) => (x.id === id ? { ...x, visible: !x.visible } : x)),
        })),

    clear: () =>
        set((s) => {
            for (const sc of s.scans) disposeScanGeometry(sc);
            for (const g of Object.values(s.rawBaseBySourceId)) g.dispose();
            return {
                scans: [],
                markersByScanId: {},
                registrationByScanId: {},
                manualOffsetByScanId: {},
                selectedScanId: null,
                placementMode: null,
                sliceDraft: null,
                rawBaseBySourceId: {},
                hoveredComponentId: null,
                cleanupBusy: false,
            };
        }),

    selectScan: (scanId) => {
        if (get().selectedScanId === scanId) return;
        set({ selectedScanId: scanId });
    },

    setManualOffset: (scanId, offset) =>
        set((s) => ({
            manualOffsetByScanId: {
                ...s.manualOffsetByScanId,
                [scanId]: { x: offset.x, y: offset.y, z: offset.z },
            },
        })),

    nudgeManualOffset: (scanId, dx, dy, dz = 0) =>
        set((s) => {
            const prev = s.manualOffsetByScanId[scanId] ?? ZERO_SCAN_OFFSET;
            return {
                manualOffsetByScanId: {
                    ...s.manualOffsetByScanId,
                    [scanId]: {
                        x: prev.x + dx,
                        y: prev.y + dy,
                        z: prev.z + dz,
                    },
                },
            };
        }),

    resetManualOffset: (scanId) =>
        set((s) => {
            if (!s.manualOffsetByScanId[scanId]) return s;
            const { [scanId]: _o, ...manualOffsetByScanId } = s.manualOffsetByScanId;
            return { manualOffsetByScanId };
        }),

    enterPlacement: (scanId) => {
        const markers = get().markersByScanId[scanId] ?? { ...EMPTY_MARKERS };
        set({
            placementMode: { scanId, next: nextMarker(markers) },
            sliceDraft: null,
            selectedScanId: null,
        });
    },

    exitPlacement: () => set({ placementMode: null }),

    setMarker: (scanId, id, point) => {
        const markers = {
            ...(get().markersByScanId[scanId] ?? { ...EMPTY_MARKERS }),
            [id]: point.clone(),
        };
        const complete = allPlaced(markers);
        // Single store update for markers + placement exit; then one registration pass.
        set((s) => ({
            markersByScanId: { ...s.markersByScanId, [scanId]: markers },
            placementMode: complete
                ? null
                : s.placementMode?.scanId === scanId
                  ? { scanId, next: nextMarker(markers) }
                  : s.placementMode,
        }));
        get().recomputeRegistration(scanId);
    },

    resetMarkers: (scanId) => {
        set((s) => {
            const { [scanId]: _o, ...manualOffsetByScanId } = s.manualOffsetByScanId;
            return {
                markersByScanId: { ...s.markersByScanId, [scanId]: { ...EMPTY_MARKERS } },
                registrationByScanId: {
                    ...s.registrationByScanId,
                    [scanId]: emptyRegistration(true),
                },
                manualOffsetByScanId,
                selectedScanId: s.selectedScanId === scanId ? null : s.selectedScanId,
                placementMode: s.placementMode?.scanId === scanId ? { scanId, next: "M1" } : s.placementMode,
            };
        });
    },

    setDeviationOverlay: (on) =>
        set((s) => {
            // L3 — while a deviation compute is in flight the toggle is disabled in UI;
            // also ignore stacked "on" calls so overlapping computations cannot start.
            if (s.deviationBusy && on) return s;
            return { deviationOverlay: on, deviationBusy: on };
        }),

    setDeviationBusy: (busy) => {
        if (get().deviationBusy === busy) return;
        set({ deviationBusy: busy });
    },
    setCleanupBusy: (busy) => {
        if (get().cleanupBusy === busy) return;
        set({ cleanupBusy: busy });
    },
    setHoveredComponentId: (hover) => set({ hoveredComponentId: hover }),

    setLandmarkSourceAssetId: (assetId) => {
        // No-op when unchanged — remounting BaseInsoleMesh would otherwise
        // re-fire registration and churn the store after every M3 placement.
        if (get().landmarkSourceAssetId === assetId) {
            if (!assetId) return;
            for (const scan of get().scans) {
                const markers = get().markersByScanId[scan.id];
                const reg = get().registrationByScanId[scan.id];
                if (markers && allPlaced(markers) && (!reg || reg.incomplete || reg.error)) {
                    get().recomputeRegistration(scan.id);
                }
            }
            return;
        }
        set({ landmarkSourceAssetId: assetId });
        // Base may finish loading after markers were confirmed — retry registration.
        if (!assetId) return;
        for (const scan of get().scans) {
            const markers = get().markersByScanId[scan.id];
            if (markers && allPlaced(markers)) {
                get().recomputeRegistration(scan.id);
            }
        }
    },

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

    setKeptComponents: (scanId, keptIds) => {
        if (keptIds.length === 0) {
            return { ok: false, reason: "Keep at least one component — an empty scan is not allowed." };
        }
        const scan = get().scans.find((x) => x.id === scanId);
        if (!scan) return { ok: false, reason: "Scan not found." };
        const labeling = labelingFromScan(scan);
        if (!labeling) return { ok: false, reason: "No component labeling available." };

        const unique = [...new Set(keptIds)];
        const working = rebuildWorkingGeometry(scan, unique, scan.slicePlanes);
        if (triangleCountOf(working) < 1) {
            working.dispose();
            return { ok: false, reason: "Keep set + slices would leave an empty scan." };
        }
        const display = displayForKept(scan.rawGeometry, scan.components, unique);
        const triangleCount = triangleCountOf(working);

        const hadMarkers = Object.values(get().markersByScanId[scanId] ?? {}).some(Boolean);

        set((s) => {
            const prev = s.scans.find((x) => x.id === scanId);
            if (prev && prev.geometry !== prev.rawGeometry) {
                prev.geometry.dispose();
            }
            const invalidated = invalidateMarkersRegistration(s, scanId);
            return {
                ...invalidated,
                scans: s.scans.map((x) =>
                    x.id === scanId
                        ? {
                              ...x,
                              geometry: working,
                              keptComponentIds: unique,
                              triangleCount,
                              display,
                              suggestedLandmarks: null,
                              cleanupMessage: hadMarkers ? MARKERS_INVALIDATED_MSG : x.cleanupMessage,
                          }
                        : x,
                ),
                hoveredComponentId: s.hoveredComponentId?.scanId === scanId ? null : s.hoveredComponentId,
            };
        });
        return { ok: true };
    },

    restoreAllComponents: (scanId) => {
        const scan = get().scans.find((x) => x.id === scanId);
        if (!scan) return;
        const allIds = scan.components.length > 0 ? scan.components.map((c) => c.id) : scan.keptComponentIds;
        // Clear slices then restore components.
        set((s) => ({
            scans: s.scans.map((x) => (x.id === scanId ? { ...x, slicePlanes: [] } : x)),
            sliceDraft: s.sliceDraft?.scanId === scanId ? null : s.sliceDraft,
        }));
        if (allIds.length > 0 && scan.components.length > 0) {
            get().setKeptComponents(scanId, allIds);
        } else {
            const fresh = get().scans.find((x) => x.id === scanId);
            if (!fresh) return;
            const working = rebuildWorkingGeometry(fresh, fresh.keptComponentIds, []);
            set((s) => {
                const prev = s.scans.find((x) => x.id === scanId);
                if (prev && prev.geometry !== prev.rawGeometry) prev.geometry.dispose();
                const invalidated = invalidateMarkersRegistration(s, scanId);
                return {
                    ...invalidated,
                    scans: s.scans.map((x) =>
                        x.id === scanId
                            ? {
                                  ...x,
                                  geometry: working,
                                  triangleCount: triangleCountOf(working),
                                  slicePlanes: [],
                                  suggestedLandmarks: null,
                                  cleanupMessage: MARKERS_INVALIDATED_MSG,
                              }
                            : x,
                    ),
                };
            });
            return;
        }
        set((s) => ({
            scans: s.scans.map((x) =>
                x.id === scanId
                    ? {
                          ...x,
                          slicePlanes: [],
                          cleanupMessage: MARKERS_INVALIDATED_MSG,
                      }
                    : x,
            ),
        }));
    },

    setSuggestedLandmarks: (scanId, suggestions) =>
        set((s) => ({
            scans: s.scans.map((x) => (x.id === scanId ? { ...x, suggestedLandmarks: suggestions } : x)),
        })),

    clearCleanupMessage: (scanId) =>
        set((s) => ({
            scans: s.scans.map((x) => (x.id === scanId ? { ...x, cleanupMessage: null } : x)),
        })),

    beginSlice: (scanId) => {
        set({
            placementMode: null,
            selectedScanId: null,
            sliceDraft: {
                scanId,
                step: 0,
                p0World: null,
                p1World: null,
                previewLocal: null,
            },
        });
    },

    cancelSlice: () => set({ sliceDraft: null }),

    setSliceDraft: (draft) => set({ sliceDraft: draft }),

    flipSliceKeepSide: () => {
        const draft = get().sliceDraft;
        if (!draft?.previewLocal) return;
        set({
            sliceDraft: {
                ...draft,
                previewLocal: {
                    ...draft.previewLocal,
                    keepPositive: !draft.previewLocal.keepPositive,
                },
            },
        });
    },

    applySlicePlane: (scanId, plane) => {
        const scan = get().scans.find((x) => x.id === scanId);
        if (!scan) return { ok: false, reason: "Scan not found." };
        const nextPlanes = [...scan.slicePlanes, plane];
        const working = rebuildWorkingGeometry(scan, scan.keptComponentIds, nextPlanes);
        if (triangleCountOf(working) < 1) {
            working.dispose();
            return { ok: false, reason: "Slice would remove the entire scan — flip keep side or cancel." };
        }
        const hadMarkers = Object.values(get().markersByScanId[scanId] ?? {}).some(Boolean);
        // Display framing stays on the selected-component bbox (pre-slice); geometry updates.
        set((s) => {
            const prev = s.scans.find((x) => x.id === scanId);
            if (prev && prev.geometry !== prev.rawGeometry) prev.geometry.dispose();
            const invalidated = invalidateMarkersRegistration(s, scanId);
            return {
                ...invalidated,
                sliceDraft: null,
                scans: s.scans.map((x) =>
                    x.id === scanId
                        ? {
                              ...x,
                              geometry: working,
                              slicePlanes: nextPlanes,
                              triangleCount: triangleCountOf(working),
                              suggestedLandmarks: null,
                              cleanupMessage: hadMarkers ? MARKERS_INVALIDATED_SLICE_MSG : x.cleanupMessage,
                          }
                        : x,
                ),
            };
        });
        return { ok: true };
    },

    undoLastSlice: (scanId) => {
        const scan = get().scans.find((x) => x.id === scanId);
        if (!scan || scan.slicePlanes.length === 0) return;
        const nextPlanes = scan.slicePlanes.slice(0, -1);
        const working = rebuildWorkingGeometry(scan, scan.keptComponentIds, nextPlanes);
        const hadMarkers = Object.values(get().markersByScanId[scanId] ?? {}).some(Boolean);
        set((s) => {
            const prev = s.scans.find((x) => x.id === scanId);
            if (prev && prev.geometry !== prev.rawGeometry) prev.geometry.dispose();
            const invalidated = invalidateMarkersRegistration(s, scanId);
            return {
                ...invalidated,
                scans: s.scans.map((x) =>
                    x.id === scanId
                        ? {
                              ...x,
                              geometry: working,
                              slicePlanes: nextPlanes,
                              triangleCount: triangleCountOf(working),
                              suggestedLandmarks: null,
                              cleanupMessage: hadMarkers ? MARKERS_INVALIDATED_SLICE_MSG : x.cleanupMessage,
                          }
                        : x,
                ),
            };
        });
    },

    clearSlicePlanes: (scanId) => {
        const scan = get().scans.find((x) => x.id === scanId);
        if (!scan || scan.slicePlanes.length === 0) return;
        const working = rebuildWorkingGeometry(scan, scan.keptComponentIds, []);
        const hadMarkers = Object.values(get().markersByScanId[scanId] ?? {}).some(Boolean);
        set((s) => {
            const prev = s.scans.find((x) => x.id === scanId);
            if (prev && prev.geometry !== prev.rawGeometry) prev.geometry.dispose();
            const invalidated = invalidateMarkersRegistration(s, scanId);
            return {
                ...invalidated,
                sliceDraft: s.sliceDraft?.scanId === scanId ? null : s.sliceDraft,
                scans: s.scans.map((x) =>
                    x.id === scanId
                        ? {
                              ...x,
                              geometry: working,
                              slicePlanes: [],
                              triangleCount: triangleCountOf(working),
                              suggestedLandmarks: null,
                              cleanupMessage: hadMarkers ? MARKERS_INVALIDATED_SLICE_MSG : x.cleanupMessage,
                          }
                        : x,
                ),
            };
        });
    },
}));

/** Read registration matrix for a scan (null if unregistered / error). */
export function getScanRegistrationMatrix(state: ScanRegistrationState | undefined): THREE.Matrix4 | null {
    if (!state?.matrixElements || state.error) return null;
    return new THREE.Matrix4().fromArray(state.matrixElements);
}

/** Re-rank and return auto-selected foot id (top rank). */
export function autoSelectFootComponentIds(components: ScanComponentStats[]): number[] {
    if (components.length === 0) return [];
    const ranked = rankComponents(components);
    return ranked[0] ? [ranked[0].id] : [];
}
