// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ChevronDown, Upload } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { MATERIAL_CARDS } from "@/features/slicer/materials";
import { cn } from "@/lib/utils";
import { CLASS_DISPLAY_NAMES, CLASS_PREVIEW_COLORS } from "../../../shared/print-recipe/hardness-class-table";
import {
    INFILL_DENSITY_PCT_MAX,
    INFILL_DENSITY_PCT_MIN,
    VERTEXSLICE_MAX_UPLOAD_BYTES,
    type VertexSlicePrintDirection,
} from "../../../shared/vertexslice/contract";
import { classDensityPct, NAMED_HARDNESS_CLASSES } from "../../lib/hardness";
import { SliceButtonBar } from "./slicer-slice-bar";
import {
    type SlicerFileSlot,
    type SlicerHardness,
    type SlicerState,
    slicerInfillPercent,
} from "./slicer-state";
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
    onTreatInches,
    onMaterial,
    onDirection,
    onLeader,
    leaderMessage,
    onHardness,
    onToggleAdvanced,
    onInfillOverride,
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
    onTreatInches: (slot: SlicerFileSlot) => void;
    onMaterial: (id: import("../../../shared/vertexslice/contract").VertexSliceMaterialId) => void;
    onDirection: (printDirection: VertexSlicePrintDirection) => void;
    onLeader: (includeLeader: boolean) => void;
    leaderMessage: string | null;
    onHardness: (hardness: SlicerHardness) => void;
    onToggleAdvanced: () => void;
    onInfillOverride: (infillOverridePct: number | null) => void;
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
                            {Math.round(VERTEXSLICE_MAX_UPLOAD_BYTES / (1024 * 1024))} MB. One file at a time.
                        </p>
                        {state.uploadNotice ? (
                            <p className="mt-2 text-xs text-destructive">{state.uploadNotice}</p>
                        ) : null}
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
                            className="sr-only"
                            onChange={onPick}
                        />
                    </div>
                </div>
                {state.files.map((slot) => (
                    <FileChip
                        key={slot.id}
                        slot={slot}
                        uploading={state.status === "uploading"}
                        validating={state.status === "validating"}
                        onRemove={() => onRemoveFile(slot.id)}
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

                <label className="mt-4 flex items-start gap-2 text-sm">
                    <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-primary"
                        checked={state.includeLeader}
                        data-testid="slicer-sacrificial-leader"
                        onChange={(event) => onLeader(event.target.checked)}
                    />
                    <span>
                        Add sacrificial leader
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                            Same belt tab as a CAD export. Off leaves this file unchanged.
                        </span>
                    </span>
                </label>
                {leaderMessage ? (
                    <p
                        className="text-[11px] leading-snug text-amber-200"
                        data-testid="slicer-leader-message"
                    >
                        {leaderMessage}
                    </p>
                ) : null}

                <fieldset className="mt-4 space-y-1" aria-label="Hardness">
                    <legend className="text-xs text-muted-foreground">Hardness</legend>
                    {NAMED_HARDNESS_CLASSES.map((level) => {
                        const selected = state.hardness === level;
                        return (
                            <button
                                key={level}
                                type="button"
                                aria-pressed={selected}
                                data-testid="slicer-hardness"
                                data-hardness-option={level}
                                onClick={() => onHardness(level)}
                                className={cn(
                                    "flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    selected ? "bg-primary/15" : "hover:bg-muted",
                                )}
                            >
                                <span
                                    aria-hidden="true"
                                    className="h-3 w-3 rounded-full"
                                    style={{ backgroundColor: CLASS_PREVIEW_COLORS[level] }}
                                />
                                {CLASS_DISPLAY_NAMES[level]}
                                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                                    {classDensityPct(level)}%
                                </span>
                            </button>
                        );
                    })}
                </fieldset>

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
                                Infill override{" "}
                                <span className="tabular-nums text-foreground">
                                    {slicerInfillPercent(state.hardness, state.infillOverridePct)}%
                                </span>
                            </span>
                            <input
                                type="range"
                                min={INFILL_DENSITY_PCT_MIN}
                                max={INFILL_DENSITY_PCT_MAX}
                                step={1}
                                value={slicerInfillPercent(state.hardness, state.infillOverridePct)}
                                aria-label="Infill override"
                                onChange={(e) => onInfillOverride(Number(e.target.value))}
                                className="mt-1 h-1 w-full cursor-pointer appearance-none rounded bg-muted accent-primary"
                            />
                        </label>
                        {state.infillOverridePct != null ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => onInfillOverride(null)}
                            >
                                Use hardness infill
                            </Button>
                        ) : (
                            <p className="text-[11px] text-muted-foreground">
                                Uses the hardness level until you set a percentage.
                            </p>
                        )}
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
