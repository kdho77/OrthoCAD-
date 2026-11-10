// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    AFO_LANDMARK_STEPS,
    AFO_OPTIONAL_LANDMARK_COUNT,
    AFO_PLANTAR_STEPS,
    AFO_REQUIRED_LANDMARK_COUNT,
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

/**
 * Body draws under markers. A solid surface keeps near markers readable
 * through the shell. A point cloud writes depth and dims the far side:
 * without that, the cloud is the mirror of the opposite view.
 */
export const AFO_BODY_RENDER_ORDER = 1;
export const AFO_MARKER_RENDER_ORDER = 60;
/** Solid cast / shell. Point clouds turn depth testing on in {@link afoCastBodyStyle}. */
export const AFO_MARKER_DEPTH_TEST = false;

/** World-millimetre point size when a scan has no usable faces. */
export const AFO_POINT_SIZE_MM = 2.4;
/** Far point-cloud markers stay faintly visible where the depth splat has a hole. */
export const AFO_FAR_MARKER_OPACITY = 0.16;
/** Hidden splats overlap neighbouring samples so the cloud occludes the far side. */
export const AFO_POINT_DEPTH_SPLAT_SCALE = 2.6;
/**
 * Depth window for point-cloud shading. A sample one leg-width behind the
 * nearest surface is fully dim, so the far side cannot be read as the near side.
 */
export const AFO_POINT_DEPTH_WINDOW_MM = 90;
/** Near samples stay the material colour. Far samples drop to this fraction. */
export const AFO_POINT_BRIGHTNESS_MIN = 0.2;
export const AFO_POINT_BRIGHTNESS_SPAN = 0.8;
export const AFO_POINT_SIZE_MIN = 0.55;
export const AFO_POINT_SIZE_SPAN = 0.8;

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
    /** Point clouds write depth. Surfaces do too, unless Transparent is on. */
    pointDepthWrite: boolean;
    /** Camera-distance brightness and size. Point clouds only. */
    pointDistanceShade: boolean;
    /** 1 for a surface. Point clouds draw a larger depth-only splat under the visible points. */
    pointDepthSplatScale: number;
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

export interface AfoViewPoint {
    x: number;
    y: number;
    z: number;
}

/** 1 at the nearest sample, 0 at the farthest. Shared with the point-cloud shader. */
export function afoCameraProximity(distance: number, nearest: number, farthest: number): number {
    const span = Math.max(1, farthest - nearest);
    const t = (distance - nearest) / span;
    return 1 - Math.min(1, Math.max(0, t));
}

export function afoPointBrightness(proximity: number): number {
    const clamped = Math.min(1, Math.max(0, proximity));
    return AFO_POINT_BRIGHTNESS_MIN + AFO_POINT_BRIGHTNESS_SPAN * clamped;
}

export function afoPointSizeScale(proximity: number): number {
    const clamped = Math.min(1, Math.max(0, proximity));
    return AFO_POINT_SIZE_MIN + AFO_POINT_SIZE_SPAN * clamped;
}

export function afoPointCloudGlsl(): { sizeScale: string; brightness: string } {
    return {
        sizeScale: `${AFO_POINT_SIZE_MIN.toFixed(2)} + ${AFO_POINT_SIZE_SPAN.toFixed(2)} * afoProx`,
        brightness: `${AFO_POINT_BRIGHTNESS_MIN.toFixed(2)} + ${AFO_POINT_BRIGHTNESS_SPAN.toFixed(2)} * afoProx`,
    };
}

function axisValue(point: AfoViewPoint, axis: 0 | 1 | 2): number {
    if (axis === 0) return point.x;
    if (axis === 1) return point.y;
    return point.z;
}

/**
 * Preset axis the camera sits on. Presets look at the origin, so the camera
 * position is the view direction: X front/back, Y up/down, Z left/right.
 */
export function afoCameraDominantAxis(camera: AfoViewPoint): 0 | 1 | 2 {
    const ax = Math.abs(camera.x);
    const ay = Math.abs(camera.y);
    const az = Math.abs(camera.z);
    if (ax >= ay && ax >= az) return 0;
    if (ay >= ax && ay >= az) return 1;
    return 2;
}

/**
 * True when the marker is on the camera's side of the body center.
 * Every scan, design, and clinical marker uses this. It does not know the
 * marker id, so it cannot flip one landmark and leave the others behind.
 */
export function afoMarkerOnCameraSide(
    marker: AfoViewPoint,
    camera: AfoViewPoint,
    bodyCenter: AfoViewPoint,
): boolean {
    if (Math.hypot(camera.x, camera.y, camera.z) < 1) return true;
    const axis = afoCameraDominantAxis(camera);
    const cam = axisValue(camera, axis);
    const mid = axisValue(bodyCenter, axis);
    const at = axisValue(marker, axis);
    return cam >= mid ? at >= mid : at <= mid;
}

export interface AfoMarkerDisplayCue {
    opacity: number;
    /** Depth-test against the cloud or the surface. */
    depthTest: boolean;
    /** Far point-cloud markers are occluded, not only dimmed. */
    occluded: boolean;
    dimmed: boolean;
}

/** Display cue for one marker. Placement and the camera preset stay on the shared side rule. */
export function afoMarkerDisplayCue(opts: {
    drawMode: AfoScanDrawMode;
    facesCamera: boolean;
    baseOpacity?: number;
}): AfoMarkerDisplayCue {
    const base = opts.baseOpacity ?? 1;
    const far = !opts.facesCamera;
    if (opts.drawMode === "points") {
        return {
            opacity: far ? base * AFO_FAR_MARKER_OPACITY : base,
            depthTest: true,
            occluded: far,
            dimmed: far,
        };
    }
    return {
        opacity: far ? base * AFO_FAR_MARKER_OPACITY : base,
        depthTest: far,
        occluded: false,
        dimmed: far,
    };
}

export interface AfoPointCloudShader {
    vertexShader: string;
    fragmentShader: string;
    uniforms: Record<string, { value: number }>;
}

/** Camera-distance size and brightness. Near samples read as the near surface. */
export function patchAfoPointCloudShaders(shader: AfoPointCloudShader): void {
    const glsl = afoPointCloudGlsl();
    if (!shader.vertexShader.includes("gl_PointSize = size;")) {
        throw new Error("AFO point cloud shader is missing gl_PointSize.");
    }
    if (!shader.fragmentShader.includes("#include <color_fragment>")) {
        throw new Error("AFO point cloud shader is missing color_fragment.");
    }
    shader.uniforms.afoNear = { value: 80 };
    shader.uniforms.afoFar = { value: 900 };
    shader.vertexShader = shader.vertexShader
        .replace(
            "uniform float size;",
            `uniform float size;
uniform float afoNear;
uniform float afoFar;
varying float vAfoViewZ;`,
        )
        .replace(
            "#include <project_vertex>",
            `#include <project_vertex>
	vAfoViewZ = -mvPosition.z;`,
        )
        .replace(
            "gl_PointSize = size;",
            `float afoProx = 1.0 - clamp((vAfoViewZ - afoNear) / max(1.0, afoFar - afoNear), 0.0, 1.0);
	gl_PointSize = size * (${glsl.sizeScale});`,
        );
    shader.fragmentShader = shader.fragmentShader
        .replace(
            "uniform float opacity;",
            `uniform float opacity;
uniform float afoNear;
uniform float afoFar;
varying float vAfoViewZ;`,
        )
        .replace(
            "#include <color_fragment>",
            `#include <color_fragment>
	float afoProx = 1.0 - clamp((vAfoViewZ - afoNear) / max(1.0, afoFar - afoNear), 0.0, 1.0);
	diffuseColor.rgb *= (${glsl.brightness});`,
        );
}

export function setAfoPointCloudRange(
    material: { userData: { afoShader?: AfoPointCloudShader } },
    nearest: number,
    farthest: number,
): void {
    const shader = material.userData.afoShader;
    if (!shader?.uniforms.afoNear || !shader.uniforms.afoFar) return;
    shader.uniforms.afoNear.value = nearest;
    shader.uniforms.afoFar.value = Math.max(farthest, nearest + 1);
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
        pointDepthWrite: true,
        pointDistanceShade: drawMode === "points",
        pointDepthSplatScale: drawMode === "points" ? AFO_POINT_DEPTH_SPLAT_SCALE : 1,
        markerDepthTest: drawMode === "points" ? true : AFO_MARKER_DEPTH_TEST,
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
