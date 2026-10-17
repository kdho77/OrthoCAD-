// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ChevronDown, Upload } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { MATERIAL_CARDS, standardWallLabel } from "@/features/slicer/materials";
import { cn } from "@/lib/utils";
import {
    DEFAULT_INFILL_DENSITY_PCT,
    defaultWallLoopsForMaterial,
    INFILL_DENSITY_PCT_MAX,
    INFILL_DENSITY_PCT_MIN,
    REINFORCED_WALL_LOOPS,
    VERTEXSLICE_MAX_UPLOAD_BYTES,
    type VertexSlicePrintDirection,
    WALL_LOOPS_MAX,
    WALL_LOOPS_MIN,
} from "../../../shared/vertexslice/contract";
import type { FootSideTag } from "./slicer-mesh";
import type { SlicerFileSlot, SlicerState } from "./slicer-state";
import { SliceButtonBar } from "./slicer-slice-bar";
import { FileChip, Segmented } from "./slicer-widgets";

export function SlicerFormColumn({
    state,
    dragOver,
    dropRef,
    fileInputRef,
    materialRef,
    onKeyActivate,
    onDragOver,
    onDragLeave,
    onDrop,
    onPick,
    onChooseFile,
    onRemoveFile,
    onSide,
    onTreatInches,
    onMaterial,
    onDirection,
    onWallPreset,
    onToggleAdvanced,
    onWallLoops,
    onInfill,
    onResetDefaults,
    onSlice,
    onCancel,
    onKeepWaiting,
    children,
}: {
    state: SlicerState;
    dragOver: boolean;
    dropRef: RefObject<HTMLDivElement | null>;
    fileInputRef: RefObject<HTMLInputElement | null>;
    materialRef: RefObject<HTMLElement | null>;
    onKeyActivate: (e: React.KeyboardEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
    onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onChooseFile: (e: React.MouseEvent) => void;
    onRemoveFile: (id: string) => void;
    onSide: (id: string, side: FootSideTag) => void;
    onTreatInches: (slot: SlicerFileSlot) => void;
    onMaterial: (id: import("../../../shared/vertexslice/contract").VertexSliceMaterialId) => void;
    onDirection: (printDirection: VertexSlicePrintDirection) => void;
    onWallPreset: (preset: "standard" | "reinforced") => void;
    onToggleAdvanced: () => void;
    onWallLoops: (wallLoops: number) => void;
    onInfill: (infillDensity: number) => void;
    onResetDefaults: () => void;
    onSlice: () => void;
    onCancel: () => void;
    onKeepWaiting: () => void;
    children?: ReactNode;
}) {
    return (
        <div className="flex w-full flex-col gap-4 p-4 pb-24 md:h-full md:w-[400px] md:shrink-0 md:overflow-y-auto md:pb-4">
            {/* biome-ignore lint/a11y/useSemanticElements: drop target cannot be a native button */}
            <div
                ref={dropRef}
                tabIndex={0}
                role="button"
                aria-label="Upload STL or 3MF"
                onKeyDown={onKeyActivate}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
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
                            {Math.round(VERTEXSLICE_MAX_UPLOAD_BYTES / (1024 * 1024))} MB. One file at a time,
                            or a left/right pair.
                        </p>
                        {state.missingHighlight === "file" ? (
                            <p className="mt-2 text-xs text-destructive">Add an STL or 3MF to slice.</p>
                        ) : null}
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-3"
                            onClick={onChooseFile}
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
                        onRemove={() => onRemoveFile(slot.id)}
                        onSide={(side) => onSide(slot.id, side)}
                        onInches={() => onTreatInches(slot)}
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
                                    onChange={() => onMaterial(card.id)}
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
                    onChange={onDirection}
                    options={[
                        { value: "toe_first", label: "Toe first", hint: "Nozzle starts at the toe" },
                        { value: "heel_first", label: "Heel first", hint: "Nozzle starts at the heel" },
                    ]}
                />

                <p className="mt-4 text-xs text-muted-foreground">Walls</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={() => onWallPreset("standard")}
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
                        onClick={() => onWallPreset("reinforced")}
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
                    onClick={onToggleAdvanced}
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
                                <span className="tabular-nums text-foreground">{state.wallLoops}</span>
                            </span>
                            <input
                                type="range"
                                min={WALL_LOOPS_MIN}
                                max={WALL_LOOPS_MAX}
                                step={1}
                                value={state.wallLoops}
                                onChange={(e) => onWallLoops(Number(e.target.value))}
                                className="mt-1 h-1 w-full cursor-pointer appearance-none rounded bg-muted accent-primary"
                            />
                        </label>
                        <label className="block text-xs">
                            <span className="flex justify-between text-muted-foreground">
                                Infill %{" "}
                                <span className="tabular-nums text-foreground">{state.infillDensity}%</span>
                            </span>
                            <input
                                type="range"
                                min={INFILL_DENSITY_PCT_MIN}
                                max={INFILL_DENSITY_PCT_MAX}
                                step={1}
                                value={state.infillDensity}
                                onChange={(e) => onInfill(Number(e.target.value))}
                                className="mt-1 h-1 w-full cursor-pointer appearance-none rounded bg-muted accent-primary"
                            />
                        </label>
                        <p className="text-[11px] text-muted-foreground">
                            Material default: {defaultWallLoopsForMaterial(state.material)} walls,{" "}
                            {DEFAULT_INFILL_DENSITY_PCT}% infill.
                        </p>
                        <Button type="button" size="sm" variant="ghost" onClick={onResetDefaults}>
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
                    onSlice={onSlice}
                    onCancel={onCancel}
                    onKeepWaiting={onKeepWaiting}
                />
            </div>
            {children}
        </div>
    );
}
