import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import { getActiveFootSide } from "@/lib/clinical/active-foot-side";
import {
    baseModifierField,
    DEFAULT_STOCK_PRIMARY_SIDE,
    getBaseCacheKey,
    getDesignBase,
    isLocalPlaceholderGlbPath,
    isStockDesignBase,
    loadBaseGeometry,
    stockBaseNeedsServerResolution,
} from "@/lib/geometry/base-asset";
import { clearBaseBoundsCache, computeBaseBounds } from "@/lib/geometry/base-bounds";
import { applyBaseModifiers, BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { elementsForSurface } from "@/lib/geometry/element-assets/display-mesh";
import { elementGeometryKey } from "@/lib/geometry/element-geometry-key";
import { heightAt } from "@/lib/geometry/height-field";
import {
    hashLiveBottomPattern,
    resolveLiveBottomPattern,
} from "@/lib/geometry/procedural-wall/live-bottom-pattern";
import {
    enqueuePreviewLoft,
    isCoarsePointerDevice,
    previewLoftPriority,
    yieldToMain,
    yieldToPaint,
} from "@/lib/geometry/procedural-wall/preview-loft-queue";
import {
    autoPatternKey,
    hashPatternPoints,
    PRINT_LOFT_TIMEOUT_MS,
    proceduralLoftReuseKey,
    resolveLoftActiveSide,
    shouldLoftProceduralViewer,
} from "@/lib/geometry/procedural-wall/preview-loft-ui";
import {
    buildProceduralViewerPatternInWorker,
    reconstructProceduralPreviewInWorker,
} from "@/lib/geometry/procedural-wall/preview-loft-worker";
import { composeViewerPrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { proceduralViewerStockGate } from "@/lib/geometry/procedural-wall/sample-top-display";
import {
    bundledTopShapeFromBase,
    distalTrimKind,
    SAMPLE_TOP_ASSET_ID,
} from "@/lib/geometry/procedural-wall/sample-top-id";
import { loadBundledTopGeometry } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { ensureRawBaseRegistered } from "@/lib/geometry/scan-registration-wire";
import { insoleLayoutFromDesign, scaleGeometryToInsoleSize } from "@/lib/geometry/shoe-size";
import { applyShoeWidthToPoints, shoeWidthForSide } from "@/lib/geometry/shoe-width";
import { stockDebug, stockResolveLog } from "@/lib/geometry/stock-debug";
import { textMarkingHash } from "@/lib/geometry/text-marking/hash";
import { clipGeometryToOutline, extractMeshOutline, getDesignTrimline } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import { isApiConfigured } from "@/lib/trpc";
import { useBaseBoundsStore } from "@/stores/base-bounds-store";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import { usePreviewLoftStatusStore } from "@/stores/preview-loft-status-store";
import { useScanStore } from "@/stores/scan-store";
import type { DesignState, Side } from "@/types";

const PREVIEW_LOFT_WATCHDOG_MS = PRINT_LOFT_TIMEOUT_MS;

export interface BaseInsoleGeometryState {
    geometry: BufferGeometry | null;
    building: boolean;
    hasBase: boolean;
    elementReference: BufferGeometry | null;
}

/**
 * Base + Modifier preview geometry for one side: loads the design's base
 * template once, then applies the current corrections / elements as a fast
 * vertical deformation whenever they change. Returns `hasBase: false` for pure
 * parametric designs so callers can fall back to the parametric mesh.
 */
export function useBaseInsoleGeometry(design: DesignState, side: Side): BaseInsoleGeometryState {
    const [elementReference, setElementReference] = useState<BufferGeometry | null>(null);
    useEffect(() => () => elementReference?.dispose(), [elementReference]);
    const geometryElementsKey = elementGeometryKey(design.elements);
    const correctionPreview = usePerformanceStore((s) => s.correctionPreview);
    const thicknessPreview = usePerformanceStore((s) => s.thicknessPreview);
    const elementPreviews = usePerformanceStore((s) => s.elementPreviews);
    const interacting = usePerformanceStore((s) => s.interacting);
    const interactionSource = usePerformanceStore((s) => s.interactionSource);
    const stockBaseLoading = useDesignStore((s) => s.stockBaseLoading);
    const stockBaseResolutionState = useDesignStore((s) => s.stockBaseResolutionState);
    const setBaseMeshLoading = useDesignStore((s) => s.setBaseMeshLoading);
    const wallModel = useDesignStore((s) => s.viewer.wallModel ?? "procedural");
    const wallStyle = useDesignStore((s) => s.viewer.wallStyle ?? "straight");
    const deviceType = useDesignStore((s) => s.viewer.deviceType ?? "functional");
    const lateralFlangeHeightMm = useDesignStore((s) => s.viewer.lateralFlangeHeightMm ?? 0);
    const lateralFlangeLengthMm = useDesignStore((s) => s.viewer.lateralFlangeLengthMm ?? 40);
    const lateralFlangeAngleDeg = useDesignStore((s) => s.viewer.lateralFlangeAngleDeg ?? 10);
    const bottomPattern = useBottomPatternStore((s) => s.patterns[side]);
    const generatedPatternKey = useBottomPatternStore((s) => s.generatedKey[side]);
    const bottomPatternEdit = useMeshEditStore((s) => s.bottomPatternEdit);
    const retryNonce = usePreviewLoftStatusStore((s) => s.retryNonce);
    const loftCancelled = usePreviewLoftStatusStore((s) => s.cancelled);
    const exportSide = useDesignStore((s) => s.exportSide);
    const showLeft = useDesignStore((s) => s.viewer.showLeft);
    const showRight = useDesignStore((s) => s.viewer.showRight);
    const activeReady = usePreviewLoftStatusStore((s) => {
        const active = resolveLoftActiveSide(showLeft, showRight, exportSide);
        return s.phaseBySide[active] === "ready";
    });
    const clinicalStep = useClinicalWorkflowStore((s) => s.step);
    const setLoftPhase = usePreviewLoftStatusStore((s) => s.setSidePhase);
    const setLoftError = usePreviewLoftStatusStore((s) => s.setError);
    const lastLoftKeyRef = useRef<string | null>(null);
    const loftGenRef = useRef(0);

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
    const procedural = wallModel === "procedural";
    const topShape = bundledTopShapeFromBase(base);
    const loadKey = procedural
        ? `${topShape ?? SAMPLE_TOP_ASSET_ID}:${side}:${isMirroredForLoad ? "m" : "p"}:${base?.glbPath ?? ""}`
        : assetId
          ? `${assetId}:${isMirroredForLoad ? "m" : "p"}:${baseUrl ?? ""}`
          : null;
    // SAMPLE_Top is a public static GLB — ignore stock-server loading flags so
    // App login bootstrap / persist rehydrate cannot remount-dispose the sheet.
    const stockGate = proceduralViewerStockGate(wallModel, stockBaseLoading, stockBaseResolutionState);
    // biome-ignore lint/correctness/useExhaustiveDependencies: loadKey captures asset + mirror variant
    useEffect(() => {
        let cancelled = false;
        const ref = getDesignBase(design, side);
        if (!ref) {
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
            setGeometry(null);
            setBuilding(false);
            setBaseMeshLoading(side, false);
            return;
        }

        const isStock = isStockDesignBase(ref);
        const hasUrl = Boolean(ref.url && (/^https?:\/\//i.test(ref.url) || ref.url.startsWith("/")));
        // An authoritative (signed/public https) URL means the glbPath is a real
        // storage key — even when it is literally "Templates/Default.glb". Without a
        // URL we keep the bundled-placeholder guard so server mode never fetches public/.
        const hasRealGlbPath =
            typeof ref.glbPath === "string" &&
            ref.glbPath.length > 0 &&
            (hasUrl || !isApiConfigured() || !isLocalPlaceholderGlbPath(ref.glbPath));
        const awaitingResolution =
            !procedural && isStock && (stockBaseNeedsServerResolution(ref) || !hasUrl || !hasRealGlbPath);

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
            if (!outRef.current) setGeometry(null);
            setBuilding(stockBaseLoading || stockBaseResolutionState === "loading");
            setBaseMeshLoading(side, true);
            setLoftPhase(side, "fetching", "Waiting for stock base…");
            return;
        }

        // Reload in the background. Keep the last displayed geometry so a
        // remount cannot flash an empty viewport (blue patterns only).
        const keepDisplay = Boolean(outRef.current);
        if (!keepDisplay) {
            nativeGeoRef.current?.dispose();
            nativeGeoRef.current = null;
            baseGeoRef.current?.dispose();
            baseGeoRef.current = null;
            workRef.current?.dispose();
            workRef.current = null;
        }
        setBuilding(true);
        setBaseMeshLoading(side, true);
        setLoftPhase(side, "fetching", "Fetching SAMPLE_Top…");
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
        const loadGeo = procedural
            ? loadBundledTopGeometry(bundledTopShapeFromBase(ref) ?? "full").then((geo) => {
                  if (!isMirroredForLoad) return geo;
                  const mirrored = mirrorGeometry(geo);
                  geo.dispose();
                  return mirrored;
              })
            : loadBaseGeometry(ref, {
                  // sealBottomSlits disabled on viewer load — too expensive for 208k-vertex
                  // bottom mesh on main thread. Sealing runs on export path only via
                  // sealInternalSlitsSafe. See: vertex/IMPLEMENTATION_NOTES.md — geometry worker TODO
                  sealBottomSlits: false,
              });
        void loadGeo
            .then((geo) => {
                if (cancelled) {
                    geo?.dispose();
                    return;
                }
                if (nativeGeoRef.current && nativeGeoRef.current !== geo) {
                    nativeGeoRef.current.dispose();
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
                const msg = e instanceof Error ? e.message : String(e);
                useDesignStore.setState({ stockBaseError: msg });
                setLoftError(side, msg);
            })
            .finally(() => {
                if (cancelled) return;
                setBuilding(false);
                if (!nativeGeoRef.current) setBaseMeshLoading(side, false);
            });
        return () => {
            cancelled = true;
            setBaseMeshLoading(side, false);
        };
    }, [loadKey, stockGate, setBaseMeshLoading, side, retryNonce, setLoftPhase, setLoftError, wallModel]);

    // Scale native template to the selected shoe size; publish outline/bounds for the sized mesh.
    // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild when native load finishes (building→false)
    useEffect(() => {
        const native = nativeGeoRef.current;
        if (!native || (!assetId && !procedural)) return;
        const ref = getDesignBase(design, side);
        // Procedural preview keeps native SAMPLE_Top (the approved STL input).
        // Shoe-size scale on a top-only sheet is a display concern for legacy Default.
        const sized = procedural
            ? native.clone()
            : scaleGeometryToInsoleSize(native, layout.lengthMm, layout.widthMm);
        if (baseGeoRef.current && baseGeoRef.current !== native) {
            baseGeoRef.current.dispose();
        }
        baseGeoRef.current = sized;
        if (workRef.current) {
            workRef.current.dispose();
            workRef.current = null;
        }

        const cacheKey = ref ? getBaseCacheKey(ref) : null;
        const lookupKey = procedural
            ? `${SAMPLE_TOP_ASSET_ID}:${side}:${isMirroredForLoad ? "m" : "p"}`
            : (cacheKey ?? ref?.assetId ?? assetId);
        // Invalidate prior size so outline/bounds refresh for the new footprint.
        clearBaseBoundsCache(lookupKey);
        const b = computeBaseBounds(sized, lookupKey);
        useBaseBoundsStore.getState().setBounds(lookupKey, b);
        const outline = extractMeshOutline(sized);
        if (outline) {
            const widthId = shoeWidthForSide(design, side);
            const heelW = layout.widthMm * 0.62;
            const scaledPts = applyShoeWidthToPoints(outline.points, widthId, {
                ballWidthMm: layout.widthMm,
                heelWidthMm: heelW,
                minX: b.minX,
                lengthMm: Math.max(1e-3, b.maxX - b.minX),
                heelOverrideMm: design.corrections[side]?.heelCupWidthMm,
            });
            useBaseOutlineStore.getState().setOutline(lookupKey, { points: scaledPts });
        }
    }, [
        assetId,
        side,
        layout.lengthMm,
        layout.widthMm,
        layout.usMenSize,
        design.shoeWidth,
        design.shoeWidthBySide,
        design.corrections.linked,
        design.corrections[side]?.heelCupWidthMm,
        building,
    ]);

    // Re-apply modifiers whenever corrections / elements / thickness change.
    // `wallModel: 'procedural'` is viewer-only (S1): loft from planform columns.
    // Widen / cup / lift move only the curves; profile interiors rescale affinely.
    // Export / legacy modifier paths are unchanged.
    // biome-ignore lint/correctness/useExhaustiveDependencies: preview patches + live draft trimline are intentional triggers
    useEffect(() => {
        const raw = baseGeoRef.current;
        if ((!assetId && wallModel !== "procedural") || !raw) return;
        if (wallModel === "procedural") {
            const committedThickness = design.paired
                ? side === "left"
                    ? design.paired.leftThicknessMm
                    : design.paired.rightThicknessMm
                : design.thicknessMm;
            const thicknessMm = thicknessPreview ?? committedThickness ?? BASE_REFERENCE_THICKNESS_MM;
            const field = baseModifierField(design, side, thicknessMm);
            field.elements = elementsForSurface(
                field.elements ?? [],
                clinicalStep === "print" || clinicalStep === "export",
            );
            const rw = field.corrections?.rearfootWedge;
            if (
                rw?.unit === "mm" &&
                rw.side === "lateral" &&
                Math.abs((rw.value ?? 0) - 10) < 0.01 &&
                clinicalStep === "corrections"
            ) {
                const u = 0.1;
                const neutral = {
                    ...field,
                    corrections: { ...field.corrections!, rearfootWedge: undefined },
                };
                stockDebug("STEP0 design viewer top-sheet z delta (mm)", {
                    side,
                    border: heightAt(u, 0.98, field) - heightAt(u, 0.98, neutral),
                    lateralHeelCenter: heightAt(u, 0.5, field) - heightAt(u, 0.5, neutral),
                    medialHeel: heightAt(u, -0.5, field) - heightAt(u, -0.5, neutral),
                    medialEdge: heightAt(u, -0.98, field) - heightAt(u, -0.98, neutral),
                });
            }
            const fw = field.corrections?.forefootWedge;
            if (
                fw?.unit === "mm" &&
                fw.side === "lateral" &&
                (fw.value ?? 0) > 0 &&
                clinicalStep === "corrections"
            ) {
                const u = 0.88;
                const neutral = {
                    ...field,
                    corrections: { ...field.corrections!, forefootWedge: undefined },
                };
                stockDebug("STEP corrections forefoot lateral mm top z delta (heightAt + mesh)", {
                    side,
                    mm: fw.value,
                    composedPath: true,
                    lateralBorder: heightAt(u, 0.98, field) - heightAt(u, 0.98, neutral),
                    medialEdge: heightAt(u, -0.98, field) - heightAt(u, -0.98, neutral),
                    lateralMet: heightAt(u, 0.5, field) - heightAt(u, 0.5, neutral),
                });
            }
            const draft = useMeshEditStore.getState().getActiveDraftBottomPattern(side);
            const stored = useBottomPatternStore.getState().getPattern(side);
            const dragging = Boolean(useMeshEditStore.getState().bottomPatternEdit?.isDragging);
            const heelW = field.corrections?.heelCupWidthMm ?? 0;
            const widthId = shoeWidthForSide(design, side);
            const patternKey = `${autoPatternKey(isMirroredForLoad, design.pattern)}:hw${heelW.toFixed(2)}:w${widthId}`;
            const userEdited = Boolean(stored) && !generatedPatternKey;
            const needPattern = !draft && !userEdited && generatedPatternKey !== patternKey;
            const session = {
                cancelled: false,
                handle: null as { cancel: () => void } | null,
                watchdog: 0,
                gen: 0,
            };
            void (async () => {
                if (needPattern) {
                    try {
                        await yieldToMain();
                        if (session.cancelled) return;
                        const draftTrimForPattern = useMeshEditStore.getState().getActiveDraftTrimline(side);
                        const committedTrimForPattern = getDesignTrimline(design, side);
                        const patternTrim = draftTrimForPattern ?? committedTrimForPattern;
                        let patternTop = raw;
                        try {
                            patternTop = await composeViewerPrintSolidTop({
                                raw,
                                sourceField: field,
                                shoeWidth: {
                                    width: widthId,
                                    ballWidthMm: layout.widthMm,
                                    heelWidthMm: layout.widthMm * 0.62,
                                    heelOverrideMm: heelW,
                                },
                                trimline: patternTrim,
                            });
                        } catch (composeErr) {
                            stockDebug("composePrintSolidTop for viewer pattern — using raw rim", {
                                side,
                                message:
                                    composeErr instanceof Error ? composeErr.message : String(composeErr),
                            });
                        }
                        const rawPattern = await buildProceduralViewerPatternInWorker(
                            patternTop,
                            design.pattern,
                            field.corrections,
                        );
                        if (patternTop !== raw) patternTop.dispose();
                        if (session.cancelled) return;
                        await yieldToMain();
                        if (session.cancelled) return;
                        let minX = Infinity;
                        let maxX = -Infinity;
                        for (const p of rawPattern) {
                            minX = Math.min(minX, p.x);
                            maxX = Math.max(maxX, p.x);
                        }
                        const sizedPattern = applyShoeWidthToPoints(rawPattern, widthId, {
                            ballWidthMm: layout.widthMm,
                            heelWidthMm: layout.widthMm * 0.62,
                            minX,
                            lengthMm: Math.max(1e-3, maxX - minX),
                            heelOverrideMm: heelW,
                        });
                        useBottomPatternStore.getState().ensureGenerated(side, patternKey, sizedPattern);
                    } catch (e) {
                        if (session.cancelled) return;
                        stockDebug("procedural viewer pattern failed", {
                            side,
                            message: e instanceof Error ? e.message : String(e),
                        });
                    }
                }
                if (session.cancelled) return;
                const livePts = resolveLiveBottomPattern({
                    draft,
                    stored: useBottomPatternStore.getState().getPattern(side),
                });
                if (!shouldLoftProceduralViewer(clinicalStep, wallModel)) {
                    setElementReference(null);
                    await yieldToMain();
                    if (session.cancelled) return;
                    const draftTrim = useMeshEditStore.getState().getActiveDraftTrimline(side);
                    const committedTrim = getDesignTrimline(design, side);
                    const printTrim = draftTrim ?? committedTrim;
                    let modified = raw;
                    try {
                        modified = await composeViewerPrintSolidTop({
                            raw,
                            sourceField: field,
                            shoeWidth: {
                                width: widthId,
                                ballWidthMm: layout.widthMm,
                                heelWidthMm: layout.widthMm * 0.62,
                                heelOverrideMm: heelW,
                            },
                            trimline: printTrim,
                        });
                        const fwLog = field.corrections?.forefootWedge;
                        if (
                            fwLog?.unit === "mm" &&
                            fwLog.side === "lateral" &&
                            (fwLog.value ?? 0) > 0 &&
                            clinicalStep === "corrections" &&
                            modified !== raw
                        ) {
                            const neutralField = {
                                ...field,
                                corrections: { ...(field.corrections ?? {}), forefootWedge: undefined },
                            };
                            const neutralGeo = await composeViewerPrintSolidTop({
                                raw,
                                sourceField: neutralField,
                                shoeWidth: {
                                    width: widthId,
                                    ballWidthMm: layout.widthMm,
                                    heelWidthMm: layout.widthMm * 0.62,
                                    heelOverrideMm: heelW,
                                },
                                trimline: printTrim,
                            });
                            const posAttr = modified.getAttribute("position");
                            const neuAttr = neutralGeo.getAttribute("position");
                            let maxMeshLiftMm = 0;
                            if (posAttr && neuAttr) {
                                const pos = posAttr.array as Float32Array;
                                const neu = neuAttr.array as Float32Array;
                                for (let vi = 2; vi < pos.length; vi += 3) {
                                    maxMeshLiftMm = Math.max(maxMeshLiftMm, pos[vi] - neu[vi]);
                                }
                            }
                            neutralGeo.dispose();
                            stockDebug("STEP corrections forefoot lateral composed mesh maxZ lift (mm)", {
                                side,
                                mm: fwLog.value,
                                maxMeshLiftMm,
                            });
                        }
                    } catch (e) {
                        stockDebug("composePrintSolidTop failed — showing raw SAMPLE_Top", {
                            side,
                            message: e instanceof Error ? e.message : String(e),
                        });
                        modified = raw;
                    }
                    if (workRef.current && workRef.current !== modified && workRef.current !== raw) {
                        workRef.current.dispose();
                    }
                    workRef.current = modified;
                    if (outRef.current && outRef.current !== modified && outRef.current !== raw) {
                        outRef.current.dispose();
                    }
                    outRef.current = modified;
                    lastLoftKeyRef.current = null;
                    setGeometry((prev) => (prev === modified ? prev : modified));
                    setLoftPhase(side, "idle", "Composed top ready");
                    setBaseMeshLoading(side, false);
                    return;
                }
                if (dragging || loftCancelled) {
                    lastLoftKeyRef.current = null;
                    setBaseMeshLoading(side, false);
                    if (loftCancelled) setLoftPhase(side, "idle", "Print solid cancelled");
                    else setLoftPhase(side, "ready", "Pattern edited — solid is stale");
                    return;
                }
                const draftTrim = useMeshEditStore.getState().getActiveDraftTrimline(side);
                const committedTrim = getDesignTrimline(design, side);
                const printTrim = draftTrim ?? committedTrim;
                const loftKey = proceduralLoftReuseKey({
                    side,
                    wallStyle,
                    deviceType,
                    thicknessMm,
                    correctionsJson: JSON.stringify(field.corrections ?? {}),
                    scanPattern: design.pattern,
                    patternKind: draft ? "edited" : livePts ? "live" : "auto",
                    patternHash: livePts ? hashLiveBottomPattern(livePts) : patternKey,
                    flanges: `${lateralFlangeHeightMm}:${lateralFlangeLengthMm}:${lateralFlangeAngleDeg}|r${retryNonce}`,
                    sourceFieldJson: JSON.stringify({
                        side: field.side,
                        lengthMm: field.lengthMm,
                        widthMm: field.widthMm,
                        thicknessMm: field.thicknessMm,
                        includeSkives: field.includeSkives ?? false,
                        includeElements: field.includeElements ?? true,
                    }),
                    shapeFinishJson: JSON.stringify(field.shapeFinish ?? null),
                    elementsJson: elementGeometryKey(field.elements ?? []),
                    trimlineHash: printTrim ? hashPatternPoints(printTrim.points) : "",
                    shoeWidth: widthId,
                    textMarkingHash: textMarkingHash(design.textMarking),
                });
                if (lastLoftKeyRef.current === loftKey && outRef.current) {
                    setBaseMeshLoading(side, false);
                    setLoftPhase(side, "ready");
                    return;
                }
                const viewer = useDesignStore.getState().viewer;
                const activeSide = resolveLoftActiveSide(
                    viewer.showLeft,
                    viewer.showRight,
                    getActiveFootSide(),
                );
                const coarse = isCoarsePointerDevice();
                const deferMirror = coarse && side !== activeSide && !activeReady;
                session.gen = ++loftGenRef.current;
                if (deferMirror) {
                    setBaseMeshLoading(side, true);
                    setLoftPhase(side, "queued", "Waiting for active foot…");
                    return;
                }
                await yieldToMain();
                if (session.cancelled) return;
                setBaseMeshLoading(side, true);
                setLoftPhase(side, "queued", `Queued ${side} walls…`);
                session.handle = enqueuePreviewLoft({
                    side,
                    priority: previewLoftPriority(side, activeSide, coarse),
                    run: async () => {
                        if (session.cancelled) return;
                        setLoftPhase(
                            side,
                            "lofting",
                            coarse
                                ? `Building ${side} walls for print… — this can take up to a minute on phones`
                                : `Building ${side} walls for print…`,
                        );
                        await yieldToPaint();
                        if (session.cancelled) return;
                        const started = performance.now();
                        try {
                            const preview = await reconstructProceduralPreviewInWorker(raw, {
                                distalTrim:
                                    distalTrimKind(bundledTopShapeFromBase(getDesignBase(design, side))) ??
                                    undefined,
                                corrections: field.corrections,
                                thicknessMm,
                                stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
                                deviceType,
                                lateralFlange: {
                                    heightMm: lateralFlangeHeightMm,
                                    lengthMm: lateralFlangeLengthMm,
                                    angleDeg: lateralFlangeAngleDeg,
                                },
                                archGrindDepthMm: 0,
                                wallStyle,
                                scanPattern: design.pattern,
                                sourceField: field,
                                composedTop: true,
                                shoeWidth: {
                                    width: widthId,
                                    ballWidthMm: layout.widthMm,
                                    heelWidthMm: layout.widthMm * 0.62,
                                    heelOverrideMm: heelW,
                                },
                                trimline: printTrim,
                                textMarking: design.textMarking,
                                side,
                                ...(livePts ? { bottomPattern: livePts } : {}),
                            });
                            let placementReference: BufferGeometry;
                            try {
                                placementReference = await composeViewerPrintSolidTop({
                                    raw,
                                    sourceField: {
                                        ...field,
                                        elements: elementsForSurface(field.elements ?? [], false),
                                    },
                                    shoeWidth: {
                                        width: widthId,
                                        ballWidthMm: layout.widthMm,
                                        heelWidthMm: layout.widthMm * 0.62,
                                        heelOverrideMm: heelW,
                                    },
                                    trimline: printTrim,
                                });
                            } catch (error) {
                                preview.geometry.dispose();
                                throw error;
                            }
                            if (session.cancelled) {
                                placementReference.dispose();
                                preview.geometry.dispose();
                                return;
                            }
                            setElementReference(placementReference);
                            if (outRef.current && outRef.current !== workRef.current) {
                                outRef.current.dispose();
                            }
                            outRef.current = preview.geometry;
                            lastLoftKeyRef.current = loftKey;
                            setGeometry(preview.geometry);
                            setLoftPhase(side, "ready", `Print solid ready (${side})`);
                            usePreviewLoftStatusStore.getState().markElapsed(performance.now() - started);
                        } catch (e) {
                            if (session.cancelled) return;
                            const message = e instanceof Error ? e.message : String(e);
                            if (/cancelled/i.test(message)) return;
                            stockDebug("procedural SAMPLE_Top reconstruct failed", { side, message });
                            setGeometry(null);
                            setLoftError(side, message);
                        } finally {
                            if (loftGenRef.current === session.gen) setBaseMeshLoading(side, false);
                        }
                    },
                });
                session.watchdog = window.setTimeout(() => {
                    if (session.cancelled || loftGenRef.current !== session.gen) return;
                    const phase = usePreviewLoftStatusStore.getState().phaseBySide[side];
                    if (phase === "queued" || phase === "lofting" || phase === "fetching") {
                        setLoftError(side, "Print solid is taking too long. Tap Retry.");
                        setBaseMeshLoading(side, false);
                    }
                }, PREVIEW_LOFT_WATCHDOG_MS);
            })();
            return () => {
                session.cancelled = true;
                session.handle?.cancel();
                if (session.watchdog) window.clearTimeout(session.watchdog);
                if (session.gen && loftGenRef.current === session.gen) setBaseMeshLoading(side, false);
            };
        }
        // Paired workspace: per-side committed thickness (matches export path).
        const committedThickness = design.paired
            ? side === "left"
                ? design.paired.leftThicknessMm
                : design.paired.rightThicknessMm
            : design.thicknessMm;
        const thicknessMm = thicknessPreview ?? committedThickness;
        const field = baseModifierField(design, side, thicknessMm);
        field.elements = elementsForSurface(
            field.elements ?? [],
            clinicalStep === "print" || clinicalStep === "export",
        );
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
        design.thicknessMm,
        design.paired?.leftThicknessMm,
        design.paired?.rightThicknessMm,
        design.corrections,
        geometryElementsKey,
        design.pattern,
        design.shoeWidth,
        design.shoeWidthBySide,
        design.shapeFinish,
        design.trimlines,
        design.textMarking,
        correctionPreview,
        thicknessPreview,
        elementPreviews,
        interacting,
        interactionSource,
        building,
        setBaseMeshLoading,
        wallModel,
        wallStyle,
        deviceType,
        lateralFlangeHeightMm,
        lateralFlangeLengthMm,
        lateralFlangeAngleDeg,
        bottomPattern,
        generatedPatternKey,
        bottomPatternEdit,
        retryNonce,
        loftCancelled,
        activeReady,
        clinicalStep,
        setLoftPhase,
        setLoftError,
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

    return { geometry, building, hasBase: Boolean(base), elementReference };
}
