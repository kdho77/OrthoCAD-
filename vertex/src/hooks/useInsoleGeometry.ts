import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import type { TrimLine } from "@/lib/geometry/mesh-edit";
import type { GeometryQuality } from "@/lib/geometry/quality";
import type { TrimlineCurve } from "@/lib/geometry/trimline";
import { useKernelStore } from "@/stores/kernel-store";
import { mergeCorrections, mergeElementPreviews, usePerformanceStore } from "@/stores/performance-store";
import type { DesignState, Side } from "@/types";

export interface UseInsoleGeometryOptions {
    side: Side;
    design: DesignState;
    trimLines: TrimLine[];
    trimline?: TrimlineCurve | null;
    vertexOverrides: Map<number, { x: number; y: number; z: number }>;
    applyEdits: boolean;
}

export interface InsoleGeometryState {
    geometry: BufferGeometry | null;
    building: boolean;
    quality: GeometryQuality;
}

/**
 * Async insole geometry — worker preview while interacting, OCCT kernel when idle.
 */
export function useInsoleGeometry(options: UseInsoleGeometryOptions): InsoleGeometryState {
    const { side, design, trimLines, trimline, vertexOverrides, applyEdits } = options;
    const interacting = usePerformanceStore((s) => s.interacting);
    const correctionPreview = usePerformanceStore((s) => s.correctionPreview);
    const thicknessPreview = usePerformanceStore((s) => s.thicknessPreview);
    const elementPreviews = usePerformanceStore((s) => s.elementPreviews);
    const kernelVersion = useKernelStore((s) => s.version);
    const kernelLoadState = useKernelStore((s) => s.loadState);

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

    // Preview patches and kernel readiness are intentional effect triggers (not captured as direct reads).
    // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild when OCCT loads or live previews change
    useEffect(() => {
        let cancelled = false;
        setBuilding(true);
        geometryEngine.cancelStaleBuilds();

        const thicknessMm =
            thicknessPreview ??
            (design.paired
                ? side === "left"
                    ? design.paired.leftThicknessMm
                    : design.paired.rightThicknessMm
                : design.thicknessMm);
        const params = {
            ...insoleParamsFromDesign(design, side, quality),
            corrections: mergeCorrections(side, design.corrections[side]),
            elements: mergeElementPreviews(design.elements.filter((e) => e.side === side)),
            trimline: trimline ?? null,
        };

        void geometryEngine
            .buildInsole({
                params,
                quality,
                trimLines: applyEdits ? trimLines : [],
                vertexOverrides: applyEdits ? vertexOverrides : new Map(),
                preferKernel: !interacting && kernelLoadState === "ready",
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
        design.method,
        design.sizeSystem,
        design.usMenSize,
        design.ukSize,
        design.footLengthMm,
        design.corrections,
        design.elements,
        trimLines,
        trimline,
        vertexOverrides,
        applyEdits,
        quality,
        interacting,
        correctionPreview,
        thicknessPreview,
        elementPreviews,
        kernelVersion,
        kernelLoadState,
    ]);

    useEffect(
        () => () => {
            geomRef.current?.dispose();
        },
        [],
    );

    return { geometry, building, quality };
}
