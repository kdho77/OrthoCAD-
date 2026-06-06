import { useEffect, useState } from "react";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import type { SolidValidation } from "@/lib/geometry/repair";
import { useKernelStore } from "@/stores/kernel-store";
import type { DesignState, Side } from "@/types";

const EMPTY: SolidValidation = {
    triangleCount: 0,
    vertexCount: 0,
    openEdges: 0,
    nonManifoldEdges: 0,
    isWatertight: false,
    occtClosed: false,
};

/** Debounced production solid validation — OCCT topology when WASM is loaded. */
export function useSolidValidation(design: DesignState, side: Side, debounceMs = 400): SolidValidation {
    const [report, setReport] = useState<SolidValidation>(EMPTY);
    const kernelVersion = useKernelStore((s) => s.version);
    const kernelLoadState = useKernelStore((s) => s.loadState);

    // Re-validate when the WASM kernel finishes loading (design object alone does not change).
    // biome-ignore lint/correctness/useExhaustiveDependencies: kernelVersion/kernelLoadState trigger OCCT validation
    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            void geometryEngine
                .validateProductionSolid(insoleParamsFromDesign(design, side, "full"))
                .then((r) => {
                    if (!cancelled) setReport(r);
                })
                .catch(() => {
                    if (!cancelled) setReport(EMPTY);
                });
        }, debounceMs);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [design, side, debounceMs, kernelVersion, kernelLoadState]);

    return report;
}
