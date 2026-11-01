// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useMemo, useState } from "react";
import {
    AFO_FOREFOOT_WARN_DEG,
    AFO_LANDMARK_STEPS,
    AFO_PLANNED_RELIEFS_MM,
    AFO_PLANTAR_STEPS,
    AFO_PROXIMAL_TRIM_OFFSET_MM,
    afoFrameSide,
    afoStageSnapshot,
    applyAfoAlignment,
    commitAfoScanPoint,
    redoAfoMarker,
    scanForAfoWorkflow,
    undoAfoMarker,
} from "@/features/afo/afo-scan-markers";
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
    const placing = useAfoStore((s) => s.scanPlacement);
    const landmarkError = useAfoStore((s) => s.scanLandmarkError);
    const scanTick = useScanStore((s) =>
        s.scans.map((scan) => `${scan.id}:${scan.display.displayScale}`).join("|"),
    );
    const [alignError, setAlignError] = useState<string | null>(null);
    const stage = afoStageSnapshot(workflow);
    const plantarReady = Boolean(workflow.plantar.heel && workflow.plantar.m1p && workflow.plantar.m5p);
    const hasMalleoli = Boolean(workflow.landmarks.medial_malleolus && workflow.landmarks.lateral_malleolus);

    const forefoot = useMemo(() => previewForefoot(workflow, scanTick), [workflow, scanTick]);

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
        } catch (error) {
            setAlignError(error instanceof Error ? error.message : "Alignment failed");
        }
    };

    const redoLabel = labelForRedo(placing?.redo ?? null);
    const hint = redoLabel
        ? `Redo: ${redoLabel}`
        : stage.nextLabel
          ? `Next: ${stage.nextLabel}`
          : "All landmarks placed";

    return (
        <div
            className="space-y-3 text-xs"
            data-orient-revision={orientRevision}
            data-afo-landmarks={afoRevision}
            data-foot-known={footKnown ? "yes" : "no"}
        >
            <p className="font-medium text-foreground" data-testid="afo-stage">
                {stage.title}
            </p>
            <p className="text-muted-foreground leading-relaxed">
                Step 1 snaps three plantar points and applies a rigid align. Step 2 places eight anatomical
                landmarks, one at a time. Warnings never move the scan.
            </p>
            <p className="text-[11px] text-cyan-200" data-testid="afo-next-marker">
                {hint}
            </p>
            <button
                type="button"
                className="h-8 w-full rounded-md border border-border bg-background text-[12px]"
                onClick={() => ingestOrientedScan(buildSyntheticLegMesh())}
            >
                Load synthetic demo leg
            </button>
            <ScanImport />

            <div className="space-y-1">
                {AFO_PLANTAR_STEPS.map((step) => {
                    const point = workflow.plantar[step.id];
                    if (!point) return null;
                    return (
                        <MarkerRow
                            key={step.id}
                            label={step.label}
                            onUndo={() => undoAfoMarker(step.id)}
                            onRedo={() => redoAfoMarker(step.id)}
                        />
                    );
                })}
            </div>

            <button
                type="button"
                data-testid="afo-place"
                onClick={() => useAfoStore.getState().setScanPlacement(placing ? null : { redo: null })}
                className="h-8 w-full rounded-md bg-muted text-[12px] font-medium text-foreground"
            >
                {placing ? "Done placing" : stage.stage === 1 ? "Place alignment" : "Place landmarks"}
            </button>
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

            {stage.stage === 2 ? (
                <div className="space-y-1" data-testid="afo-landmark-list">
                    {AFO_LANDMARK_STEPS.map((step, index) => {
                        const point = workflow.landmarks[step.id];
                        return (
                            <div key={step.id} className="flex items-center gap-1 text-[11px]">
                                <span className={point ? "text-emerald-300" : "text-muted-foreground"}>
                                    {index + 1}. {step.label}
                                    {point ? "" : " — waiting"}
                                </span>
                                {point ? (
                                    <span className="ml-auto flex gap-1">
                                        <button
                                            type="button"
                                            className="underline"
                                            onClick={() => undoAfoMarker(step.id)}
                                        >
                                            Undo
                                        </button>
                                        <button
                                            type="button"
                                            className="underline"
                                            onClick={() => redoAfoMarker(step.id)}
                                        >
                                            Redo
                                        </button>
                                    </span>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            ) : null}

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

function MarkerRow({ label, onUndo, onRedo }: { label: string; onUndo: () => void; onRedo: () => void }) {
    return (
        <div className="flex items-center gap-1 text-[11px]">
            <span className="text-emerald-300">{label}</span>
            <span className="ml-auto flex gap-1">
                <button type="button" className="underline" onClick={onUndo}>
                    Undo
                </button>
                <button type="button" className="underline" onClick={onRedo}>
                    Redo
                </button>
            </span>
        </div>
    );
}

function DerivedReadout({ workflow }: { workflow: AfoScanWorkflow }) {
    const derived = workflow.derived;
    if (!workflow.alignmentApplied || !derived) return null;
    const relief = AFO_PLANNED_RELIEFS_MM;
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
                Planned reliefs: malleoli {relief.malleoli} mm, navicular {relief.navicular} mm, styloid{" "}
                {relief.styloid} mm
            </p>
            <p>
                Proximal trim cap: fibular head − {AFO_PROXIMAL_TRIM_OFFSET_MM} mm
                {derived.proximalTrimCap ? ` (${fmt(derived.proximalTrimCap.point)})` : ""}
            </p>
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

function labelForRedo(id: string | null): string | null {
    if (!id) return null;
    return (
        AFO_PLANTAR_STEPS.find((step) => step.id === id)?.label ??
        AFO_LANDMARK_STEPS.find((step) => step.id === id)?.label ??
        null
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
