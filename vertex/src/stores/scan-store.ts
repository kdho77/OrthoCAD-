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
} from "@/lib/geometry/scan-display";
import { ScanDorsalError } from "@/lib/geometry/scan-dorsal";
import type { SuggestedScanLandmarks } from "@/lib/geometry/scan-landmark-suggest";
import { runScanRegistration, ScanRegistrationWireError } from "@/lib/geometry/scan-registration-wire";
import type { Side } from "@/types";

export interface ImportedScan {
    id: string;
    name: string;
    side: Side;
    format: ImportFormat;
    triangleCount: number;
    /** Currently rendered (kept-component) geometry. */
    geometry: BufferGeometry;
    /** Original import buffer — never discarded for the session. */
    rawGeometry: BufferGeometry;
    manifold: ManifoldReport;
    visible: boolean;
    /** DISPLAY-ONLY framing meta (units + provisional matrix). Never export / Kabsch. */
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
    /** Heuristic suggestions — not confirmed markers. */
    suggestedLandmarks: SuggestedScanLandmarks | null;
    /** Clinician-facing reason when markers/registration were cleared. */
    cleanupMessage: string | null;
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

const MARKERS_INVALIDATED_MSG =
    "Markers and registration cleared — kept components changed. Re-place markers on the cleaned scan.";

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
    | "suggestedLandmarks"
    | "cleanupMessage"
> & {
    display?: ScanDisplayInfo;
    rawGeometry?: BufferGeometry;
    components?: ScanComponentStats[];
    keptComponentIds?: number[];
    triangleComponentOf?: Int32Array | null;
    labelingMeta?: ImportedScan["labelingMeta"];
    suggestedLandmarks?: SuggestedScanLandmarks | null;
};

interface ScanStore {
    scans: ImportedScan[];
    markersByScanId: Record<string, ScanMarkers>;
    registrationByScanId: Record<string, ScanRegistrationState>;
    placementMode: PlacementMode | null;
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
    /** Restore all components from the raw import. */
    restoreAllComponents: (scanId: string) => void;
    setSuggestedLandmarks: (scanId: string, suggestions: SuggestedScanLandmarks | null) => void;
    clearCleanupMessage: (scanId: string) => void;
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

function invalidateMarkersRegistration(
    s: {
        markersByScanId: Record<string, ScanMarkers>;
        registrationByScanId: Record<string, ScanRegistrationState>;
        placementMode: PlacementMode | null;
    },
    scanId: string,
) {
    return {
        markersByScanId: { ...s.markersByScanId, [scanId]: { ...EMPTY_MARKERS } },
        registrationByScanId: {
            ...s.registrationByScanId,
            [scanId]: emptyRegistration(true),
        },
        placementMode:
            s.placementMode?.scanId === scanId ? { scanId, next: "M1" as MarkerId } : s.placementMode,
    };
}

export const useScanStore = create<ScanStore>((set, get) => ({
    scans: [],
    markersByScanId: {},
    registrationByScanId: {},
    placementMode: null,
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
                suggestedLandmarks: scan.suggestedLandmarks ?? null,
                cleanupMessage: null,
            };
            return {
                scans: [...s.scans, imported],
                // Re-import / new mesh: never retain markers pointing at a deleted mesh.
                markersByScanId: { ...s.markersByScanId, [scan.id]: { ...EMPTY_MARKERS } },
                registrationByScanId: {
                    ...s.registrationByScanId,
                    [scan.id]: emptyRegistration(true),
                },
                hoveredComponentId: s.hoveredComponentId?.scanId === scan.id ? null : s.hoveredComponentId,
            };
        }),

    removeScan: (id) =>
        set((s) => {
            const target = s.scans.find((x) => x.id === id);
            if (target) disposeScanGeometry(target);
            const { [id]: _m, ...markersByScanId } = s.markersByScanId;
            const { [id]: _r, ...registrationByScanId } = s.registrationByScanId;
            return {
                scans: s.scans.filter((x) => x.id !== id),
                markersByScanId,
                registrationByScanId,
                placementMode: s.placementMode?.scanId === id ? null : s.placementMode,
                hoveredComponentId: s.hoveredComponentId?.scanId === id ? null : s.hoveredComponentId,
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
                placementMode: null,
                rawBaseBySourceId: {},
                hoveredComponentId: null,
                cleanupBusy: false,
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
            // Confirming a marker clears that suggestion slot visually via UI; keep suggestions
            // until all confirmed or kept-set changes.
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
    setCleanupBusy: (busy) => set({ cleanupBusy: busy }),
    setHoveredComponentId: (hover) => set({ hoveredComponentId: hover }),

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

    setKeptComponents: (scanId, keptIds) => {
        if (keptIds.length === 0) {
            return { ok: false, reason: "Keep at least one component — an empty scan is not allowed." };
        }
        const scan = get().scans.find((x) => x.id === scanId);
        if (!scan) return { ok: false, reason: "Scan not found." };
        const labeling = labelingFromScan(scan);
        if (!labeling) return { ok: false, reason: "No component labeling available." };

        const unique = [...new Set(keptIds)];
        const extracted = extractKeptGeometry(scan.rawGeometry, labeling, unique);
        const display = displayForKept(scan.rawGeometry, scan.components, unique);
        const index = extracted.getIndex();
        const triangleCount = index ? index.count / 3 : extracted.getAttribute("position").count / 3;

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
                              geometry: extracted,
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
        if (!scan || scan.components.length === 0) return;
        const allIds = scan.components.map((c) => c.id);
        get().setKeptComponents(scanId, allIds);
        // After restore, clear the "invalidated" tone if we restored to full raw —
        // still invalidate markers (selection changed) but message stays accurate.
        set((s) => ({
            scans: s.scans.map((x) =>
                x.id === scanId
                    ? {
                          ...x,
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
