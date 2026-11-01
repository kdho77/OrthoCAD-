// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    EXPORT_FILE_TYPE_PURPOSE,
    type ExportFileTypeChoice,
    useExportFileTypeStore,
} from "@/features/exports/export-file-type-store";
import { cn } from "@/lib/utils";

const CHOICES: ExportFileTypeChoice[] = ["gcode", "stl", "3mf"];

const LABEL: Record<ExportFileTypeChoice, string> = {
    gcode: "G-code",
    stl: "STL",
    "3mf": "3MF",
};

export function ExportFileTypePicker({ pulse }: { pulse?: boolean }) {
    const choice = useExportFileTypeStore((s) => s.exportFileType);
    const setChoice = useExportFileTypeStore((s) => s.setExportFileType);

    return (
        <div className="space-y-2" data-testid="export-file-type-picker">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                File type
            </div>
            <div
                className={cn(
                    "grid grid-cols-3 gap-1 rounded-md border p-0.5",
                    pulse ? "animate-pulse border-amber-400" : "border-border",
                )}
            >
                {CHOICES.map((id) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setChoice(id)}
                        className={cn(
                            "rounded-sm px-1 py-2 text-[11px] font-medium",
                            choice === id
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted/60",
                        )}
                    >
                        {LABEL[id]}
                    </button>
                ))}
            </div>
            <p className="min-h-[2rem] text-[11px] leading-snug text-muted-foreground">
                {choice ? EXPORT_FILE_TYPE_PURPOSE[choice] : "Pick a file type to export."}
            </p>
        </div>
    );
}
