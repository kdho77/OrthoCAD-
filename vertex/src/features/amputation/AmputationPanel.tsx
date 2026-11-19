// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    confirmAmputationDraw,
    defaultSideAmputation,
    normalizeSideAmputation,
} from "@/lib/geometry/amputee-filler";
import { outlineHalfWidth } from "@/lib/geometry/height-field";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { useDesignStore } from "@/stores/design-store";
import type { Side, SideAmputation } from "@/types";
import { useAmputationDrawStore } from "./amputation-draw-store";

const SIDES: Side[] = ["left", "right"];
const SIDE_LABEL: Record<Side, string> = { left: "Left", right: "Right" };

/**
 * Windows Amputation panel: per foot, Enabled and Draw, then Height,
 * Fillet inside, Fillet outside, and Interface Fillet.
 * Draw clicks a U from the medial edge, around the toe, to the lateral edge.
 */
export function AmputationPanel() {
    const design = useDesignStore((s) => s.design);
    const updateAmputation = useDesignStore((s) => s.updateAmputation);
    const layout = useMemo(() => insoleLayoutFromDesign(design), [design]);
    const halfWidthMm = useMemo(
        () => (u: number) => outlineHalfWidth(u) * (layout.widthMm / 2),
        [layout.widthMm],
    );
    const drawing = useAmputationDrawStore((s) => s.side);
    const draft = useAmputationDrawStore((s) => s.points);
    const start = useAmputationDrawStore((s) => s.start);
    const undoPoint = useAmputationDrawStore((s) => s.undo);
    const cancelDraw = useAmputationDrawStore((s) => s.cancel);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => () => useAmputationDrawStore.getState().cancel(), []);

    const startDraw = (side: Side) => {
        if (drawing === side) return;
        start(side);
        setNote(
            "Click the insole from the medial edge, around the toe, to the lateral edge. The cut shows on the sheet as you place points.",
        );
    };

    const confirm = () => {
        if (!drawing) return;
        const result = confirmAmputationDraw(
            draft.map((p) => ({ x: p.x, y: p.y })),
            layout.lengthMm,
            layout.widthMm,
            halfWidthMm,
        );
        if (result.rejected) {
            setNote(result.reason ?? "That line cannot be used.");
            return;
        }
        updateAmputation(drawing, { enabled: true, points: result.points });
        setNote(
            result.clipped ? "Clipped to the outline. The toe side is raised." : "The toe side is raised.",
        );
        cancelDraw();
    };

    return (
        <section className="space-y-3" aria-label="Amputation">
            <h3 className="text-sm font-medium">Amputation</h3>
            <p className="text-[11px] leading-snug text-muted-foreground">
                Toe side of the line rises by Height. Fillet inside rounds the top edge. Fillet outside blends
                into the insole. Interface Fillet off is a near-vertical step with about 1 mm of cleanup.
            </p>
            {SIDES.map((side) => {
                const amp = normalizeSideAmputation(design.amputation?.[side] ?? defaultSideAmputation());
                return (
                    <FootAmputation
                        key={side}
                        side={side}
                        amp={amp}
                        drawing={drawing === side}
                        onEnabled={(enabled) => updateAmputation(side, { enabled })}
                        onDraw={() => startDraw(side)}
                        onHeight={(height) => updateAmputation(side, { height })}
                        onFilletInside={(filletInside) => updateAmputation(side, { filletInside })}
                        onFilletOutside={(filletOutside) => updateAmputation(side, { filletOutside })}
                        onInterface={(interfaceFillet) => updateAmputation(side, { interfaceFillet })}
                    />
                );
            })}
            {drawing ? (
                <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                        Click the {SIDE_LABEL[drawing]} insole from the medial edge, around the toe, to the
                        lateral edge, then Confirm.
                    </p>
                    <div className="flex gap-2">
                        <Button type="button" size="sm" onClick={confirm}>
                            Confirm
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => undoPoint()}>
                            Undo point
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                cancelDraw();
                                setNote(null);
                            }}
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}
            {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
        </section>
    );
}

function FootAmputation({
    side,
    amp,
    drawing,
    onEnabled,
    onDraw,
    onHeight,
    onFilletInside,
    onFilletOutside,
    onInterface,
}: {
    side: Side;
    amp: SideAmputation;
    drawing: boolean;
    onEnabled: (on: boolean) => void;
    onDraw: () => void;
    onHeight: (mm: number) => void;
    onFilletInside: (mm: number) => void;
    onFilletOutside: (mm: number) => void;
    onInterface: (on: boolean) => void;
}) {
    return (
        <div className="space-y-2 rounded-md border border-border p-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{SIDE_LABEL[side]}</span>
                <label className="flex items-center gap-2 text-xs">
                    <span>Enabled</span>
                    <input
                        type="checkbox"
                        aria-label={`${SIDE_LABEL[side]} amputation enabled`}
                        checked={amp.enabled}
                        onChange={(event) => onEnabled(event.target.checked)}
                    />
                </label>
            </div>
            <Button type="button" size="sm" variant={drawing ? "default" : "outline"} onClick={onDraw}>
                Draw
            </Button>
            <MmField side={side} label="Height" value={amp.height} onChange={onHeight} />
            <MmField side={side} label="Fillet inside" value={amp.filletInside} onChange={onFilletInside} />
            <MmField
                side={side}
                label="Fillet outside"
                value={amp.filletOutside}
                onChange={onFilletOutside}
            />
            <label className="flex items-center justify-between gap-2 text-xs">
                <span>Interface Fillet</span>
                <input
                    type="checkbox"
                    aria-label={`${SIDE_LABEL[side]} interface fillet`}
                    checked={amp.interfaceFillet}
                    onChange={(event) => onInterface(event.target.checked)}
                />
            </label>
        </div>
    );
}

function MmField({
    side,
    label,
    value,
    onChange,
}: {
    side: Side;
    label: string;
    value: number;
    onChange: (mm: number) => void;
}) {
    return (
        <label className="flex items-center justify-between gap-2 text-xs">
            <span>{label}</span>
            <span className="flex items-center gap-1">
                <input
                    type="number"
                    aria-label={`${SIDE_LABEL[side]} ${label}`}
                    className="h-7 w-16 rounded border border-border bg-transparent px-1 text-right text-xs"
                    min={0}
                    max={80}
                    step={0.5}
                    value={Number.isFinite(value) ? value : 0}
                    onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) onChange(next);
                    }}
                />
                <span className="text-muted-foreground">mm</span>
            </span>
        </label>
    );
}
