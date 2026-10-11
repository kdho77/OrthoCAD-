// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ClinicalStepId } from "@/stores/clinical-workflow-store";
import type { Side } from "@/types";

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
    patternKind: "auto" | "edited";
    patternHash: string;
    flanges: string;
}): string {
    return [
        input.side,
        input.wallStyle,
        input.deviceType,
        input.thicknessMm.toFixed(3),
        input.correctionsJson,
        input.scanPattern,
        input.patternKind,
        input.patternHash,
        input.flanges,
    ].join("|");
}

export function hashPatternPoints(points: ReadonlyArray<{ x: number; y: number; z?: number }>): string {
    if (points.length === 0) return "0";
    const a = points[0];
    const mid = points[Math.floor(points.length / 2)];
    const c = points[points.length - 1];
    return `${points.length}:${a.x.toFixed(2)},${mid.x.toFixed(2)},${c.x.toFixed(2)}`;
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
 * Full-viewport spinner only while no visible foot has a mesh.
 * Once the active foot is ready the canvas stays usable; the mirror can loft
 * in the background with a non-blocking banner.
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
    const anyReady = phases.includes("ready");
    const anyError = phases.includes("error") || Boolean(args.error);
    const anyWorking =
        args.stockBaseLoading ||
        visible.some((side) => args.loadingBySide[side]) ||
        phases.some((phase) => phase === "fetching" || phase === "queued" || phase === "lofting");

    if (!anyReady && (anyWorking || anyError)) {
        return {
            blockViewport: true,
            showBanner: true,
            kind: anyError && !anyWorking ? "error" : anyError ? "error" : "progress",
        };
    }
    if (anyReady && (anyWorking || anyError)) {
        return { blockViewport: false, showBanner: true, kind: anyError ? "error" : "progress" };
    }
    return { blockViewport: false, showBanner: false, kind: "hidden" };
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
