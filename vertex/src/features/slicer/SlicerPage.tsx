// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Check, ChevronDown, Copy, Loader2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MATERIAL_CARDS, standardWallLabel } from "@/features/slicer/materials";
import { canUseSlicer } from "@/features/slicer/slicer-access";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import {
    DEFAULT_INFILL_DENSITY_PCT,
    defaultWallLoopsForMaterial,
    INFILL_DENSITY_PCT_MAX,
    INFILL_DENSITY_PCT_MIN,
    REINFORCED_WALL_LOOPS,
    VERTEXSLICE_MAX_UPLOAD_BYTES,
    type VertexSliceMaterialId,
    type VertexSlicePrintDirection,
    WALL_LOOPS_MAX,
    WALL_LOOPS_MIN,
} from "../../../shared/vertexslice/contract";
import { slicerDownloadFilename } from "../../../shared/vertexslice/filename";
import { formatPrintTime } from "../../../shared/vertexslice/gcode-stats";
import { SlicerPreview } from "./SlicerPreview";
import { downloadGcode, requestSlice } from "./slicer-api";
import {
    type FootSideTag,
    formatDimensionsMm,
    INCH_SCALE,
    parseSlicerMesh,
    scaledMesh,
    unitsWarning,
    validateSlicerFileMeta,
} from "./slicer-mesh";
import {
    type DemoSlicerState,
    demoSlicerState,
    initialSlicerState,
    type SlicerFileSlot,
    type SliceStep,
    slicerReducer,
} from "./slicer-state";

const SLOW_MS = 20_000;
const STEPS: SliceStep[] = ["Preparing", "Slicing", "Packaging"];
const MAX_FILES = 2;

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

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
        demo === "outdated"
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
    const { user, license } = useAuthStore();
    const access = canUseSlicer(user, license);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropRef = useRef<HTMLDivElement>(null);
    const materialRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
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
                step: STEPS[(STEPS.indexOf(state.sliceStep) + 1) % STEPS.length],
            });
        }, 1500);
        const slowTimer = window.setTimeout(() => dispatch({ type: "slicing-slow", slow: true }), SLOW_MS);
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
    const primaryFile = state.files[0] ?? null;

    const runSlice = useCallback(async () => {
        if (!access.ok) {
            dispatch({
                type: "error",
                error: {
                    code: "unauthorized",
                    cause: access.reason ?? "Not allowed to slice.",
                    nextStep: "Sign in with a licensed account. Super admin is never blocked.",
                    requestId: "",
                },
            });
            return;
        }
        if (!primaryFile?.file || !primaryFile.mesh || primaryFile.issue) {
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
        const fileToSend =
            primaryFile.treatedAsInches && primaryFile.mesh
                ? new File([primaryFile.file], primaryFile.file.name, { type: primaryFile.file.type })
                : primaryFile.file;
        try {
            const response = await requestSlice({
                file: fileToSend,
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
            dispatch({
                type: "done",
                result: {
                    gcode: response.gcode,
                    filename:
                        response.filename ||
                        slicerDownloadFilename({
                            modelName: primaryFile.file.name,
                            material: state.material,
                            printDirection: state.printDirection,
                            wallLoops: state.wallLoops,
                        }),
                    stats: response.stats,
                    requestId: response.requestId,
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
    }, [access, primaryFile, state.material, state.printDirection, state.wallLoops, state.infillDensity]);

    const onSliceClick = () => {
        void runSlice();
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
                <div className="flex w-full flex-col gap-4 md:w-[380px] md:shrink-0 pb-24 md:pb-0">
                    {/* Drop zone is a keyboard button and a file drop target (UI guidance). */}
                    {/* biome-ignore lint/a11y/useSemanticElements: drop target cannot be a native button */}
                    <div
                        ref={dropRef}
                        tabIndex={0}
                        role="button"
                        aria-label="Upload STL or 3MF"
                        onKeyDown={(e) => {
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
                        className={cn(
                            "rounded-lg border border-dashed p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            dragOver ? "border-primary bg-primary/10" : "border-border bg-panel",
                            state.missingHighlight === "file" ? "ring-2 ring-destructive" : "",
                        )}
                    >
                        <div className="flex items-start gap-3">
                            <Upload className="mt-0.5 h-5 w-5 text-primary" />
                            <div className="min-w-0 flex-1">
                                <h2 className="text-sm font-medium">Upload</h2>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Drop an .stl or .3mf here, or choose a file. Max{" "}
                                    {Math.round(VERTEXSLICE_MAX_UPLOAD_BYTES / (1024 * 1024))} MB. One file at
                                    a time, or a left/right pair.
                                </p>
                                {state.missingHighlight === "file" ? (
                                    <p className="mt-2 text-xs text-destructive">
                                        Add an STL or 3MF to slice.
                                    </p>
                                ) : null}
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="mt-3"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        fileInputRef.current?.click();
                                    }}
                                >
                                    Choose file
                                </Button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".stl,.3mf,model/stl,model/3mf"
                                    multiple
                                    className="sr-only"
                                    onChange={onPick}
                                />
                            </div>
                        </div>
                        {state.files.map((slot) => (
                            <FileChip
                                key={slot.id}
                                slot={slot}
                                pair={state.files.length === 2}
                                uploading={state.status === "uploading"}
                                validating={state.status === "validating"}
                                onRemove={() => dispatch({ type: "remove-file", id: slot.id })}
                                onSide={(side) => dispatch({ type: "set-side", id: slot.id, side })}
                                onInches={() => {
                                    if (!slot.mesh) return;
                                    dispatch({
                                        type: "treat-inches",
                                        id: slot.id,
                                        mesh: scaledMesh(slot.mesh, INCH_SCALE),
                                    });
                                }}
                            />
                        ))}
                    </div>

                    <section
                        ref={materialRef}
                        className={cn(
                            "rounded-lg border border-border bg-panel p-4",
                            state.missingHighlight === "material" ? "ring-2 ring-destructive" : "",
                        )}
                    >
                        <h2 className="text-sm font-medium">Settings</h2>
                        {state.missingHighlight === "material" ? (
                            <p className="mt-1 text-xs text-destructive">Pick a material.</p>
                        ) : null}
                        <p className="mt-3 text-xs text-muted-foreground">Material</p>
                        <div role="radiogroup" aria-label="Material" className="mt-2 grid grid-cols-2 gap-2">
                            {MATERIAL_CARDS.map((card) => {
                                const selected = state.material === card.id;
                                return (
                                    <label
                                        key={card.id}
                                        className={cn(
                                            "cursor-pointer rounded-md border p-2.5 text-left focus-within:ring-2 focus-within:ring-ring",
                                            selected
                                                ? "border-primary bg-primary/15"
                                                : "border-border bg-background hover:border-primary/50",
                                        )}
                                    >
                                        <input
                                            type="radio"
                                            name="slicer-material"
                                            className="sr-only"
                                            checked={selected}
                                            onChange={() =>
                                                dispatch({ type: "set-material", material: card.id })
                                            }
                                        />
                                        <div className="text-sm font-medium">{card.name}</div>
                                        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                                            {card.description}
                                            {card.shore ? ` ${card.shore}.` : ""}
                                        </div>
                                    </label>
                                );
                            })}
                        </div>

                        <p className="mt-4 text-xs text-muted-foreground">Print direction</p>
                        <Segmented
                            ariaLabel="Print direction"
                            value={state.printDirection}
                            onChange={(printDirection) => dispatch({ type: "set-direction", printDirection })}
                            options={[
                                { value: "toe_first", label: "Toe first", hint: "Nozzle starts at the toe" },
                                {
                                    value: "heel_first",
                                    label: "Heel first",
                                    hint: "Nozzle starts at the heel",
                                },
                            ]}
                        />

                        <p className="mt-4 text-xs text-muted-foreground">Walls</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => dispatch({ type: "set-wall-preset", preset: "standard" })}
                                className={cn(
                                    "rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    state.wallPreset === "standard"
                                        ? "border-primary bg-primary/15"
                                        : "border-border hover:border-primary/50",
                                )}
                            >
                                {standardWallLabel(state.material)}
                            </button>
                            <button
                                type="button"
                                onClick={() => dispatch({ type: "set-wall-preset", preset: "reinforced" })}
                                className={cn(
                                    "rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    state.wallPreset === "reinforced"
                                        ? "border-primary bg-primary/15"
                                        : "border-border hover:border-primary/50",
                                )}
                            >
                                Reinforced: {REINFORCED_WALL_LOOPS} walls
                            </button>
                        </div>

                        <button
                            type="button"
                            className="mt-4 flex w-full items-center justify-between rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-expanded={state.advancedOpen}
                            onClick={() => dispatch({ type: "toggle-advanced" })}
                        >
                            Advanced settings
                            <ChevronDown
                                className={cn("h-4 w-4 transition", state.advancedOpen ? "rotate-180" : "")}
                            />
                        </button>
                        {state.advancedOpen ? (
                            <div className="mt-2 space-y-3 rounded-md border border-border p-3">
                                <label className="block text-xs">
                                    <span className="flex justify-between text-muted-foreground">
                                        Wall count{" "}
                                        <span className="tabular-nums text-foreground">
                                            {state.wallLoops}
                                        </span>
                                    </span>
                                    <input
                                        type="range"
                                        min={WALL_LOOPS_MIN}
                                        max={WALL_LOOPS_MAX}
                                        step={1}
                                        value={state.wallLoops}
                                        onChange={(e) =>
                                            dispatch({
                                                type: "set-wall-loops",
                                                wallLoops: Number(e.target.value),
                                            })
                                        }
                                        className="mt-1 h-1 w-full cursor-pointer appearance-none rounded bg-muted accent-primary"
                                    />
                                </label>
                                <label className="block text-xs">
                                    <span className="flex justify-between text-muted-foreground">
                                        Infill %{" "}
                                        <span className="tabular-nums text-foreground">
                                            {state.infillDensity}%
                                        </span>
                                    </span>
                                    <input
                                        type="range"
                                        min={INFILL_DENSITY_PCT_MIN}
                                        max={INFILL_DENSITY_PCT_MAX}
                                        step={1}
                                        value={state.infillDensity}
                                        onChange={(e) =>
                                            dispatch({
                                                type: "set-infill",
                                                infillDensity: Number(e.target.value),
                                            })
                                        }
                                        className="mt-1 h-1 w-full cursor-pointer appearance-none rounded bg-muted accent-primary"
                                    />
                                </label>
                                <p className="text-[11px] text-muted-foreground">
                                    Material default: {defaultWallLoopsForMaterial(state.material)} walls,{" "}
                                    {DEFAULT_INFILL_DENSITY_PCT}% infill.
                                </p>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => dispatch({ type: "reset-defaults" })}
                                >
                                    Reset to material defaults
                                </Button>
                            </div>
                        ) : null}
                    </section>

                    <div className="hidden md:block">
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
                        copied={copied}
                        onCopy={copyId}
                        onRetry={onSliceClick}
                        onSliceAnother={() => dispatch({ type: "slice-another" })}
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

function FileChip({
    slot,
    pair,
    uploading,
    validating,
    onRemove,
    onSide,
    onInches,
}: {
    slot: SlicerFileSlot;
    pair: boolean;
    uploading: boolean;
    validating: boolean;
    onRemove: () => void;
    onSide: (side: FootSideTag) => void;
    onInches: () => void;
}) {
    const warn = slot.mesh && !slot.treatedAsInches ? unitsWarning(slot.mesh.bounds.lengthMm) : null;
    return (
        <div className="mt-3 rounded-md border border-border bg-background p-2.5">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm">{slot.file.name}</div>
                    <div className="text-[11px] text-muted-foreground">{formatBytes(slot.file.size)}</div>
                </div>
                <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Remove"
                    onClick={onRemove}
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
            {uploading ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${slot.progress}%` }} />
                </div>
            ) : null}
            {validating ? <p className="mt-2 text-xs text-muted-foreground">Checking file…</p> : null}
            {slot.mesh ? (
                <p className="mt-2 text-xs text-muted-foreground">{formatDimensionsMm(slot.mesh.bounds)}</p>
            ) : null}
            {slot.issue ? (
                <p className="mt-2 text-xs text-destructive">
                    {slot.issue.message} {slot.issue.fix}
                </p>
            ) : null}
            {warn ? (
                <div className="mt-2 rounded bg-amber-500/15 p-2 text-xs text-amber-200">
                    {warn === "small"
                        ? "This looks shorter than 150 mm, which often means the file is in inches."
                        : "This looks longer than 350 mm, which may be a units problem."}
                    <Button type="button" size="sm" variant="outline" className="ml-2" onClick={onInches}>
                        Treat as inches
                    </Button>
                </div>
            ) : null}
            {pair ? (
                <div className="mt-2 flex gap-2">
                    {(["left", "right"] as const).map((side) => (
                        <button
                            key={side}
                            type="button"
                            onClick={() => onSide(side)}
                            className={cn(
                                "rounded px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                slot.side === side ? "bg-primary text-primary-foreground" : "bg-muted",
                            )}
                        >
                            {side === "left" ? "Left" : "Right"}
                        </button>
                    ))}
                </div>
            ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">One file at a time.</p>
            )}
        </div>
    );
}

function Segmented({
    ariaLabel,
    value,
    onChange,
    options,
}: {
    ariaLabel: string;
    value: VertexSlicePrintDirection;
    onChange: (v: VertexSlicePrintDirection) => void;
    options: { value: VertexSlicePrintDirection; label: string; hint: string }[];
}) {
    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            className="mt-2 flex rounded-md border border-border p-0.5"
            onKeyDown={(e) => {
                const i = options.findIndex((o) => o.value === value);
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                    e.preventDefault();
                    onChange(options[(i + 1) % options.length].value);
                }
                if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                    e.preventDefault();
                    onChange(options[(i - 1 + options.length) % options.length].value);
                }
            }}
        >
            {options.map((opt) => {
                const selected = opt.value === value;
                return (
                    <label
                        key={opt.value}
                        title={opt.hint}
                        className={cn(
                            "flex flex-1 cursor-pointer items-center justify-center gap-1 rounded px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring",
                            selected
                                ? "bg-secondary text-foreground"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        <input
                            type="radio"
                            name="slicer-print-direction"
                            className="sr-only"
                            checked={selected}
                            onChange={() => onChange(opt.value)}
                        />
                        <svg width="12" height="12" viewBox="0 0 12 12" className="opacity-80">
                            <title>{opt.hint}</title>
                            {opt.value === "toe_first" ? (
                                <path
                                    d="M2 6h7M7 3l3 3-3 3"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                />
                            ) : (
                                <path
                                    d="M10 6H3M5 3L2 6l3 3"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                />
                            )}
                        </svg>
                        {opt.label}
                    </label>
                );
            })}
        </div>
    );
}

function SliceButtonBar({
    status,
    sliceStep,
    slicingSlow,
    onSlice,
    onCancel,
    onKeepWaiting,
}: {
    status: string;
    sliceStep: SliceStep;
    slicingSlow: boolean;
    onSlice: () => void;
    onCancel: () => void;
    onKeepWaiting: () => void;
}) {
    const slicing = status === "slicing";
    return (
        <div className="space-y-2">
            <Button type="button" className="w-full" size="lg" onClick={onSlice}>
                {slicing ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Slicing… ~5 s
                    </>
                ) : (
                    "Slice"
                )}
            </Button>
            {slicing ? (
                <div className="text-center text-xs text-muted-foreground">
                    {STEPS.map((step, i) => (
                        <span key={step}>
                            <span className={step === sliceStep ? "text-foreground" : ""}>{step}</span>
                            {i < STEPS.length - 1 ? " → " : ""}
                        </span>
                    ))}
                </div>
            ) : null}
            {slicing ? (
                <div className="flex justify-center gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                </div>
            ) : null}
            {slicing && slicingSlow ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                    Taking longer than usual
                    <div className="mt-2 flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={onKeepWaiting}>
                            Keep waiting
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function ResultPanel({
    stateStatus,
    error,
    result,
    copied,
    onCopy,
    onRetry,
    onSliceAnother,
}: {
    stateStatus: string;
    error: import("../../../shared/vertexslice/errors").SlicerPublicError | null;
    result: import("./slicer-state").SliceResult | null;
    copied: boolean;
    onCopy: (id: string) => void;
    onRetry: () => void;
    onSliceAnother: () => void;
}) {
    if (stateStatus === "error" && error) {
        return (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                <h3 className="text-sm font-medium text-destructive">Couldn’t slice</h3>
                <p className="mt-1 text-sm">{error.cause}</p>
                <p className="mt-1 text-xs text-muted-foreground">{error.nextStep}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" onClick={onRetry}>
                        Retry
                    </Button>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                        {error.requestId || "—"}
                    </code>
                    <Button type="button" size="sm" variant="ghost" onClick={() => onCopy(error.requestId)}>
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        Copy ID
                    </Button>
                </div>
            </div>
        );
    }
    if ((stateStatus === "done" || stateStatus === "outdated") && result) {
        const stale = stateStatus === "outdated";
        return (
            <div className={cn("rounded-lg border border-border bg-panel p-4", stale && "opacity-70")}>
                {stale ? (
                    <div className="mb-3 rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-200">
                        Out of date: Slice again
                    </div>
                ) : null}
                <h3 className="text-sm font-medium">Result</h3>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Print time</dt>
                    <dd>{formatPrintTime(result.stats.printTimeSeconds)}</dd>
                    <dt className="text-muted-foreground">Filament used</dt>
                    <dd>
                        {result.stats.filamentGrams != null
                            ? `${result.stats.filamentGrams.toFixed(1)} g`
                            : "—"}
                        {result.stats.filamentMeters != null
                            ? ` · ${result.stats.filamentMeters.toFixed(2)} m`
                            : ""}
                    </dd>
                    <dt className="text-muted-foreground">Layers</dt>
                    <dd>{result.stats.layers ?? "—"}</dd>
                    <dt className="text-muted-foreground">Summary</dt>
                    <dd>
                        {result.material === "apex_core"
                            ? "ApexCore"
                            : result.material === "apex_light"
                              ? "ApexLight"
                              : result.material === "apex_forge"
                                ? "ApexForge"
                                : "ApexBounce"}{" "}
                        · {result.printDirection === "toe_first" ? "Toe first" : "Heel first"} ·{" "}
                        {result.wallLoops} walls
                    </dd>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" onClick={() => downloadGcode(result.gcode, result.filename)}>
                        Download G-code
                    </Button>
                    <Button type="button" variant="outline" onClick={onSliceAnother}>
                        Slice another
                    </Button>
                </div>
                {stale ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                        Download still uses the previous settings ({result.filename}).
                    </p>
                ) : null}
            </div>
        );
    }
    return (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Slice to see print time, filament, and G-code.
        </div>
    );
}

export type { VertexSliceMaterialId };
