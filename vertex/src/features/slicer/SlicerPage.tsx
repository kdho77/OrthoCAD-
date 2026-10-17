// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { canDownloadSlicerGcode, chargeSlicerExport } from "@/features/slicer/slicer-pay";
import type { VertexSliceMaterialId } from "../../../shared/vertexslice/contract";
import { slicerDownloadFilename } from "../../../shared/vertexslice/filename";
import { sumGcodeStats, type GcodeStats } from "../../../shared/vertexslice/gcode-stats";
import { SlicerFormColumn } from "./slicer-form-column";
import { SlicerPreview } from "./SlicerPreview";
import { ResultPanel } from "./slicer-result-panel";
import { downloadGcode, requestSlice } from "./slicer-api";
import { INCH_SCALE, parseSlicerMesh, scaledMesh, validateSlicerFileMeta } from "./slicer-mesh";
import {
    type DemoSlicerState,
    demoSlicerState,
    initialSlicerState,
    type SlicerFileSlot,
    slicerReducer,
} from "./slicer-state";
import { SLICER_SLOW_MS, SLICER_STEPS, SliceButtonBar } from "./slicer-slice-bar";

const MAX_FILES = 2;

function demoKindFromSearch(): { kind: DemoSlicerState; fault: string | null } | null {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const demo = params.get("demo");
    if (
        demo === "empty" ||
        demo === "uploading" ||
        demo === "validating" ||
        demo === "slicing" ||
        demo === "error" ||
        demo === "done" ||
        demo === "outdated" ||
        demo === "pay" ||
        demo === "paid"
    ) {
        return { kind: demo, fault: params.get("fault") };
    }
    return null;
}

export function SlicerPage() {
    const demo = demoKindFromSearch();
    const [state, dispatch] = useReducer(slicerReducer, undefined, () =>
        demo ? demoSlicerState(demo.kind, demo.fault) : initialSlicerState(),
    );
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropRef = useRef<HTMLDivElement>(null);
    const materialRef = useRef<HTMLElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const payAbortRef = useRef<AbortController | null>(null);
    const [resetNonce, setResetNonce] = useState(0);
    const [copied, setCopied] = useState(false);
    const [dragOver, setDragOver] = useState(false);

    const liveMessage = useMemo(() => {
        switch (state.status) {
            case "uploading":
                return "Uploading file";
            case "validating":
                return "Checking file…";
            case "slicing":
                return state.slicingSlow ? "Taking longer than usual" : `Slicing… ${state.sliceStep}`;
            case "error":
                return state.error?.cause ?? "Slice failed";
            case "done":
                return "Slice complete";
            case "outdated":
                return "Out of date: Slice again";
            default:
                return "Upload a model and choose settings, then Slice.";
        }
    }, [state.status, state.sliceStep, state.slicingSlow, state.error]);

    useEffect(() => {
        if (state.status !== "slicing") return;
        const stepTimer = window.setInterval(() => {
            dispatch({
                type: "slice-step",
                step: SLICER_STEPS[(SLICER_STEPS.indexOf(state.sliceStep) + 1) % SLICER_STEPS.length],
            });
        }, 1500);
        const slowTimer = window.setTimeout(
            () => dispatch({ type: "slicing-slow", slow: true }),
            SLICER_SLOW_MS,
        );
        return () => {
            window.clearInterval(stepTimer);
            window.clearTimeout(slowTimer);
        };
    }, [state.status, state.sliceStep]);

    const ingestFiles = useCallback(async (list: FileList | File[]) => {
        const incoming = Array.from(list).slice(0, MAX_FILES);
        if (incoming.length === 0) return;
        const slots: SlicerFileSlot[] = incoming.map((file, i) => ({
            id: `${file.name}-${file.size}-${Date.now()}-${i}`,
            file,
            mesh: null,
            side: incoming.length === 2 ? (i === 0 ? "left" : "right") : null,
            progress: 0,
            issue: validateSlicerFileMeta(file),
            treatedAsInches: false,
        }));
        dispatch({ type: "uploading", files: slots });
        const validated: SlicerFileSlot[] = [];
        for (const slot of slots) {
            if (slot.issue) {
                validated.push({ ...slot, progress: 100 });
                continue;
            }
            dispatch({ type: "set-status", status: "validating" });
            try {
                const buffer = await slot.file.arrayBuffer();
                dispatch({ type: "progress", id: slot.id, progress: 100 });
                const mesh = await parseSlicerMesh(slot.file, buffer);
                const issue = mesh.closed
                    ? null
                    : {
                          message:
                              "This file isn't a closed mesh. Re-export from OrthoCAD with Export > STL.",
                          fix: "Export a watertight STL and try again.",
                      };
                validated.push({ ...slot, mesh, progress: 100, issue });
            } catch (err) {
                const issue = (err as { issue?: { message: string; fix: string } }).issue ?? {
                    message: "This file isn't a closed mesh. Re-export from OrthoCAD with Export > STL.",
                    fix: "Export a watertight STL and try again.",
                };
                validated.push({ ...slot, progress: 100, issue });
            }
        }
        dispatch({ type: "validated", files: validated });
    }, []);

    const onDrop = (event: React.DragEvent) => {
        event.preventDefault();
        setDragOver(false);
        if (event.dataTransfer.files.length) void ingestFiles(event.dataTransfer.files);
    };

    const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files?.length) void ingestFiles(event.target.files);
        event.target.value = "";
    };

    const primaryMesh = state.files.find((f) => f.mesh)?.mesh ?? null;

    const runSlice = useCallback(async () => {
        const validFiles = state.files.filter((f) => f.file && f.mesh && !f.issue);
        if (validFiles.length === 0 || validFiles.length !== state.files.length) {
            dispatch({ type: "highlight", field: "file" });
            dropRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            dropRef.current?.focus();
            return;
        }
        if (!state.material) {
            dispatch({ type: "highlight", field: "material" });
            materialRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        dispatch({ type: "start-slicing" });
        const fault = new URLSearchParams(window.location.search).get("fault");
        try {
            const downloads: { gcode: string; filename: string }[] = [];
            const statsList: GcodeStats[] = [];
            let requestId = "";
            for (const slot of validFiles) {
                const response = await requestSlice({
                    file: slot.file,
                    material: state.material,
                    printDirection: state.printDirection,
                    wallLoops: state.wallLoops,
                    infillDensity: state.infillDensity,
                    fault,
                    signal: ac.signal,
                });
                if (ac.signal.aborted) return;
                if (!response.ok) {
                    dispatch({ type: "error", error: response.error });
                    return;
                }
                requestId = response.requestId;
                downloads.push({
                    gcode: response.gcode,
                    filename:
                        response.filename ||
                        slicerDownloadFilename({
                            modelName: slot.file.name,
                            material: state.material,
                            printDirection: state.printDirection,
                            wallLoops: state.wallLoops,
                        }),
                });
                statsList.push(response.stats);
            }
            dispatch({
                type: "done",
                result: {
                    downloads,
                    stats: sumGcodeStats(statsList),
                    requestId,
                    material: state.material,
                    printDirection: state.printDirection,
                    wallLoops: state.wallLoops,
                    infillDensity: state.infillDensity,
                },
            });
        } catch (err) {
            if (ac.signal.aborted) return;
            dispatch({
                type: "error",
                error: {
                    code: "auth_config",
                    cause: "Something on our side. Try again; if it repeats, share this ID",
                    nextStep: "Retry. If it happens again, send this request ID to support.",
                    requestId: "",
                },
            });
            void err;
        }
    }, [state.files, state.material, state.printDirection, state.wallLoops, state.infillDensity]);

    const onSliceClick = () => {
        void runSlice();
    };

    const downloadPaidGcode = () => {
        if (!state.result || !canDownloadSlicerGcode(state.paymentStatus)) return;
        for (const file of state.result.downloads) {
            downloadGcode(file.gcode, file.filename);
        }
    };

    const onPayAndDownload = async () => {
        if (!state.result) return;
        if (canDownloadSlicerGcode(state.paymentStatus)) {
            downloadPaidGcode();
            return;
        }
        payAbortRef.current?.abort();
        const ac = new AbortController();
        payAbortRef.current = ac;
        dispatch({ type: "start-pay" });
        try {
            const pay = await chargeSlicerExport({
                fileCount: state.result.downloads.length,
                signal: ac.signal,
            });
            if (ac.signal.aborted) return;
            if (!pay.ok) {
                dispatch({ type: "pay-failed", error: pay.error });
                return;
            }
            dispatch({ type: "paid", paymentId: pay.paymentId });
            for (const file of state.result.downloads) {
                downloadGcode(file.gcode, file.filename);
            }
        } catch {
            if (ac.signal.aborted) return;
            dispatch({ type: "pay-failed", error: "Payment cancelled." });
        }
    };

    const copyId = async (id: string) => {
        try {
            await navigator.clipboard.writeText(id);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <div aria-live="polite" className="sr-only">
                {liveMessage}
            </div>
            <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 p-4 md:flex-row md:items-start">
                <SlicerFormColumn
                    state={state}
                    dragOver={dragOver}
                    dropRef={dropRef}
                    fileInputRef={fileInputRef}
                    materialRef={materialRef}
                    onKeyActivate={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            fileInputRef.current?.click();
                        }
                    }}
                    onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onPick={onPick}
                    onChooseFile={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                    }}
                    onRemoveFile={(id) => dispatch({ type: "remove-file", id })}
                    onSide={(id, side) => dispatch({ type: "set-side", id, side })}
                    onTreatInches={(slot) => {
                        if (!slot.mesh) return;
                        dispatch({
                            type: "treat-inches",
                            id: slot.id,
                            mesh: scaledMesh(slot.mesh, INCH_SCALE),
                        });
                    }}
                    onMaterial={(material) => dispatch({ type: "set-material", material })}
                    onDirection={(printDirection) => dispatch({ type: "set-direction", printDirection })}
                    onWallPreset={(preset) => dispatch({ type: "set-wall-preset", preset })}
                    onToggleAdvanced={() => dispatch({ type: "toggle-advanced" })}
                    onWallLoops={(wallLoops) => dispatch({ type: "set-wall-loops", wallLoops })}
                    onInfill={(infillDensity) => dispatch({ type: "set-infill", infillDensity })}
                    onResetDefaults={() => dispatch({ type: "reset-defaults" })}
                    onSlice={onSliceClick}
                    onCancel={() => abortRef.current?.abort()}
                    onKeepWaiting={() => dispatch({ type: "slicing-slow", slow: false })}
                />

                <div className="flex min-h-[360px] min-w-0 flex-1 flex-col gap-4">
                    <SlicerPreview
                        mesh={primaryMesh}
                        printDirection={state.printDirection}
                        resetNonce={resetNonce}
                        onResetView={() => setResetNonce((n) => n + 1)}
                    />
                    <ResultPanel
                        stateStatus={state.status}
                        error={state.error}
                        result={state.result}
                        paymentStatus={state.paymentStatus}
                        paymentError={state.paymentError}
                        copied={copied}
                        onCopy={copyId}
                        onRetry={onSliceClick}
                        onSliceAnother={() => dispatch({ type: "slice-another" })}
                        onPay={onPayAndDownload}
                        onDownload={downloadPaidGcode}
                    />
                </div>
            </div>
            <div className="sticky bottom-0 z-20 border-t border-border bg-background/95 p-3 backdrop-blur md:hidden">
                <SliceButtonBar
                    status={state.status}
                    sliceStep={state.sliceStep}
                    slicingSlow={state.slicingSlow}
                    onSlice={onSliceClick}
                    onCancel={() => abortRef.current?.abort()}
                    onKeepWaiting={() => dispatch({ type: "slicing-slow", slow: false })}
                />
            </div>
        </div>
    );
}

export type { VertexSliceMaterialId };
