// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Loader2 } from "lucide-react";
import { useKernelStore } from "@/stores/kernel-store";

/** Banner shown while the OpenCascade WASM kernel is loading. */
export function KernelLoadingBanner() {
    const loadState = useKernelStore((s) => s.loadState);
    const loadError = useKernelStore((s) => s.loadError);

    if (loadState === "ready" || loadState === "idle") return null;

    if (loadState === "failed") {
        return (
            <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-center text-xs text-amber-200">
                OCCT kernel unavailable — using procedural fallback
                {loadError ? `: ${loadError}` : ""}
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center gap-2 border-b border-primary/20 bg-primary/10 px-3 py-1.5 text-xs text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading OpenCascade geometry kernel…
        </div>
    );
}
