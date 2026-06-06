import { CheckCircle2, Download, FileCode2, Lock, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { exportDesign } from "@/features/exports/export-service";
import { useManifoldAnalysis } from "@/hooks/useManifoldAnalysis";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { mergeCorrections, mergeElementPreviews } from "@/stores/performance-store";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import { cn } from "@/lib/utils";
import type { BufferGeometry } from "three";
import type { Side } from "@/types";

export function ExportPanel() {
    const { user, license } = useAuthStore();
    const { design } = useDesignStore();
    const [status, setStatus] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [side, setSide] = useState<Side>("left");
    const [geometry, setGeometry] = useState<BufferGeometry | null>(null);

    const stlCheck = canExport(user, license, "stl");

    // Build full-quality geometry in worker when design changes (debounced by effect cleanup).
    useEffect(() => {
        let cancelled = false;

        void geometryEngine
            .buildInsole({
                params: {
                    side,
                    lengthMm: INSOLE_LENGTH_MM,
                    widthMm: INSOLE_WIDTH_MM,
                    thicknessMm: design.thicknessMm,
                    corrections: mergeCorrections(side, design.corrections[side]),
                    elements: mergeElementPreviews(design.elements.filter((e) => e.side === side)),
                },
                quality: "full",
            })
            .then((g) => {
                if (cancelled) {
                    g.dispose();
                    return;
                }
                setGeometry((prev) => {
                    prev?.dispose();
                    return g;
                });
            });

        return () => {
            cancelled = true;
        };
    }, [side, design.thicknessMm, design.corrections, design.elements]);

    useEffect(() => () => geometry?.dispose(), [geometry]);

    const manifold = useManifoldAnalysis(geometry, 400);

    const handleStl = async () => {
        setBusy(true);
        try {
            const res = await exportDesign("stl", side);
            setStatus(res.ok ? `Exported ${res.filename} (-${TOKEN_COST.stl} token)` : (res.reason ?? "Export failed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="rounded-md border border-border bg-background/50 p-2 text-xs">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Token balance</span>
                    <span className="tabular-nums">{user?.tokenBalance ?? 0}</span>
                </div>
                <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">License</span>
                    <span>{license?.status ?? "none"}</span>
                </div>
            </div>

            <div className="flex gap-1">
                {(["left", "right"] as Side[]).map((s) => (
                    <Button key={s} size="sm" variant={side === s ? "default" : "secondary"} className="h-8 flex-1" onClick={() => setSide(s)}>
                        {s} insole
                    </Button>
                ))}
            </div>

            <div className={cn("flex items-center justify-between rounded-md border px-2 py-1.5 text-xs", manifold.isWatertight ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400")}>
                <span className="flex items-center gap-1.5">
                    {manifold.isWatertight ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
                    {geometry ? (manifold.isWatertight ? "Watertight solid" : `${manifold.openEdges} open edges`) : "Analyzing…"}
                </span>
                <span className="tabular-nums text-muted-foreground">
                    {manifold.triangleCount > 0 ? `${manifold.triangleCount.toLocaleString()} tris` : "—"}
                </span>
            </div>

            <Button className="w-full" disabled={!stlCheck.ok || busy} onClick={handleStl}>
                {stlCheck.ok ? <Download className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                Export STL · {TOKEN_COST.stl} token
            </Button>
            {!stlCheck.ok ? <p className="text-xs text-amber-400">{stlCheck.reason}</p> : null}

            <div className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-xs text-muted-foreground">
                <FileCode2 className="h-4 w-4" />
                G-code (slicing / CNC) is in the <span className="text-foreground">Printing</span> tab · {TOKEN_COST.gcode} tokens
            </div>

            {status ? <p className="rounded-md bg-muted px-2 py-1.5 text-xs">{status}</p> : null}
        </div>
    );
}
