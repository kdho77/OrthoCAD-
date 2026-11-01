import { useEffect, useState } from "react";
import { buildValidatedExportGeometry } from "@/lib/geometry/export-geometry";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import type { SolidValidation } from "@/lib/geometry/geometry-kernel";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useDesignStore } from "@/stores/design-store";
import { useKernelStore } from "@/stores/kernel-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { DesignState, Side } from "@/types";

const EMPTY: ExportSolidValidation = {
    triangleCount: 0,
    vertexCount: 0,
    openEdges: 0,
    nonManifoldEdges: 0,
    isWatertight: false,
    solidClosed: false,
};

export interface ExportSolidValidation extends SolidValidation {
    error?: string;
}

/** Validate the same mesh that STL/3MF will serialize, never a parametric substitute. */
export function useSolidValidation(design: DesignState, side: Side, debounceMs = 400): ExportSolidValidation {
    const [report, setReport] = useState<ExportSolidValidation>(EMPTY);
    const kernelVersion = useKernelStore((s) => s.version);
    const kernelLoadState = useKernelStore((s) => s.loadState);

    const viewer = useDesignStore((s) => s.viewer);
    const pattern = useBottomPatternStore((s) => s.patterns[side]);
    const bottomEdit = useMeshEditStore((s) => s.bottomPatternEdit);
    const trimEdit = useMeshEditStore((s) => s.trimlineEdit);

    // kernelVersion/kernelLoadState stay in the dependency list so a future kernel swap re-validates.
    // biome-ignore lint/correctness/useExhaustiveDependencies: kernel store identity is an explicit trigger
    useEffect(() => {
        let cancelled = false;
        setReport(EMPTY);
        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const geometry = await buildValidatedExportGeometry(side);
                    try {
                        const mesh = await geometryEngine.analyzeManifold(geometry);
                        if (!cancelled) setReport({ ...mesh, solidClosed: mesh.isWatertight });
                    } finally {
                        geometry.dispose();
                    }
                } catch (error) {
                    if (!cancelled)
                        setReport({
                            ...EMPTY,
                            error: error instanceof Error ? error.message : "Export validation failed",
                        });
                }
            })();
        }, debounceMs);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [design, side, debounceMs, kernelVersion, kernelLoadState, viewer, pattern, bottomEdit, trimEdit]);

    return report;
}
