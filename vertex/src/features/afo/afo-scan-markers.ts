// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { defaultAfoScanWorkflow } from "@/lib/geometry/afo/defaults";
import {
    AFO_LANDMARK_STEPS,
    AFO_OPTIONAL_LANDMARK_COUNT,
    AFO_PLANTAR_STEPS,
    AFO_REQUIRED_LANDMARK_COUNT,
    alignScanToPlantarFrame,
    anatomicalPlacementAllowed,
    deriveAfoMeasurements,
    firstMissingStep,
    isOptionalLandmark,
    nextLandmarkStep,
    type OrientedLandmarks,
    requiredLandmarkCount,
    skippedLandmarkIds,
    transformAfoPoint,
} from "@/lib/geometry/afo/landmark-frame";
import { geometryToAfoMesh } from "@/lib/geometry/afo/mesh-ops";
import type {
    AfoAnatomicalLandmarkId,
    AfoPlantarPointId,
    AfoScanWorkflow,
    AfoTriMesh,
    AfoVec3,
} from "@/lib/geometry/afo/types";
import { getAfoState, ingestOrientedScan, patchAfoState, useAfoStore } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useScanStore } from "@/stores/scan-store";
import type { Side } from "@/types";

export {
    AFO_FOREFOOT_WARN_DEG,
    AFO_LANDMARK_STEPS,
    AFO_OPTIONAL_LANDMARK_COUNT,
    AFO_PLANNED_RELIEFS_MM,
    AFO_PLANTAR_STEPS,
    AFO_PROXIMAL_TRIM_OFFSET_MM,
    AFO_REQUIRED_LANDMARK_COUNT,
} from "@/lib/geometry/afo/landmark-frame";

const PLANTAR_IDS = new Set<string>(AFO_PLANTAR_STEPS.map((step) => step.id));
const LANDMARK_IDS = new Set<string>(AFO_LANDMARK_STEPS.map((step) => step.id));

/**
 * Insole placement waits on the loaded landmark base.
 * AFO has no insole base — the scan itself is the placement target.
 */
export function markerPlaceControl(opts: { isAfo: boolean; hasLandmarkBase: boolean }): {
    enabled: boolean;
    blockedTitle: string | null;
} {
    if (opts.isAfo || opts.hasLandmarkBase) return { enabled: true, blockedTitle: null };
    return { enabled: false, blockedTitle: "Base geometry not loaded" };
}

/** Insole clicks use the scan layer. AFO design landmarks take over only when scan placement is idle. */
export function activeMarkerPlacementLayer(
    isAfo: boolean,
    placingScanMarkers: boolean,
    placingAfoLandmarks = false,
): "scan" | "afo-design" | "afo-scan" {
    if (isAfo && placingAfoLandmarks) return "afo-scan";
    return isAfo && !placingScanMarkers ? "afo-design" : "scan";
}

export function afoFrameSide(scanSide: Side): Side {
    const editing = useClinicalWorkflowStore.getState().elementPlacementFoot;
    if (editing === "left" || editing === "right") return editing;
    return scanSide;
}

export function scanForAfoWorkflow(): {
    id: string;
    side: Side;
    geometry: BufferGeometry;
    displayScale: number;
} | null {
    const scans = useScanStore.getState().scans;
    const wf = getAfoState().scanWorkflow;
    const chosen =
        (wf.scanId ? scans.find((scan) => scan.id === wf.scanId) : undefined) ??
        (() => {
            const editing = useClinicalWorkflowStore.getState().elementPlacementFoot;
            if (editing === "left" || editing === "right") {
                return scans.find((scan) => scan.side === editing) ?? scans[0];
            }
            return scans[0];
        })();
    if (!chosen) return null;
    return {
        id: chosen.id,
        side: chosen.side,
        geometry: chosen.geometry,
        displayScale: chosen.display.displayScale,
    };
}

function scaleMesh(mesh: AfoTriMesh, scale: number): AfoTriMesh {
    if (scale === 1) return mesh;
    const positions = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i++) positions[i] = (mesh.positions[i] ?? 0) * scale;
    return { positions, indices: mesh.indices };
}

function writeWorkflow(next: AfoScanWorkflow, label: string): void {
    patchAfoState({ scanWorkflow: next }, label);
}

function freshIfScanChanged(wf: AfoScanWorkflow, scanId: string, displayScale: number): AfoScanWorkflow {
    if (wf.scanId && wf.scanId !== scanId) {
        return { ...defaultAfoScanWorkflow(), scanId, displayScale };
    }
    return { ...wf, scanId, displayScale: displayScale > 0 ? displayScale : wf.displayScale };
}

function orientedLandmarks(wf: AfoScanWorkflow): OrientedLandmarks {
    const matrix = wf.matrixElements;
    const out: OrientedLandmarks = {};
    if (!matrix) return out;
    for (const step of AFO_LANDMARK_STEPS) {
        const point = wf.landmarks[step.id];
        if (point) out[step.id] = transformAfoPoint(point, matrix);
    }
    return out;
}

function withDerived(wf: AfoScanWorkflow, side: Side): AfoScanWorkflow {
    if (!wf.alignmentApplied || !wf.matrixElements) return { ...wf, derived: null };
    const derived = deriveAfoMeasurements(
        orientedLandmarks(wf),
        side,
        useAfoStore.getState().sourceMesh,
        wf.derived?.forefootToRearfootDeg ?? null,
    );
    return { ...wf, derived };
}

export function commitAfoScanPoint(pointMm: AfoVec3, scanId: string, displayScale: number): string | null {
    const scan = useScanStore.getState().scans.find((item) => item.id === scanId);
    const side = afoFrameSide(scan?.side ?? "left");
    let wf = freshIfScanChanged(getAfoState().scanWorkflow, scanId, displayScale);
    const redo = useAfoStore.getState().scanPlacement?.redo;

    if (redo && PLANTAR_IDS.has(redo)) {
        const id = redo as AfoPlantarPointId;
        wf = {
            ...wf,
            plantar: { ...wf.plantar, [id]: pointMm },
            alignmentApplied: false,
            levelToRearfoot: false,
            matrixElements: null,
            derived: null,
        };
        writeWorkflow(wf, "afo-plantar");
        useAfoStore.getState().setScanPlacement({ redo: null });
        useAfoStore.getState().setScanLandmarkError(null);
        return null;
    }

    if (redo && LANDMARK_IDS.has(redo)) {
        if (!wf.alignmentApplied) return "Apply alignment before anatomical landmarks.";
        const id = redo as AfoAnatomicalLandmarkId;
        const allowed = anatomicalPlacementAllowed(id, wf.landmarks, skippedLandmarkIds(wf));
        if (!allowed.ok) return allowed.message;
        wf = withDerived(
            {
                ...wf,
                skippedLandmarks: skippedLandmarkIds(wf).filter((skipped) => skipped !== id),
                landmarks: { ...wf.landmarks, [id]: pointMm },
            },
            side,
        );
        writeWorkflow(wf, "afo-landmark");
        useAfoStore.getState().setScanPlacement({ redo: null });
        useAfoStore.getState().setScanLandmarkError(null);
        return null;
    }

    const nextPlantar = firstMissingStep(AFO_PLANTAR_STEPS, wf.plantar);
    if (nextPlantar && !wf.alignmentApplied) {
        wf = { ...wf, plantar: { ...wf.plantar, [nextPlantar.id]: pointMm } };
        writeWorkflow(wf, "afo-plantar");
        useAfoStore.getState().setScanLandmarkError(null);
        return null;
    }

    if (!wf.alignmentApplied) return "Apply alignment before anatomical landmarks.";

    const nextLandmark = nextLandmarkStep(wf);
    if (!nextLandmark) return "All landmarks are placed. Redo one to move it.";
    const allowed = anatomicalPlacementAllowed(nextLandmark.id, wf.landmarks, skippedLandmarkIds(wf));
    if (!allowed.ok) return allowed.message;
    wf = withDerived(
        {
            ...wf,
            skippedLandmarks: skippedLandmarkIds(wf).filter((skipped) => skipped !== nextLandmark.id),
            landmarks: { ...wf.landmarks, [nextLandmark.id]: pointMm },
        },
        side,
    );
    writeWorkflow(wf, "afo-landmark");
    useAfoStore.getState().setScanLandmarkError(null);
    return null;
}

export function undoAfoMarker(id: string): void {
    const scan = scanForAfoWorkflow();
    const side = afoFrameSide(scan?.side ?? "left");
    const wf = getAfoState().scanWorkflow;
    if (PLANTAR_IDS.has(id)) {
        const plantar = { ...wf.plantar };
        delete plantar[id as AfoPlantarPointId];
        writeWorkflow(
            {
                ...wf,
                plantar,
                alignmentApplied: false,
                levelToRearfoot: false,
                matrixElements: null,
                derived: null,
            },
            "afo-plantar-undo",
        );
        return;
    }
    if (!LANDMARK_IDS.has(id)) return;
    const landmarkId = id as AfoAnatomicalLandmarkId;
    const landmarks = { ...wf.landmarks };
    delete landmarks[landmarkId];
    writeWorkflow(
        withDerived(
            {
                ...wf,
                landmarks,
                skippedLandmarks: skippedLandmarkIds(wf).filter((skipped) => skipped !== landmarkId),
            },
            side,
        ),
        "afo-landmark-undo",
    );
}

/** Skip an optional landmark. Earlier markers must already be placed or skipped. */
export function skipAfoLandmark(id: string): string | null {
    if (!isOptionalLandmark(id)) return "That landmark is required.";
    const scan = scanForAfoWorkflow();
    const side = afoFrameSide(scan?.side ?? "left");
    const wf = getAfoState().scanWorkflow;
    if (!wf.alignmentApplied) return "Apply alignment before anatomical landmarks.";
    if (wf.landmarks[id]) return "Undo the marker before skipping it.";
    const skipped = skippedLandmarkIds(wf);
    if (skipped.includes(id)) return null;
    const allowed = anatomicalPlacementAllowed(id, wf.landmarks, skipped);
    if (!allowed.ok) return allowed.message;
    writeWorkflow(withDerived({ ...wf, skippedLandmarks: [...skipped, id] }, side), "afo-landmark-skip");
    useAfoStore.getState().setScanLandmarkError(null);
    return null;
}

export function redoAfoMarker(id: string): void {
    useAfoStore.getState().setScanPlacement({ redo: id });
    useAfoStore.getState().setScanLandmarkError(null);
}

/** Rigid plantar align. `levelToRearfoot` aims +X along the heel–malleolar midpoint. */
export function applyAfoAlignment(levelToRearfoot = false): void {
    const wf = getAfoState().scanWorkflow;
    const heel = wf.plantar.heel;
    const m1p = wf.plantar.m1p;
    const m5p = wf.plantar.m5p;
    if (!heel || !m1p || !m5p) {
        throw new Error("Place the plantar heel, 1st met head, and 5th met head before applying alignment.");
    }
    const scan = scanForAfoWorkflow();
    if (!scan) throw new Error("Import a foot+leg scan to start the AFO case.");
    const side = afoFrameSide(scan.side);
    const scale = Number.isFinite(scan.displayScale) && scan.displayScale > 0 ? scan.displayScale : 1;
    const mesh = scaleMesh(geometryToAfoMesh(scan.geometry), scale);
    let longitudinal: AfoVec3 | undefined;
    if (levelToRearfoot) {
        const medial = wf.landmarks.medial_malleolus;
        const lateral = wf.landmarks.lateral_malleolus;
        if (!medial || !lateral) {
            throw new Error("Level to rearfoot needs the medial and lateral malleoli.");
        }
        longitudinal = {
            x: (medial.x + lateral.x) / 2,
            y: (medial.y + lateral.y) / 2,
            z: (medial.z + lateral.z) / 2,
        };
    }
    const aligned = alignScanToPlantarFrame(mesh, { heel, m1p, m5p }, side, longitudinal);
    useAfoStore.getState().setUnorientedMesh(mesh);
    const next: AfoScanWorkflow = {
        ...wf,
        scanId: scan.id,
        displayScale: scale,
        alignmentApplied: true,
        levelToRearfoot,
        matrixElements: aligned.matrixElements,
        derived: {
            forefootToRearfootDeg: aligned.forefootToRearfootDeg,
            ankleAxis: null,
            plannedReliefsMm: { malleoli: -3, navicular: null, styloid: null },
            proximalTrimCap: null,
            heelCupCenter: null,
            mpjBreak: null,
            shankTiltDeg: null,
            warnings: [],
        },
    };
    writeWorkflow(next, "afo-align");
    ingestOrientedScan(aligned.mesh);
    writeWorkflow(withDerived(getAfoState().scanWorkflow, side), "afo-derived");
    useAfoStore.getState().setScanLandmarkError(null);
}

export function afoStageSnapshot(wf: AfoScanWorkflow): {
    stage: 1 | 2;
    title: string;
    nextLabel: string | null;
    landmarkCount: number;
} {
    const landmarkCount = requiredLandmarkCount(wf);
    if (!wf.alignmentApplied) {
        const next = firstMissingStep(AFO_PLANTAR_STEPS, wf.plantar);
        return {
            stage: 1,
            title: "Step 1 of 2: Align",
            nextLabel: next?.label ?? "Apply alignment",
            landmarkCount,
        };
    }
    const next = nextLandmarkStep(wf);
    return {
        stage: 2,
        title: `Step 2 of 2: Landmarks ${landmarkCount}/${AFO_REQUIRED_LANDMARK_COUNT} required (+${AFO_OPTIONAL_LANDMARK_COUNT} optional)`,
        nextLabel: next ? (next.optional ? `${next.label} (optional)` : next.label) : null,
        landmarkCount,
    };
}
