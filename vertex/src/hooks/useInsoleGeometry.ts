import { useEffect, useMemo, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import {
    buildInsoleAsync,
    bumpGeometryGeneration,
    getGeometryGeneration,
} from "@/lib/geometry/geometry-pool";
import type { InsoleParams } from "@/lib/geometry/insole";
import { usePerformanceStore } from "@/stores/performance-store";

interface UseInsoleGeometryOptions {
    params: InsoleParams;
    preview: boolean;
}

interface UseInsoleGeometryResult {
    geometry: BufferGeometry | null;
    building: boolean;
}

const FULL_DEBOUNCE_MS = 120;

/**
 * Async insole mesh for the R3F viewer. Low-res preview while interacting;
 * debounced full OCCT/procedural rebuild when idle.
 */
export function useInsoleGeometry({ params, preview }: UseInsoleGeometryOptions): UseInsoleGeometryResult {
    const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
    const [building, setBuilding] = useState(false);
    const paramsRef = useRef(params);
    paramsRef.current = params;
    const generationRef = useRef(getGeometryGeneration());
    const buildKey = useMemo(() => `${preview}:${JSON.stringify(params)}`, [preview, params]);

    useEffect(() => {
        generationRef.current = bumpGeometryGeneration();
        const generation = generationRef.current;
        let cancelled = false;
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        const run = async (quality: "preview" | "full") => {
            setBuilding(true);
            try {
                const result = await buildInsoleAsync({
                    params: paramsRef.current,
                    quality,
                    generation,
                });
                if (cancelled || generation !== generationRef.current) {
                    result.geometry.dispose();
                    return;
                }
                setGeometry((prev) => {
                    prev?.dispose();
                    return result.geometry;
                });
                if (quality === "full") {
                    usePerformanceStore.getState().notifyGeometryBuilt();
                }
            } catch (error) {
                if (error instanceof Error && error.message === "superseded") return;
                console.warn("[useInsoleGeometry] build failed:", error);
            } finally {
                if (!cancelled) setBuilding(false);
            }
        };

        const isPreview = buildKey.startsWith("true:");
        if (isPreview) {
            void run("preview");
        } else {
            debounceTimer = setTimeout(() => void run("full"), FULL_DEBOUNCE_MS);
        }

        return () => {
            cancelled = true;
            if (debounceTimer) clearTimeout(debounceTimer);
        };
    }, [buildKey]);

    return { geometry, building };
}
