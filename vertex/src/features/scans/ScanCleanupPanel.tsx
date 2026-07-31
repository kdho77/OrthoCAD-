// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useMemo, useState } from "react";
import { groupSmallFragments, SMALL_FRAGMENT_TRI_FLOOR } from "@/lib/geometry/scan-components";
import { suggestScanLandmarks } from "@/lib/geometry/scan-landmark-suggest";
import { cn } from "@/lib/utils";
import { useScanStore } from "@/stores/scan-store";

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
    const kept = draftKept ?? scan?.keptComponentIds ?? [];
    const grouping = useMemo(() => groupSmallFragments(components), [components]);

    if (!scan) return null;

    if (components.length === 0) {
        return (
            <div className="rounded border border-border/60 bg-muted/20 px-1.5 py-1 text-[10px] text-muted-foreground">
                No component analysis available.
            </div>
        );
    }

    if (components.length === 1) {
        return (
            <div className="rounded border border-border/60 bg-muted/20 px-1.5 py-1 text-[10px] text-muted-foreground">
                Single component detected — no cleanup needed.
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
        // Re-suggest on cleaned selection (fail soft).
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
    };

    const smallKept =
        grouping.smallFragments.length > 0 && grouping.smallFragments.every((c) => kept.includes(c.id));

    return (
        <div className="space-y-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-1.5 text-[10px] leading-snug">
            <p className="font-medium text-amber-200">
                {cleanupBusy ? "Analyzing components…" : "Multiple mesh components detected"}
            </p>
            <p className="text-muted-foreground">
                Auto-selected rank #1 as the foot. Review statistics, adjust keep set, then approve. Removal
                is non-destructive for this session.
            </p>

            {(d.priorRawInferredUnit != null || d.priorRawLongest != null) && (
                <div className="rounded border border-border/50 bg-background/40 px-1.5 py-1 text-muted-foreground">
                    <p>
                        Before cleanup: unit {d.priorRawInferredUnit ?? "—"}, longest{" "}
                        {d.priorRawLongest?.toFixed(3) ?? "—"}, {d.priorRawDominantAxis?.toUpperCase() ?? "—"}
                        -dominant
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
                                        {c.rank === 1 ? " (foot)" : ""} · {c.triangleCount.toLocaleString()}{" "}
                                        tris
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
                    <button type="button" className="underline" onClick={() => clearCleanupMessage(scanId)}>
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
        </div>
    );
}
