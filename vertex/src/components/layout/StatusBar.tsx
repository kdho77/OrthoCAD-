import { Coins } from "lucide-react";
import { HelpPopover } from "@/components/ui/help-popover";
import { showSuperAdminLink } from "@/features/admin/admin-nav";
import { isOfflineStockPlaceholder } from "@/lib/geometry/base-asset";
import { isApiConfigured } from "@/lib/trpc";
import { useAuthStore } from "@/stores/auth-store";
import { useClientStore } from "@/stores/client-store";
import { retryStockBaseResolution, useDesignStore } from "@/stores/design-store";
import { useKernelStore } from "@/stores/kernel-store";

export function StatusBar() {
    const design = useDesignStore((s) => s.design);
    const stockBaseError = useDesignStore((s) => s.stockBaseError);
    const stockBaseLoading = useDesignStore((s) => s.stockBaseLoading);
    const clearStockBaseError = useDesignStore((s) => s.clearStockBaseError);
    const activeDesignId = useClientStore((s) => s.activeDesignId);
    const designs = useClientStore((s) => s.designs);
    const { user } = useAuthStore();
    const kernelName = useKernelStore((s) => s.name);
    const kernelLoadState = useKernelStore((s) => s.loadState);
    const record = designs.find((d) => d.id === activeDesignId);
    const superAdmin = showSuperAdminLink(user?.role);

    const stockBase = design.paired?.rightBase ?? design.base;
    const usingOfflinePlaceholder =
        !isApiConfigured() && stockBase?.source === "stock" && isOfflineStockPlaceholder(stockBase);

    const savedLabel = record?.name ? `Saved · ${record.name}` : "Saved";

    return (
        <footer className="flex h-7 items-center justify-between border-t border-border bg-panel px-3 text-[11px] text-muted-foreground">
            <div className="flex min-w-0 flex-1 items-center gap-3">
                {superAdmin && stockBaseError ? (
                    <span className="truncate text-red-300" role="alert">
                        {stockBaseError}
                        <button
                            type="button"
                            className="ml-2 underline"
                            onClick={() => {
                                clearStockBaseError();
                                retryStockBaseResolution();
                            }}
                        >
                            Retry
                        </button>
                    </span>
                ) : null}
                {superAdmin && stockBaseLoading ? (
                    <span className="text-cyan-400/90">Base loading…</span>
                ) : null}
                {superAdmin && usingOfflinePlaceholder ? (
                    <span className="text-amber-200">Offline placeholder base</span>
                ) : null}
                <span data-testid="status-saved">{savedLabel}</span>
            </div>
            <div className="flex items-center gap-3">
                <HelpPopover label="Keyboard shortcuts">
                    <p>
                        <strong className="text-foreground">Shortcuts</strong> — Ctrl/Cmd+S save, Ctrl/Cmd+E
                        export STL, Ctrl/Cmd+P AI Rx, T transparent, Esc cancel tool.
                    </p>
                    <p className="mt-1">
                        <strong className="text-foreground">Kernel</strong> —{" "}
                        {kernelLoadState === "loading" ? "loading…" : kernelName.replace(/-/g, " ")}
                    </p>
                </HelpPopover>
                <span className="flex items-center gap-1 tabular-nums">
                    <Coins className="h-3 w-3 text-primary" /> {user?.tokenBalance ?? 0} tokens
                </span>
            </div>
        </footer>
    );
}
