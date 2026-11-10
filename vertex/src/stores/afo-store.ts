// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { create } from "zustand";
import { applyClinicalCast } from "@/lib/geometry/afo/cast";
import { applyAfoCorrections, correctionContextFromAfo } from "@/lib/geometry/afo/corrections";
import { detectTibialCrest } from "@/lib/geometry/afo/crest";
import {
    AFO_DESIGN_MARKERS,
    afoPrintParams,
    correctionsForSide,
    defaultAfoDesignState,
    defaultAfoSideCorrection,
} from "@/lib/geometry/afo/defaults";
import { cloneMesh, orientMeshOutward } from "@/lib/geometry/afo/mesh-ops";
import { fitSurfaceSpline, reprojectTrimPins } from "@/lib/geometry/afo/trim-spline";
import type { AfoClinicalMarkerId, AfoScanWorkflow, AfoTriMesh, AfoVec3 } from "@/lib/geometry/afo/types";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

interface AfoSessionStore {
    /** Oriented scan (cast ops always re-run from this). */
    sourceMesh: AfoTriMesh | null;
    /** Working positive after orient / cast. */
    castMesh: AfoTriMesh | null;
    correctedMesh: AfoTriMesh | null;
    shellMesh: AfoTriMesh | null;
    /** Scaled scan before the plantar rigid map. Level to rearfoot rebuilds from this. */
    unorientedMesh: AfoTriMesh | null;
    /** Active Stage 1 / Stage 2 click session. `redo` replaces that marker on the next click. */
    scanPlacement: { redo: string | null; paused?: boolean } | null;
    scanLandmarkError: string | null;
    scanShowMarkerLabels: boolean;
    scanAutoFrame: boolean;
    scanAutoFrameSuppressed: boolean;
    scanLastUndoId: string | null;
    scanDraggingMarkerId: string | null;
    scanHoverWorld: { x: number; y: number; z: number } | null;
    placingLandmarkIndex: number;
    /** Design-step landmark clicks. Off during trim, cast markers, and after the five are placed. */
    placingDesignLandmarks: boolean;
    placingClinicalId: AfoClinicalMarkerId | null;
    placingTrim: boolean;
    /** Cursor sample on the working mesh while a trim line is being placed. */
    trimHover: AfoVec3 | null;
    draggingTrimIndex: number | null;
    workerProgress: { pct: number; stage: string } | null;
    lastError: string | null;
    setSourceMesh: (mesh: AfoTriMesh | null) => void;
    setCastMesh: (mesh: AfoTriMesh | null) => void;
    setCorrectedMesh: (mesh: AfoTriMesh | null) => void;
    setShellMesh: (mesh: AfoTriMesh | null) => void;
    setUnorientedMesh: (mesh: AfoTriMesh | null) => void;
    setScanPlacement: (placement: { redo: string | null; paused?: boolean } | null) => void;
    setScanLandmarkError: (message: string | null) => void;
    setScanShowMarkerLabels: (on: boolean) => void;
    setScanAutoFrame: (on: boolean) => void;
    setScanAutoFrameSuppressed: (on: boolean) => void;
    setScanLastUndoId: (id: string | null) => void;
    setScanDraggingMarkerId: (id: string | null) => void;
    setScanHoverWorld: (point: { x: number; y: number; z: number } | null) => void;
    setPlacingLandmarkIndex: (index: number) => void;
    setPlacingDesignLandmarks: (on: boolean) => void;
    setPlacingClinicalId: (id: AfoClinicalMarkerId | null) => void;
    setPlacingTrim: (on: boolean) => void;
    setTrimHover: (point: AfoVec3 | null) => void;
    setDraggingTrimIndex: (index: number | null) => void;
    setWorkerProgress: (p: { pct: number; stage: string } | null) => void;
    setLastError: (msg: string | null) => void;
    resetSession: () => void;
}

export function isAfoProduct(): boolean {
    return (useDesignStore.getState().design.productType ?? "insole") === "afo";
}

export function getAfoState() {
    const design = useDesignStore.getState().design;
    const base = defaultAfoDesignState(design.afo?.side ?? "left");
    if (!design.afo) return base;
    return {
        ...base,
        ...design.afo,
        cast: { ...base.cast, ...design.afo.cast },
        corrections: mergeCorrections(base.corrections, design.afo.corrections),
        reliefs: { ...base.reliefs, ...design.afo.reliefs },
        print: afoPrintParams({ ...base.print, ...design.afo.print }),
        crest: { ...base.crest, ...design.afo.crest },
        clinicalMarkers: design.afo.clinicalMarkers ?? [],
        landmarks: design.afo.landmarks ?? [],
        scanWorkflow: mergeScanWorkflow(base.scanWorkflow, design.afo.scanWorkflow),
        trimPoints: design.afo.trimPoints ?? [],
        trimCurve: design.afo.trimCurve ?? [],
    };
}

function mergeCorrections(
    base: ReturnType<typeof defaultAfoDesignState>["corrections"],
    extra: ReturnType<typeof defaultAfoDesignState>["corrections"],
) {
    const side = defaultAfoSideCorrection();
    const legacy = {
        legRearDeg: extra.legRearDeg ?? side.legRearDeg,
        legSideDeg: extra.legSideDeg ?? side.legSideDeg,
        heelLiftMm: extra.heelLiftMm ?? side.heelLiftMm,
        footLiftMedMm: extra.footLiftMedMm ?? side.footLiftMedMm,
        footLiftLatMm: extra.footLiftLatMm ?? side.footLiftLatMm,
        medialArchMm: extra.medialArchMm ?? side.medialArchMm,
        heelWidthMm: extra.heelWidthMm ?? side.heelWidthMm,
        braceHeightMm: extra.braceHeightMm ?? side.braceHeightMm,
        toeRiseMm: extra.toeRiseMm ?? side.toeRiseMm,
    };
    return {
        ...base,
        ...extra,
        ...legacy,
        left: { ...legacy, ...(extra.left ?? {}) },
        right: { ...legacy, ...(extra.right ?? {}) },
        volumeRegions: extra.volumeRegions ?? base.volumeRegions ?? [],
        smoothRegions: extra.smoothRegions ?? base.smoothRegions ?? [],
        text: extra.text === undefined ? base.text : extra.text,
        patientName: extra.patientName ?? base.patientName,
        smoothIterations: extra.smoothIterations ?? base.smoothIterations,
    };
}

function mergeScanWorkflow(base: AfoScanWorkflow, extra?: AfoScanWorkflow): AfoScanWorkflow {
    if (!extra) return base;
    return {
        ...base,
        ...extra,
        plantar: { ...base.plantar, ...(extra.plantar ?? {}) },
        landmarks: { ...base.landmarks, ...(extra.landmarks ?? {}) },
        skippedLandmarks: extra.skippedLandmarks ?? base.skippedLandmarks ?? [],
        derived: extra.derived === undefined ? base.derived : extra.derived,
    };
}

export function patchAfoState(
    patch: Partial<ReturnType<typeof defaultAfoDesignState>>,
    checkpointLabel = "afo",
): void {
    const ds = useDesignStore.getState();
    ds.checkpoint(checkpointLabel);
    const current = ds.design.afo ?? defaultAfoDesignState();
    useDesignStore.setState({
        design: {
            ...ds.design,
            productType: "afo",
            afo: { ...current, ...patch },
        },
    });
}

export function refreshAfoWorkingMesh(): void {
    const src = useAfoStore.getState().sourceMesh;
    if (!src) return;
    const afo = getAfoState();
    const medial = afo.landmarks.find((l) => l.id === "malleolus_medial")?.point;
    const lateral = afo.landmarks.find((l) => l.id === "malleolus_lateral")?.point;
    const { mesh, featherMm } = applyClinicalCast(src, afo, { medialMal: medial, lateralMal: lateral });
    useAfoStore.getState().setCastMesh(mesh);
    if (Math.abs(featherMm - afo.effectiveFeatherMm) > 1e-3) {
        const ds = useDesignStore.getState();
        const current = ds.design.afo ?? defaultAfoDesignState();
        useDesignStore.setState({
            design: { ...ds.design, afo: { ...current, effectiveFeatherMm: featherMm } },
        });
    }
    const corrected = applyAfoCorrections(
        mesh,
        correctionsForSide(afo.corrections, afo.side),
        correctionContextFromAfo(afo, { medialMal: medial, lateralMal: lateral }),
    );
    useAfoStore.getState().setCorrectedMesh(corrected);
    if (!corrected || afo.trimPoints.length === 0) return;
    const nextPins = reprojectTrimPins(corrected, afo.trimPoints);
    const moved = nextPins.some((pin, i) => {
        const prev = afo.trimPoints[i]?.point;
        if (!prev) return true;
        return Math.hypot(pin.point.x - prev.x, pin.point.y - prev.y, pin.point.z - prev.z) > 0.1;
    });
    if (!moved) return;
    const trimCurve =
        afo.trimClosed && nextPins.length >= 3
            ? fitSurfaceSpline(
                  corrected,
                  nextPins.map((pin) => pin.point),
                  { closed: true, quick: true },
              ).curve
            : afo.trimCurve;
    const ds = useDesignStore.getState();
    const current = ds.design.afo ?? defaultAfoDesignState();
    useDesignStore.setState({
        design: {
            ...ds.design,
            afo: { ...current, trimPoints: nextPins, trimCurve },
        },
    });
}

export function ingestOrientedScan(mesh: AfoTriMesh): void {
    const oriented = orientMeshOutward(mesh);
    useAfoStore.getState().setSourceMesh(oriented);
    const afo = getAfoState();
    const crest = detectTibialCrest(oriented, afo.corrections.braceHeightMm, afo.clinicalMarkers);
    patchAfoState({ crest }, "afo-crest");
    refreshAfoWorkingMesh();
}

export function setProductType(productType: "insole" | "afo", side: Side = "left"): void {
    const ds = useDesignStore.getState();
    ds.checkpoint(`product-${productType}`);
    if (productType === "afo") {
        useDesignStore.setState({
            design: {
                ...ds.design,
                productType: "afo",
                method: "printing_shell",
                afo: ds.design.afo ?? defaultAfoDesignState(side),
            },
        });
        useAfoStore.getState().resetSession();
        return;
    }
    useDesignStore.setState({
        design: { ...ds.design, productType: "insole" },
    });
}

export const useAfoStore = create<AfoSessionStore>((set, get) => ({
    sourceMesh: null,
    castMesh: null,
    correctedMesh: null,
    shellMesh: null,
    unorientedMesh: null,
    scanPlacement: null,
    scanLandmarkError: null,
    scanShowMarkerLabels: true,
    scanAutoFrame: true,
    scanAutoFrameSuppressed: false,
    scanLastUndoId: null,
    scanDraggingMarkerId: null,
    scanHoverWorld: null,
    placingLandmarkIndex: 0,
    placingDesignLandmarks: false,
    placingClinicalId: null,
    placingTrim: false,
    trimHover: null,
    draggingTrimIndex: null,
    workerProgress: null,
    lastError: null,
    setSourceMesh: (mesh) =>
        set({
            sourceMesh: mesh ? cloneMesh(mesh) : null,
            castMesh: mesh ? cloneMesh(mesh) : null,
        }),
    setCastMesh: (mesh) => set({ castMesh: mesh ? cloneMesh(mesh) : null }),
    setCorrectedMesh: (mesh) => set({ correctedMesh: mesh ? cloneMesh(mesh) : null }),
    setShellMesh: (mesh) => set({ shellMesh: mesh ? cloneMesh(mesh) : null }),
    setUnorientedMesh: (mesh) => set({ unorientedMesh: mesh ? cloneMesh(mesh) : null }),
    setScanPlacement: (placement) => set({ scanPlacement: placement }),
    setScanLandmarkError: (message) => set({ scanLandmarkError: message }),
    setScanShowMarkerLabels: (on) => set({ scanShowMarkerLabels: on }),
    setScanAutoFrame: (on) => set({ scanAutoFrame: on }),
    setScanAutoFrameSuppressed: (on) => set({ scanAutoFrameSuppressed: on }),
    setScanLastUndoId: (id) => set({ scanLastUndoId: id }),
    setScanDraggingMarkerId: (id) => set({ scanDraggingMarkerId: id }),
    setScanHoverWorld: (point) => set({ scanHoverWorld: point }),
    setPlacingLandmarkIndex: (index) =>
        set({ placingLandmarkIndex: index, placingTrim: false, trimHover: null }),
    setPlacingDesignLandmarks: (on) =>
        set(
            on
                ? {
                      placingDesignLandmarks: true,
                      placingTrim: false,
                      placingClinicalId: null,
                      trimHover: null,
                  }
                : { placingDesignLandmarks: false },
        ),
    setPlacingClinicalId: (id) =>
        set(
            id
                ? {
                      placingClinicalId: id,
                      placingTrim: false,
                      placingDesignLandmarks: false,
                      trimHover: null,
                  }
                : { placingClinicalId: null },
        ),
    setPlacingTrim: (on) => {
        if (on) {
            set({
                placingTrim: true,
                placingClinicalId: null,
                placingDesignLandmarks: false,
                trimHover: null,
            });
            return;
        }
        const index = get().placingLandmarkIndex;
        const count = getAfoState().landmarks.length;
        const resume = count < AFO_DESIGN_MARKERS.length && index < AFO_DESIGN_MARKERS.length;
        set({ placingTrim: false, trimHover: null, placingDesignLandmarks: resume });
    },
    setTrimHover: (point) => set({ trimHover: point }),
    setDraggingTrimIndex: (index) => set({ draggingTrimIndex: index }),
    setWorkerProgress: (p) => set({ workerProgress: p }),
    setLastError: (msg) => set({ lastError: msg }),
    resetSession: () =>
        set({
            sourceMesh: null,
            castMesh: null,
            correctedMesh: null,
            shellMesh: null,
            unorientedMesh: null,
            scanPlacement: null,
            scanLandmarkError: null,
            scanShowMarkerLabels: true,
            scanAutoFrame: true,
            scanAutoFrameSuppressed: false,
            scanLastUndoId: null,
            scanDraggingMarkerId: null,
            scanHoverWorld: null,
            placingLandmarkIndex: 0,
            placingDesignLandmarks: false,
            placingClinicalId: null,
            placingTrim: false,
            trimHover: null,
            draggingTrimIndex: null,
            workerProgress: null,
            lastError: null,
        }),
}));
