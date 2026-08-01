import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
    createDefaultStockPairedBases,
    createFallbackStockDesignPatch,
    designHasBase,
    designNeedsDefaultStockResolution,
    designStockBasesAreResolved,
    getDesignStockAssetId,
    resolveStockBase,
    StockBaseResolutionError,
    sanitizeDesignStockBases,
} from "@/lib/geometry/base-asset";
import { type ConstraintViolation, constrainSideCorrections } from "@/lib/geometry/clinical-constraints";
import { defaultElementPose } from "@/lib/geometry/elements";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { stockDebug, stockFixLog, stockGlbLog, stockResolveLog } from "@/lib/geometry/stock-debug";
import { serializeTrimlineCurve, type TrimlineCurve } from "@/lib/geometry/trimline";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isApiConfigured } from "@/lib/trpc";
import { buildEffectiveTrimlines, useIssuesStore } from "@/stores/issues-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type {
    Corrections,
    DesignBase,
    DesignState,
    ElementKind,
    PlacedElement,
    PrescriptionParseResult,
    ProductionMethod,
    ScanPattern,
    Side,
    SideCorrections,
    Unit,
    WedgeCorrection,
} from "@/types";

function defaultSideCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
        // rearfootWedge and forefootWedge intentionally omitted (undefined = no wedge)
        // as per wedge system design for default/neutral state.
    };
}

/**
 * Store-level enforcement of mutual exclusion for wedges.
 * Per refined design: only one wedge type (medial or lateral) per zone.
 * Since the data model uses a single optional WedgeCorrection object per zone (rearfootWedge / forefootWedge),
 * "both" is not possible via normal setters. This defensive normalizer ensures that if a patch
 * somehow sets conflicting state (e.g. from bad external data), we prefer the patch's value or clear.
 * Called from updateCorrection.
 */
function enforceWedgeMutualExclusion(corrections: Corrections): Corrections {
    const newCorrections = { ...corrections };
    // For each side, if both wedge fields were somehow present in a way that conflicts (not typical),
    // but since they are different zones, no conflict between rear and fore.
    // The exclusion is per-zone (one side choice). Nothing to "clear" here beyond what the object model provides.
    // This function is a hook for future if we change model; currently structural.
    // For safety, ensure undefined for absent.
    if (!newCorrections.left.rearfootWedge) delete (newCorrections.left as any).rearfootWedge;
    if (!newCorrections.left.forefootWedge) delete (newCorrections.left as any).forefootWedge;
    if (!newCorrections.right.rearfootWedge) delete (newCorrections.right as any).rearfootWedge;
    if (!newCorrections.right.forefootWedge) delete (newCorrections.right as any).forefootWedge;
    return newCorrections;
}

export function defaultDesign(): DesignState {
    return {
        pattern: "full_contact",
        method: "printing_solid",
        thicknessMm: 3,
        corrections: {
            unit: "mm",
            linked: true,
            left: defaultSideCorrections(),
            right: defaultSideCorrections(),
        },
        elements: [],
        // paired remains undefined for legacy/single side designs
    };
}

/**
 * Every new design must start from the default stock GLB (Base + Modifier model).
 * When the API is configured, injects a non-loadable pending stub; applyDefaultStockBase()
 * must run (after auth) to fetch the real Supabase GLB. Offline dev uses the local placeholder.
 */
export function createDesignWithStockPlaceholder(design?: DesignState): DesignState {
    const d = design ?? defaultDesign();
    if (designHasBase(d)) return d;

    const { left, right } = createDefaultStockPairedBases();
    stockFixLog("createDesignWithStockPlaceholder() injected pending paired placeholders", {
        leftName: left.name,
        rightName: right.name,
        leftUrl: left.url ?? "(pending resolution)",
        leftGlbPath: left.glbPath ?? "(none)",
    });
    stockGlbLog(
        `createDesignWithStockPlaceholder() injected placeholder — left="${left.name}" right="${right.name}" url="${left.url ?? "(pending resolution)"}" glb_path="${left.glbPath ?? "(none)"}"`,
    );
    stockDebug("createDesignWithStockPlaceholder()", {
        leftAssetId: left.assetId,
        rightAssetId: right.assetId,
        leftGlbPath: left.glbPath,
        leftUrl: left.url ?? null,
        apiConfigured: isApiConfigured(),
    });
    return {
        ...d,
        pattern: "custom",
        base: left,
        customPrefabId: left.assetId,
        customPrefabName: left.name,
        paired: {
            leftBase: left,
            rightBase: right,
            leftThicknessMm: d.thicknessMm ?? 3,
            rightThicknessMm: d.thicknessMm ?? 3,
            leftMethod: d.method,
            rightMethod: d.method,
            linked: false,
        },
    };
}

let stockBaseUpgradeInFlight: Promise<void> | null = null;

/** When true, automatic ensureDefaultStockBaseResolved() calls are suppressed (prevents infinite retry). */
let stockBaseAutoRetryBlocked = false;

function markStockBaseResolved(): void {
    stockBaseAutoRetryBlocked = false;
    useDesignStore.setState({ stockBaseResolutionState: "resolved" });
}

function markStockBaseFailed(msg: string): void {
    stockBaseAutoRetryBlocked = true;
    useDesignStore.setState({
        stockBaseError: msg,
        stockBaseResolutionState: "failed",
        stockBaseLoading: false,
    });
}

/** Fire-and-forget server resolution for stock bases missing an authoritative URL. */
function upgradeStockBaseAsync(apply: () => Promise<void>, reason: string): void {
    if (stockBaseAutoRetryBlocked) {
        stockFixLog("upgradeStockBaseAsync() skipped — auto-retry blocked after prior failure", { reason });
        return;
    }
    if (stockBaseUpgradeInFlight) {
        stockFixLog("upgradeStockBaseAsync() skipped — already in flight", { reason });
        return;
    }

    stockFixLog("upgradeStockBaseAsync() start", { reason });
    stockDebug("upgradeStockBaseAsync() start", { reason });
    useDesignStore.setState({
        stockBaseLoading: true,
        stockBaseError: null,
        stockBaseResolutionState: "loading",
    });
    stockBaseUpgradeInFlight = apply()
        .then(() => {
            const d = useDesignStore.getState().design;
            const injected = d.paired?.rightBase ?? d.base;
            if (!designStockBasesAreResolved(d)) {
                const msg =
                    "Stock base resolution finished without glbPath and a valid download URL on both feet.";
                stockResolveLog("upgradeStockBaseAsync() incomplete — not marking resolved", {
                    reason,
                    leftGlbPath: d.paired?.leftBase?.glbPath ?? null,
                    rightGlbPath: d.paired?.rightBase?.glbPath ?? null,
                    leftUrl: d.paired?.leftBase?.url ?? null,
                    rightUrl: d.paired?.rightBase?.url ?? null,
                });
                markStockBaseFailed(msg);
                return;
            }
            markStockBaseResolved();
            stockFixLog(`upgradeStockBaseAsync() success (${reason})`, {
                url: injected?.url ?? null,
                glbPath: injected?.glbPath ?? null,
                name: injected?.name ?? null,
            });
            stockGlbLog(
                `upgradeStockBaseAsync() success (${reason}) — injected url="${injected?.url ?? "(none)"}" glb_path="${injected?.glbPath ?? "(none)"}" name="${injected?.name ?? "(none)"}"`,
            );
            stockDebug("upgradeStockBaseAsync() success", {
                reason,
                url: injected?.url,
                glbPath: injected?.glbPath,
            });
        })
        .catch((e) => {
            const msg =
                e instanceof StockBaseResolutionError
                    ? e.message
                    : "Failed to load the default stock base. Check server configuration.";
            stockFixLog(
                "upgradeStockBaseAsync() failed — applying offline fallback and blocking auto-retry",
                {
                    reason,
                    error: msg,
                },
            );
            stockDebug("upgradeStockBaseAsync() failed", {
                reason,
                error: msg,
            });
            console.error("[STOCK_FIX] Default stock base resolution failed:", e);
            // applyDefaultStockBase already applies fallback; ensure blocked state if it threw early.
            if (!stockBaseAutoRetryBlocked) {
                markStockBaseFailed(msg);
            }
        })
        .finally(() => {
            stockBaseUpgradeInFlight = null;
            useDesignStore.setState({ stockBaseLoading: false });
        });
}

/**
 * Resolve the default stock base from the server when required.
 * Safe to call repeatedly — dedupes in-flight requests and re-runs after auth is ready.
 */
export function ensureDefaultStockBaseResolved(): void {
    if (!isApiConfigured()) {
        stockFixLog("ensureDefaultStockBaseResolved() skipped — API not configured");
        return;
    }
    if (stockBaseAutoRetryBlocked) {
        stockFixLog("ensureDefaultStockBaseResolved() skipped — auto-retry blocked after failure");
        return;
    }
    const design = useDesignStore.getState().design;
    const needs = designNeedsDefaultStockResolution(design);
    const resolved = designStockBasesAreResolved(design);
    stockFixLog("ensureDefaultStockBaseResolved()", { needsResolution: needs, fullyResolved: resolved });
    stockDebug("ensureDefaultStockBaseResolved()", { needsResolution: needs, fullyResolved: resolved });
    stockResolveLog("ensureDefaultStockBaseResolved()", {
        needsResolution: needs,
        fullyResolved: resolved,
        assetId: getDesignStockAssetId(design),
    });
    if (!needs) {
        if (resolved && designStockBasesAreResolved(design)) {
            stockResolveLog("ensureDefaultStockBaseResolved() — already fully resolved", {
                assetId: getDesignStockAssetId(design),
                glbPath: design.paired?.rightBase?.glbPath ?? design.base?.glbPath ?? null,
                hasUrl: Boolean(design.paired?.rightBase?.url ?? design.base?.url),
            });
            markStockBaseResolved();
            return;
        }
        stockResolveLog(
            "ensureDefaultStockBaseResolved() — bases present but missing glbPath/url, resolving",
        );
    }
    upgradeStockBaseAsync(
        () => useDesignStore.getState().applyDefaultStockBase(),
        "ensureDefaultStockBaseResolved",
    );
}

/** User-initiated retry after a stock base resolution failure (StatusBar Retry button). */
export function retryStockBaseResolution(): void {
    stockFixLog("retryStockBaseResolution() — clearing blocked state and re-attempting");
    stockBaseAutoRetryBlocked = false;
    useDesignStore.setState({
        stockBaseError: null,
        stockBaseResolutionState: "idle",
    });
    ensureDefaultStockBaseResolved();
}

/** Await server resolution (used on new design creation when possible). */
export async function resolveDefaultStockBaseForDesign(): Promise<void> {
    if (!isApiConfigured()) return;
    await useDesignStore.getState().applyDefaultStockBase();
}

/** Named camera viewpoints. Orthographic-style views drive trimline planar constraint. */
export type CameraView = "iso" | "front" | "back" | "left" | "right" | "top" | "bottom";

export interface ViewerSettings {
    transparent: boolean;
    heightmap: boolean;
    showLeft: boolean;
    showRight: boolean;
    /** Show imported foot scan meshes in the viewer. */
    showScans: boolean;
    /** Active named camera view (for UI + planar editing constraint). */
    view: CameraView;
}

export type TransformMode = "translate" | "rotate" | "scale";

export type StockBaseResolutionState = "idle" | "loading" | "resolved" | "failed";

export interface DesignStore {
    design: DesignState;
    /** Set when the mandatory default stock base cannot be loaded from the server. */
    stockBaseError: string | null;
    /** True while fetching the default stock base from the server. */
    stockBaseLoading: boolean;
    /** Tracks server stock resolution lifecycle — prevents infinite auto-retry loops. */
    stockBaseResolutionState: StockBaseResolutionState;
    /** True per side while the viewer is waiting on or loading a base GLB mesh. */
    baseMeshLoadingBySide: Record<Side, boolean>;
    /** Active foot side for STL/GLB/G-code export (shared across tabs + keyboard shortcut). */
    exportSide: Side;
    viewer: ViewerSettings;
    selectedElementId: string | null;
    transformMode: TransformMode;

    /** Undo stack (most recent first). Session-only, not persisted to localStorage. */
    history: DesignState[];
    /** Redo stack. Cleared on new mutations. */
    future: DesignState[];

    setPattern: (pattern: ScanPattern) => void;
    setMethod: (method: ProductionMethod) => void;
    setThickness: (mm: number) => void;
    setUnit: (unit: Unit) => void;
    setLinked: (linked: boolean) => void;

    /** Patch corrections for a side. When linked, mirrors to the other side. */
    updateCorrection: (side: Side, patch: Partial<SideCorrections>) => void;

    /** Live production constraint violations for the current design (derived). */
    getActiveViolations: () => ConstraintViolation[];

    addElement: (kind: ElementKind, side: Side) => void;
    addCustomElement: (customElementId: string, customName: string, side: Side) => void;
    updateElement: (id: string, patch: Partial<PlacedElement>) => void;
    removeElement: (id: string) => void;
    selectElement: (id: string | null) => void;
    setTransformMode: (mode: TransformMode) => void;
    setCustomPrefab: (customPrefabId: string, customPrefabName: string) => void;

    /** Set the base template the design starts from (Base + Modifier model). */
    setBase: (base: DesignBase) => void;
    /** Remove the base template and revert to full parametric generation. */
    clearBase: () => void;

    /**
     * Load/refresh the default stock base from the server (stock_bases table).
     * Returns a promise so callers can await authoritative data (real UUID, storage URL, primarySide).
     * The implementation builds a mirrored pair when the stock record indicates a single-sided asset.
     */
    applyDefaultStockBase: () => Promise<void>;

    /** Clear the stock base load error banner after the user dismisses it. */
    clearStockBaseError: () => void;

    /** Atomically apply an AI-parsed prescription to the design. */
    applyPrescription: (result: PrescriptionParseResult) => void;

    /** Replace the entire design (used when opening a saved design). */
    loadDesign: (design: DesignState) => void;

    /** Persist a confirmed trimline curve for one foot side. */
    setSideTrimline: (side: Side, curve: TrimlineCurve | null) => void;
    /** Remove custom trimline for one side (revert to parametric outline). */
    clearSideTrimline: (side: Side) => void;

    setViewer: (patch: Partial<ViewerSettings>) => void;
    setExportSide: (side: Side) => void;
    setBaseMeshLoading: (side: Side, loading: boolean) => void;
    reset: () => void;

    /** Push a snapshot of the current design onto the undo stack (clears future). */
    checkpoint: (label?: string) => void;
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    /** Clear history (call after explicit server Save or when starting a brand new clinical case). */
    clearHistory: () => void;

    /** Set or clear rearfoot wedge (mutual exclusion per zone is by using a single WedgeCorrection object or undefined). */
    setRearfootWedge: (side: Side, wedge: WedgeCorrection | undefined) => void;
    /** Set or clear forefoot wedge (mutual exclusion per zone is by using a single WedgeCorrection object or undefined). */
    setForefootWedge: (side: Side, wedge: WedgeCorrection | undefined) => void;

    /** Set paired left/right bases for dual-view workspace. Sets per-side bases, defaults per-side thickness/method from legacy or defaults, sets paired.linked = false for independence. */
    setPairedBases: (left?: DesignBase, right?: DesignBase) => void;
}

export const useDesignStore = create<DesignStore>()(
    persist(
        (set, get) => ({
            design: createDesignWithStockPlaceholder(),
            stockBaseError: null,
            // Show "Loading base…" immediately while the pending stub waits for the server GLB.
            stockBaseLoading: isApiConfigured(),
            stockBaseResolutionState: isApiConfigured() ? "loading" : "resolved",
            baseMeshLoadingBySide: { left: false, right: false },
            exportSide: "left",
            viewer: {
                transparent: false,
                heightmap: false,
                showLeft: true,
                showRight: true,
                showScans: true,
                view: "iso",
            },
            selectedElementId: null,
            transformMode: "translate",
            history: [],
            future: [],

            setPattern: (pattern) =>
                set((s) => ({
                    // Scan pattern is metadata only — never clears the mandatory GLB base.
                    design: { ...s.design, pattern },
                })),
            setMethod: (method) => set((s) => ({ design: { ...s.design, method } })),
            setThickness: (thicknessMm) =>
                set((s) => {
                    const isPaired = !!s.design.paired;
                    const linked = isPaired ? s.design.paired!.linked : s.design.corrections.linked;
                    if (isPaired && s.design.paired) {
                        // Per-side thickness for paired workspace. Corrections live
                        // top-level (paired holds only thickness/method/base) — reading
                        // a non-existent paired.left here used to throw and silently
                        // swallow every thickness change in paired mode.
                        const safe = constrainSideCorrections(
                            s.design.corrections.left,
                            thicknessMm,
                        ).thicknessMm;
                        const next = {
                            ...s.design.paired,
                            leftThicknessMm: safe,
                            rightThicknessMm: safe,
                        };
                        return {
                            design: {
                                ...s.design,
                                thicknessMm: safe, // legacy compat
                                paired: next,
                            },
                        };
                    }
                    const left = s.design.corrections.left;
                    const right = s.design.corrections.right;
                    // Use constrain on a representative side for thickness decision, then re-apply full.
                    const rep = constrainSideCorrections(left, thicknessMm);
                    const safeThickness = rep.thicknessMm;
                    // Re-clamp both sides against the (possibly reduced) thickness.
                    const r1 = constrainSideCorrections(left, safeThickness);
                    const r2 = constrainSideCorrections(right, safeThickness);
                    const nextLeft = r1.constrained;
                    const nextRight = linked ? r1.constrained : r2.constrained;
                    return {
                        design: {
                            ...s.design,
                            thicknessMm: safeThickness,
                            corrections: {
                                ...s.design.corrections,
                                left: nextLeft,
                                right: nextRight,
                            },
                        },
                    };
                }),

            setUnit: (unit) =>
                set((s) => ({
                    design: { ...s.design, corrections: { ...s.design.corrections, unit } },
                })),
            setLinked: (linked) =>
                set((s) => ({
                    design: {
                        ...s.design,
                        corrections: { ...s.design.corrections, linked },
                        paired: s.design.paired ? { ...s.design.paired, linked } : undefined,
                    },
                })),

            updateCorrection: (side, patch) =>
                set((s) => {
                    let corrections: Corrections = { ...s.design.corrections };
                    corrections[side] = { ...corrections[side], ...patch };
                    if (corrections.linked) {
                        const other: Side = side === "left" ? "right" : "left";
                        corrections[other] = { ...corrections[other], ...patch };
                    }
                    // Enforce mutual exclusion for wedges at store level: a zone can have at most one wedge object.
                    // Structural (single field per zone), but defensively clear the other if a bad patch tries both (shouldn't happen via UI).
                    // Here we just ensure only one is set per zone in the patch; the model prevents "both medial and lateral" simultaneously.
                    corrections = enforceWedgeMutualExclusion(corrections);

                    // Apply clinical constraints (clamps + combined wall/arch guards).
                    // Note: wedge objects (if present in patch) are clamped inside constrainSideCorrections
                    // (value clamped per unit; mutual exclusion is structural: one WedgeCorrection per zone).
                    const leftResult = constrainSideCorrections(corrections.left, s.design.thicknessMm);
                    const { constrained: safeLeft, thicknessMm: t1 } = leftResult;
                    const rightResult = constrainSideCorrections(corrections.right, t1);
                    const { constrained: safeRight } = rightResult;
                    const finalLeft = safeLeft;
                    const finalRight = corrections.linked ? safeLeft : safeRight;
                    return {
                        design: {
                            ...s.design,
                            thicknessMm: t1,
                            corrections: {
                                ...corrections,
                                left: finalLeft,
                                right: finalRight,
                            },
                        },
                    };
                }),

            /** Set or clear the rearfoot wedge for a side (enforces one choice per zone via the single object). */
            setRearfootWedge: (side, wedge) =>
                set((s) => {
                    const patch = { rearfootWedge: wedge } as Partial<SideCorrections>;
                    const corrections: Corrections = { ...s.design.corrections };
                    corrections[side] = { ...corrections[side], ...patch };
                    if (corrections.linked) {
                        const other: Side = side === "left" ? "right" : "left";
                        corrections[other] = { ...corrections[other], ...patch };
                    }
                    const { constrained: safeLeft, thicknessMm: t1 } = constrainSideCorrections(
                        corrections.left,
                        s.design.thicknessMm,
                    );
                    const { constrained: safeRight } = constrainSideCorrections(corrections.right, t1);
                    const finalLeft = safeLeft;
                    const finalRight = corrections.linked ? safeLeft : safeRight;
                    return {
                        design: {
                            ...s.design,
                            thicknessMm: t1,
                            corrections: {
                                ...corrections,
                                left: finalLeft,
                                right: finalRight,
                            },
                        },
                    };
                }),

            /** Set or clear the forefoot wedge for a side (enforces one choice per zone via the single object). */
            setForefootWedge: (side, wedge) =>
                set((s) => {
                    const patch = { forefootWedge: wedge } as Partial<SideCorrections>;
                    const corrections: Corrections = { ...s.design.corrections };
                    corrections[side] = { ...corrections[side], ...patch };
                    if (corrections.linked) {
                        const other: Side = side === "left" ? "right" : "left";
                        corrections[other] = { ...corrections[other], ...patch };
                    }
                    const { constrained: safeLeft, thicknessMm: t1 } = constrainSideCorrections(
                        corrections.left,
                        s.design.thicknessMm,
                    );
                    const { constrained: safeRight } = constrainSideCorrections(corrections.right, t1);
                    const finalLeft = safeLeft;
                    const finalRight = corrections.linked ? safeLeft : safeRight;
                    return {
                        design: {
                            ...s.design,
                            thicknessMm: t1,
                            corrections: {
                                ...corrections,
                                left: finalLeft,
                                right: finalRight,
                            },
                        },
                    };
                }),

            setPairedBases: (left, right) =>
                set((s) => {
                    const currentThickness = s.design.thicknessMm || 3;
                    const currentMethod = s.design.method || "printing_solid";
                    const newPaired = {
                        leftBase: left,
                        rightBase: right,
                        leftThicknessMm: currentThickness,
                        rightThicknessMm: currentThickness,
                        leftMethod: currentMethod,
                        rightMethod: currentMethod,
                        linked: false, // default independence for paired workspace
                        rightMetadata: right ? { mirroredFrom: left?.assetId } : undefined,
                    };
                    return {
                        design: {
                            ...s.design,
                            // keep legacy base for compat if single
                            paired: newPaired,
                            // if setting paired, also set legacy base to left for hooks that don't yet support paired
                            base: left || s.design.base,
                        },
                    };
                }),

            addElement: (kind, side) => {
                get().checkpoint("add-element");
                set((s) => {
                    const pose = defaultElementPose(kind, side, INSOLE_LENGTH_MM, INSOLE_WIDTH_MM);
                    const el: PlacedElement = {
                        id: crypto.randomUUID(),
                        kind,
                        side,
                        ...pose,
                    };
                    const next = { ...s.design, elements: [...s.design.elements, el] };
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return { design: next, selectedElementId: el.id };
                });
            },

            addCustomElement: (customElementId, customName, side) => {
                get().checkpoint("add-custom-element");
                set((s) => {
                    const el: PlacedElement = {
                        id: crypto.randomUUID(),
                        kind: "custom",
                        customElementId,
                        customName,
                        side,
                        position: { x: 0, y: 0 },
                        rotationDeg: 0,
                        scale: { x: 1, y: 1 },
                        heightMm: 4,
                    };
                    const next = { ...s.design, elements: [...s.design.elements, el] };
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return { design: next, selectedElementId: el.id };
                });
            },

            setCustomPrefab: (customPrefabId, customPrefabName) =>
                set((s) => ({
                    design: {
                        ...s.design,
                        pattern: "custom",
                        customPrefabId,
                        customPrefabName,
                        // Keep the canonical base in sync so modifiers apply to it.
                        base: { assetId: customPrefabId, name: customPrefabName, source: "custom" },
                    },
                })),

            setBase: (base) => {
                const snap = get().design;
                set((s) => ({
                    design: {
                        ...s.design,
                        pattern: "custom",
                        base,
                        customPrefabId: base.assetId,
                        customPrefabName: base.name,
                    },
                }));
                // Only checkpoint if something actually changed (base switch is a big clinical action).
                if (snap.base?.assetId !== base.assetId) get().checkpoint("set-base");
            },

            clearBase: () => {
                const hadBase = !!get().design.base || !!get().design.paired;
                set((s) => ({
                    design: {
                        ...s.design,
                        pattern: s.design.pattern === "custom" ? "full_contact" : s.design.pattern,
                        base: undefined,
                        customPrefabId: undefined,
                        customPrefabName: undefined,
                        paired: undefined,
                    },
                }));
                if (hadBase) get().checkpoint("clear-base");
            },

            applyDefaultStockBase: async () => {
                try {
                    const snap = get().design;
                    const assetId = getDesignStockAssetId(snap);
                    stockFixLog("applyDefaultStockBase() start", { assetId });
                    stockDebug("applyDefaultStockBase() start", { assetId });
                    stockResolveLog("applyDefaultStockBase() start", { assetId });
                    set({
                        stockBaseError: null,
                        stockBaseLoading: true,
                        stockBaseResolutionState: "loading",
                    });
                    const resolved = await resolveStockBase(assetId);
                    const { left, right } = createDefaultStockPairedBases(resolved);
                    stockResolveLog("applyDefaultStockBase() resolved — injecting mirrored L+R pair", {
                        resolvedId: resolved.assetId,
                        glbPath: resolved.glbPath ?? null,
                        hasUrl: Boolean(resolved.url),
                    });
                    stockFixLog("applyDefaultStockBase() server success — injecting mirrored L+R pair", {
                        resolvedId: resolved.assetId,
                        glbPath: resolved.glbPath,
                        url: resolved.url ?? null,
                        leftName: left.name,
                        rightName: right.name,
                    });
                    stockGlbLog(
                        `applyDefaultStockBase() injecting stock base — url="${resolved.url ?? "(none)"}" glb_path="${resolved.glbPath ?? "(none)"}" left="${left.name}" right="${right.name}"`,
                    );
                    stockDebug("applyDefaultStockBase() applying paired bases", {
                        resolvedId: resolved.assetId,
                        resolvedGlbPath: resolved.glbPath,
                        resolvedUrl: resolved.url ?? null,
                        leftName: left.name,
                        rightName: right.name,
                    });
                    set((s) => ({
                        design: {
                            ...s.design,
                            pattern: "custom",
                            base: left,
                            customPrefabId: left.assetId,
                            customPrefabName: left.name,
                            paired: {
                                leftBase: left,
                                rightBase: right,
                                leftThicknessMm:
                                    s.design.paired?.leftThicknessMm ?? s.design.thicknessMm ?? 3,
                                rightThicknessMm:
                                    s.design.paired?.rightThicknessMm ?? s.design.thicknessMm ?? 3,
                                leftMethod: s.design.paired?.leftMethod ?? s.design.method,
                                rightMethod: s.design.paired?.rightMethod ?? s.design.method,
                                linked: s.design.paired?.linked ?? false,
                            },
                        },
                        stockBaseLoading: false,
                        stockBaseResolutionState: "resolved",
                    }));
                    stockBaseAutoRetryBlocked = false;
                    if (snap.base?.assetId !== left.assetId && snap.base?.assetId !== right.assetId) {
                        get().checkpoint("default-stock-base");
                    }
                } catch (e) {
                    const msg =
                        e instanceof StockBaseResolutionError
                            ? e.message
                            : "Failed to load the default stock base. Check server configuration.";
                    stockResolveLog("applyDefaultStockBase() error", { error: msg });
                    stockFixLog("applyDefaultStockBase() error", {
                        error: msg,
                        supabaseConfigured: isSupabaseConfigured(),
                    });
                    stockDebug("applyDefaultStockBase() error", { error: msg });
                    stockBaseAutoRetryBlocked = true;
                    if (isSupabaseConfigured()) {
                        set({
                            stockBaseError: msg,
                            stockBaseLoading: false,
                            stockBaseResolutionState: "failed",
                        });
                    } else {
                        const snap = get().design;
                        const fallbackPatch = createFallbackStockDesignPatch(snap);
                        set((s) => ({
                            design: { ...s.design, ...fallbackPatch },
                            stockBaseError: msg,
                            stockBaseLoading: false,
                            stockBaseResolutionState: "failed",
                        }));
                    }
                    throw e;
                }
            },

            clearStockBaseError: () => set({ stockBaseError: null }),

            updateElement: (id, patch) =>
                set((s) => {
                    const nextElements = s.design.elements.map((e) => (e.id === id ? { ...e, ...patch } : e));
                    const next = { ...s.design, elements: nextElements };
                    // Recompute orphans when an element moves/scales (common source of "outside trimline").
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return { design: next };
                }),

            removeElement: (id) => {
                get().checkpoint("remove-element");
                set((s) => {
                    const nextElements = s.design.elements.filter((e) => e.id !== id);
                    const next = { ...s.design, elements: nextElements };
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return {
                        design: next,
                        selectedElementId: s.selectedElementId === id ? null : s.selectedElementId,
                    };
                });
            },

            selectElement: (selectedElementId) => set({ selectedElementId }),
            setTransformMode: (transformMode) => set({ transformMode }),

            applyPrescription: (result) => {
                usePerformanceStore.getState().setInteracting(true, "ai");
                set((s) => {
                    const baseThickness = result.thicknessMm ?? s.design.thicknessMm;
                    const baseLeft = { ...s.design.corrections.left, ...(result.corrections.left ?? {}) };
                    const baseRight = { ...s.design.corrections.right, ...(result.corrections.right ?? {}) };
                    // Clamp AI output immediately — parsed prescriptions can be aggressive.
                    const r1 = constrainSideCorrections(baseLeft, baseThickness);
                    const r2 = constrainSideCorrections(baseRight, r1.thicknessMm);
                    const corrections: Corrections = {
                        ...s.design.corrections,
                        unit: result.unit ?? s.design.corrections.unit,
                        left: r1.constrained,
                        right: s.design.corrections.linked ? r1.constrained : r2.constrained,
                    };
                    const elements: PlacedElement[] = result.elements.map((e) => ({
                        id: crypto.randomUUID(),
                        kind: e.kind,
                        side: e.side,
                        ...defaultElementPose(e.kind, e.side, INSOLE_LENGTH_MM, INSOLE_WIDTH_MM),
                    }));
                    return {
                        design: {
                            ...s.design,
                            pattern: result.pattern ?? s.design.pattern,
                            method: result.method ?? s.design.method,
                            thicknessMm: r1.thicknessMm,
                            corrections,
                            elements: [...s.design.elements, ...elements],
                        },
                    };
                });
                requestAnimationFrame(() => usePerformanceStore.getState().setInteracting(false));
            },

            loadDesign: (incoming) => {
                usePerformanceStore.getState().clearAllPreviews();
                useMeshEditStore.getState().cancelTrimlineEdit();
                useIssuesStore.getState().clear();
                get().clearHistory(); // Loaded design becomes the new undo root.
                // Sanitize on load so persisted or imported designs are always valid.
                const r = constrainSideCorrections(incoming.corrections.left, incoming.thicknessMm);
                const r2 = constrainSideCorrections(incoming.corrections.right, r.thicknessMm);
                let safeDesign: DesignState = {
                    ...incoming,
                    thicknessMm: r.thicknessMm,
                    corrections: {
                        ...incoming.corrections,
                        left: r.constrained,
                        right: incoming.corrections.linked ? r.constrained : r2.constrained,
                    },
                };
                // Legacy or parametric-only saved designs: inject the mandatory stock GLB base.
                const hadBase = designHasBase(safeDesign);
                if (!hadBase) {
                    safeDesign = createDesignWithStockPlaceholder(safeDesign);
                }
                safeDesign = sanitizeDesignStockBases(safeDesign);
                const eff = buildEffectiveTrimlines(safeDesign);
                useIssuesStore.getState().recompute(safeDesign, eff);
                const needsResolution = !hadBase || designNeedsDefaultStockResolution(safeDesign);
                const waitingOnServer = needsResolution && isApiConfigured();
                stockBaseAutoRetryBlocked = false;
                set({
                    design: safeDesign,
                    selectedElementId: null,
                    stockBaseError: null,
                    stockBaseLoading: waitingOnServer,
                    stockBaseResolutionState: waitingOnServer ? "loading" : "resolved",
                });

                // Resolve server stock base when missing or still on a local/sync placeholder.
                if (needsResolution) {
                    upgradeStockBaseAsync(() => get().applyDefaultStockBase(), "loadDesign");
                }
            },

            setSideTrimline: (side, curve) => {
                get().checkpoint("set-trimline");
                set((s) => {
                    const trimlines = { ...s.design.trimlines };
                    if (curve && curve.points.length >= 4) {
                        trimlines[side] = serializeTrimlineCurve(curve);
                    } else {
                        delete trimlines[side];
                    }
                    return {
                        design: {
                            ...s.design,
                            trimlines: Object.keys(trimlines).length > 0 ? trimlines : undefined,
                        },
                    };
                });
            },

            clearSideTrimline: (side) => {
                if (!get().design.trimlines?.[side]) return;
                get().checkpoint("clear-trimline");
                set((s) => {
                    if (!s.design.trimlines?.[side]) return s;
                    const trimlines = { ...s.design.trimlines };
                    delete trimlines[side];
                    return {
                        design: {
                            ...s.design,
                            trimlines: Object.keys(trimlines).length > 0 ? trimlines : undefined,
                        },
                    };
                });
            },

            setViewer: (patch) => set((s) => ({ viewer: { ...s.viewer, ...patch } })),
            setExportSide: (side) => set({ exportSide: side }),
            setBaseMeshLoading: (side, loading) =>
                set((s) => ({
                    baseMeshLoadingBySide: { ...s.baseMeshLoadingBySide, [side]: loading },
                })),
            reset: () => {
                usePerformanceStore.getState().clearAllPreviews();
                useMeshEditStore.getState().cancelTrimlineEdit();
                useIssuesStore.getState().clear();
                get().clearHistory();
                const withStock = createDesignWithStockPlaceholder(defaultDesign());
                stockBaseAutoRetryBlocked = false;
                set({
                    design: withStock,
                    selectedElementId: null,
                    stockBaseError: null,
                    stockBaseLoading: isApiConfigured(),
                    stockBaseResolutionState: isApiConfigured() ? "loading" : "resolved",
                    baseMeshLoadingBySide: { left: false, right: false },
                });
                upgradeStockBaseAsync(() => get().applyDefaultStockBase(), "reset");
            },

            getActiveViolations: () => {
                const d = useDesignStore.getState().design;
                const r1 = constrainSideCorrections(d.corrections.left, d.thicknessMm);
                const r2 = constrainSideCorrections(d.corrections.right, r1.thicknessMm);
                // Dedup combined messages for UI brevity.
                const seen = new Set<string>();
                const all = [...r1.violations, ...r2.violations].filter((vi) => {
                    const key = `${vi.field}:${vi.message}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                return all;
            },

            checkpoint: (label?: string) => {
                const current = get().design;
                const snap: DesignState = JSON.parse(JSON.stringify(current));
                // Phase 5: bump a simple design version for audit/versioned history.
                (snap as any).designVersion = ((snap as any).designVersion ?? 0) + 1;
                set((s) => ({
                    history: [snap, ...s.history].slice(0, 40),
                    future: [],
                }));
                // Also record in the client audit trail (pairs with server audit_logs in Phase 5).
                try {
                    // Lazy to avoid circular import at module top level.
                    import("@/stores/audit-store").then(({ useAuditStore }) => {
                        useAuditStore
                            .getState()
                            .record(
                                "design_saved",
                                `checkpoint${label ? ":" + label : ""} v${(snap as any).designVersion}`,
                            );
                    });
                } catch {}
            },

            undo: () => {
                const s = get();
                if (s.history.length === 0) return;
                const [prev, ...rest] = s.history;
                const currentSnap: DesignState = JSON.parse(JSON.stringify(s.design));
                // Restore previous and push current onto future for redo.
                usePerformanceStore.getState().clearAllPreviews();
                useMeshEditStore.getState().cancelTrimlineEdit();
                useIssuesStore.getState().clear();
                const eff = buildEffectiveTrimlines(prev);
                useIssuesStore.getState().recompute(prev, eff);
                set({
                    design: prev,
                    history: rest,
                    future: [currentSnap, ...s.future].slice(0, 40),
                    selectedElementId: null,
                });
            },

            redo: () => {
                const s = get();
                if (s.future.length === 0) return;
                const [next, ...restFuture] = s.future;
                const currentSnap: DesignState = JSON.parse(JSON.stringify(s.design));
                usePerformanceStore.getState().clearAllPreviews();
                useMeshEditStore.getState().cancelTrimlineEdit();
                useIssuesStore.getState().clear();
                const eff = buildEffectiveTrimlines(next);
                useIssuesStore.getState().recompute(next, eff);
                set({
                    design: next,
                    history: [currentSnap, ...s.history].slice(0, 40),
                    future: restFuture,
                    selectedElementId: null,
                });
            },

            canUndo: () => get().history.length > 0,
            canRedo: () => get().future.length > 0,

            clearHistory: () => set({ history: [], future: [] }),
        }),
        {
            name: "vertex-design-session",
            /** Keep live design (incl. trimlines) across page refresh before explicit Save. */
            partialize: (state) => ({ design: state.design }),
            onRehydrateStorage: () => (state) => {
                if (!state?.design) return;
                let design = sanitizeDesignStockBases(state.design);
                if (!designHasBase(design)) {
                    design = createDesignWithStockPlaceholder(design);
                }
                const needsResolution = designNeedsDefaultStockResolution(design);
                stockDebug("persist onRehydrate", {
                    needsResolution,
                    supabaseConfigured: isSupabaseConfigured(),
                    apiConfigured: isApiConfigured(),
                    baseAssetId: design.base?.assetId,
                    baseGlbPath: design.base?.glbPath,
                    hasUrl: Boolean(design.base?.url),
                });
                stockBaseAutoRetryBlocked = false;
                const waitingOnServer = needsResolution && isApiConfigured();
                useDesignStore.setState({
                    design,
                    stockBaseError: null,
                    stockBaseLoading: waitingOnServer,
                    stockBaseResolutionState: waitingOnServer ? "loading" : "resolved",
                    baseMeshLoadingBySide: { left: false, right: false },
                });
                stockFixLog("persist onRehydrate", { needsResolution, apiConfigured: isApiConfigured() });
                // When Supabase auth is required, App.tsx resolves after the session is ready.
                if (needsResolution && (!isSupabaseConfigured() || !isApiConfigured())) {
                    upgradeStockBaseAsync(
                        () => useDesignStore.getState().applyDefaultStockBase(),
                        "persist-rehydrate-no-supabase",
                    );
                } else if (needsResolution && isSupabaseConfigured()) {
                    stockFixLog("persist onRehydrate deferring to App.tsx until auth is ready");
                    stockDebug("persist onRehydrate deferring to App.tsx until auth is ready");
                }
            },
        },
    ),
);
