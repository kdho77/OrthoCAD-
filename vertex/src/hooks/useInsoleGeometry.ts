import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import type { GeometryQuality } from "@/lib/geometry/quality";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import {
    mergeCorrections,
    mergeElementPreviews,
    usePerformanceStore,
} from "@/stores/performance-store";
import type { DesignState, Side } from "@/types";
import type { TrimLine } from "@/lib/geometry/mesh-edit";

export interface UseInsoleGeometryOptions {
    side: Side;
    design: DesignState;
    trimLines: TrimLine[];
    vertexOverrides: Map<number, { x: number; y: number; z: number }>;
    applyEdits: boolean;
}

export interface InsoleGeometryState {
    geometry: BufferGeometry | null;
    building: boolean;
    quality: GeometryQuality;
}

/**
 * Async insole geometry hook — builds in a Web Worker with preview resolution
 * during interaction and full resolution when idle.
 */
export function useInsoleGeometry(options: UseInsoleGeometryOptions): InsoleGeometryState {
    const { side, design, trimLines, vertexOverrides, applyEdits } = options;
    const interacting = usePerformanceStore((s) => s.interacting);
    const correctionPreview = usePerformanceStore((s) => s.correctionPreview);
    const thicknessPreview = usePerformanceStore((s) => s.thicknessPreview);
    const elementPreviews = usePerformanceStore((s) => s.elementPreviews);

    const quality: GeometryQuality = interacting ? "preview" : "full";
    const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
    const [building, setBuilding] = useState(false);
    const mountedRef = useRef(true);
    const geomRef = useRef<BufferGeometry | null>(null);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        setBuilding(true);
        geometryEngine.cancelStaleBuilds();

        const sideElements = mergeElementPreviews(design.elements.filter((e) => e.side === side));
        const corrections = mergeCorrections(side, design.corrections[side]);
        const thicknessMm = thicknessPreview ?? design.thicknessMm;

        void geometryEngine
            .buildInsole({
                params: {
                    side,
                    lengthMm: INSOLE_LENGTH_MM,
                    widthMm: INSOLE_WIDTH_MM,
                    thicknessMm,
                    corrections,
                    elements: sideElements,
                },
                quality,
                trimLines: applyEdits ? trimLines : [],
                vertexOverrides: applyEdits ? vertexOverrides : new Map(),
            })
            .then((geo) => {
                if (cancelled || !mountedRef.current) {
                    geo.dispose();
                    return;
                }
                geomRef.current?.dispose();
                geomRef.current = geo;
                setGeometry(geo);
                setBuilding(false);
            })
            .catch(() => {
                if (!cancelled && mountedRef.current) setBuilding(false);
            });

        return () => {
            cancelled = true;
        };
    }, [
        side,
        design.thicknessMm,
        design.corrections,
        design.elements,
        trimLines,
        vertexOverrides,
        applyEdits,
        quality,
        interacting,
        correctionPreview,
        thicknessPreview,
        elementPreviews,
    ]);

    useEffect(
        () => () => {
            geomRef.current?.dispose();
        },
        [],
    );

    return { geometry, building, quality };
}
