// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useState } from "react";
import { ExportPanel } from "@/features/exports/ExportPanel";
import { generateHybridGcode } from "@/features/exports/export-service";
import { PRINTER_PRESETS } from "@/lib/kiri/presets";
import { getAfoState } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";

/** STL through existing hard gates plus the send-to-VertexSlice manufacturing path. */
export function AfoExportPanel() {
    const afo = useDesignStore((s) => s.design.afo) ?? getAfoState();
    const exportSide = useDesignStore((s) => s.exportSide);
    const [msg, setMsg] = useState<string | null>(null);

    const sendSlice = async () => {
        setMsg(null);
        const preset = PRINTER_PRESETS[0];
        if (!preset) {
            setMsg("No printer preset available.");
            return;
        }
        const res = await generateHybridGcode(exportSide, preset, { type: "straight" });
        setMsg(res.ok ? `Sent to VertexSlice (${res.filename ?? "ok"})` : (res.reason ?? "Send failed"));
    };

    return (
        <div className="space-y-3 text-xs">
            <p className="text-muted-foreground">
                STL uses the existing watertight solid gates. Send-to-VertexSlice reuses the manufacturing
                hybrid path.
            </p>
            {!afo.shellReady ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-amber-100">
                    Generate the shell on Print before exporting.
                </p>
            ) : null}
            <ExportPanel />
            <button
                type="button"
                onClick={() => void sendSlice()}
                className="h-8 w-full rounded-md border border-border bg-background text-[12px] font-medium"
            >
                Send to VertexSlice
            </button>
            {msg ? <p className="text-muted-foreground">{msg}</p> : null}
        </div>
    );
}
