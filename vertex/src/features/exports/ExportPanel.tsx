import { Boxes, CheckCircle2, Download, FileCode2, Loader2, Lock, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { exportDesign } from "@/features/exports/export-service";
import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { useSolidValidation } from "@/hooks/useSolidValidation";
import { isOcctKernelActive } from "@/lib/geometry/kernel-build";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import { useKernelStore } from "@/stores/kernel-store";
import type { Side } from "@/types";

type ExportKind = "stl" | "glb" | null;

export function ExportPanel() {
    const { user, license } = useAuthStore();
    const { design } = useDesignStore();
    const kernelName = useKernelStore((s) => s.name);
    const [status, setStatus] = useState<string | null>(null);
    const [busyKind, setBusyKind] = useState<ExportKind>(null);
    const [side, setSide] = useState<Side>("left");

    const stlCheck = canExport(user, license, "stl");
    const glbCheck = canExport(user, license, "glb");
    const validation = useSolidValidation(design, side);
    const occtActive = isOcctKernelActive();
    const busy = busyKind !== null;

    const handleStl = async () => {
        setBusyKind("stl");
        try {
            const res = await exportDesign("stl", side);
            setStatus(
                res.ok
                    ? `Exported ${res.filename} (-${TOKEN_COST.stl} token)`
                    : (res.reason ?? "Export failed"),
            );
        } finally {
            setBusyKind(null);
        }
    };

    const handleGlb = async () => {
        setBusyKind("glb");
        setStatus("Generating GLB…");
        try {
            const res = await exportDesign("glb", side);
            setStatus(
                res.ok
                    ? `Exported ${res.filename} (-${TOKEN_COST.glb} token)`
                    : (res.reason ?? "GLB export failed"),
            );
        } finally {
            setBusyKind(null);
        }
    };

    const watertightLabel = validation.isWatertight
        ? occtActive && validation.occtClosed
            ? "OCCT watertight solid"
            : "Watertight solid"
        : validation.triangleCount > 0
          ? `${validation.openEdges} open edges`
          : "Analyzing…";

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
                <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">Kernel</span>
                    <span className="capitalize">{kernelName.replace(/-/g, " ")}</span>
                </div>
            </div>

            <div className="flex gap-1">
                {(["left", "right"] as Side[]).map((s) => (
                    <Button
                        key={s}
                        size="sm"
                        variant={side === s ? "default" : "secondary"}
                        className="h-8 flex-1"
                        onClick={() => setSide(s)}
                    >
                        {s} insole
                    </Button>
                ))}
            </div>

            <div
                className={cn(
                    "flex items-center justify-between rounded-md border px-2 py-1.5 text-xs",
                    validation.isWatertight
                        ? "border-emerald-500/40 text-emerald-400"
                        : "border-amber-500/40 text-amber-400",
                )}
            >
                <span className="flex items-center gap-1.5">
                    {validation.isWatertight ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                        <TriangleAlert className="h-3.5 w-3.5" />
                    )}
                    {watertightLabel}
                </span>
                <span className="tabular-nums text-muted-foreground">
                    {validation.triangleCount > 0 ? `${validation.triangleCount.toLocaleString()} tris` : "—"}
                </span>
            </div>

            <Button className="w-full" disabled={!stlCheck.ok || busy} onClick={handleStl}>
                {busyKind === "stl" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : stlCheck.ok ? (
                    <Download className="h-4 w-4" />
                ) : (
                    <Lock className="h-4 w-4" />
                )}
                {busyKind === "stl" ? "Exporting STL…" : `Export STL · ${TOKEN_COST.stl} token`}
            </Button>
            {!stlCheck.ok ? <p className="text-xs text-amber-400">{stlCheck.reason}</p> : null}

            <Button
                variant="secondary"
                className="w-full"
                disabled={!glbCheck.ok || busy}
                onClick={handleGlb}
                title="Download a watertight, print-ready GLB (top + tapered side walls + bottom) of the current trimline."
            >
                {busyKind === "glb" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : glbCheck.ok ? (
                    <Boxes className="h-4 w-4" />
                ) : (
                    <Lock className="h-4 w-4" />
                )}
                {busyKind === "glb"
                    ? "Generating GLB…"
                    : TOKEN_COST.glb > 0
                      ? `Download GLB · ${TOKEN_COST.glb} token`
                      : "Download GLB"}
            </Button>
            {!glbCheck.ok ? <p className="text-xs text-amber-400">{glbCheck.reason}</p> : null}

            <div className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-xs text-muted-foreground">
                <FileCode2 className="h-4 w-4" />
                G-code (slicing / CNC) is in the <span className="text-foreground">Printing</span> tab ·{" "}
                {TOKEN_COST.gcode} tokens
            </div>

            {status ? <p className="rounded-md bg-muted px-2 py-1.5 text-xs">{status}</p> : null}
        </div>
    );
}
