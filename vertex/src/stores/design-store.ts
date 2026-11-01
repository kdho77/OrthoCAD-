import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ExportOutputTarget } from "@/features/exports/export-target";
import {
    applyCorrectionPresetToDesign,
    type CorrectionPresetApplyMode,
    type CorrectionPresetPayload,
} from "@/lib/clinical/correction-presets";
import {
    createDefaultStockPairedBases,
    designHasBase,
    designNeedsDefaultStockResolution,
    designStockBasesAreResolved,
    designUsesLegacyDefaultStock,
    getDesignStockAssetId,
    getSampleTopStockBase,
    replaceBuiltinDefaultWithSampleTop,
    StockBaseResolutionError,
    sanitizeDesignStockBases,
} from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { type ConstraintViolation, constrainSideCorrections } from "@/lib/geometry/clinical-constraints";
import { defaultElementPose } from "@/lib/geometry/elements";
import {
    migrateCorrections,
    migrateDesignSinks,
    sinkStyloidThickenForSide,
    sinksForSide,
} from "@/lib/geometry/migrate-corrections";
import {
    defaultSideShapeFinish,
    normalizeSideShapeFinish,
    thicknessMmForDesignSide,
} from "@/lib/geometry/shape-finish-modifiers";
import {
    convertSizingToSystem,
    DEFAULT_SHOE_SIZE_SYSTEM,
    DEFAULT_US_MEN_SIZE,
    insoleLayoutForFootLengthMm,
    insoleLayoutForUkSize,
    insoleLayoutForUsMenSize,
    insoleLayoutFromDesign,
    normalizeFootLengthMm,
    normalizeShoeSizeSystem,
    normalizeUkSize,
    normalizeUsMenSize,
    type ShoeSizeSystem,
    usMenToUk,
} from "@/lib/geometry/shoe-size";
import { normalizeShoeWidth } from "@/lib/geometry/shoe-width";
import { SINK_DEFAULT_DEPTH_MM } from "@/lib/geometry/sink";
import { stockDebug, stockFixLog, stockGlbLog, stockResolveLog } from "@/lib/geometry/stock-debug";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { normalizeTextMarking } from "@/lib/geometry/text-marking/validate";
import { serializeTrimlineCurve, type TrimlineCurve } from "@/lib/geometry/trimline";
import { applyDefaultSplitHardness, defaultSplitHardnessPatch } from "@/lib/hardness/split-overlay";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isApiConfigured } from "@/lib/trpc";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClientStore } from "@/stores/client-store";
import { buildEffectiveTrimlines, useIssuesStore } from "@/stores/issues-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type {
    Corrections,
    DesignBase,
    DesignState,
    ElementKind,
    PlacedElement,
    PlacedSink,
    PrescriptionParseResult,
    PressureMapAlignment,
    PressureMapFoot,
    ProductionMethod,
    ScanPattern,
    ShapeFinishModifiers,
    Side,
    SideCorrections,
    SideShapeFinish,
    SinkKind,
    TextMarking,
    TrimPresetId,
    Unit,
    WedgeCorrection,
} from "@/types";
import type { NamedHardnessClass } from "../../shared/print-recipe/hardness-class-table";
import { type HardnessName, migratePrintRecipe } from "../../shared/print-recipe/print-recipe";

function defaultSideCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        forefootWidthMm: 0,
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

/** Scale element positions + trimlines when footprint length/width change. */
function scaleDesignToLayout(
    design: DesignState,
    next: ReturnType<typeof insoleLayoutFromDesign>,
    sizingPatch: Partial<DesignState>,
): DesignState {
    const prev = insoleLayoutFromDesign(design);
    const sx = next.lengthMm / prev.lengthMm;
    const sy = next.widthMm / prev.widthMm;
    const scaleNeeded = Math.abs(sx - 1) > 1e-9 || Math.abs(sy - 1) > 1e-9;

    const elements = scaleNeeded
        ? design.elements.map((el) => ({
              ...el,
              position: { x: el.position.x * sx, y: el.position.y * sy },
          }))
        : design.elements;

    let trimlines = design.trimlines;
    if (scaleNeeded && trimlines) {
        const scalePts = (pts: { x: number; y: number; z: number }[] | undefined) =>
            pts?.map((p) => ({ ...p, x: p.x * sx, y: p.y * sy }));
        trimlines = {
            left: scalePts(trimlines.left),
            right: scalePts(trimlines.right),
        };
    }

    return {
        ...design,
        ...sizingPatch,
        elements,
        trimlines,
    };
}

/** Write one foot's sink list. Linked corrections copy it onto the other foot. */
function writeSideSinks(design: DesignState, side: Side, list: PlacedSink[]): DesignState["sinks"] {
    const cleaned = list.length > 0 ? list : undefined;
    if (design.corrections.linked) {
        if (!cleaned) return undefined;
        return { left: cleaned, right: cleaned.map((sink) => ({ ...sink })) };
    }
    const next: { left?: PlacedSink[]; right?: PlacedSink[] } = {
        left: sinksForSide(design, "left"),
        right: sinksForSide(design, "right"),
    };
    next[side] = cleaned;
    if (!next.left?.length) delete next.left;
    if (!next.right?.length) delete next.right;
    if (!next.left && !next.right) return undefined;
    return next;
}

function writeSideThicken(design: DesignState, side: Side, on: boolean): DesignState["sinkStyloidThicken"] {
    if (design.corrections.linked) return on ? { left: true, right: true } : undefined;
    const next = {
        left: sinkStyloidThickenForSide(design, "left"),
        right: sinkStyloidThickenForSide(design, "right"),
    };
    next[side] = on;
    if (!next.left && !next.right) return undefined;
    return { ...(next.left ? { left: true } : {}), ...(next.right ? { right: true } : {}) };
}

function sinkKindById(design: DesignState, id: string): PlacedSink["kind"] | undefined {
    for (const side of ["left", "right"] as const) {
        const hit = sinksForSide(design, side)?.find((sink) => sink.id === id);
        if (hit) return hit.kind;
    }
    return undefined;
}

/** Linking copies the left foot's sinks onto the right, matching shoe-width link. */
function copyLinkedSinks(design: DesignState): DesignState["sinks"] {
    const left = sinksForSide(design, "left");
    if (!left) return undefined;
    return { left, right: left.map((sink) => ({ ...sink })) };
}

function defaultShapeFinishModifiers(method: ProductionMethod = "printing_solid"): ShapeFinishModifiers {
    const side = defaultSideShapeFinish(method);
    return { left: side, right: { ...side }, linked: true };
}

export function defaultDesign(): DesignState {
    return {
        pattern: "full_contact",
        method: "printing_solid",
        printRecipe: migratePrintRecipe(undefined),
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        shellThicknessMode: "zonal",
        shellThicknessRfMm: 3,
        shellThicknessMfMm: 2.5,
        shellThicknessFfMm: 2,
        shellThicknessBlendMm: 12,
        sizeSystem: DEFAULT_SHOE_SIZE_SYSTEM,
        usMenSize: DEFAULT_US_MEN_SIZE,
        shoeWidth: "medium",
        corrections: {
            unit: "mm",
            linked: true,
            left: defaultSideCorrections(),
            right: defaultSideCorrections(),
        },
        shapeFinish: defaultShapeFinishModifiers("printing_solid"),
        elements: [],
        // paired remains undefined for legacy/single side designs
    };
}

/**
 * Every new design starts from bundled SAMPLE_Top (Left + mirrored Right) with
 * the faired bottom pattern. Legacy Default.glb is never injected here.
 */
export function createDesignWithStockPlaceholder(design?: DesignState): DesignState {
    const d = replaceBuiltinDefaultWithSampleTop(design ?? defaultDesign());
    stockFixLog("createDesignWithStockPlaceholder() SAMPLE_Top pair", {
        leftName: d.paired?.leftBase?.name,
        rightName: d.paired?.rightBase?.name,
        leftUrl: d.paired?.leftBase?.url ?? d.base?.url ?? "(none)",
        leftGlbPath: d.paired?.leftBase?.glbPath ?? d.base?.glbPath ?? "(none)",
    });
    stockGlbLog(
        `createDesignWithStockPlaceholder() — left="${d.paired?.leftBase?.name ?? d.base?.name}" right="${d.paired?.rightBase?.name ?? ""}" url="${d.paired?.leftBase?.url ?? d.base?.url ?? "(none)"}" glb_path="${d.paired?.leftBase?.glbPath ?? d.base?.glbPath ?? "(none)"}"`,
    );
    return d;
}

let stockBaseUpgradeInFlight: Promise<void> | null = null;

/** When true, automatic ensureDefaultStockBaseResolved() calls are suppressed (prevents infinite retry). */
let stockBaseAutoRetryBlocked = false;

function markStockBaseResolved(): void {
    stockBaseAutoRetryBlocked = false;
    const current = useDesignStore.getState();
    // No-op when already resolved — a redundant setState still notifies
    // subscribers and remounted the SAMPLE_Top hook after login bootstrap.
    if (current.stockBaseResolutionState === "resolved" && current.stockBaseLoading === false) {
        return;
    }
    // Always clear the loading flag here — early-return paths used to leave
    // stockBaseLoading=true after a rehydrated/session design was already usable,
    // which stuck the viewer on "Loading base…" / "Loading stock base from server…".
    useDesignStore.setState({
        stockBaseResolutionState: "resolved",
        stockBaseLoading: false,
    });
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
        // Ensure a prior "loading" bootstrap flag cannot linger after a blocked retry.
        useDesignStore.setState({ stockBaseLoading: false });
        return;
    }
    if (stockBaseUpgradeInFlight) {
        stockFixLog("upgradeStockBaseAsync() skipped — already in flight", { reason });
        return;
    }

    // Rehydrate / auth races can call this after paired bases already have public URLs.
    // Do not flip loading back on — the mesh is already fetchable.
    const current = useDesignStore.getState().design;
    if (designStockBasesAreResolved(current)) {
        stockFixLog("upgradeStockBaseAsync() skipped — design already fully resolved", { reason });
        markStockBaseResolved();
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
        if (useDesignStore.getState().stockBaseLoading) {
            useDesignStore.setState({ stockBaseLoading: false });
        }
        return;
    }
    if (stockBaseAutoRetryBlocked) {
        stockFixLog("ensureDefaultStockBaseResolved() skipped — auto-retry blocked after failure");
        if (useDesignStore.getState().stockBaseLoading) {
            useDesignStore.setState({ stockBaseLoading: false });
        }
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
        stockResolveLog("ensureDefaultStockBaseResolved() — already fully resolved", {
            assetId: getDesignStockAssetId(design),
            glbPath: design.paired?.rightBase?.glbPath ?? design.base?.glbPath ?? null,
            hasUrl: Boolean(design.paired?.rightBase?.url ?? design.base?.url),
        });
        markStockBaseResolved();
        return;
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
    /**
     * Procedural walls rebuild from SAMPLE_Top + the faired bottom pattern.
     * Default `'procedural'` (Grinding Straight). `'legacy'` is test-only via
     * `?wallModel=legacy`. Not persisted; never touches modifiers/export.
     */
    wallModel?: "legacy" | "procedural";
    /**
     * Print-step grinding dropdown → wall mid-style. Default `'straight'`.
     * Applied only when `wallModel === "procedural"` (also `?wallStyle=`).
     */
    wallStyle?: "straight" | "round" | "hybrid";
    /** Viewer-only device-type preset for the procedural wall. Not persisted. */
    deviceType?: "functional" | "accommodative";
    lateralFlangeHeightMm?: number;
    lateralFlangeLengthMm?: number;
    lateralFlangeAngleDeg?: number;
}

export type TransformMode = "translate" | "rotate" | "scale";

export type StockBaseResolutionState = "idle" | "loading" | "resolved" | "failed";

export interface DesignStore {
    design: DesignState;
    /** Browser draft held aside until the user explicitly resumes it. */
    pendingSessionDesign: DesignState | null;
    resumeSession: () => void;
    startFreshSession: () => void;
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
    /** Print + Export footer target (Left / Right / Pair). Null until the user picks once per design. */
    exportTarget: ExportOutputTarget | null;
    /** Remembered footer targets keyed by active design id (or __draft__). */
    exportTargetByDesignId: Record<string, ExportOutputTarget>;
    viewer: ViewerSettings;
    selectedElementId: string | null;
    transformMode: TransformMode;

    /** Undo stack (most recent first). Session-only, not persisted to localStorage. */
    history: DesignState[];
    /** Redo stack. Cleared on new mutations. */
    future: DesignState[];

    setPattern: (pattern: ScanPattern) => void;
    setMethod: (method: ProductionMethod) => void;
    /** Named whole-device hardness (Phase A PrintRecipe). */
    setPrintHardness: (hardness: HardnessName) => void;
    setSplitElements: (on: boolean) => void;
    setSmoothElements: (on: boolean) => void;
    setThickness: (mm: number) => void;
    setUnit: (unit: Unit) => void;
    setLinked: (linked: boolean) => void;
    /** Change US shoe size and auto-scale footprint, trimlines, and element placement. */
    setUsShoeSize: (menSize: number) => void;
    /** Switch size system (US / UK / mm), converting the current footprint length. */
    setShoeSizeSystem: (system: ShoeSizeSystem) => void;
    /** Change UK shoe size and auto-scale. */
    setUkShoeSize: (ukSize: number) => void;
    /** Change foot length in mm and auto-scale. */
    setFootLengthMm: (mm: number) => void;
    setShoeWidth: (width: "narrow" | "medium" | "wide" | "extra_wide", side?: Side) => void;

    /** Patch corrections for a side. When linked, mirrors to the other side. */
    updateCorrection: (side: Side, patch: Partial<SideCorrections>) => void;

    updateShapeFinish: (side: Side, patch: Partial<SideShapeFinish>) => void;
    setShapeFinishLinked: (linked: boolean) => void;
    setTextMarking: (patch: Partial<TextMarking>) => void;

    /** Live production constraint violations for the current design (derived). */
    getActiveViolations: () => ConstraintViolation[];

    addElement: (kind: ElementKind, side: Side) => void;
    addCustomElement: (customElementId: string, customName: string, side: Side) => void;
    updateElement: (id: string, patch: Partial<PlacedElement>) => void;
    setElementHardness: (id: string, hardness: NamedHardnessClass) => void;
    removeElement: (id: string) => void;
    addSink: (kind: SinkKind, side: Side) => void;
    updateSink: (
        id: string,
        patch: Partial<Pick<PlacedSink, "depthMm" | "u" | "v" | "markerId" | "rimOverride">>,
        side: Side,
    ) => void;
    removeSink: (id: string, side: Side) => void;
    setSinkStyloidThicken: (on: boolean, side: Side) => void;
    selectElement: (id: string | null) => void;
    setTransformMode: (mode: TransformMode) => void;
    setCustomPrefab: (customPrefabId: string, customPrefabName: string) => void;

    /** Set the base template the design starts from (Base + Modifier model). */
    setBase: (base: DesignBase) => void;
    /** Remove the base template and revert to full parametric generation. */
    clearBase: () => void;

    /**
     * Apply bundled SAMPLE_Top as the L+R stock pair. Migrates leftover Default.glb.
     * Custom library prefabs that are already resolved are left alone.
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
    /** Record top-trim preset id for a foot (or clear with custom). */
    setTrimPresetId: (side: Side, preset: TrimPresetId | undefined) => void;

    /** Apply a correction macro preset without changing the clinical workflow step. */
    applyCorrectionPreset: (
        payload: CorrectionPresetPayload,
        mode: CorrectionPresetApplyMode,
        options?: { activeSide?: Side; label?: string },
    ) => void;

    setPressureMap: (side: Side, foot: PressureMapFoot) => void;
    removePressureMap: (side: Side) => void;
    setPressureMapVisible: (side: Side, visible: boolean) => void;
    patchPressureMapAlignment: (side: Side, patch: Partial<PressureMapAlignment>) => void;

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
    setExportTarget: (target: ExportOutputTarget | null) => void;
    /** Load remembered export target when switching designs. */
    syncExportTargetForDesign: (designId: string | null) => void;
}

export const useDesignStore = create<DesignStore>()(
    persist(
        (set, get) => ({
            design: createDesignWithStockPlaceholder(),
            pendingSessionDesign: null,
            resumeSession: () => {
                const draft = get().pendingSessionDesign;
                if (draft) get().loadDesign({ ...draft, corrections: migrateCorrections(draft.corrections) });
            },
            startFreshSession: () => {
                useClientStore.getState().setActiveDesign(null);
                get().reset();
            },
            stockBaseError: null,
            stockBaseLoading: false,
            stockBaseResolutionState: "resolved",
            baseMeshLoadingBySide: { left: false, right: false },
            exportSide: "left",
            exportTarget: "pair",
            exportTargetByDesignId: {},
            viewer: {
                transparent: false,
                heightmap: false,
                showLeft: true,
                showRight: true,
                showScans: true,
                view: "iso",
                wallModel: "procedural",
                wallStyle: "straight",
            },
            selectedElementId: null,
            transformMode: "translate",
            history: [],
            future: [],

            setPattern: (pattern) => {
                // Stock Pattern presets drive the faired B on SAMPLE_Top.
                // Custom keeps a user-edited overlay; the other presets regenerate.
                if (pattern !== "custom") {
                    useBottomPatternStore.getState().clear();
                }
                set((s) => ({
                    design: { ...s.design, pattern },
                }));
            },
            setMethod: (method) => set((s) => ({ design: { ...s.design, method } })),
            setPrintHardness: (hardness) => {
                get().checkpoint("print-hardness");
                set((s) => {
                    const recipe = migratePrintRecipe(s.design.printRecipe);
                    return {
                        design: {
                            ...s.design,
                            printRecipe: { ...recipe, defaultHardness: hardness },
                        },
                    };
                });
            },
            setSplitElements: (on) => {
                set((s) => ({
                    design: {
                        ...s.design,
                        splitElements: on,
                        elements: on ? applyDefaultSplitHardness(s.design.elements) : s.design.elements,
                    },
                }));
            },
            setSmoothElements: (on) => set((s) => ({ design: { ...s.design, smoothElements: on } })),
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
                set((s) => {
                    const leftWidth = normalizeShoeWidth(
                        linked ? (s.design.shoeWidthBySide?.left ?? s.design.shoeWidth) : s.design.shoeWidth,
                    );
                    return {
                        design: {
                            ...s.design,
                            shoeWidth: linked ? leftWidth : s.design.shoeWidth,
                            shoeWidthBySide: linked
                                ? { left: leftWidth, right: leftWidth }
                                : s.design.shoeWidthBySide,
                            corrections: { ...s.design.corrections, linked },
                            paired: s.design.paired ? { ...s.design.paired, linked } : undefined,
                            ...(linked
                                ? {
                                      sinks: copyLinkedSinks(s.design),
                                      sinkStyloidThicken: sinkStyloidThickenForSide(s.design, "left")
                                          ? { left: true, right: true }
                                          : undefined,
                                  }
                                : {}),
                        },
                    };
                }),

            setUsShoeSize: (menSize) =>
                set((s) => {
                    const nextSize = normalizeUsMenSize(menSize);
                    const next = insoleLayoutForUsMenSize(nextSize);
                    return {
                        design: scaleDesignToLayout(s.design, next, {
                            sizeSystem: "us",
                            usMenSize: nextSize,
                            ukSize: usMenToUk(nextSize),
                            footLengthMm: next.footLengthMm,
                        }),
                    };
                }),

            setShoeSizeSystem: (system) =>
                set((s) => {
                    const nextSystem = normalizeShoeSizeSystem(system);
                    const converted = convertSizingToSystem(s.design, nextSystem);
                    const next = insoleLayoutFromDesign(converted);
                    return {
                        design: scaleDesignToLayout(s.design, next, converted),
                    };
                }),

            setUkShoeSize: (ukSize) =>
                set((s) => {
                    const nextUk = normalizeUkSize(ukSize);
                    const next = insoleLayoutForUkSize(nextUk);
                    return {
                        design: scaleDesignToLayout(s.design, next, {
                            sizeSystem: "uk",
                            ukSize: nextUk,
                            usMenSize: next.usMenSize,
                            footLengthMm: next.footLengthMm,
                        }),
                    };
                }),

            setFootLengthMm: (mm) =>
                set((s) => {
                    const nextMm = normalizeFootLengthMm(mm);
                    const next = insoleLayoutForFootLengthMm(nextMm, "mm");
                    return {
                        design: scaleDesignToLayout(s.design, next, {
                            sizeSystem: "mm",
                            footLengthMm: nextMm,
                            usMenSize: next.usMenSize,
                            ukSize: next.ukSize,
                        }),
                    };
                }),

            setShoeWidth: (width, side) =>
                set((s) => {
                    const linked = s.design.corrections.linked;
                    if (linked || !side) {
                        return {
                            design: {
                                ...s.design,
                                shoeWidth: width,
                                shoeWidthBySide: { left: width, right: width },
                            },
                        };
                    }
                    return {
                        design: {
                            ...s.design,
                            shoeWidth: side === "left" ? width : s.design.shoeWidth,
                            shoeWidthBySide: { ...s.design.shoeWidthBySide, [side]: width },
                        },
                    };
                }),

            updateShapeFinish: (side, patch) =>
                set((s) => {
                    const method = s.design.method;
                    const current = s.design.shapeFinish ?? defaultShapeFinishModifiers(method);
                    const applyLeft = side === "left" || current.linked;
                    const applyRight = side === "right" || current.linked;
                    const left = normalizeSideShapeFinish(
                        { ...current.left, ...(applyLeft ? patch : {}) },
                        method,
                        thicknessMmForDesignSide(s.design, "left"),
                    );
                    const right = current.linked
                        ? { ...left }
                        : normalizeSideShapeFinish(
                              { ...current.right, ...(applyRight ? patch : {}) },
                              method,
                              thicknessMmForDesignSide(s.design, "right"),
                          );
                    return {
                        design: {
                            ...s.design,
                            shapeFinish: { ...current, left, right },
                        },
                    };
                }),

            setTextMarking: (patch) =>
                set((s) => {
                    const current = s.design.textMarking ?? defaultTextMarking(patch.surface ?? "bottom");
                    return {
                        design: {
                            ...s.design,
                            textMarking: normalizeTextMarking({ ...current, ...patch }),
                        },
                    };
                }),

            setShapeFinishLinked: (linked) =>
                set((s) => {
                    const method = s.design.method;
                    const current = s.design.shapeFinish ?? defaultShapeFinishModifiers(method);
                    const left = normalizeSideShapeFinish(current.left, method);
                    const right = linked ? { ...left } : normalizeSideShapeFinish(current.right, method);
                    return {
                        design: {
                            ...s.design,
                            shapeFinish: { ...current, linked, left, right },
                        },
                    };
                }),

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
                    const currentThickness = s.design.thicknessMm || BASE_REFERENCE_THICKNESS_MM;
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
                    const layout = insoleLayoutFromDesign(s.design);
                    const pose = defaultElementPose(kind, side, layout.lengthMm, layout.widthMm);
                    const id = crypto.randomUUID();
                    const el: PlacedElement = {
                        id,
                        kind,
                        side,
                        ...pose,
                        ...(s.design.splitElements ? defaultSplitHardnessPatch(id) : {}),
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
                    const id = crypto.randomUUID();
                    const el: PlacedElement = {
                        id,
                        kind: "custom",
                        customElementId,
                        customName,
                        side,
                        position: { x: 0, y: 0 },
                        rotationDeg: 0,
                        scale: { x: 1, y: 1 },
                        heightMm: 4,
                        ...(s.design.splitElements ? defaultSplitHardnessPatch(id) : {}),
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
                const snap = get().design;
                if (designStockBasesAreResolved(snap) && !designUsesLegacyDefaultStock(snap)) {
                    stockResolveLog(
                        "applyDefaultStockBase() skipped — SAMPLE_Top / custom already resolved",
                        {
                            assetId: getDesignStockAssetId(snap),
                            glbPath: snap.paired?.rightBase?.glbPath ?? snap.base?.glbPath ?? null,
                        },
                    );
                    set({
                        stockBaseError: null,
                        stockBaseLoading: false,
                        stockBaseResolutionState: "resolved",
                    });
                    stockBaseAutoRetryBlocked = false;
                    return;
                }
                const resolved = getSampleTopStockBase();
                const { left, right } = createDefaultStockPairedBases(resolved);
                stockResolveLog("applyDefaultStockBase() injecting SAMPLE_Top L+R", {
                    resolvedId: resolved.assetId,
                    glbPath: resolved.glbPath ?? null,
                    hasUrl: Boolean(resolved.url),
                });
                stockFixLog("applyDefaultStockBase() SAMPLE_Top pair", {
                    leftName: left.name,
                    rightName: right.name,
                    glbPath: resolved.glbPath,
                });
                stockGlbLog(
                    `applyDefaultStockBase() injecting SAMPLE_Top — url="${resolved.url ?? "(none)"}" glb_path="${resolved.glbPath ?? "(none)"}" left="${left.name}" right="${right.name}"`,
                );
                set((s) => ({
                    design: {
                        ...s.design,
                        base: left,
                        customPrefabId: left.assetId,
                        customPrefabName: left.name,
                        paired: {
                            leftBase: left,
                            rightBase: right,
                            leftThicknessMm:
                                s.design.paired?.leftThicknessMm ??
                                s.design.thicknessMm ??
                                BASE_REFERENCE_THICKNESS_MM,
                            rightThicknessMm:
                                s.design.paired?.rightThicknessMm ??
                                s.design.thicknessMm ??
                                BASE_REFERENCE_THICKNESS_MM,
                            leftMethod: s.design.paired?.leftMethod ?? s.design.method,
                            rightMethod: s.design.paired?.rightMethod ?? s.design.method,
                            linked: s.design.paired?.linked ?? false,
                        },
                    },
                    stockBaseError: null,
                    stockBaseLoading: false,
                    stockBaseResolutionState: "resolved",
                }));
                stockBaseAutoRetryBlocked = false;
                if (snap.base?.assetId !== left.assetId && snap.base?.assetId !== right.assetId) {
                    get().checkpoint("default-stock-base");
                }
            },

            clearStockBaseError: () => set({ stockBaseError: null }),

            setElementHardness: (id, hardness) => {
                const element = get().design.elements.find((e) => e.id === id);
                if (!element) return;
                if (element.hardnessClass === hardness && !element.overrides && get().design.splitElements)
                    return;
                get().checkpoint("element-hardness");
                set((s) => ({
                    design: {
                        ...s.design,
                        splitElements: true,
                        elements: s.design.elements.map((e) =>
                            e.id === id
                                ? {
                                      ...e,
                                      regionId: e.regionId ?? e.id,
                                      hardnessClass: hardness,
                                      priority: e.priority ?? 1,
                                      depth: e.depth ?? { type: "full" },
                                      overrides: undefined,
                                  }
                                : e,
                        ),
                    },
                }));
            },

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

            addSink: (kind, side) => {
                const current = sinksForSide(get().design, side) ?? [];
                if (current.some((s) => s.kind === kind)) return;
                get().checkpoint("add-sink");
                set((s) => {
                    const list = sinksForSide(s.design, side) ?? [];
                    if (list.some((sink) => sink.kind === kind)) return {};
                    const sink: PlacedSink = {
                        id: crypto.randomUUID(),
                        kind,
                        depthMm: SINK_DEFAULT_DEPTH_MM,
                    };
                    const next = { ...s.design, sinks: writeSideSinks(s.design, side, [...list, sink]) };
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return { design: next };
                });
            },

            updateSink: (id, patch, side) => {
                get().checkpoint("update-sink");
                set((s) => {
                    const kind = sinkKindById(s.design, id);
                    const list = (sinksForSide(s.design, side) ?? []).map((sink) =>
                        sink.id === id || (kind !== undefined && sink.kind === kind)
                            ? { ...sink, ...patch }
                            : sink,
                    );
                    const next = { ...s.design, sinks: writeSideSinks(s.design, side, list) };
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return { design: next };
                });
            },

            removeSink: (id, side) => {
                get().checkpoint("remove-sink");
                set((s) => {
                    const kind = sinkKindById(s.design, id);
                    const list = (sinksForSide(s.design, side) ?? []).filter((sink) =>
                        kind !== undefined ? sink.kind !== kind : sink.id !== id,
                    );
                    const next = { ...s.design, sinks: writeSideSinks(s.design, side, list) };
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return { design: next };
                });
            },

            setSinkStyloidThicken: (on, side) => {
                get().checkpoint("sink-styloid-thicken");
                set((s) => {
                    const next = {
                        ...s.design,
                        sinkStyloidThicken: writeSideThicken(s.design, side, on),
                    };
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return { design: next };
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
                    return {
                        design: {
                            ...s.design,
                            pattern: result.pattern ?? s.design.pattern,
                            method: result.method ?? s.design.method,
                            thicknessMm: r1.thicknessMm,
                            corrections,
                            // Element suggestions are added explicitly in the Elements library.
                            elements: s.design.elements,
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
                let safeDesign: DesignState = migrateDesignSinks({
                    ...incoming,
                    printRecipe: migratePrintRecipe(incoming.printRecipe),
                    thicknessMm: r.thicknessMm,
                    corrections: {
                        ...incoming.corrections,
                        left: r.constrained,
                        right: incoming.corrections.linked ? r.constrained : r2.constrained,
                    },
                });
                // Legacy or parametric-only saved designs: inject SAMPLE_Top.
                const hadBase = designHasBase(safeDesign);
                if (!hadBase) {
                    safeDesign = createDesignWithStockPlaceholder(safeDesign);
                }
                safeDesign = replaceBuiltinDefaultWithSampleTop(sanitizeDesignStockBases(safeDesign));
                const eff = buildEffectiveTrimlines(safeDesign);
                useIssuesStore.getState().recompute(safeDesign, eff);
                const needsResolution = designNeedsDefaultStockResolution(safeDesign);
                stockBaseAutoRetryBlocked = false;
                set({
                    design: safeDesign,
                    pendingSessionDesign: null,
                    selectedElementId: null,
                    stockBaseError: null,
                    stockBaseLoading: false,
                    stockBaseResolutionState: "resolved",
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
                    const trimPreset = { ...s.design.trimPreset };
                    delete trimPreset[side];
                    return {
                        design: {
                            ...s.design,
                            trimlines: Object.keys(trimlines).length > 0 ? trimlines : undefined,
                            trimPreset: Object.keys(trimPreset).length > 0 ? trimPreset : undefined,
                        },
                    };
                });
            },

            setTrimPresetId: (side, preset) =>
                set((s) => {
                    const trimPreset = { ...s.design.trimPreset };
                    if (!preset) delete trimPreset[side];
                    else trimPreset[side] = preset;
                    return {
                        design: {
                            ...s.design,
                            trimPreset: Object.keys(trimPreset).length > 0 ? trimPreset : undefined,
                        },
                    };
                }),

            applyCorrectionPreset: (payload, mode, options) => {
                get().checkpoint("apply-correction-preset");
                set((s) => {
                    const next = applyCorrectionPresetToDesign(s.design, payload, {
                        mode,
                        activeSide: options?.activeSide ?? s.exportSide,
                    });
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return { design: next };
                });
            },

            setPressureMap: (side, foot) => {
                get().checkpoint("pressure-map");
                set((s) => ({
                    design: {
                        ...s.design,
                        pressureMaps: { ...s.design.pressureMaps, [side]: foot },
                    },
                }));
            },

            removePressureMap: (side) => {
                if (!get().design.pressureMaps?.[side]) return;
                get().checkpoint("pressure-map-remove");
                set((s) => {
                    const pressureMaps = { ...s.design.pressureMaps };
                    delete pressureMaps[side];
                    return {
                        design: {
                            ...s.design,
                            pressureMaps: Object.keys(pressureMaps).length ? pressureMaps : undefined,
                        },
                    };
                });
            },

            setPressureMapVisible: (side, visible) => {
                const cur = get().design.pressureMaps?.[side];
                if (!cur || cur.visible === visible) return;
                set((s) => {
                    const foot = s.design.pressureMaps?.[side];
                    if (!foot) return s;
                    return {
                        design: {
                            ...s.design,
                            pressureMaps: {
                                ...s.design.pressureMaps,
                                [side]: { ...foot, visible },
                            },
                        },
                    };
                });
            },

            patchPressureMapAlignment: (side, patch) => {
                const cur = get().design.pressureMaps?.[side];
                if (!cur) return;
                get().checkpoint("pressure-map-align");
                set((s) => {
                    const foot = s.design.pressureMaps?.[side];
                    if (!foot) return s;
                    return {
                        design: {
                            ...s.design,
                            pressureMaps: {
                                ...s.design.pressureMaps,
                                [side]: {
                                    ...foot,
                                    alignment: {
                                        ...foot.alignment,
                                        ...patch,
                                        offsetMm: patch.offsetMm
                                            ? { ...foot.alignment.offsetMm, ...patch.offsetMm }
                                            : foot.alignment.offsetMm,
                                    },
                                },
                            },
                        },
                    };
                });
            },

            setViewer: (patch) => set((s) => ({ viewer: { ...s.viewer, ...patch } })),
            setExportSide: (side) => set({ exportSide: side }),
            setExportTarget: (target) =>
                set((s) => {
                    const designKey = useClientStore.getState().activeDesignId ?? "__draft__";
                    const nextMemory = target
                        ? { ...s.exportTargetByDesignId, [designKey]: target }
                        : s.exportTargetByDesignId;
                    return {
                        exportTarget: target,
                        exportTargetByDesignId: nextMemory,
                        ...(target === "left" || target === "right" ? { exportSide: target } : {}),
                    };
                }),
            syncExportTargetForDesign: (designId) => {
                const key = designId ?? "__draft__";
                const remembered = get().exportTargetByDesignId[key] ?? "pair";
                set({
                    exportTarget: remembered,
                    ...(remembered === "left" || remembered === "right" ? { exportSide: remembered } : {}),
                });
            },
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
                    pendingSessionDesign: null,
                    selectedElementId: null,
                    stockBaseError: null,
                    stockBaseLoading: false,
                    stockBaseResolutionState: "resolved",
                    baseMeshLoadingBySide: { left: false, right: false },
                });
                if (designNeedsDefaultStockResolution(withStock)) {
                    upgradeStockBaseAsync(() => get().applyDefaultStockBase(), "reset");
                }
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
            /** Keep both the active work and an unclaimed draft across repeated reloads. */
            partialize: (state) => ({
                design: state.design,
                pendingSessionDesign: state.pendingSessionDesign,
                exportTargetByDesignId: state.exportTargetByDesignId,
            }),
            merge: (persisted, current) => {
                const saved = persisted as
                    | {
                          design?: DesignState;
                          pendingSessionDesign?: DesignState | null;
                      }
                    | undefined;
                if (!saved?.design) return current;
                // Never put a previous session's elements into a new viewport implicitly.
                // Intercept before hydration publishes any state, avoiding a flash of pads.
                const draft = saved.design.elements?.length
                    ? saved.design
                    : (saved.pendingSessionDesign ?? null);
                const savedTargets =
                    (saved as { exportTargetByDesignId?: Record<string, ExportOutputTarget> })
                        .exportTargetByDesignId ?? {};
                return {
                    ...current,
                    design: draft ? createDesignWithStockPlaceholder() : saved.design,
                    pendingSessionDesign: draft,
                    selectedElementId: null,
                    exportTargetByDesignId: savedTargets,
                };
            },
            onRehydrateStorage: () => (state) => {
                if (!state?.design) return;
                let design = migrateDesignSinks(
                    replaceBuiltinDefaultWithSampleTop(sanitizeDesignStockBases(state.design)),
                );
                design = { ...design, corrections: migrateCorrections(design.corrections) };
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
                useDesignStore.setState({
                    design,
                    stockBaseError: null,
                    stockBaseLoading: false,
                    stockBaseResolutionState: "resolved",
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
