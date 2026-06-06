import { useEffect, useMemo, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import { buildInsoleAsync, bumpGeometryGeneration } from "@/lib/geometry/geometry-pool";
import type { InsoleParams } from "@/lib/geometry/insole";
import type { SolidValidation } from "@/lib/geometry/repair";
import { usePerformanceStore } from "@/stores/performance-store";

export interface InsoleSolidState {
    geometry: BufferGeometry | null;
    manifold: SolidValidation | null;
    building: boolean;
}

const SOLID_DEBOUNCE_MS = 280;

/** Debounced worker build for export-panel watertight validation (off main thread). */
export function useInsoleSolid(params: InsoleParams): InsoleSolidState {
    const [state, setState] = useState<InsoleSolidState>({
        geometry: null,
        manifold: null,
        building: false,
    });
    const paramsRef = useRef(params);
    paramsRef.current = params;
    const generationRef = useRef(0);
    const geometryGeneration = usePerformanceStore((s) => s.geometryGeneration);
    const buildKey = useMemo(
        () => `${geometryGeneration}:${JSON.stringify(params)}`,
        [geometryGeneration, params],
    );

    useEffect(() => {
        void buildKey;
        generationRef.current = bumpGeometryGeneration();
        const generation = generationRef.current;
        let cancelled = false;

        const timer = setTimeout(() => {
            void (async () => {
                setState((s) => ({ ...s, building: true }));
                try {
                    const result = await buildInsoleAsync({
                        params: paramsRef.current,
                        quality: "full",
                        withManifold: true,
                        generation,
                    });
                    if (cancelled || generation !== generationRef.current) {
                        result.geometry.dispose();
                        return;
                    }
                    setState((prev) => {
                        prev.geometry?.dispose();
                        return {
                            geometry: result.geometry,
                            manifold: result.manifold ?? null,
                            building: false,
                        };
                    });
                } catch (error) {
                    if (error instanceof Error && error.message === "superseded") return;
                    if (!cancelled) setState((s) => ({ ...s, building: false }));
                }
            })();
        }, SOLID_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [buildKey]);

    useEffect(
        () => () => {
            setState((prev) => {
                prev.geometry?.dispose();
                return { geometry: null, manifold: null, building: false };
            });
        },
        [],
    );

    return state;
}
