// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { groupSmallFragments, SMALL_FRAGMENT_TRI_FLOOR } from "@/lib/geometry/scan-components";
import { suggestScanLandmarks } from "@/lib/geometry/scan-landmark-suggest";
import { cn } from "@/lib/utils";
import { useScanStore } from "@/stores/scan-store";

function CollapsibleSection({
    title,
    titleClassName,
    open,
    onOpenChange,
    children,
    className,
    collapsedHint,
}: {
    title: string;
    titleClassName?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
    className?: string;
    collapsedHint?: ReactNode;
}) {
    return (
        <div className={cn("rounded border px-1.5 py-1.5 text-[10px] leading-snug", className)}>
            <button
                type="button"
                onClick={() => onOpenChange(!open)}
                className="flex w-full items-center gap-1 text-left"
                aria-expanded={open}
            >
                <ChevronRight
                    className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
                />
                <span className={cn("font-medium", titleClassName)}>{title}</span>
            </button>
            {open ? <div className="mt-1 space-y-1.5">{children}</div> : null}
            {!open && collapsedHint ? (
                <p className="mt-0.5 pl-4 text-muted-foreground">{collapsedHint}</p>
            ) : null}
        </div>
    );
}

function ScanPlaneSliceControls({ scanId }: { scanId: string }) {
    const scan = useScanStore((s) => s.scans.find((x) => x.id === scanId));
    const sliceDraft = useScanStore((s) => s.sliceDraft);
    const beginSlice = useScanStore((s) => s.beginSlice);
    const cancelSlice = useScanStore((s) => s.cancelSlice);
    const flipSliceKeepSide = useScanStore((s) => s.flipSliceKeepSide);
    const applySlicePlane = useScanStore((s) => s.applySlicePlane);
    const undoLastSlice = useScanStore((s) => s.undoLastSlice);
    const clearSlicePlanes = useScanStore((s) => s.clearSlicePlanes);
    const setSuggestedLandmarks = useScanStore((s) => s.setSuggestedLandmarks);
    const [sliceError, setSliceError] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const active = sliceDraft?.scanId === scanId;
    const ready = Boolean(active && sliceDraft?.step === 2 && sliceDraft.previewLocal);

    useEffect(() => {
        if (active) setOpen(true);
    }, [active]);

    if (!scan) return null;

    const onApply = () => {
        if (!sliceDraft?.previewLocal) return;
        const result = applySlicePlane(scanId, sliceDraft.previewLocal);
        if (!result.ok) {
            setSliceError(result.reason);
            return;
        }
        setSliceError(null);
        const updated = useScanStore.getState().scans.find((x) => x.id === scanId);
        if (updated) {
            const sug = suggestScanLandmarks(updated.geometry, updated.side);
            setSuggestedLandmarks(scanId, sug);
        }
    };

    return (
        <CollapsibleSection
            title="Plane slice"
            titleClassName="text-sky-200"
            open={open}
            onOpenChange={setOpen}
            className="border-sky-500/30 bg-sky-500/5"
            collapsedHint={
                scan.slicePlanes.length > 0
                    ? `${scan.slicePlanes.length} slice(s) applied · expand to cut connected noise`
                    : "Expand if a plane cut is needed to remove connected noise"
            }
        >
            <p className="text-muted-foreground">
                Cut connected noise that is still attached to the foot. Click two points in the viewport to
                draw a cut line (plane faces the camera), flip keep side if needed, then apply.
                Non-destructive for this session.
            </p>
            {scan.slicePlanes.length > 0 ? (
                <p className="text-muted-foreground">
                    Applied slices: {scan.slicePlanes.length} · tris now {scan.triangleCount.toLocaleString()}
                </p>
            ) : null}
            {active ? (
                <p className="text-amber-200">
                    {sliceDraft.step === 0 && "Click first point of the cut line…"}
                    {sliceDraft.step === 1 && "Click second point…"}
                    {sliceDraft.step === 2 && "Preview ready — flip keep side or apply."}
                </p>
            ) : null}
            {sliceError ? <p className="text-destructive">{sliceError}</p> : null}
            <div className="flex flex-wrap gap-1 pt-0.5">
                {!active ? (
                    <button
                        type="button"
                        onClick={() => {
                            setSliceError(null);
                            beginSlice(scanId);
                        }}
                        className="rounded bg-sky-500/20 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-500/30"
                    >
                        Draw slice plane
                    </button>
                ) : (
                    <>
                        <button
                            type="button"
                            disabled={!ready}
                            onClick={onApply}
                            className="rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground disabled:opacity-40"
                        >
                            Apply slice
                        </button>
                        <button
                            type="button"
                            disabled={!ready}
                            onClick={() => flipSliceKeepSide()}
                            className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                        >
                            Flip keep side
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setSliceError(null);
                                cancelSlice();
                            }}
                            className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                            Cancel
                        </button>
                    </>
                )}
                <button
                    type="button"
                    disabled={scan.slicePlanes.length === 0}
                    onClick={() => undoLastSlice(scanId)}
                    className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                    Undo slice
                </button>
                <button
                    type="button"
                    disabled={scan.slicePlanes.length === 0}
                    onClick={() => clearSlicePlanes(scanId)}
                    className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                    Clear slices
                </button>
            </div>
        </CollapsibleSection>
    );
}

export function ScanCleanupPanel({ scanId }: { scanId: string }) {
    const scan = useScanStore((s) => s.scans.find((x) => x.id === scanId));
    const setKeptComponents = useScanStore((s) => s.setKeptComponents);
    const restoreAllComponents = useScanStore((s) => s.restoreAllComponents);
    const setHoveredComponentId = useScanStore((s) => s.setHoveredComponentId);
    const setSuggestedLandmarks = useScanStore((s) => s.setSuggestedLandmarks);
    const clearCleanupMessage = useScanStore((s) => s.clearCleanupMessage);
    const cleanupBusy = useScanStore((s) => s.cleanupBusy);

    const [draftKept, setDraftKept] = useState<number[] | null>(null);
    const [blockReason, setBlockReason] = useState<string | null>(null);
    const components = scan?.components ?? [];
    const hasDisjoint = components.length > 1;
    const needsKeepReview = hasDisjoint && !(scan?.keepSetApproved ?? false);
    const [componentsOpen, setComponentsOpen] = useState(needsKeepReview);

    const kept = draftKept ?? scan?.keptComponentIds ?? [];
    const grouping = useMemo(() => groupSmallFragments(components), [components]);

    useEffect(() => {
        // Open only when disjoint pieces still need review; collapse after approve / for single meshes.
        setComponentsOpen(needsKeepReview);
    }, [needsKeepReview, scanId]);

    if (!scan) return null;

    if (components.length === 0) {
        return (
            <div className="space-y-1.5">
                <div className="rounded border border-border/60 bg-muted/20 px-1.5 py-1 text-[10px] text-muted-foreground">
                    No component analysis available.
                </div>
                <ScanPlaneSliceControls scanId={scanId} />
            </div>
        );
    }

    if (components.length === 1) {
        return (
            <div className="space-y-1.5">
                <CollapsibleSection
                    title="Mesh components"
                    titleClassName="text-muted-foreground"
                    open={componentsOpen}
                    onOpenChange={setComponentsOpen}
                    className="border-border/60 bg-muted/20"
                    collapsedHint="Single component — no split needed"
                >
                    <p className="text-muted-foreground">
                        Single component detected — no component split needed.
                        {scan.labelingMeta ? (
                            <span>
                                {" "}
                                ({scan.labelingMeta.originalTriangleCount.toLocaleString()} tris
                                {scan.labelingMeta.elapsedMs > 250
                                    ? `, analyzed in ${Math.round(scan.labelingMeta.elapsedMs)}ms`
                                    : ""}
                                )
                            </span>
                        ) : null}
                        <span className="block pt-0.5">
                            Connected noise can still be removed with a plane slice below.
                        </span>
                    </p>
                    {scan.cleanupMessage ? (
                        <p className="text-amber-300">
                            {scan.cleanupMessage}{" "}
                            <button
                                type="button"
                                className="underline"
                                onClick={() => clearCleanupMessage(scanId)}
                            >
                                dismiss
                            </button>
                        </p>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => {
                            restoreAllComponents(scanId);
                            setSuggestedLandmarks(scanId, null);
                        }}
                        className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                        Restore all (raw import)
                    </button>
                </CollapsibleSection>
                <ScanPlaneSliceControls scanId={scanId} />
            </div>
        );
    }

    const allIds = components.map((c) => c.id);
    const isPartial = kept.length < allIds.length;
    const d = scan.display;

    const toggleId = (id: number) => {
        setBlockReason(null);
        setDraftKept((prev) => {
            const base = prev ?? [...scan.keptComponentIds];
            if (base.includes(id)) return base.filter((x) => x !== id);
            return [...base, id];
        });
    };

    const toggleSmallGroup = () => {
        setBlockReason(null);
        const smallIds = grouping.smallFragments.map((c) => c.id);
        setDraftKept((prev) => {
            const base = new Set(prev ?? scan.keptComponentIds);
            const allSmallKept = smallIds.every((id) => base.has(id));
            if (allSmallKept) {
                for (const id of smallIds) base.delete(id);
            } else {
                for (const id of smallIds) base.add(id);
            }
            return [...base];
        });
    };

    const applyKept = () => {
        const result = setKeptComponents(scanId, kept);
        if (!result.ok) {
            setBlockReason(result.reason);
            return;
        }
        setDraftKept(null);
        setBlockReason(null);
        // keepSetApproved flips via the store; effect collapses the section.
        const updated = useScanStore.getState().scans.find((x) => x.id === scanId);
        if (updated) {
            const sug = suggestScanLandmarks(updated.geometry, updated.side);
            setSuggestedLandmarks(scanId, sug);
        }
    };

    const onRestore = () => {
        restoreAllComponents(scanId);
        setDraftKept(null);
        setBlockReason(null);
        setSuggestedLandmarks(scanId, null);
        // keepSetApproved resets via restore; effect re-opens for multi-component scans.
    };

    const smallKept =
        grouping.smallFragments.length > 0 && grouping.smallFragments.every((c) => kept.includes(c.id));

    return (
        <div className="space-y-1.5">
            <CollapsibleSection
                title={cleanupBusy ? "Analyzing components…" : "Multiple mesh components detected"}
                titleClassName="text-amber-200"
                open={componentsOpen}
                onOpenChange={setComponentsOpen}
                className="border-amber-500/30 bg-amber-500/5"
                collapsedHint={`Keeping ${kept.length} of ${allIds.length} components · expand to review`}
            >
                <p className="text-muted-foreground">
                    Auto-selected rank #1 as the foot. Review statistics, adjust keep set, then approve.
                    Removal is non-destructive for this session.
                </p>

                {(d.priorRawInferredUnit != null || d.priorRawLongest != null) && (
                    <div className="rounded border border-border/50 bg-background/40 px-1.5 py-1 text-muted-foreground">
                        <p>
                            Before cleanup: unit {d.priorRawInferredUnit ?? "—"}, longest{" "}
                            {d.priorRawLongest?.toFixed(3) ?? "—"},{" "}
                            {d.priorRawDominantAxis?.toUpperCase() ?? "—"}-dominant
                        </p>
                        <p>
                            After selection: unit {d.inferredUnit}, longest {d.rawLongest.toFixed(3)},{" "}
                            {d.dominantRawAxis.toUpperCase()}-dominant → ×{d.displayScale}
                        </p>
                    </div>
                )}

                <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {grouping.listed.map((c) => {
                        const checked = kept.includes(c.id);
                        return (
                            <li key={c.id}>
                                <label
                                    className={cn(
                                        "flex cursor-pointer gap-1.5 rounded border border-border/40 px-1 py-1",
                                        checked ? "bg-background/60" : "opacity-70",
                                    )}
                                    onMouseEnter={() => setHoveredComponentId({ scanId, componentId: c.id })}
                                    onMouseLeave={() => setHoveredComponentId(null)}
                                >
                                    <input
                                        type="checkbox"
                                        className="mt-0.5 h-3 w-3"
                                        checked={checked}
                                        onChange={() => toggleId(c.id)}
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="text-foreground">
                                            Rank #{c.rank}
                                            {c.rank === 1 ? " (foot)" : ""} ·{" "}
                                            {c.triangleCount.toLocaleString()} tris
                                        </span>
                                        <span className="block text-muted-foreground">
                                            fill {c.fillRatio.toFixed(3)} · bbox{" "}
                                            {c.bboxSize.map((v) => v.toFixed(3)).join("×")} ·{" "}
                                            {c.closed ? "closed" : `open (${c.boundaryEdgeCount} edges)`}
                                        </span>
                                        <span className="block text-[9px] text-muted-foreground/80">
                                            {c.rankReasons.join(" · ")}
                                        </span>
                                    </span>
                                </label>
                            </li>
                        );
                    })}
                    {grouping.smallFragments.length > 0 ? (
                        <li>
                            <label
                                className={cn(
                                    "flex cursor-pointer gap-1.5 rounded border border-border/40 px-1 py-1",
                                    smallKept ? "bg-background/60" : "opacity-70",
                                )}
                            >
                                <input
                                    type="checkbox"
                                    className="mt-0.5 h-3 w-3"
                                    checked={smallKept}
                                    onChange={toggleSmallGroup}
                                />
                                <span>
                                    <span className="text-foreground">
                                        Small fragments ({grouping.smallFragments.length} parts, ≤
                                        {SMALL_FRAGMENT_TRI_FLOOR} tris each)
                                    </span>
                                    <span className="block text-muted-foreground">
                                        {grouping.smallFragmentTriTotal.toLocaleString()} tris total
                                    </span>
                                </span>
                            </label>
                        </li>
                    ) : null}
                </ul>

                {blockReason ? <p className="text-destructive">{blockReason}</p> : null}
                {scan.cleanupMessage ? (
                    <p className="text-amber-300">
                        {scan.cleanupMessage}{" "}
                        <button
                            type="button"
                            className="underline"
                            onClick={() => clearCleanupMessage(scanId)}
                        >
                            dismiss
                        </button>
                    </p>
                ) : null}

                <div className="flex gap-1 pt-0.5">
                    <button
                        type="button"
                        onClick={applyKept}
                        className="flex-1 rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground"
                    >
                        {isPartial || draftKept ? "Approve keep set" : "Confirm selection"}
                    </button>
                    <button
                        type="button"
                        onClick={onRestore}
                        className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                        Restore all
                    </button>
                </div>
            </CollapsibleSection>

            <ScanPlaneSliceControls scanId={scanId} />
        </div>
    );
}
