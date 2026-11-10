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
import { type AfoOrientedSides, cameraViewForAfoMarkerId } from "@/lib/geometry/afo/marker-side";
import type { AfoAnatomicalLandmarkId, AfoPlantarPointId, AfoScanWorkflow } from "@/lib/geometry/afo/types";
import { getAfoState, useAfoStore } from "@/stores/afo-store";
import type { CameraView } from "@/stores/design-store";
import type { Side } from "@/types";

export const AFO_SCAN_GREY = "#C9CDD3";

/** Light neutral cast/scan surface. Reads on the navy viewport from a side view. */
export const AFO_CAST_SURFACE = "#E7EBF1";

/** Body draws under markers. Markers use a higher order and ignore depth so they stay on top. */
export const AFO_BODY_RENDER_ORDER = 1;
export const AFO_MARKER_RENDER_ORDER = 60;
export const AFO_MARKER_DEPTH_TEST = false;

/** World-millimetre point size when a scan has no usable faces. */
export const AFO_POINT_SIZE_MM = 2.4;

export type AfoScanDrawMode = "surface" | "points";

export interface AfoCastBodyStyle {
    drawMode: AfoScanDrawMode;
    /** Solid shaded surface, not a point sprite. */
    shaded: boolean;
    color: string;
    opacity: number;
    transparent: boolean;
    roughness: number;
    metalness: number;
    vertexColors: boolean;
    depthWrite: boolean;
    pointSizeMm: number;
    markerDepthTest: boolean;
    markerRenderOrder: number;
}

/**
 * A scan with no triangles, or almost only zero-area triangles, is a point cloud.
 * Sequential indices invented for a vertex list still count as unusable faces.
 */
export function afoScanDrawMode(triangleCount: number, degenerateRatio: number): AfoScanDrawMode {
    if (triangleCount <= 0 || degenerateRatio >= 0.8) return "points";
    return "surface";
}

export function afoTriangleStats(
    positions: ArrayLike<number>,
    indices: ArrayLike<number>,
): { triangles: number; degenerateRatio: number } {
    const triangles = Math.floor(indices.length / 3);
    if (triangles === 0) return { triangles: 0, degenerateRatio: 1 };
    const step = Math.max(1, Math.floor(triangles / 2000));
    let seen = 0;
    let bad = 0;
    for (let i = 0; i < triangles; i += step) {
        seen += 1;
        if (afoTriangleArea(positions, indices, i) < 1e-4) bad += 1;
    }
    return { triangles, degenerateRatio: bad / seen };
}

function afoTriangleArea(positions: ArrayLike<number>, indices: ArrayLike<number>, tri: number): number {
    const ia = indices[tri * 3] ?? 0;
    const ib = indices[tri * 3 + 1] ?? 0;
    const ic = indices[tri * 3 + 2] ?? 0;
    const ax = positions[ia * 3] ?? 0;
    const ay = positions[ia * 3 + 1] ?? 0;
    const az = positions[ia * 3 + 2] ?? 0;
    const bx = (positions[ib * 3] ?? 0) - ax;
    const by = (positions[ib * 3 + 1] ?? 0) - ay;
    const bz = (positions[ib * 3 + 2] ?? 0) - az;
    const cx = (positions[ic * 3] ?? 0) - ax;
    const cy = (positions[ic * 3 + 1] ?? 0) - ay;
    const cz = (positions[ic * 3 + 2] ?? 0) - az;
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    return 0.5 * Math.hypot(nx, ny, nz);
}

/** Luminance ramp along Z so a point cloud still shows leg depth. Stays light on navy. */
export function afoHeightColors(positions: ArrayLike<number>): Float32Array {
    const n = Math.floor(positions.length / 3);
    const colors = new Float32Array(n * 3);
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
        const z = positions[i * 3 + 2] ?? 0;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    const span = Math.max(1e-6, maxZ - minZ);
    for (let i = 0; i < n; i++) {
        const t = ((positions[i * 3 + 2] ?? 0) - minZ) / span;
        const l = 0.58 + 0.34 * t;
        colors[i * 3] = l;
        colors[i * 3 + 1] = l;
        colors[i * 3 + 2] = Math.min(1, l + 0.04);
    }
    return colors;
}

/** Default Cast / landmark body: opaque shaded surface. Heightmap and Transparent still apply. */
export function afoCastBodyStyle(opts: {
    transparentOn: boolean;
    heightmap: boolean;
    triangleCount: number;
    degenerateRatio: number;
}): AfoCastBodyStyle {
    const drawMode = afoScanDrawMode(opts.triangleCount, opts.degenerateRatio);
    const transparent = opts.transparentOn && drawMode === "surface";
    return {
        drawMode,
        shaded: drawMode === "surface",
        color: opts.heightmap ? "#ffffff" : AFO_CAST_SURFACE,
        opacity: transparent ? 0.45 : 1,
        transparent,
        roughness: 0.46,
        metalness: 0,
        vertexColors: opts.heightmap,
        depthWrite: !transparent,
        pointSizeMm: AFO_POINT_SIZE_MM,
        markerDepthTest: AFO_MARKER_DEPTH_TEST,
        markerRenderOrder: AFO_MARKER_RENDER_ORDER,
    };
}

/**
 * The Stage-1 plantar scan is solid grey. Keep that for every later landmark,
 * and whenever the Transparent control is off.
 */
export function afoUploadedScanMaterial(opts: { transparentOn: boolean; placingLandmarks: boolean }): {
    opacity: number;
    transparent: boolean;
    grey: boolean;
} {
    if (opts.placingLandmarks || !opts.transparentOn) {
        return { opacity: 1, transparent: false, grey: opts.placingLandmarks };
    }
    return { opacity: 0.45, transparent: true, grey: false };
}
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

/** Stage 1 plantar clicks keep the user's camera; auto-frame runs for anatomical landmarks only. */
export function afoScanAutoFrameAllowed(wf: AfoScanWorkflow): boolean {
    return wf.alignmentApplied;
}

/** Scan-marker camera. Placed M1/M5 decide the side; `side` is the fallback. */
export function cameraViewForAfoMarker(
    id: AfoMarkerKey,
    side: Side,
    oriented?: AfoOrientedSides,
): CameraView {
    return cameraViewForAfoMarkerId(id, side, oriented);
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
