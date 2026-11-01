// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useMemo, useState } from "react";
import {
    AFO_FOREFOOT_WARN_DEG,
    AFO_LANDMARK_STEPS,
    AFO_PLANNED_RELIEFS_MM,
    AFO_PLANTAR_STEPS,
    AFO_PROXIMAL_TRIM_OFFSET_MM,
    AFO_REQUIRED_LANDMARK_COUNT,
    afoFrameSide,
    applyAfoAlignment,
    commitAfoScanPoint,
    redoAfoMarker,
    scanForAfoWorkflow,
    skipAfoLandmark,
    undoAfoMarker,
} from "@/features/afo/afo-scan-markers";
import {
    AfoChecklistCheck,
    afoChecklistRowState,
} from "@/features/afo/AfoScanGuidedCard";
import {
    afoPlacementComplete,
    afoRequiredLandmarkSummary,
    ensureAfoScanPlacement,
    jumpToFirstMissingRequired,
} from "@/features/afo/afo-scan-ui";
import { ScanImport } from "@/features/scans/ScanImport";
import { selectAfoLandmarkRevision, selectScanGateRevision } from "@/lib/clinical/clinical-step-gates";
import { defaultAfoScanWorkflow } from "@/lib/geometry/afo/defaults";
import {
    buildPlantarFrame,
    forefootToRearfootDeg,
    PlantarFrameError,
} from "@/lib/geometry/afo/landmark-frame";
import { geometryToAfoMesh, meshCentroid } from "@/lib/geometry/afo/mesh-ops";
import { buildSyntheticLegMesh } from "@/lib/geometry/afo/synthetic-leg";
import type { AfoScanWorkflow, AfoVec3 } from "@/lib/geometry/afo/types";
import { getAfoState, ingestOrientedScan, useAfoStore } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useScanStore } from "@/stores/scan-store";

function fmt(p: AfoVec3 | null | undefined): string {
    if (!p) return "—";
    return `${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)} mm`;
}

export function AfoScanPanel() {
    const orientRevision = useScanStore(selectScanGateRevision);
    const afoRevision = useDesignStore(selectAfoLandmarkRevision);
    const footKnown = useClinicalWorkflowStore((s) => s.footSideExplicitlyChosen);
    const workflow = useDesignStore((s) => s.design.afo?.scanWorkflow) ?? defaultAfoScanWorkflow();
    const autoFrame = useAfoStore((s) => s.scanAutoFrame);
    const setAutoFrame = useAfoStore((s) => s.setScanAutoFrame);
    const landmarkError = useAfoStore((s) => s.scanLandmarkError);
    const scanTick = useScanStore((s) =>
        s.scans.map((scan) => `${scan.id}:${scan.display.displayScale}`).join("|"),
    );
    const [alignError, setAlignError] = useState<string | null>(null);
    const plantarReady = Boolean(workflow.plantar.heel && workflow.plantar.m1p && workflow.plantar.m5p);
    const hasMalleoli = Boolean(workflow.landmarks.medial_malleolus && workflow.landmarks.lateral_malleolus);

    const forefoot = useMemo(() => previewForefoot(workflow, scanTick), [workflow, scanTick]);

    useEffect(() => {
        if (scanForAfoWorkflow() && !afoPlacementComplete(workflow)) ensureAfoScanPlacement();
    }, [scanTick, workflow]);

    useEffect(() => {
        if (!import.meta.env.DEV) return;
        const api = {
            placeMm(point: AfoVec3, scanId?: string, displayScale?: number) {
                const scan = scanForAfoWorkflow();
                const id = scanId ?? scan?.id;
                if (!id) return "Import a foot+leg scan first.";
                const message = commitAfoScanPoint(point, id, displayScale ?? scan?.displayScale ?? 1);
                useAfoStore.getState().setScanLandmarkError(message);
                return message;
            },
            apply(level = false) {
                try {
                    applyAfoAlignment(level);
                    setAlignError(null);
                    return null;
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Alignment failed";
                    setAlignError(message);
                    return message;
                }
            },
            undo(id: string) {
                undoAfoMarker(id);
            },
            workflow() {
                return getAfoState().scanWorkflow;
            },
        };
        (window as unknown as { __orthocadAfo?: typeof api }).__orthocadAfo = api;
        return () => {
            delete (window as unknown as { __orthocadAfo?: typeof api }).__orthocadAfo;
        };
    }, []);

    const onApply = (level: boolean) => {
        try {
            applyAfoAlignment(level);
            setAlignError(null);
            useAfoStore.getState().setScanPlacement({ redo: null, paused: false });
            useAfoStore.getState().setScanAutoFrameSuppressed(false);
        } catch (error) {
            setAlignError(error instanceof Error ? error.message : "Alignment failed");
        }
    };

    return (
        <div
            className="space-y-3 text-xs"
            data-orient-revision={orientRevision}
            data-afo-landmarks={afoRevision}
            data-foot-known={footKnown ? "yes" : "no"}
        >
            <p className="font-medium text-foreground" data-testid="afo-stage">
                {workflow.alignmentApplied
                    ? `Landmarks · ${afoRequiredLandmarkSummary(workflow)}`
                    : "Alignment · 3 plantar points"}
            </p>
            <p className="text-muted-foreground leading-relaxed">
                Place plantar alignment, apply the rigid fit, then walk through anatomical landmarks in the
                viewport card.
            </p>
            <button
                type="button"
                className="h-8 w-full rounded-md border border-border bg-background text-[12px]"
                onClick={() => ingestOrientedScan(buildSyntheticLegMesh())}
            >
                Load synthetic demo leg
            </button>
            <ScanImport />

            <div className="space-y-1" data-testid="afo-plantar-checklist">
                {AFO_PLANTAR_STEPS.map((step) => {
                    const point = workflow.plantar[step.id];
                    const state = point ? "done" : "waiting";
                    return (
                        <button
                            key={step.id}
                            type="button"
                            className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted/40"
                            onClick={() => {
                                if (point) redoAfoMarker(step.id);
                                else ensureAfoScanPlacement();
                            }}
                        >
                            <AfoChecklistCheck state={state} />
                            <span className={state === "done" ? "text-foreground" : "text-muted-foreground"}>
                                {step.label}
                            </span>
                        </button>
                    );
                })}
            </div>

            <button
                type="button"
                data-testid="afo-apply-alignment"
                onClick={() => onApply(false)}
                disabled={!plantarReady}
                className="h-8 w-full rounded-md bg-primary text-[12px] font-medium text-primary-foreground disabled:opacity-40"
            >
                Apply alignment
            </button>

            {forefoot.angle != null ? (
                <p className="text-[11px] text-foreground" data-testid="afo-forefoot-angle">
                    Forefoot-to-rearfoot angle {forefoot.angle.toFixed(1)}°.
                    {workflow.levelToRearfoot ? " Leveled to the rearfoot." : ""}
                </p>
            ) : null}
            {forefoot.angle != null && forefoot.angle > AFO_FOREFOOT_WARN_DEG ? (
                <div className="space-y-1">
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-[11px] text-amber-100/90">
                        Forefoot-to-rearfoot angle is over {AFO_FOREFOOT_WARN_DEG}°. Level to rearfoot uses
                        the heel and the malleolar line.
                    </p>
                    <button
                        type="button"
                        data-testid="afo-level-rearfoot"
                        disabled={!hasMalleoli}
                        title={
                            hasMalleoli
                                ? "Re-aim the long axis along the heel and malleolar midpoint"
                                : "Place both malleoli in Step 2 first"
                        }
                        onClick={() => onApply(true)}
                        className="h-8 w-full rounded-md border border-amber-500/50 text-[12px] text-amber-100 disabled:opacity-40"
                    >
                        Level to rearfoot
                    </button>
                </div>
            ) : null}

            {workflow.alignmentApplied ? (
                <div className="space-y-1" data-testid="afo-landmark-list">
                    {AFO_LANDMARK_STEPS.map((step) => {
                        const point = workflow.landmarks[step.id];
                        const rowState = afoChecklistRowState(workflow, step.id, point, step.optional);
                        return (
                            <button
                                key={step.id}
                                type="button"
                                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted/40"
                                onClick={() => {
                                    if (rowState === "skipped") {
                                        redoAfoMarker(step.id);
                                    } else if (point) {
                                        redoAfoMarker(step.id);
                                    } else if (step.optional) {
                                        const message = skipAfoLandmark(step.id);
                                        useAfoStore.getState().setScanLandmarkError(message);
                                    } else {
                                        redoAfoMarker(step.id);
                                    }
                                    ensureAfoScanPlacement();
                                }}
                            >
                                <AfoChecklistCheck state={rowState} />
                                <span
                                    className={
                                        rowState === "done"
                                            ? "text-foreground"
                                            : rowState === "skipped"
                                              ? "text-violet-300"
                                              : "text-muted-foreground"
                                    }
                                >
                                    {step.label}
                                    {rowState === "skipped" ? " · Skipped · Add" : ""}
                                </span>
                                {step.optional && rowState === "waiting" ? (
                                    <span
                                        className="ml-auto text-[10px] underline"
                                        data-testid={`afo-skip-${step.id}`}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            const message = skipAfoLandmark(step.id);
                                            useAfoStore.getState().setScanLandmarkError(message);
                                        }}
                                    >
                                        Skip
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}

            <button
                type="button"
                data-testid="afo-place"
                onClick={() => jumpToFirstMissingRequired()}
                className="h-8 w-full rounded-md bg-muted text-[12px] font-medium text-foreground"
            >
                Done
            </button>

            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input
                    type="checkbox"
                    checked={autoFrame}
                    onChange={(event) => setAutoFrame(event.target.checked)}
                />
                Auto-frame camera per marker
            </label>

            <DerivedReadout workflow={workflow} />

            {alignError ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-2 text-[11px] text-destructive">
                    {alignError}
                </p>
            ) : null}
            {landmarkError ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-2 text-[11px] text-destructive">
                    {landmarkError}
                </p>
            ) : null}
        </div>
    );
}

function DerivedReadout({ workflow }: { workflow: AfoScanWorkflow }) {
    const derived = workflow.derived;
    if (!workflow.alignmentApplied || !derived) return null;
    const relief = AFO_PLANNED_RELIEFS_MM;
    const requiredDone = AFO_LANDMARK_STEPS.filter(
        (step) => !step.optional && workflow.landmarks[step.id],
    ).length;
    const fibularSkipped = (workflow.skippedLandmarks ?? []).includes("fibular_head");
    const showTrimUnchecked =
        !workflow.landmarks.fibular_head && (fibularSkipped || requiredDone === AFO_REQUIRED_LANDMARK_COUNT);
    return (
        <div
            className="space-y-1 rounded-md border border-border bg-background px-2 py-2 text-[11px] leading-snug"
            data-testid="afo-derived"
        >
            <p className="font-medium text-foreground">Derived frame</p>
            <p>Ankle axis (malleolar apices): {derived.ankleAxis ? "stored" : "waiting for both malleoli"}</p>
            {derived.ankleAxis ? (
                <p className="text-muted-foreground">
                    Medial {fmt(derived.ankleAxis.medial)} · lateral {fmt(derived.ankleAxis.lateral)}
                </p>
            ) : null}
            <p>
                Planned reliefs: malleoli {relief.malleoli} mm
                {derived.plannedReliefsMm.navicular != null
                    ? `, navicular ${derived.plannedReliefsMm.navicular} mm`
                    : ""}
                {derived.plannedReliefsMm.styloid != null
                    ? `, styloid ${derived.plannedReliefsMm.styloid} mm`
                    : ""}
            </p>
            {showTrimUnchecked ? (
                <p data-testid="afo-trim-unchecked">Proximal trim cap is unchecked.</p>
            ) : (
                <p>
                    Proximal trim cap: fibular head − {AFO_PROXIMAL_TRIM_OFFSET_MM} mm
                    {derived.proximalTrimCap ? ` (${fmt(derived.proximalTrimCap.point)})` : ""}
                </p>
            )}
            <p>Heel cup center: {fmt(derived.heelCupCenter)}</p>
            <p>
                MPJ break:{" "}
                {derived.mpjBreak ? `${fmt(derived.mpjBreak.m1)} → ${fmt(derived.mpjBreak.m5)}` : "—"}
            </p>
            <p>
                Shank tilt:{" "}
                {derived.shankTiltDeg
                    ? `sagittal ${derived.shankTiltDeg.sagittal.toFixed(1)}°, frontal ${derived.shankTiltDeg.frontal.toFixed(1)}°`
                    : "—"}
            </p>
            {derived.warnings
                .filter((warning) => warning.id !== "forefoot-rearfoot")
                .map((warning) => (
                    <p
                        key={warning.id}
                        className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-amber-100/90"
                    >
                        {warning.message}
                    </p>
                ))}
        </div>
    );
}

function previewForefoot(workflow: AfoScanWorkflow, scanKey: string): { angle: number | null } {
    if (!scanKey && !workflow.plantar.heel) return { angle: null };
    const heel = workflow.plantar.heel;
    const m1p = workflow.plantar.m1p;
    const m5p = workflow.plantar.m5p;
    if (!heel || !m1p || !m5p) return { angle: workflow.derived?.forefootToRearfootDeg ?? null };
    if (workflow.derived?.forefootToRearfootDeg != null) {
        return { angle: workflow.derived.forefootToRearfootDeg };
    }
    const scan = scanForAfoWorkflow();
    if (!scan) return { angle: null };
    try {
        const scale = scan.displayScale > 0 ? scan.displayScale : 1;
        const centroid = meshCentroid(geometryToAfoMesh(scan.geometry));
        const up = {
            x: centroid.x * scale - heel.x,
            y: centroid.y * scale - heel.y,
            z: centroid.z * scale - heel.z,
        };
        const frame = buildPlantarFrame(heel, m1p, m5p, afoFrameSide(scan.side), up);
        return { angle: forefootToRearfootDeg(m1p, m5p, frame) };
    } catch (error) {
        if (error instanceof PlantarFrameError) return { angle: null };
        return { angle: null };
    }
}
