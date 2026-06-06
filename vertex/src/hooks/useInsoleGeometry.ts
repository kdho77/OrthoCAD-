import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import * as THREE from "three";
import { getKernel } from "@/lib/chili3d";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import { applyTrimLines, applyVertexOverrides } from "@/lib/geometry/mesh-edit";
import type { GeometryQuality } from "@/lib/geometry/quality";
import { segmentsForQuality } from "@/lib/geometry/quality";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import {
    mergeCorrections,
    mergeElementPreviews,
    usePerformanceStore,
} from "@/stores/performance-store";
import { useKernelStore } from "@/stores/kernel-store";
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

function applyMeshEdits(
    geometry: BufferGeometry,
    trimLines: TrimLine[],
    vertexOverrides: Map<number, { x: number; y: number; z: number }>,
    applyEdits: boolean,
): BufferGeometry {
    if (!applyEdits) return geometry;
    let g = geometry;
    if (trimLines.length > 0) g = applyTrimLines(g, trimLines);
    if (vertexOverrides.size > 0) {
        const vecMap = new Map<number, THREE.Vector3>();
        for (const [idx, v] of vertexOverrides) vecMap.set(idx, new THREE.Vector3(v.x, v.y, v.z));
        g = applyVertexOverrides(g, vecMap);
    }
    return g;
}

/**
 * Async insole geometry hook — Web Worker builds for procedural preview paths;
 * OpenCascade WASM builds on the main thread when idle for watertight solids.
 */
export function useInsoleGeometry(options: UseInsoleGeometryOptions): InsoleGeometryState {
    const { side, design, trimLines, vertexOverrides, applyEdits } = options;
    const interacting = usePerformanceStore((s) => s.interacting);
    const correctionPreview = usePerformanceStore((s) => s.correctionPreview);
    const thicknessPreview = usePerformanceStore((s) => s.thicknessPreview);
    const elementPreviews = usePerformanceStore((s) => s.elementPreviews);
    const kernelVersion = useKernelStore((s) => s.version);

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
        const segments = segmentsForQuality(quality);
        const params = {
            side,
            lengthMm: INSOLE_LENGTH_MM,
            widthMm: INSOLE_WIDTH_MM,
            thicknessMm,
            corrections,
            elements: sideElements,
            ...segments,
        };

        const useOcct = getKernel().name === "opencascade-wasm";
        const buildPromise =
            useOcct && !interacting
                ? Promise.resolve(
                      applyMeshEdits(getKernel().buildInsole(params), trimLines, vertexOverrides, applyEdits),
                  )
                : geometryEngine.buildInsole({
                      params,
                      quality,
                      trimLines: applyEdits ? trimLines : [],
                      vertexOverrides: applyEdits ? vertexOverrides : new Map(),
                  });

        void buildPromise
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
        kernelVersion,
    ]);

    useEffect(
        () => () => {
            geomRef.current?.dispose();
        },
        [],
    );

    return { geometry, building, quality };
}
