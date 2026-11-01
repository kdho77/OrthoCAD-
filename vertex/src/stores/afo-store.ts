// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { create } from "zustand";
import { applyClinicalCast } from "@/lib/geometry/afo/cast";
import { applyAfoCorrections } from "@/lib/geometry/afo/corrections";
import { detectTibialCrest } from "@/lib/geometry/afo/crest";
import { defaultAfoDesignState } from "@/lib/geometry/afo/defaults";
import { cloneMesh } from "@/lib/geometry/afo/mesh-ops";
import type { AfoClinicalMarkerId, AfoScanWorkflow, AfoTriMesh } from "@/lib/geometry/afo/types";
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
    scanPlacement: { redo: string | null } | null;
    scanLandmarkError: string | null;
    placingLandmarkIndex: number;
    placingClinicalId: AfoClinicalMarkerId | null;
    placingTrim: boolean;
    draggingTrimIndex: number | null;
    workerProgress: { pct: number; stage: string } | null;
    lastError: string | null;
    setSourceMesh: (mesh: AfoTriMesh | null) => void;
    setCastMesh: (mesh: AfoTriMesh | null) => void;
    setCorrectedMesh: (mesh: AfoTriMesh | null) => void;
    setShellMesh: (mesh: AfoTriMesh | null) => void;
    setUnorientedMesh: (mesh: AfoTriMesh | null) => void;
    setScanPlacement: (placement: { redo: string | null } | null) => void;
    setScanLandmarkError: (message: string | null) => void;
    setPlacingLandmarkIndex: (index: number) => void;
    setPlacingClinicalId: (id: AfoClinicalMarkerId | null) => void;
    setPlacingTrim: (on: boolean) => void;
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
        corrections: { ...base.corrections, ...design.afo.corrections },
        reliefs: { ...base.reliefs, ...design.afo.reliefs },
        print: { ...base.print, ...design.afo.print },
        crest: { ...base.crest, ...design.afo.crest },
        clinicalMarkers: design.afo.clinicalMarkers ?? [],
        landmarks: design.afo.landmarks ?? [],
        scanWorkflow: mergeScanWorkflow(base.scanWorkflow, design.afo.scanWorkflow),
        trimPoints: design.afo.trimPoints ?? [],
    };
}

function mergeScanWorkflow(base: AfoScanWorkflow, extra?: AfoScanWorkflow): AfoScanWorkflow {
    if (!extra) return base;
    return {
        ...base,
        ...extra,
        plantar: { ...base.plantar, ...(extra.plantar ?? {}) },
        landmarks: { ...base.landmarks, ...(extra.landmarks ?? {}) },
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
    const corrected = applyAfoCorrections(mesh, afo.corrections, {
        medialMal: medial,
        lateralMal: lateral,
    });
    useAfoStore.getState().setCorrectedMesh(corrected);
}

export function ingestOrientedScan(mesh: AfoTriMesh): void {
    useAfoStore.getState().setSourceMesh(mesh);
    const afo = getAfoState();
    const crest = detectTibialCrest(mesh, afo.corrections.braceHeightMm, afo.clinicalMarkers);
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

export const useAfoStore = create<AfoSessionStore>((set) => ({
    sourceMesh: null,
    castMesh: null,
    correctedMesh: null,
    shellMesh: null,
    unorientedMesh: null,
    scanPlacement: null,
    scanLandmarkError: null,
    placingLandmarkIndex: 0,
    placingClinicalId: null,
    placingTrim: false,
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
    setPlacingLandmarkIndex: (index) => set({ placingLandmarkIndex: index }),
    setPlacingClinicalId: (id) => set({ placingClinicalId: id }),
    setPlacingTrim: (on) => set({ placingTrim: on }),
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
            placingLandmarkIndex: 0,
            placingClinicalId: null,
            placingTrim: false,
            draggingTrimIndex: null,
            workerProgress: null,
            lastError: null,
        }),
}));
