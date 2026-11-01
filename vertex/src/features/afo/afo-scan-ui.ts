// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    AFO_LANDMARK_STEPS,
    AFO_OPTIONAL_LANDMARK_COUNT,
    AFO_PLANTAR_STEPS,
    AFO_REQUIRED_LANDMARK_COUNT,
    afoFrameSide,
    scanForAfoWorkflow,
    skipAfoLandmark,
    undoAfoMarker,
} from "@/features/afo/afo-scan-markers";
import {
    firstMissingStep,
    landmarkSettled,
    nextLandmarkStep,
    skippedLandmarkIds,
} from "@/lib/geometry/afo/landmark-frame";
import type { AfoAnatomicalLandmarkId, AfoPlantarPointId, AfoScanWorkflow } from "@/lib/geometry/afo/types";
import { medialSign } from "@/lib/pressure-map/placement";
import { getAfoState, useAfoStore } from "@/stores/afo-store";
import type { CameraView } from "@/stores/design-store";
import type { Side } from "@/types";

export const AFO_SCAN_GREY = "#C9CDD3";
export const AFO_STAGE1_MARKER = "#F59E0B";
export const AFO_REQUIRED_MARKER = "#22D3EE";
export const AFO_OPTIONAL_MARKER = "#A78BFA";
export const AFO_MARKER_OUTLINE = "#0f172a";
export const AFO_MARKER_WORLD_MM = 4;
export const AFO_MARKER_MIN_PX = 10;
export const AFO_PLACE_ADVANCE_MS = 250;
export const AFO_CAMERA_TWEEN_MS = 400;

export type AfoMarkerKey = AfoPlantarPointId | AfoAnatomicalLandmarkId;

export const AFO_MARKER_PILL: Record<AfoMarkerKey, string> = {
    heel: "Heel",
    m1p: "M1p",
    m5p: "M5p",
    posterior_calcaneus: "PC",
    m1_mpj: "M1",
    m5_mpj: "M5",
    navicular: "Nav",
    fifth_met_base: "Sty",
    medial_malleolus: "MM",
    lateral_malleolus: "LM",
    fibular_head: "FH",
};

export const AFO_MARKER_FULL_NAME: Record<AfoMarkerKey, string> = {
    heel: "Plantar heel center",
    m1p: "Plantar 1st met head",
    m5p: "Plantar 5th met head",
    posterior_calcaneus: "Posterior calcaneus center",
    m1_mpj: "M1 medial 1st MPJ prominence",
    m5_mpj: "M5 lateral 5th MPJ prominence",
    navicular: "Navicular tuberosity",
    fifth_met_base: "5th met base (styloid)",
    medial_malleolus: "Medial malleolus",
    lateral_malleolus: "Lateral malleolus",
    fibular_head: "Fibular head",
};

export const AFO_MARKER_CLICK_HINT: Record<AfoMarkerKey, string> = {
    heel: "Click the plantar center of the heel on the sole.",
    m1p: "Click the plantar head of the 1st metatarsal.",
    m5p: "Click the plantar head of the 5th metatarsal.",
    posterior_calcaneus: "Click the posterior center of the calcaneus.",
    m1_mpj: "Click the medial 1st MPJ prominence on the dorsal foot.",
    m5_mpj: "Click the lateral 5th MPJ prominence.",
    navicular: "Click the navicular tuberosity on the medial midfoot.",
    fifth_met_base: "Click the styloid process at the 5th met base.",
    medial_malleolus: "Click the apex of the medial malleolus.",
    lateral_malleolus: "Click the apex of the lateral malleolus.",
    fibular_head: "Click the fibular head at the proximal lateral leg.",
};

export const AFO_MARKER_HELP: Record<AfoMarkerKey, string> = {
    heel: "Center of the plantar fat pad at the heel. This anchors the rearfoot in the alignment triangle.",
    m1p: "Plantar surface at the first metatarsal head — the medial forefoot corner of the triangle.",
    m5p: "Plantar surface at the fifth metatarsal head — the lateral forefoot corner.",
    posterior_calcaneus: "Posterior-most point of the calcaneus, centered left-to-right on the heel.",
    m1_mpj: "Medial dorsal prominence at the first metatarsophalangeal joint.",
    m5_mpj: "Lateral dorsal prominence at the fifth metatarsophalangeal joint.",
    navicular: "Optional. Medial navicular tuberosity — used for navicular relief if placed.",
    fifth_met_base: "Optional. Styloid at the fifth metatarsal base — used for styloid relief if placed.",
    medial_malleolus: "Medial malleolus apex — defines the ankle axis with the lateral malleolus.",
    lateral_malleolus: "Lateral malleolus apex — should sit slightly distal to the medial.",
    fibular_head: "Optional. Fibular head — sets the proximal trim reference when placed.",
};

export function markerColor(id: AfoMarkerKey, optional: boolean, stage1: boolean): string {
    if (stage1) return AFO_STAGE1_MARKER;
    return optional ? AFO_OPTIONAL_MARKER : AFO_REQUIRED_MARKER;
}

export function activeAfoTarget(wf: AfoScanWorkflow, redo: string | null): AfoMarkerKey | null {
    if (redo) return redo as AfoMarkerKey;
    if (!wf.alignmentApplied) {
        const next = firstMissingStep(AFO_PLANTAR_STEPS, wf.plantar);
        return next?.id ?? null;
    }
    const next = nextLandmarkStep(wf);
    return next?.id ?? null;
}

export function afoPlacementComplete(wf: AfoScanWorkflow): boolean {
    if (!wf.plantar.heel || !wf.plantar.m1p || !wf.plantar.m5p) return false;
    if (!wf.alignmentApplied) return false;
    const skipped = skippedLandmarkIds(wf);
    return AFO_LANDMARK_STEPS.every((step) => landmarkSettled(step.id, wf.landmarks, skipped));
}

export function afoGuidedProgress(wf: AfoScanWorkflow): {
    stage: 1 | 2;
    headline: string;
    progress: number;
} {
    if (!wf.alignmentApplied) {
        const done = AFO_PLANTAR_STEPS.filter((s) => wf.plantar[s.id]).length;
        return {
            stage: 1,
            headline: `Alignment ${Math.min(done + 1, 3)} of 3`,
            progress: done / 3,
        };
    }
    const skipped = skippedLandmarkIds(wf);
    const requiredDone = AFO_LANDMARK_STEPS.filter((s) => !s.optional && wf.landmarks[s.id]).length;
    const settled = AFO_LANDMARK_STEPS.filter((s) => landmarkSettled(s.id, wf.landmarks, skipped)).length;
    return {
        stage: 2,
        headline: `Marker ${Math.min(requiredDone + 1, AFO_REQUIRED_LANDMARK_COUNT)} of ${AFO_REQUIRED_LANDMARK_COUNT} (+${AFO_OPTIONAL_LANDMARK_COUNT} optional)`,
        progress: settled / AFO_LANDMARK_STEPS.length,
    };
}

export function firstMissingRequiredLandmark(
    wf: AfoScanWorkflow,
): (typeof AFO_LANDMARK_STEPS)[number] | null {
    const skipped = skippedLandmarkIds(wf);
    return (
        AFO_LANDMARK_STEPS.find(
            (step) => !step.optional && !landmarkSettled(step.id, wf.landmarks, skipped),
        ) ?? null
    );
}

export function jumpToFirstMissingRequired(): void {
    const wf = getAfoState().scanWorkflow;
    if (!wf.alignmentApplied) {
        const next = firstMissingStep(AFO_PLANTAR_STEPS, wf.plantar);
        useAfoStore.getState().setScanPlacement({ redo: next?.id ?? null, paused: false });
        useAfoStore.getState().setScanAutoFrameSuppressed(false);
        return;
    }
    const next = firstMissingRequiredLandmark(wf);
    if (next) {
        useAfoStore.getState().setScanPlacement({ redo: next.id, paused: false });
        useAfoStore.getState().setScanAutoFrameSuppressed(false);
    }
}

/** Camera preset for the active marker; medial/lateral flip with foot side. */
export function cameraViewForAfoMarker(id: AfoMarkerKey, side: Side): CameraView {
    if (id === "heel" || id === "m1p" || id === "m5p") return "bottom";
    if (id === "posterior_calcaneus") return "back";
    const sign = medialSign(side);
    const medialView: CameraView = sign === 1 ? "left" : "right";
    const lateralView: CameraView = sign === 1 ? "right" : "left";
    if (id === "medial_malleolus" || id === "navicular") return medialView;
    if (id === "lateral_malleolus" || id === "fifth_met_base" || id === "fibular_head") return lateralView;
    if (id === "m1_mpj") return medialView;
    if (id === "m5_mpj") return lateralView;
    return "iso";
}

const LANDMARK_IDS = new Set<string>(AFO_LANDMARK_STEPS.map((s) => s.id));

const UNDO_ORDER: readonly AfoMarkerKey[] = [
    ...AFO_LANDMARK_STEPS.map((s) => s.id).reverse(),
    ...AFO_PLANTAR_STEPS.map((s) => s.id).reverse(),
];

export function undoLastAfoMarker(): string | null {
    const wf = getAfoState().scanWorkflow;
    const skipped = skippedLandmarkIds(wf);
    for (const id of UNDO_ORDER) {
        if (LANDMARK_IDS.has(id)) {
            const lid = id as AfoAnatomicalLandmarkId;
            if (landmarkSettled(lid, wf.landmarks, skipped)) {
                undoAfoMarker(lid);
                useAfoStore.getState().setScanLastUndoId(lid);
                return lid;
            }
            continue;
        }
        if (wf.plantar[id as AfoPlantarPointId]) {
            undoAfoMarker(id);
            useAfoStore.getState().setScanLastUndoId(id);
            return id;
        }
    }
    return null;
}

export function redoLastAfoMarker(): void {
    const id = useAfoStore.getState().scanLastUndoId;
    if (!id) return;
    useAfoStore.getState().setScanPlacement({ redo: id, paused: false });
    useAfoStore.getState().setScanLastUndoId(null);
}

export function ensureAfoScanPlacement(): void {
    const wf = getAfoState().scanWorkflow;
    if (afoPlacementComplete(wf)) {
        useAfoStore.getState().setScanPlacement(null);
        return;
    }
    if (!scanForAfoWorkflow()) return;
    const current = useAfoStore.getState().scanPlacement;
    if (!current) useAfoStore.getState().setScanPlacement({ redo: null, paused: false });
}

export function afoRequiredLandmarkSummary(wf: AfoScanWorkflow): string {
    const n = AFO_LANDMARK_STEPS.filter((s) => !s.optional && wf.landmarks[s.id]).length;
    return `${n}/${AFO_REQUIRED_LANDMARK_COUNT} required (+${AFO_OPTIONAL_LANDMARK_COUNT} optional)`;
}

export { skipAfoLandmark };
