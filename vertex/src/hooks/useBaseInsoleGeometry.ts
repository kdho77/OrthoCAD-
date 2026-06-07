import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import { baseModifierField, getDesignBase, loadBaseGeometry } from "@/lib/geometry/base-asset";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import { usePerformanceStore } from "@/stores/performance-store";
import type { DesignState, Side } from "@/types";

export interface BaseInsoleGeometryState {
    geometry: BufferGeometry | null;
    building: boolean;
    hasBase: boolean;
}

/**
 * Base + Modifier preview geometry for one side: loads the design's base
 * template once, then applies the current corrections / elements as a fast
 * vertical deformation whenever they change. Returns `hasBase: false` for pure
 * parametric designs so callers can fall back to the parametric mesh.
 */
export function useBaseInsoleGeometry(design: DesignState, side: Side): BaseInsoleGeometryState {
    const correctionPreview = usePerformanceStore((s) => s.correctionPreview);
    const thicknessPreview = usePerformanceStore((s) => s.thicknessPreview);
    const elementPreviews = usePerformanceStore((s) => s.elementPreviews);

    const base = getDesignBase(design);
    const assetId = base?.assetId ?? null;

    const baseGeoRef = useRef<BufferGeometry | null>(null);
    const outRef = useRef<BufferGeometry | null>(null);
    const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
    const [building, setBuilding] = useState(false);

    // Load the raw base mesh whenever the referenced asset changes. `assetId`
    // is the stable identity of the base; `base` is derived from it each render.
    // biome-ignore lint/correctness/useExhaustiveDependencies: assetId is the load key
    useEffect(() => {
        let cancelled = false;
        baseGeoRef.current?.dispose();
        baseGeoRef.current = null;
        const ref = getDesignBase(design);
        if (!ref) {
            setGeometry(null);
            return;
        }
        setBuilding(true);
        void loadBaseGeometry(ref)
            .then((geo) => {
                if (cancelled) {
                    geo?.dispose();
                    return;
                }
                baseGeoRef.current = geo;
            })
            .catch(() => {
                if (!cancelled) baseGeoRef.current = null;
            })
            .finally(() => {
                if (!cancelled) setBuilding(false);
            });
        return () => {
            cancelled = true;
        };
    }, [assetId]);

    // Re-apply modifiers whenever corrections / elements / thickness change.
    // biome-ignore lint/correctness/useExhaustiveDependencies: preview patches are intentional triggers
    useEffect(() => {
        const raw = baseGeoRef.current;
        if (!assetId || !raw) return;
        const thicknessMm = thicknessPreview ?? design.thicknessMm;
        const field = baseModifierField(design, side, thicknessMm);
        const modified = applyBaseModifiers(raw, field);
        outRef.current?.dispose();
        outRef.current = modified;
        setGeometry(modified);
    }, [
        assetId,
        side,
        design,
        design.thicknessMm,
        design.corrections,
        design.elements,
        correctionPreview,
        thicknessPreview,
        elementPreviews,
        building,
    ]);

    useEffect(
        () => () => {
            baseGeoRef.current?.dispose();
            outRef.current?.dispose();
        },
        [],
    );

    return { geometry, building, hasBase: Boolean(base) };
}
