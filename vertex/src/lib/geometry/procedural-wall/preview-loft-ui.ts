// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ClinicalStepId } from "@/stores/clinical-workflow-store";
import type { Side } from "@/types";
import { sha256Hex } from "./sha256";

/** Walls/solid are Print + export only — Base/Design stay top + pattern. */
export function shouldLoftProceduralViewer(step: ClinicalStepId, wallModel: string): boolean {
    return wallModel === "procedural" && step === "print";
}

export function wantsProceduralExportSolid(
    base: { assetId?: string; glbPath?: string } | null | undefined,
    wallModel?: string,
): boolean {
    if (!base) return false;
    const path = (base.glbPath ?? "").replace(/^\/+/, "");
    if (base.assetId === "sample-top" || /SAMPLE_Top\.glb$/i.test(path)) return true;
    if (base.assetId === "stock-default" || /(?:^|\/)Default\.glb$/i.test(path)) return false;
    return (wallModel ?? "procedural") === "procedural";
}

export type PreviewLoftPhase = "idle" | "fetching" | "queued" | "lofting" | "ready" | "error";

export function resolveLoftActiveSide(showLeft: boolean, showRight: boolean, exportSide: Side): Side {
    if (showLeft && !showRight) return "left";
    if (showRight && !showLeft) return "right";
    return exportSide;
}

export function proceduralLoftReuseKey(input: {
    side: Side;
    wallStyle: string;
    deviceType: string;
    thicknessMm: number;
    correctionsJson: string;
    scanPattern: string;
    patternKind: "auto" | "edited" | "live";
    patternHash: string;
    flanges: string;
    /** Full viewer field (elements, shapeFinish, include flags). */
    sourceFieldJson?: string;
    shapeFinishJson?: string;
    elementsJson?: string;
    trimlineHash?: string;
    shoeWidth?: string;
}): string {
    return sha256Hex(
        [
            input.side,
            input.wallStyle,
            input.deviceType,
            input.thicknessMm.toFixed(3),
            input.correctionsJson,
            input.scanPattern,
            input.patternKind,
            input.patternHash,
            input.flanges,
            input.sourceFieldJson ?? "",
            input.shapeFinishJson ?? "",
            input.elementsJson ?? "",
            input.trimlineHash ?? "",
            input.shoeWidth ?? "medium",
        ].join("|"),
    );
}

export function hashPatternPoints(points: ReadonlyArray<{ x: number; y: number; z?: number }>): string {
    if (points.length === 0) return "0";
    let h = points.length * 2654435761;
    const step = Math.max(1, Math.floor(points.length / 48));
    for (let i = 0; i < points.length; i += step) {
        const p = points[i];
        if (!p) continue;
        h = (Math.imul(h, 33) + Math.round(p.x * 100) * 10007 + Math.round(p.y * 100) * 17) >>> 0;
    }
    const last = points[points.length - 1];
    if (last) {
        h = (Math.imul(h, 33) + Math.round(last.x * 100) + Math.round(last.y * 100) * 31) >>> 0;
    }
    return `${points.length}:${h.toString(16)}`;
}

export function autoPatternKey(mirrored: boolean, scanPattern: string): string {
    return `sample-top:${mirrored ? "m" : "p"}:${scanPattern}`;
}

export interface ViewerLoftOverlayState {
    blockViewport: boolean;
    showBanner: boolean;
    kind: "hidden" | "progress" | "error";
}

/**
 * Full-viewport splash while any visible foot is fetching / queued / lofting.
 * Print reconstruct is off the main thread but still takes about a minute per
 * foot — keep the canvas blocked so the page never looks frozen.
 */
export function viewerLoftOverlayState(args: {
    showBase: boolean;
    showLeft: boolean;
    showRight: boolean;
    stockBaseLoading: boolean;
    loadingBySide: Record<Side, boolean>;
    phaseBySide: Record<Side, PreviewLoftPhase>;
    error: string | null;
}): ViewerLoftOverlayState {
    if (!args.showBase) return { blockViewport: false, showBanner: false, kind: "hidden" };
    const visible: Side[] = [];
    if (args.showLeft) visible.push("left");
    if (args.showRight) visible.push("right");
    if (visible.length === 0) return { blockViewport: false, showBanner: false, kind: "hidden" };

    const phases = visible.map((side) => args.phaseBySide[side]);
    const anyError = phases.includes("error") || Boolean(args.error);
    const anyWorking =
        args.stockBaseLoading ||
        visible.some((side) => args.loadingBySide[side]) ||
        phases.some((phase) => phase === "fetching" || phase === "queued" || phase === "lofting");

    if (anyError) {
        return { blockViewport: true, showBanner: true, kind: "error" };
    }
    if (anyWorking) {
        return { blockViewport: true, showBanner: true, kind: "progress" };
    }
    return { blockViewport: false, showBanner: false, kind: "hidden" };
}

export const PRINT_LOFT_TIMEOUT_MS = 10 * 60 * 1000;
export const PRINT_LOFT_HINT = "This can take about a minute per foot.";

export type PrintLoftStepState = "done" | "active" | "pending";

export interface PrintLoftStep {
    id: "left" | "right" | "solid";
    label: string;
    state: PrintLoftStepState;
}

export function printLoftSteps(phaseBySide: Record<Side, PreviewLoftPhase>): PrintLoftStep[] {
    const sideState = (side: Side): PrintLoftStepState => {
        const phase = phaseBySide[side];
        if (phase === "ready") return "done";
        if (phase === "lofting" || phase === "queued" || phase === "fetching") return "active";
        return "pending";
    };
    const left = sideState("left");
    const right = sideState("right");
    let solid: PrintLoftStepState = "pending";
    if (left === "done" && right === "done") solid = "done";
    else if (left === "active" || right === "active") solid = "active";
    return [
        { id: "left", label: "Left walls", state: left },
        { id: "right", label: "Right walls", state: right },
        { id: "solid", label: "Print solid", state: solid },
    ];
}

export function printLoftProgress01(elapsedMs: number, workingFeet: number): number {
    const budget = Math.max(1, workingFeet) * 60_000;
    return Math.max(0.04, Math.min(0.95, elapsedMs / budget));
}

export function previewLoftProgressLabel(
    phaseBySide: Record<Side, PreviewLoftPhase>,
    coarse: boolean,
): string {
    const lofting = (["left", "right"] as const).find((side) => phaseBySide[side] === "lofting");
    if (lofting) {
        const extra = coarse ? " — this can take up to a minute on phones" : "";
        return `Building ${lofting} walls for print…${extra}`;
    }
    const fetching = (["left", "right"] as const).find((side) => phaseBySide[side] === "fetching");
    if (fetching) return "Loading top surface…";
    const queued = (["left", "right"] as const).find((side) => phaseBySide[side] === "queued");
    if (queued) return `Waiting to loft ${queued} foot…`;
    return "Loading base…";
}
