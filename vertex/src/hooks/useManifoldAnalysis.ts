import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import type { ManifoldReport } from "@/lib/geometry/manifold";
import { debounce } from "@/lib/performance/throttle";

const EMPTY_REPORT: ManifoldReport = {
    triangleCount: 0,
    vertexCount: 0,
    openEdges: 0,
    nonManifoldEdges: 0,
    isWatertight: false,
};

/**
 * Debounced manifold analysis offloaded to the geometry worker.
 * Avoids blocking the main thread on every slider tick.
 */
export function useManifoldAnalysis(geometry: BufferGeometry | null, debounceMs = 300): ManifoldReport {
    const [report, setReport] = useState<ManifoldReport>(EMPTY_REPORT);
    const debouncedRef = useRef<(geo: BufferGeometry) => void>();

    if (!debouncedRef.current) {
        debouncedRef.current = debounce((geo: BufferGeometry) => {
            void geometryEngine
                .analyzeManifold(geo)
                .then(setReport)
                .catch(() => setReport(EMPTY_REPORT));
        }, debounceMs);
    }

    useEffect(() => {
        if (!geometry) {
            setReport(EMPTY_REPORT);
            return;
        }
        const clone = geometry.clone();
        debouncedRef.current?.(clone);
        return () => clone.dispose();
    }, [geometry]);

    return report;
}
