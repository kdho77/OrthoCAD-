import { Box, Coins, Cpu, Loader2, ShieldAlert, ShieldCheck, WifiOff, X } from "lucide-react";
import { isOfflineStockPlaceholder } from "@/lib/geometry/base-asset";
import { isApiConfigured } from "@/lib/trpc";
import { useAuthStore } from "@/stores/auth-store";
import { useClientStore } from "@/stores/client-store";
import { ensureDefaultStockBaseResolved, useDesignStore } from "@/stores/design-store";
import { useKernelStore } from "@/stores/kernel-store";
import { cn } from "@/lib/utils";

// Bottom status bar — mirrors the dense, professional CAD layout from the
// reference screenshots.
export function StatusBar() {
    const design = useDesignStore((s) => s.design);
    const method = design.method;
    const elements = design.elements.length;
    const stockBaseError = useDesignStore((s) => s.stockBaseError);
    const stockBaseLoading = useDesignStore((s) => s.stockBaseLoading);
    const clearStockBaseError = useDesignStore((s) => s.clearStockBaseError);
    const activeDesignId = useClientStore((s) => s.activeDesignId);
    const designs = useClientStore((s) => s.designs);
    const { user, license } = useAuthStore();
    const kernelName = useKernelStore((s) => s.name);
    const kernelLoadState = useKernelStore((s) => s.loadState);
    const record = designs.find((d) => d.id === activeDesignId);

    const stockBase = design.paired?.rightBase ?? design.base;
    const usingOfflinePlaceholder =
        !isApiConfigured() && stockBase?.source === "stock" && isOfflineStockPlaceholder(stockBase);

    return (
        <footer className="flex h-7 items-center justify-between border-t border-border bg-panel px-3 text-[11px] text-muted-foreground">
            <div className="flex min-w-0 flex-1 items-center gap-4">
                {stockBaseError ? (
                    <span
                        className="flex min-w-0 max-w-[min(70vw,640px)] items-center gap-1.5 rounded border border-red-500/40 bg-red-950/50 px-2 py-0.5 text-red-300"
                        role="alert"
                    >
                        <ShieldAlert className="h-3 w-3 shrink-0" />
                        <span className="truncate font-medium">{stockBaseError}</span>
                        <button
                            type="button"
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:bg-red-900/60"
                            onClick={() => {
                                clearStockBaseError();
                                ensureDefaultStockBaseResolved();
                            }}
                        >
                            Retry
                        </button>
                        <button
                            type="button"
                            className="shrink-0 rounded p-0.5 hover:bg-red-900/60"
                            aria-label="Dismiss stock base error"
                            onClick={() => clearStockBaseError()}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ) : stockBaseLoading ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-cyan-400/90">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading stock base from server…
                    </span>
                ) : usingOfflinePlaceholder ? (
                    <span
                        className="flex shrink-0 items-center gap-1.5 rounded border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-amber-200"
                        role="status"
                    >
                        <WifiOff className="h-3 w-3" />
                        Offline dev placeholder base
                    </span>
                ) : null}
                <span className="flex shrink-0 items-center gap-1">
                    <Box className="h-3 w-3" /> {record?.name ?? "Unsaved design"}
                </span>
                <span className="capitalize">{method.replace("_", " ")}</span>
                <span>{elements} element{elements === 1 ? "" : "s"}</span>
            </div>
            <div className="flex items-center gap-4">
                <span className={cn("flex items-center gap-1", license?.status === "active" ? "text-emerald-400" : "text-amber-400")}>
                    <ShieldCheck className="h-3 w-3" /> {license?.status ?? "no license"}
                </span>
                <span className="flex items-center gap-1 text-cyan-400/90">
                    <Cpu className="h-3 w-3" />
                    {kernelLoadState === "loading" ? "OCCT loading…" : kernelName.replace(/-/g, " ")}
                </span>
                <span className="flex items-center gap-1">
                    <Coins className="h-3 w-3 text-primary" /> {user?.tokenBalance ?? 0} tokens
                </span>
                <span>{user?.email}</span>
            </div>
        </footer>
    );
}
