import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import {
    baseModifierField,
    DEFAULT_STOCK_PRIMARY_SIDE,
    getBaseCacheKey,
    getDesignBase,
    isLocalPlaceholderGlbPath,
    isStockDesignBase,
    loadBaseGeometry,
    StockGlbLoadError,
    stockBaseNeedsServerResolution,
} from "@/lib/geometry/base-asset";
import { clearBaseBoundsCache, computeBaseBounds } from "@/lib/geometry/base-bounds";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import { ensureRawBaseRegistered } from "@/lib/geometry/scan-registration-wire";
import { insoleLayoutFromDesign, scaleGeometryToInsoleSize } from "@/lib/geometry/shoe-size";
import { stockDebug, stockResolveLog } from "@/lib/geometry/stock-debug";
import { clipGeometryToOutline, extractMeshOutline, getDesignTrimline } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import { isApiConfigured } from "@/lib/trpc";
import { useBaseBoundsStore } from "@/stores/base-bounds-store";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import { useScanStore } from "@/stores/scan-store";
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
    const interactionSource = usePerformanceStore((s) => s.interactionSource);
    const stockBaseLoading = useDesignStore((s) => s.stockBaseLoading);
    const stockBaseResolutionState = useDesignStore((s) => s.stockBaseResolutionState);
    const setBaseMeshLoading = useDesignStore((s) => s.setBaseMeshLoading);

    const base = getDesignBase(design, side);
    const assetId = base?.assetId ?? null;
    const isMirroredForLoad = !!base?.mirrored;
    const baseUrl = base?.url ?? null;
    const layout = insoleLayoutFromDesign(design);

    const nativeGeoRef = useRef<BufferGeometry | null>(null);
    const baseGeoRef = useRef<BufferGeometry | null>(null);
    /** Full-resolution deform target (never trim-clipped); reused across slider frames. */
    const workRef = useRef<BufferGeometry | null>(null);
    const outRef = useRef<BufferGeometry | null>(null);
    const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
    const [building, setBuilding] = useState(false);

    // Load the raw base mesh whenever the referenced asset (or its mirrored variant) changes.
    // Include url so stock bases upgrade from the sync stub to the server row re-trigger load.
    const loadKey = assetId ? `${assetId}:${isMirroredForLoad ? "m" : "p"}:${baseUrl ?? ""}` : null;
    // biome-ignore lint/correctness/useExhaustiveDependencies: loadKey captures asset + mirror variant
    useEffect(() => {
        let cancelled = false;
        nativeGeoRef.current?.dispose();
        nativeGeoRef.current = null;
        baseGeoRef.current?.dispose();
        baseGeoRef.current = null;
        if (outRef.current && outRef.current !== workRef.current) {
            outRef.current.dispose();
        }
        outRef.current = null;
        workRef.current?.dispose();
        workRef.current = null;
        const ref = getDesignBase(design, side);
        if (!ref) {
            setGeometry(null);
            setBuilding(false);
            setBaseMeshLoading(side, false);
            return;
        }

        const isStock = isStockDesignBase(ref);
        const hasUrl = Boolean(ref.url && /^https?:\/\//i.test(ref.url));
        // An authoritative (signed/public https) URL means the glbPath is a real
        // storage key — even when it is literally "Templates/Default.glb". Without a
        // URL we keep the bundled-placeholder guard so server mode never fetches public/.
        const hasRealGlbPath =
            typeof ref.glbPath === "string" &&
            ref.glbPath.length > 0 &&
            (hasUrl || !isApiConfigured() || !isLocalPlaceholderGlbPath(ref.glbPath));
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
            setBaseMeshLoading(side, true);
            return;
        }

        setBuilding(true);
        setBaseMeshLoading(side, true);
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
        void loadBaseGeometry(ref, {
            // sealBottomSlits disabled on viewer load — too expensive for 208k-vertex
            // bottom mesh on main thread. Sealing runs on export path only via
            // sealInternalSlitsSafe. See: vertex/IMPLEMENTATION_NOTES.md — geometry worker TODO
            sealBottomSlits: false,
        })
            .then((geo) => {
                if (cancelled) {
                    geo?.dispose();
                    return;
                }
                nativeGeoRef.current = geo;
                // Phase 2 — register raw L0 once per source asset (J1: mirrored-only safe).
                if (geo && ref) {
                    try {
                        const primarySide =
                            (ref.primarySide?.toLowerCase() as Side | undefined) ??
                            DEFAULT_STOCK_PRIMARY_SIDE;
                        ensureRawBaseRegistered({
                            assetId: ref.assetId,
                            geometry: geo,
                            mirrored: Boolean(ref.mirrored),
                            mirroredFrom: ref.mirroredFrom ?? null,
                            primarySide,
                        });
                        const sourceId = ref.mirrored ? (ref.mirroredFrom ?? ref.assetId) : ref.assetId;
                        useScanStore.getState().setLandmarkSourceAssetId(sourceId);
                        // Store unmirrored raw for deviation (J1: inverse-mirror when needed).
                        if (ref.mirrored) {
                            const unmirrored = mirrorGeometry(geo);
                            useScanStore.getState().setRawBaseGeometry(sourceId, unmirrored);
                            unmirrored.dispose(); // setRawBaseGeometry clones
                        } else {
                            useScanStore.getState().setRawBaseGeometry(sourceId, geo);
                        }
                    } catch (e) {
                        stockDebug("marker-frame registration failed", {
                            assetId: ref.assetId,
                            message: e instanceof Error ? e.message : String(e),
                        });
                        useScanStore.getState().setLandmarkSourceAssetId(null);
                    }
                }
                // Signal size effect / modifier rebuild.
                setBuilding(false);
            })
            .catch((e) => {
                if (cancelled) return;
                nativeGeoRef.current = null;
                baseGeoRef.current = null;
                setGeometry(null);
                if (e instanceof StockGlbLoadError) {
                    useDesignStore.setState({ stockBaseError: e.message });
                }
            })
            .finally(() => {
                if (cancelled) return;
                setBuilding(false);
                // Clear even when the modifier rebuild path has not run yet (e.g. zero-field
                // designs) so Viewer3D does not stay on "Loading base…".
                setBaseMeshLoading(side, false);
            });
        return () => {
            cancelled = true;
            setBaseMeshLoading(side, false);
        };
    }, [loadKey, stockBaseLoading, stockBaseResolutionState, setBaseMeshLoading, side]);

    // Scale native template to the selected shoe size; publish outline/bounds for the sized mesh.
    // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild when native load finishes (building→false)
    useEffect(() => {
        const native = nativeGeoRef.current;
        if (!native || !assetId) return;
        const ref = getDesignBase(design, side);
        const sized = scaleGeometryToInsoleSize(native, layout.lengthMm, layout.widthMm);
        if (baseGeoRef.current && baseGeoRef.current !== native) {
            baseGeoRef.current.dispose();
        }
        baseGeoRef.current = sized;
        if (workRef.current) {
            workRef.current.dispose();
            workRef.current = null;
        }

        const cacheKey = ref ? getBaseCacheKey(ref) : null;
        const lookupKey = cacheKey ?? ref?.assetId ?? assetId;
        // Invalidate prior size so outline/bounds refresh for the new footprint.
        clearBaseBoundsCache(lookupKey);
        const b = computeBaseBounds(sized, lookupKey);
        useBaseBoundsStore.getState().setBounds(lookupKey, b);
        const outline = extractMeshOutline(sized);
        if (outline) useBaseOutlineStore.getState().setOutline(lookupKey, outline);
    }, [assetId, side, layout.lengthMm, layout.widthMm, layout.usMenSize, building, design]);

    // Re-apply modifiers whenever corrections / elements / thickness change.
    // biome-ignore lint/correctness/useExhaustiveDependencies: preview patches + live draft trimline are intentional triggers
    useEffect(() => {
        const raw = baseGeoRef.current;
        if (!assetId || !raw) return;
        // Paired workspace: per-side committed thickness (matches export path).
        const committedThickness = design.paired
            ? side === "left"
                ? design.paired.leftThicknessMm
                : design.paired.rightThicknessMm
            : design.thicknessMm;
        const thicknessMm = thicknessPreview ?? committedThickness;
        const field = baseModifierField(design, side, thicknessMm);
        // Skip smoothing while dragging for responsiveness; relax once when idle.
        // Slider/gizmo: reuse work buffer + skip normals/clip. Trimline keeps clip.
        const fastPreview = interacting && interactionSource !== "trimline";
        const rawCount = raw.getAttribute("position")?.count ?? 0;
        const canReuseWork =
            workRef.current != null && workRef.current.getAttribute("position")?.count === rawCount;
        const modified = applyBaseModifiers(raw, field, interacting ? 0 : 1, {
            reuse: canReuseWork ? workRef.current! : undefined,
            skipNormals: fastPreview,
            skipBottomSync: fastPreview,
        });
        if (workRef.current && workRef.current !== modified) {
            workRef.current.dispose();
        }
        workRef.current = modified;

        // Phase 3A: prefer the *live draft* trimline while a trimline edit session
        // is active for this side. This wires the deforming perimeter into the
        // rendered base mesh during drag (production editing requirement).
        // Defer full clip during slider/gizmo scrub (idle + trimline still clip).
        const draft = useMeshEditStore.getState().getActiveDraftTrimline(side);
        const committed = getDesignTrimline(design, side);
        const activeForClip = draft ?? committed;
        let display: BufferGeometry = modified;
        if (activeForClip && !fastPreview) {
            display = clipGeometryToOutline(modified, activeForClip);
        }
        if (outRef.current && outRef.current !== display && outRef.current !== workRef.current) {
            outRef.current.dispose();
        }
        outRef.current = display;
        // Same BufferGeometry identity while scrubbing → avoid React remount / EdgesGeometry.
        setGeometry((prev) => (prev === display ? prev : display));
        setBaseMeshLoading(side, false);
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
        interactionSource,
        building,
        setBaseMeshLoading,
        side,
    ]);

    useEffect(
        () => () => {
            nativeGeoRef.current?.dispose();
            if (baseGeoRef.current && baseGeoRef.current !== nativeGeoRef.current) {
                baseGeoRef.current.dispose();
            }
            if (outRef.current && outRef.current !== workRef.current) {
                outRef.current.dispose();
            }
            workRef.current?.dispose();
        },
        [],
    );

    return { geometry, building, hasBase: Boolean(base) };
}
