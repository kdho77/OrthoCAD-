import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import {
    baseModifierField,
    getBaseCacheKey,
    getDesignBase,
    isLocalPlaceholderGlbPath,
    isStockDesignBase,
    loadBaseGeometry,
    stockBaseNeedsServerResolution,
    StockGlbLoadError,
} from "@/lib/geometry/base-asset";
import { isApiConfigured } from "@/lib/trpc";
import { useDesignStore } from "@/stores/design-store";
import { stockDebug, stockResolveLog } from "@/lib/geometry/stock-debug";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import { computeBaseBounds } from "@/lib/geometry/base-bounds";
import { clipGeometryToOutline, extractMeshOutline, getDesignTrimline } from "@/lib/geometry/trimline";
import { useBaseBoundsStore } from "@/stores/base-bounds-store";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
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
    const interacting = usePerformanceStore((s) => s.interacting);
    const stockBaseLoading = useDesignStore((s) => s.stockBaseLoading);
    const stockBaseResolutionState = useDesignStore((s) => s.stockBaseResolutionState);

    const base = getDesignBase(design, side);
    const assetId = base?.assetId ?? null;
    const isMirroredForLoad = !!base?.mirrored;
    const baseUrl = base?.url ?? null;

    const baseGeoRef = useRef<BufferGeometry | null>(null);
    const outRef = useRef<BufferGeometry | null>(null);
    const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
    const [building, setBuilding] = useState(false);

    // Load the raw base mesh whenever the referenced asset (or its mirrored variant) changes.
    // Include url so stock bases upgrade from the sync stub to the server row re-trigger load.
    const loadKey = assetId ? `${assetId}:${isMirroredForLoad ? "m" : "p"}:${baseUrl ?? ""}` : null;
    // biome-ignore lint/correctness/useExhaustiveDependencies: loadKey captures asset + mirror variant
    useEffect(() => {
        let cancelled = false;
        baseGeoRef.current?.dispose();
        baseGeoRef.current = null;
        const ref = getDesignBase(design, side);
        if (!ref) {
            setGeometry(null);
            setBuilding(false);
            return;
        }

        const isStock = isStockDesignBase(ref);
        const hasUrl = Boolean(ref.url && /^https?:\/\//i.test(ref.url));
        const hasRealGlbPath =
            typeof ref.glbPath === "string" &&
            ref.glbPath.length > 0 &&
            (!isApiConfigured() || !isLocalPlaceholderGlbPath(ref.glbPath));
        const awaitingResolution =
            isStock && (stockBaseNeedsServerResolution(ref) || !hasUrl || !hasRealGlbPath);

        if (awaitingResolution) {
            stockResolveLog("useBaseInsoleGeometry waiting for stock resolution", {
                side,
                assetId: ref.assetId,
                hasUrl,
                hasRealGlbPath,
                glbPath: ref.glbPath ?? null,
                stockBaseLoading,
                stockBaseResolutionState,
            });
            stockDebug("useBaseInsoleGeometry skipped load — stock base not yet resolved", {
                side,
                assetId: ref.assetId,
                hasUrl,
                glbPath: ref.glbPath,
            });
            setGeometry(null);
            setBuilding(stockBaseLoading || stockBaseResolutionState === "loading");
            return;
        }

        setBuilding(true);
        stockResolveLog("useBaseInsoleGeometry loading resolved stock base", {
            side,
            assetId: ref.assetId,
            hasUrl,
            glbPath: ref.glbPath ?? null,
        });
        stockDebug("useBaseInsoleGeometry load effect", {
            side,
            assetId: ref.assetId,
            loadKey,
            hasUrl,
            glbPath: ref.glbPath,
        });
        void loadBaseGeometry(ref)
            .then((geo) => {
                if (cancelled) {
                    geo?.dispose();
                    return;
                }
                baseGeoRef.current = geo;
                // Publish an outline (legacy) and the richer BaseBounds (Phase 3A production editing).
                // Use cacheKey (includes :mirrored suffix for auto-mirrored stock Left) so mirrored variant
                // gets its own shape-specific outline/bounds instead of colliding with the source assetId.
                const cacheKey = getBaseCacheKey(ref);
                const lookupKey = cacheKey ?? ref?.assetId ?? null;
                if (geo && lookupKey) {
                    if (!useBaseOutlineStore.getState().getOutline(lookupKey)) {
                        const outline = extractMeshOutline(geo);
                        if (outline) useBaseOutlineStore.getState().setOutline(lookupKey, outline);
                    }
                    if (!useBaseBoundsStore.getState().getBounds(lookupKey)) {
                        // computeBaseBounds is cached internally and also stores outline + zones + safe margins.
                        const b = computeBaseBounds(geo, lookupKey);
                        useBaseBoundsStore.getState().setBounds(lookupKey, b);
                    }
                }
            })
            .catch((e) => {
                if (cancelled) return;
                baseGeoRef.current = null;
                if (e instanceof StockGlbLoadError) {
                    useDesignStore.setState({ stockBaseError: e.message });
                }
            })
            .finally(() => {
                if (!cancelled) setBuilding(false);
            });
        return () => {
            cancelled = true;
        };
    }, [loadKey, stockBaseLoading, stockBaseResolutionState]);

    // Re-apply modifiers whenever corrections / elements / thickness change.
    // biome-ignore lint/correctness/useExhaustiveDependencies: preview patches + live draft trimline are intentional triggers
    useEffect(() => {
        const raw = baseGeoRef.current;
        if (!assetId || !raw) return;
        const thicknessMm = thicknessPreview ?? design.thicknessMm;
        const field = baseModifierField(design, side, thicknessMm);
        // Skip smoothing while dragging for responsiveness; relax once when idle.
        const modified = applyBaseModifiers(raw, field, interacting ? 0 : 1);
        // Phase 3A: prefer the *live draft* trimline while a trimline edit session
        // is active for this side. This wires the deforming perimeter into the
        // rendered base mesh during drag (production editing requirement).
        const draft = useMeshEditStore.getState().getActiveDraftTrimline(side);
        const committed = getDesignTrimline(design, side);
        const activeForClip = draft ?? committed;
        let display = modified;
        if (activeForClip) {
            display = clipGeometryToOutline(modified, activeForClip);
            modified.dispose();
        }
        outRef.current?.dispose();
        outRef.current = display;
        setGeometry(display);
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
        interacting,
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
