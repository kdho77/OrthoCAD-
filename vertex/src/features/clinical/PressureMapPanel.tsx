// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ImagePlus, RotateCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadPressureMapFromFile } from "@/lib/pressure-map/import";
import {
    PRESSURE_MAP_MAX_DATA_URL_CHARS,
    PRESSURE_MAP_MAX_EDGE_PX,
} from "@/lib/pressure-map/constants";
import { useActiveFootSide } from "@/lib/clinical/active-foot-side";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

const ACCEPT = "image/png,image/jpeg,.jpg,.jpeg,.png";

export function PressureMapPanel() {
    const side = useActiveFootSide();
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [adjustOpen, setAdjustOpen] = useState(false);
    const foot = useDesignStore((s) => s.design.pressureMaps?.[side]);
    const setPressureMap = useDesignStore((s) => s.setPressureMap);
    const removePressureMap = useDesignStore((s) => s.removePressureMap);
    const setPressureMapVisible = useDesignStore((s) => s.setPressureMapVisible);
    const patchPressureMapAlignment = useDesignStore((s) => s.patchPressureMapAlignment);

    const onPick = () => inputRef.current?.click();

    const onFiles = async (files: FileList | null) => {
        const file = files?.[0];
        if (!file) return;
        setBusy(true);
        setError(null);
        try {
            const footState = await loadPressureMapFromFile(file, side);
            setPressureMap(side, footState);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Import failed");
        } finally {
            setBusy(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    const sideLabel = side === "left" ? "Left" : "Right";

    return (
        <div className="space-y-2 rounded-md border border-border bg-background/40 p-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-foreground">Pressure map · {sideLabel}</p>
                {foot ? (
                    <span className="truncate text-[10px] text-muted-foreground">{foot.fileName ?? "Imported"}</span>
                ) : null}
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
                Import a plantar image (PNG/JPEG). Stored maps are downscaled to max {PRESSURE_MAP_MAX_EDGE_PX}px and
                about {Math.round(PRESSURE_MAP_MAX_DATA_URL_CHARS / 1000)} KB. Auto-align uses rotation only; a mirror
                is applied only when the image looks like the opposite foot.
            </p>
            {foot?.orientation?.oppositeFootMirror ? (
                <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100/90">
                    This image appears to be a{" "}
                    <strong className="font-medium">
                        {foot.orientation.detectedImageSide === "left" ? "left" : "right"}
                    </strong>{" "}
                    foot — mirrored to fit the {sideLabel.toLowerCase()} slot. Adjust alignment if it looks wrong.
                </p>
            ) : null}
            <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => void onFiles(e.target.files)}
            />
            <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={onPick}>
                    <ImagePlus className="mr-1 h-3.5 w-3.5" />
                    {foot ? "Replace" : "Import pressure map"}
                </Button>
                {foot ? (
                    <>
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            onClick={() => setPressureMapVisible(side, !foot.visible)}
                        >
                            {foot.visible ? "Hide" : "Show"}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[11px] text-destructive"
                            onClick={() => removePressureMap(side)}
                        >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            Remove
                        </Button>
                    </>
                ) : null}
            </div>
            {foot ? (
                <Button
                    size="sm"
                    variant="ghost"
                    className={cn("h-7 w-full justify-start text-[11px]", adjustOpen && "bg-muted/60")}
                    onClick={() => setAdjustOpen(!adjustOpen)}
                >
                    <RotateCw className="mr-1 h-3.5 w-3.5" />
                    Adjust alignment
                </Button>
            ) : null}
            {foot && adjustOpen ? (
                <AlignmentFields
                    side={side}
                    alignment={foot.alignment}
                    onPatch={(patch) => patchPressureMapAlignment(side, patch)}
                />
            ) : null}
            {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
        </div>
    );
}

function AlignmentFields({
    side,
    alignment,
    onPatch,
}: {
    side: Side;
    alignment: import("@/types").PressureMapAlignment;
    onPatch: (patch: Partial<import("@/types").PressureMapAlignment>) => void;
}) {
    void side;
    return (
        <div className="grid grid-cols-2 gap-2 text-[10px]">
            <label className="flex flex-col gap-0.5">
                Offset X (mm)
                <Input
                    type="number"
                    step={0.5}
                    className="h-7 text-[11px]"
                    value={alignment.offsetMm.x}
                    onChange={(e) =>
                        onPatch({ offsetMm: { ...alignment.offsetMm, x: Number(e.target.value) || 0 } })
                    }
                />
            </label>
            <label className="flex flex-col gap-0.5">
                Offset Y (mm)
                <Input
                    type="number"
                    step={0.5}
                    className="h-7 text-[11px]"
                    value={alignment.offsetMm.y}
                    onChange={(e) =>
                        onPatch({ offsetMm: { ...alignment.offsetMm, y: Number(e.target.value) || 0 } })
                    }
                />
            </label>
            <label className="flex flex-col gap-0.5">
                Scale
                <Input
                    type="number"
                    step={0.02}
                    min={0.1}
                    max={3}
                    className="h-7 text-[11px]"
                    value={alignment.scale}
                    onChange={(e) => onPatch({ scale: Math.max(0.05, Number(e.target.value) || 1) })}
                />
            </label>
            <label className="flex flex-col gap-0.5">
                Rotation (°)
                <Input
                    type="number"
                    step={1}
                    className="h-7 text-[11px]"
                    value={alignment.rotationDeg}
                    onChange={(e) => onPatch({ rotationDeg: Number(e.target.value) || 0 })}
                />
            </label>
        </div>
    );
}
