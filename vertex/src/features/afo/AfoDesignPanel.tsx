// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { redoAfoMarker } from "@/features/afo/afo-scan-markers";
import {
    type BalanceBracePopup,
    balanceBracePresetTable,
    buildBalanceBracePreset,
    presetPinVertex,
} from "@/lib/geometry/afo/balance-brace-preset";
import { AFO_DESIGN_MARKERS } from "@/lib/geometry/afo/defaults";
import { nearestVertex } from "@/lib/geometry/afo/mesh-ops";
import { flatPlateSpecFromAfo } from "@/lib/geometry/afo/shell-flatten";
import { applyAfoTrimCleanup } from "@/lib/geometry/afo/trim-cleanup";
import { loopNearZ, validateTrimLoop } from "@/lib/geometry/afo/trim-loop";
import { AFO_TRIM_NO_MESH } from "@/lib/geometry/afo/trim-preview";
import { fitSurfaceSpline, flatPlateTrimLoop } from "@/lib/geometry/afo/trim-spline";
import { getAfoState, patchAfoState, useAfoStore } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

export function AfoDesignPanel() {
    const afo = useDesignStore((s) => s.design.afo) ?? getAfoState();
    const placingIndex = useAfoStore((s) => s.placingLandmarkIndex);
    const setPlacing = useAfoStore((s) => s.setPlacingLandmarkIndex);
    const setPlacingTrim = useAfoStore((s) => s.setPlacingTrim);
    const placingTrim = useAfoStore((s) => s.placingTrim);
    const lastError = useAfoStore((s) => s.lastError);
    const [presetPopup, setPresetPopup] = useState<BalanceBracePopup | null>(null);
    const [presetFlags, setPresetFlags] = useState<string[]>([]);
    const correctedMesh = useAfoStore((s) => s.correctedMesh);
    const castMesh = useAfoStore((s) => s.castMesh);
    const working = correctedMesh ?? castMesh;

    useEffect(() => {
        const store = useAfoStore.getState();
        if (store.placingTrim) return;
        if (
            afo.landmarks.length < AFO_DESIGN_MARKERS.length &&
            store.placingLandmarkIndex < AFO_DESIGN_MARKERS.length
        ) {
            store.setPlacingDesignLandmarks(true);
        }
        return () => {
            useAfoStore.getState().setPlacingDesignLandmarks(false);
        };
    }, [afo.landmarks.length]);

    const nextMarker = AFO_DESIGN_MARKERS[Math.min(Math.max(placingIndex, 0), AFO_DESIGN_MARKERS.length - 1)];
    const landmarksDone = afo.landmarks.length >= AFO_DESIGN_MARKERS.length;
    const trimHits = afo.trimPoints.map((p) => p.point);
    const validation = working
        ? validateTrimLoop(
              working,
              afo.trimPoints.map((p) => p.vertexIndex),
              afo.trimClosed,
              {
                  skipGeodesic: true,
                  points: trimHits,
              },
          )
        : { ok: false, reasons: ["No working mesh."] };

    const confirmTrim = () => {
        if (!working) return;
        const full = validateTrimLoop(
            working,
            afo.trimPoints.map((p) => p.vertexIndex),
            afo.trimClosed,
            {
                skipGeodesic: true,
                points: trimHits,
            },
        );
        const fit =
            afo.trimClosed && trimHits.length >= 3
                ? fitSurfaceSpline(working, trimHits, { closed: true })
                : null;
        if (fit && !fit.ok) {
            useAfoStore.getState().setLastError(fit.reasons.join(" "));
            return;
        }
        if (!full.ok) {
            useAfoStore.getState().setLastError(full.reasons.join(" "));
            return;
        }
        useAfoStore.getState().setLastError(null);
        patchAfoState({ trimConfirmed: true, trimCurve: fit?.curve ?? afo.trimCurve }, "afo-trim-confirm");
    };

    const closeLoop = () => {
        if (!working || trimHits.length < 3) return;
        const fit = fitSurfaceSpline(working, trimHits, { closed: true });
        useAfoStore.getState().setLastError(fit.ok ? null : fit.reasons.join(" "));
        patchAfoState({ trimClosed: true, trimCurve: fit.curve, trimConfirmed: false }, "afo-trim-close");
    };

    const fitSpline = () => {
        if (!working || afo.landmarks.length < 3) return;
        const pins = afo.landmarks.map((l) => l.point);
        const fit = fitSurfaceSpline(working, pins);
        if (!fit.ok) {
            useAfoStore.getState().setLastError(fit.reasons.join(" "));
            return;
        }
        useAfoStore.getState().setLastError(null);
        patchAfoState(
            {
                trimCurve: fit.curve,
                trimPoints: pins.map((point) => ({
                    point,
                    vertexIndex: nearestVertex(working, point).index,
                })),
                trimClosed: true,
                trimConfirmed: false,
            },
            "afo-trim-spline",
        );
    };

    const placeFlatPlateTrim = () => {
        if (!working) return;
        const spec = flatPlateSpecFromAfo(afo, afo.print.thicknessMm);
        if (!spec) {
            useAfoStore
                .getState()
                .setLastError("Place the plantar heel, 1st met head, and 5th met head first.");
            return;
        }
        const loop = flatPlateTrimLoop(working, spec);
        if (loop.pins.length < 3) {
            useAfoStore.getState().setLastError("Could not derive a flat-plate trim from this cast.");
            return;
        }
        useAfoStore.getState().setLastError(null);
        patchAfoState(
            {
                trimCurve: loop.curve,
                trimPoints: loop.pins.map((point) => ({
                    point,
                    vertexIndex: nearestVertex(working, point).index,
                })),
                trimClosed: true,
                trimConfirmed: false,
            },
            "afo-flat-plate-trim",
        );
    };

    const placeBalanceBrace = (continueWithFallbacks = false) => {
        if (!working) return;
        const preset = buildBalanceBracePreset(working, afo, { continueWithFallbacks });
        setPresetFlags(preset.flags.map((flag) => flag.message));
        if (!preset.placed) {
            setPresetPopup(
                preset.popup ?? {
                    title: "Place the balance-brace markers",
                    message: "The trimline needs the anatomical markers before it can be drawn.",
                    issues: [],
                    canContinue: false,
                },
            );
            useAfoStore.getState().setLastError(null);
            return;
        }
        setPresetPopup(preset.popup);
        useAfoStore.getState().setLastError(null);
        const validation = validateTrimLoop(
            working,
            preset.pins.map(() => 0),
            true,
            { skipGeodesic: true, points: preset.pins },
        );
        patchAfoState(
            {
                trimCurve: preset.curve,
                trimPoints: preset.pins.map((point) => ({
                    point,
                    vertexIndex: presetPinVertex(working, point),
                })),
                trimClosed: true,
                trimConfirmed: validation.ok,
            },
            "afo-balance-brace-preset",
        );
    };

    const placePresetMarker = (id: string) => {
        setPresetPopup(null);
        useClinicalWorkflowStore.getState().setStep("scan");
        redoAfoMarker(id);
    };

    const snapBraceLoop = () => {
        if (!working) return;
        const z = afo.corrections.braceHeightMm;
        const ids = loopNearZ(working, Math.min(z, 120), 16);
        if (ids.length < 3) {
            useAfoStore.getState().setLastError("Could not find a brace-height loop on this mesh.");
            return;
        }
        patchAfoState(
            {
                trimPoints: ids.map((vertexIndex) => ({
                    vertexIndex,
                    point: {
                        x: working.positions[vertexIndex * 3] ?? 0,
                        y: working.positions[vertexIndex * 3 + 1] ?? 0,
                        z: working.positions[vertexIndex * 3 + 2] ?? 0,
                    },
                })),
                trimClosed: true,
                trimConfirmed: false,
            },
            "afo-trim-brace",
        );
    };

    return (
        <div className="space-y-3 text-xs">
            <section className="space-y-1 rounded-md border border-border bg-background/40 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    5 landmarks
                </div>
                <ol className="space-y-1">
                    {AFO_DESIGN_MARKERS.map((m, i) => {
                        const placed = afo.landmarks.some((l) => l.id === m.id);
                        return (
                            <li key={m.id} className="flex items-center justify-between">
                                <span>
                                    {i + 1}. {m.label}
                                </span>
                                <span className={placed ? "text-emerald-300" : "text-muted-foreground"}>
                                    {placed ? "placed" : i === placingIndex ? "next" : ""}
                                </span>
                            </li>
                        );
                    })}
                </ol>
                {placingTrim ? (
                    <p className="text-muted-foreground">
                        Marker placement is off while the trimline is active.
                    </p>
                ) : !landmarksDone && nextMarker ? (
                    <p className="text-muted-foreground">
                        Click the mesh to place{" "}
                        <strong className="text-foreground">{nextMarker.label}</strong>. View auto-rotates.
                    </p>
                ) : (
                    <button
                        type="button"
                        className="h-7 w-full rounded border border-border text-[11px]"
                        onClick={() => {
                            setPlacing(0);
                            useAfoStore.getState().setPlacingDesignLandmarks(true);
                        }}
                    >
                        Re-place landmarks
                    </button>
                )}
            </section>

            <section className="space-y-2 rounded-md border border-border bg-background/40 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Smooth trimline
                </div>
                <p className="text-muted-foreground">
                    Click to place. Close by clicking the first point. Drag handles to edit.
                </p>
                {!working ? (
                    <p className="text-[11px] font-medium text-amber-200">{AFO_TRIM_NO_MESH}</p>
                ) : null}
                <button
                    type="button"
                    className="h-8 w-full rounded-md border border-border bg-background"
                    onClick={() => {
                        if (!placingTrim && !working) useAfoStore.getState().setLastError(AFO_TRIM_NO_MESH);
                        setPlacingTrim(!placingTrim);
                    }}
                >
                    {placingTrim ? "Placing trim…" : "Start trim line"}
                </button>
                <p className="text-[10px] text-muted-foreground">
                    {afo.trimPoints.length} handles · {afo.trimClosed ? "closed" : "open"}
                </p>
                {!validation.ok
                    ? validation.reasons.map((r) => (
                          <p key={r} className="text-[10px] text-amber-200">
                              {r}
                          </p>
                      ))
                    : null}
                <button
                    type="button"
                    disabled={!working || afo.landmarks.length < 3}
                    className="h-8 w-full rounded-md border border-border bg-background disabled:opacity-40"
                    onClick={fitSpline}
                >
                    Fit smooth trim
                </button>
                <button
                    type="button"
                    disabled={!working}
                    className="h-8 w-full rounded-md border border-border bg-background"
                    onClick={placeFlatPlateTrim}
                >
                    Flat plate trim
                </button>
                <button
                    type="button"
                    data-testid="balance-brace-preset"
                    disabled={!working}
                    className="h-8 w-full rounded-md border border-border bg-background"
                    onClick={() => placeBalanceBrace(false)}
                >
                    Balance brace preset trimline
                </button>
                <details className="rounded border border-border px-2 py-1">
                    <summary className="cursor-pointer text-[10px] text-muted-foreground">
                        Balance brace preset numbers
                    </summary>
                    <table data-testid="balance-brace-preset-table" className="mt-1 w-full text-[10px]">
                        <tbody>
                            {balanceBracePresetTable().map((row) => (
                                <tr key={row.id}>
                                    <td className="py-0.5 pr-2 text-muted-foreground">{row.label}</td>
                                    <td className="py-0.5 text-right">{row.value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </details>
                {presetFlags.map((flag) => (
                    <p key={flag} className="text-[10px] text-amber-200">
                        {flag}
                    </p>
                ))}
                <button
                    type="button"
                    disabled={!working}
                    className="h-8 w-full rounded-md border border-border bg-background"
                    onClick={snapBraceLoop}
                >
                    Loop at brace height
                </button>
                <button
                    type="button"
                    disabled={afo.trimPoints.length < 3 || afo.trimClosed}
                    className="h-8 w-full rounded-md border border-border bg-background"
                    onClick={closeLoop}
                >
                    Close loop
                </button>
                <button
                    type="button"
                    disabled={!working || afo.trimPoints.length < 2}
                    className="h-8 w-full rounded-md border border-border bg-background disabled:opacity-40"
                    onClick={() => {
                        applyAfoTrimCleanup();
                    }}
                >
                    Clean up
                </button>
                <button
                    type="button"
                    disabled={!validation.ok}
                    className="h-8 w-full rounded-md bg-primary text-[12px] font-medium text-primary-foreground disabled:opacity-40"
                    onClick={confirmTrim}
                >
                    Confirm
                </button>
                {lastError ? <p className="text-[10px] text-amber-200">{lastError}</p> : null}
            </section>

            <div className="space-y-1">
                <button
                    type="button"
                    disabled
                    className="h-7 w-full rounded border border-border text-[11px] opacity-40"
                >
                    Cut out
                </button>
                <button
                    type="button"
                    disabled
                    className="h-7 w-full rounded border border-border text-[11px] opacity-40"
                >
                    Hole pattern
                </button>
                <button
                    type="button"
                    disabled
                    className="h-7 w-full rounded border border-border text-[11px] opacity-40"
                >
                    Strengthen
                </button>
            </div>
            <Dialog open={presetPopup != null} onOpenChange={(open) => !open && setPresetPopup(null)}>
                <DialogContent data-testid="balance-brace-popup" className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{presetPopup?.title ?? "Balance brace markers"}</DialogTitle>
                    </DialogHeader>
                    <p className="text-xs text-muted-foreground">{presetPopup?.message}</p>
                    <div className="mt-3 space-y-1">
                        {presetPopup?.issues.map((issue) => (
                            <button
                                key={issue.id}
                                type="button"
                                className="h-8 w-full rounded-md border border-border text-left text-[11px]"
                                onClick={() => placePresetMarker(issue.id)}
                            >
                                Place {issue.label}
                            </button>
                        ))}
                    </div>
                    {presetPopup?.canContinue &&
                    presetPopup.issues.some((issue) => issue.kind === "missing") ? (
                        <button
                            type="button"
                            className="mt-3 h-8 w-full rounded-md bg-primary text-[12px] font-medium text-primary-foreground"
                            onClick={() => {
                                setPresetPopup(null);
                                placeBalanceBrace(true);
                            }}
                        >
                            Continue with the fallback
                        </button>
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}
