// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useEffect, useRef, useState } from "react";
import { BufferAttribute, BufferGeometry } from "three";
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
import { computeBaseBounds } from "@/lib/geometry/base-bounds";
import { baseModifierEngine } from "@/lib/geometry/base-modifier-engine";
import { buildInteractiveLodGeometry, geometryTriangleCount } from "@/lib/geometry/decimate-mesh";
import { ensureRawBaseRegistered } from "@/lib/geometry/scan-registration-wire";
import { stockDebug, stockResolveLog } from "@/lib/geometry/stock-debug";
import { clipGeometryToOutline, extractMeshOutline, getDesignTrimline } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import { installModifierPerfGlobal, modifierPerf } from "@/lib/performance/modifier-perf";
import { SliderScheduler } from "@/lib/performance/slider-scheduler";
import { isApiConfigured } from "@/lib/trpc";
import { useBaseBoundsStore } from "@/stores/base-bounds-store";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import { useScanStore } from "@/stores/scan-store";
import type { DesignState, Side } from "@/types";

export interface BaseInsoleGeometryState {
    /** Stable geometry reference — mutate attributes in place; do not remount on slider ticks. */
    geometry: BufferGeometry | null;
    building: boolean;
    hasBase: boolean;
    /** True while the interactive LOD mesh is displayed. */
    usingLod: boolean;
    /** Bumped after full-quality applies so EdgesGeometry can refresh without remounting the mesh. */
    edgesRevision: number;
}

function createDisplayTwin(source: BufferGeometry): BufferGeometry {
    const pos = source.getAttribute("position")!;
    const src = pos.array as Float32Array;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(src), 3));
    const index = source.getIndex();
    if (index) {
        const arr = index.array;
        geometry.setIndex(
            new BufferAttribute(
                arr instanceof Uint32Array ? new Uint32Array(arr) : new Uint32Array(arr as ArrayLike<number>),
                1,
            ),
        );
    }
    const normal = source.getAttribute("normal");
    if (normal) {
        geometry.setAttribute(
            "normal",
            new BufferAttribute(new Float32Array(normal.array as Float32Array), 3),
        );
    }
    geometry.userData = { ...source.userData };
    return geometry;
}

/**
 * Base + Modifier preview geometry for one side.
 *
 * Performance path (verified profiling):
 * - Immutable source buffers; modifiers always sample from originals
 * - Web Worker apply with request-ID staleness
 * - 75 ms preview throttle + 200 ms idle full rebuild
 * - Decimated LOD (10–20k tris) while dragging
 * - Stable BufferGeometry identity for zero R3F remounts during slider ticks
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

    const sourceFullRef = useRef<BufferGeometry | null>(null);
    const sourceLodRef = useRef<BufferGeometry | null>(null);
    const displayFullRef = useRef<BufferGeometry | null>(null);
    const displayLodRef = useRef<BufferGeometry | null>(null);
    const activeDisplayRef = useRef<BufferGeometry | null>(null);
    const schedulerRef = useRef<SliderScheduler | null>(null);
    const generationRef = useRef(0);

    const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
    const [building, setBuilding] = useState(false);
    const [usingLod, setUsingLod] = useState(false);
    const [edgesRevision, setEdgesRevision] = useState(0);

    useEffect(() => {
        installModifierPerfGlobal();
    }, []);

    const loadKey = assetId ? `${assetId}:${isMirroredForLoad ? "m" : "p"}:${baseUrl ?? ""}` : null;

    // Load raw base once per asset/url.
    // biome-ignore lint/correctness/useExhaustiveDependencies: loadKey captures asset + mirror variant
    useEffect(() => {
        let cancelled = false;
        generationRef.current++;
        const gen = generationRef.current;

        const prevActive = activeDisplayRef.current;
        if (prevActive && prevActive !== displayFullRef.current && prevActive !== displayLodRef.current) {
            prevActive.dispose();
        }
        sourceFullRef.current?.dispose();
        sourceLodRef.current?.dispose();
        displayFullRef.current?.dispose();
        displayLodRef.current?.dispose();
        sourceFullRef.current = null;
        sourceLodRef.current = null;
        displayFullRef.current = null;
        displayLodRef.current = null;
        activeDisplayRef.current = null;
        schedulerRef.current?.dispose();
        schedulerRef.current = null;

        const ref = getDesignBase(design, side);
        if (!ref) {
            setGeometry(null);
            setBuilding(false);
            setUsingLod(false);
            setBaseMeshLoading(side, false);
            return;
        }

        const isStock = isStockDesignBase(ref);
        const hasUrl = Boolean(ref.url && /^https?:\/\//i.test(ref.url));
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
            setGeometry(null);
            setBuilding(stockBaseLoading || stockBaseResolutionState === "loading");
            setBaseMeshLoading(side, true);
            return;
        }

        setBuilding(true);
        setBaseMeshLoading(side, true);

        void loadBaseGeometry(ref, { sealBottomSlits: false })
            .then(async (geo) => {
                if (cancelled || gen !== generationRef.current) {
                    geo?.dispose();
                    return;
                }
                if (!geo) return;

                sourceFullRef.current = geo;
                const lod = buildInteractiveLodGeometry(geo);
                sourceLodRef.current = lod;
                displayFullRef.current = createDisplayTwin(geo);
                displayLodRef.current = createDisplayTwin(lod);

                modifierPerf.recordTriangles(geometryTriangleCount(lod), geometryTriangleCount(geo));

                const cacheKey = getBaseCacheKey(ref);
                const lookupKey = cacheKey ?? ref.assetId ?? null;
                if (lookupKey) {
                    if (!useBaseOutlineStore.getState().getOutline(lookupKey)) {
                        const outline = extractMeshOutline(geo);
                        if (outline) useBaseOutlineStore.getState().setOutline(lookupKey, outline);
                    }
                    if (!useBaseBoundsStore.getState().getBounds(lookupKey)) {
                        const b = computeBaseBounds(geo, lookupKey);
                        useBaseBoundsStore.getState().setBounds(lookupKey, b);
                    }
                }

                try {
                    const primarySide =
                        (ref.primarySide?.toLowerCase() as Side | undefined) ?? DEFAULT_STOCK_PRIMARY_SIDE;
                    ensureRawBaseRegistered({
                        assetId: ref.assetId,
                        geometry: geo,
                        mirrored: Boolean(ref.mirrored),
                        mirroredFrom: ref.mirroredFrom ?? null,
                        primarySide,
                    });
                    const sourceId = ref.mirrored ? (ref.mirroredFrom ?? ref.assetId) : ref.assetId;
                    useScanStore.getState().setLandmarkSourceAssetId(sourceId);
                    if (ref.mirrored) {
                        const unmirrored = mirrorGeometry(geo);
                        useScanStore.getState().setRawBaseGeometry(sourceId, unmirrored);
                        unmirrored.dispose();
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

                const fullId = `${ref.assetId}:full:${isMirroredForLoad ? "m" : "p"}`;
                const lodId = `${ref.assetId}:lod:${isMirroredForLoad ? "m" : "p"}`;
                await Promise.all([
                    baseModifierEngine.setBase(fullId, geo),
                    baseModifierEngine.setBase(lodId, lod),
                ]);

                activeDisplayRef.current = displayFullRef.current;
                setGeometry(displayFullRef.current);
                setUsingLod(false);
                setBaseMeshLoading(side, false);
            })
            .catch((e) => {
                if (cancelled) return;
                setGeometry(null);
                setBaseMeshLoading(side, false);
                if (e instanceof StockGlbLoadError) {
                    useDesignStore.setState({ stockBaseError: e.message });
                }
            })
            .finally(() => {
                if (!cancelled) setBuilding(false);
            });

        return () => {
            cancelled = true;
            setBaseMeshLoading(side, false);
            if (assetId) {
                baseModifierEngine.disposeBase(`${assetId}:full:${isMirroredForLoad ? "m" : "p"}`);
                baseModifierEngine.disposeBase(`${assetId}:lod:${isMirroredForLoad ? "m" : "p"}`);
            }
        };
    }, [loadKey, stockBaseLoading, stockBaseResolutionState, setBaseMeshLoading, side]);

    // Rebuild pipeline — stable scheduler so throttle state survives preview ticks.
    // biome-ignore lint/correctness/useExhaustiveDependencies: preview patches intentionally trigger rebuilds
    useEffect(() => {
        if (!assetId || !sourceFullRef.current || !displayFullRef.current) return;

        const fullId = `${assetId}:full:${isMirroredForLoad ? "m" : "p"}`;
        const lodId = `${assetId}:lod:${isMirroredForLoad ? "m" : "p"}`;

        const buildField = () => {
            const committedThickness = design.paired
                ? side === "left"
                    ? design.paired.leftThicknessMm
                    : design.paired.rightThicknessMm
                : design.thicknessMm;
            const thicknessMm = thicknessPreview ?? committedThickness;
            return baseModifierField(design, side, thicknessMm);
        };

        const runApply = async (quality: "preview" | "full") => {
            const useLod = quality === "preview";
            const source = useLod ? sourceLodRef.current : sourceFullRef.current;
            const target = useLod ? displayLodRef.current : displayFullRef.current;
            if (!source || !target) return;

            if (useLod && activeDisplayRef.current !== displayLodRef.current) {
                activeDisplayRef.current = displayLodRef.current;
                setGeometry(displayLodRef.current);
                setUsingLod(true);
            } else if (!useLod && activeDisplayRef.current !== displayFullRef.current) {
                activeDisplayRef.current = displayFullRef.current;
                setGeometry(displayFullRef.current);
                setUsingLod(false);
            }

            const field = buildField();
            const result = await baseModifierEngine.apply({
                baseId: useLod ? lodId : fullId,
                field,
                smoothingIterations: useLod ? 0 : 1,
                skipNormals: useLod,
                target,
                source,
            });
            if (result.stale) return;

            if (!useLod) {
                const draft = useMeshEditStore.getState().getActiveDraftTrimline(side);
                const committed = getDesignTrimline(design, side);
                const activeForClip = draft ?? committed;
                // Clip changes topology — show a dedicated clipped mesh while idle.
                // Keep displayFullRef unclipped as the stable deform target for the next apply.
                if (activeForClip) {
                    const clipped = clipGeometryToOutline(target, activeForClip);
                    const prev = activeDisplayRef.current;
                    if (prev && prev !== displayFullRef.current && prev !== displayLodRef.current) {
                        prev.dispose();
                    }
                    activeDisplayRef.current = clipped;
                    setGeometry(clipped);
                    setUsingLod(false);
                } else if (activeDisplayRef.current !== displayFullRef.current) {
                    const prev = activeDisplayRef.current;
                    if (prev && prev !== displayFullRef.current && prev !== displayLodRef.current) {
                        prev.dispose();
                    }
                    activeDisplayRef.current = displayFullRef.current;
                    setGeometry(displayFullRef.current);
                    setUsingLod(false);
                }
                setEdgesRevision((n) => n + 1);
            }

            modifierPerf.recordR3fCommit();
            target.attributes.position.needsUpdate = true;
        };

        if (!schedulerRef.current) {
            schedulerRef.current = new SliderScheduler({
                onPreview: () => {
                    void runApply("preview");
                },
                onFull: () => {
                    void runApply("full");
                },
            });
        } else {
            schedulerRef.current.setHandlers({
                onPreview: () => {
                    void runApply("preview");
                },
                onFull: () => {
                    void runApply("full");
                },
            });
        }

        const scheduler = schedulerRef.current;
        // Slider/gizmo: LOD preview. Trimline needs full topology + clip while editing.
        const usePreviewPath = interacting && interactionSource !== "trimline";
        if (usePreviewPath) scheduler.schedulePreview();
        else scheduler.scheduleFullNow();
    }, [
        assetId,
        isMirroredForLoad,
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
    ]);

    useEffect(
        () => () => {
            schedulerRef.current?.dispose();
            const active = activeDisplayRef.current;
            if (active && active !== displayFullRef.current && active !== displayLodRef.current) {
                active.dispose();
            }
            sourceFullRef.current?.dispose();
            sourceLodRef.current?.dispose();
            displayFullRef.current?.dispose();
            displayLodRef.current?.dispose();
        },
        [],
    );

    return { geometry, building, hasBase: Boolean(base), usingLod, edgesRevision };
}
