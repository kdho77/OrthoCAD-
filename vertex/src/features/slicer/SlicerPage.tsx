// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { canDownloadSlicerGcode, formatSlicerPriceLabel } from "@/features/slicer/slicer-pay";
import { useAuthStore } from "@/stores/auth-store";
import type { VertexSliceMaterialId } from "../../../shared/vertexslice/contract";
import { slicerDownloadFilename } from "../../../shared/vertexslice/filename";
import { type GcodeStats, sumGcodeStats } from "../../../shared/vertexslice/gcode-stats";
import { SlicerPreview } from "./SlicerPreview";
import {
    downloadGcode,
    fetchSlicerQuote,
    requestPaidGcode,
    requestSlice,
    requestSlicerCheckout,
} from "./slicer-api";
import { SlicerFormColumn } from "./slicer-form-column";
import {
    INCH_SCALE,
    meshOpenBoundaryIssue,
    parseSlicerMesh,
    scaledMesh,
    validateSlicerFileMeta,
} from "./slicer-mesh";
import { ResultPanel } from "./slicer-result-panel";
import { SLICER_SLOW_MS, SLICER_STEPS, SliceButtonBar } from "./slicer-slice-bar";
import {
    type DemoSlicerState,
    demoSlicerState,
    initialSlicerState,
    type SlicerFileSlot,
    slicerReducer,
} from "./slicer-state";

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
    const [quote, setQuote] = useState<{ unitAmountCents: number; payMock: boolean } | null>(null);
    const user = useAuthStore((s) => s.user);

    useEffect(() => {
        let cancelled = false;
        void fetchSlicerQuote().then((next) => {
            if (!cancelled && next) {
                setQuote({ unitAmountCents: next.unitAmountCents, payMock: next.payMock });
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

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
                validated.push({
                    ...slot,
                    mesh,
                    progress: 100,
                    issue: meshOpenBoundaryIssue(mesh.topology),
                });
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
            const downloads: { sealed: string; filename: string }[] = [];
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
                    sealed: response.sealed,
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

    const downloadDemoFixture = () => {
        if (!state.result) return;
        for (const file of state.result.downloads) {
            if (file.gcode) downloadGcode(file.gcode, file.filename);
        }
    };

    const downloadVerified = async (sessionId: string) => {
        if (!state.result) return;
        for (const file of state.result.downloads) {
            if (!file.sealed) continue;
            const opened = await requestPaidGcode(file.sealed, sessionId);
            if (!opened.ok) {
                dispatch({ type: "pay-failed", error: opened.error });
                return;
            }
            downloadGcode(opened.gcode, opened.filename || file.filename);
        }
        dispatch({ type: "paid", paymentId: sessionId });
    };

    const downloadPaidGcode = () => {
        if (!state.result || !canDownloadSlicerGcode(state.paymentStatus)) return;
        const demoFixture = state.result.downloads.every((file) => file.gcode && !file.sealed);
        if (demoFixture) {
            downloadDemoFixture();
            return;
        }
        if (!state.paymentId) return;
        void downloadVerified(state.paymentId);
    };

    const waitForCheckout = (popup: Window) =>
        new Promise<string | null>((resolve) => {
            let received = false;
            const finish = (sessionId: string | null) => {
                if (received) return;
                received = true;
                window.removeEventListener("message", onMessage);
                window.clearInterval(timer);
                resolve(sessionId);
            };
            const onMessage = (event: MessageEvent) => {
                if (event.origin !== window.location.origin) return;
                const data = event.data as { type?: string; sessionId?: string } | null;
                if (!data || data.type !== "orthocad-slicer-checkout" || !data.sessionId) return;
                finish(data.sessionId);
            };
            const timer = window.setInterval(() => {
                if (!popup.closed) return;
                window.clearInterval(timer);
                window.setTimeout(() => finish(null), 1000);
            }, 400);
            window.addEventListener("message", onMessage);
        });

    const onPayAndDownload = async () => {
        if (!state.result) return;
        const demoFixture = state.result.downloads.every((file) => file.gcode && !file.sealed);
        if (demoFixture && canDownloadSlicerGcode(state.paymentStatus)) {
            downloadDemoFixture();
            return;
        }
        if (canDownloadSlicerGcode(state.paymentStatus) && state.paymentId) {
            await downloadVerified(state.paymentId);
            return;
        }
        const seals = state.result.downloads
            .map((file) => file.sealed)
            .filter((seal): seal is string => Boolean(seal));
        if (seals.length !== state.result.downloads.length) {
            dispatch({ type: "pay-failed", error: "Slice again before paying." });
            return;
        }
        if (!user?.email) {
            window.dispatchEvent(new Event("orthocad-slicer-sign-in"));
            dispatch({ type: "pay-failed", error: "Sign in to pay." });
            return;
        }
        payAbortRef.current?.abort();
        const ac = new AbortController();
        payAbortRef.current = ac;
        dispatch({ type: "start-pay" });
        try {
            const pay = await requestSlicerCheckout(seals);
            if (ac.signal.aborted) return;
            if (!pay.ok) {
                dispatch({ type: "pay-failed", error: pay.error });
                return;
            }
            if (pay.mock) {
                await downloadVerified(pay.sessionId);
                return;
            }
            if (!pay.url) {
                dispatch({ type: "pay-failed", error: "Stripe Checkout did not return a URL." });
                return;
            }
            const popup = window.open(pay.url, "orthocad-slicer-checkout", "popup,width=480,height=720");
            if (!popup) {
                dispatch({
                    type: "pay-failed",
                    error: "Allow popups to pay. This file stays in this tab.",
                });
                return;
            }
            const sessionId = await waitForCheckout(popup);
            if (ac.signal.aborted) return;
            if (!sessionId) {
                dispatch({ type: "pay-failed", error: "Payment cancelled." });
                return;
            }
            await downloadVerified(sessionId);
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div aria-live="polite" className="sr-only">
                {liveMessage}
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
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
                >
                    <ResultPanel
                        stateStatus={state.status}
                        error={state.error}
                        result={state.result}
                        paymentStatus={state.paymentStatus}
                        paymentError={state.paymentError}
                        priceLabel={
                            quote
                                ? formatSlicerPriceLabel(
                                      quote.unitAmountCents,
                                      state.result?.downloads.length ?? 1,
                                  )
                                : null
                        }
                        payMock={quote?.payMock ?? false}
                        copied={copied}
                        onCopy={copyId}
                        onRetry={onSliceClick}
                        onSliceAnother={() => dispatch({ type: "slice-another" })}
                        onPay={onPayAndDownload}
                        onDownload={downloadPaidGcode}
                    />
                </SlicerFormColumn>
                <div className="relative h-[50vh] min-h-[320px] min-w-0 w-full md:h-full md:min-h-0 md:flex-1">
                    <SlicerPreview
                        mesh={primaryMesh}
                        printDirection={state.printDirection}
                        resetNonce={resetNonce}
                        onResetView={() => setResetNonce((n) => n + 1)}
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
