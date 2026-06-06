import { Box, Coins, Cpu, ShieldCheck } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";
import { useKernelStore } from "@/stores/kernel-store";
import { cn } from "@/lib/utils";

// Bottom status bar — mirrors the dense, professional CAD layout from the
// reference screenshots.
export function StatusBar() {
    const method = useDesignStore((s) => s.design.method);
    const elements = useDesignStore((s) => s.design.elements.length);
    const activeDesignId = useClientStore((s) => s.activeDesignId);
    const designs = useClientStore((s) => s.designs);
    const { user, license } = useAuthStore();
    const kernelName = useKernelStore((s) => s.name);
    const kernelLoadState = useKernelStore((s) => s.loadState);
    const record = designs.find((d) => d.id === activeDesignId);

    return (
        <footer className="flex h-7 items-center justify-between border-t border-border bg-panel px-3 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
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
