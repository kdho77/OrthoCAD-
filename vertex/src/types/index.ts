// Shared domain types for the Vertex Orthopedic insole CAD app.
// These mirror the Prisma schema but are framework-agnostic for use in the
// browser, stores and the 3D pipeline.

import type { RegionHardnessClass } from "../../shared/print-recipe/hardness-class-table";
import type { DepthSpec, HardnessOverrides } from "../../shared/print-recipe/hardness-region";
import type { PrintRecipeV1 } from "../../shared/print-recipe/print-recipe";

export type { HardnessName, PrintRecipeV1 } from "../../shared/print-recipe/print-recipe";
export type { DepthSpec, HardnessOverrides, HardnessRegion, RegionKind } from "../../shared/print-recipe/hardness-region";
export type { RegionHardnessClass } from "../../shared/print-recipe/hardness-class-table";

export type Role = "super_admin" | "admin" | "clinician";

export type Side = "left" | "right";

/** Human-readable foot side labels for UI and export filenames. */
export const SIDE_LABELS: Record<Side, string> = { left: "Left", right: "Right" };

export type Unit = "mm" | "deg";

export type LicenseType = "monthly" | "yearly" | "per_seat";

export type LicenseStatus = "active" | "expired" | "revoked";

export type ProductionMethod =
    | "printing_solid"
    | "printing_shell"
    | "milling_3axis";

export type ScanPattern =
    | "full_contact"
    | "prefab_3d"
    | "flat"
    | "custom";

/** Midfoot arch skive target (distinct from Kirby heel skive). */
export type ArchSkiveSide = "medial" | "lateral" | "central";

/** `wall` is the outer (lateral) side. `medial` is the inner side. */
export type TextSurface = "bottom" | "wall" | "medial";
export type TextMode = "engrave" | "emboss";
export type TextAnchor = "heel" | "arch" | "forefoot";
export type TextFeet = "both" | "left" | "right";

/** Custom text. Empty text is a no-op. Placement is mirrored per foot; glyphs are not. */
export interface TextMarking {
    text: string;
    surface: TextSurface;
    mode: TextMode;
    /** Always the bundled bold sans. Kept so older designs still round-trip. */
    bold: boolean;
    capHeightMm: number;
    depthMm: number;
    heightMm: number;
    letterSpacingMm: number;
    rotationDeg: number;
    placementU: number;
    /** Bottom snap target. Wall / medial ignore this and use mid-height. */
    anchor: TextAnchor;
    /** Which feet receive this text. Follows the Editing L / R / Both control. */
    feet: TextFeet;
    differentOnLR: boolean;
    textLeft: string;
    textRight: string;
    /** Millimetres along the placement axis, after placementU. */
    nudgeAlongMm: number;
    /** Bottom: off the centreline. Sides: off mid-height. */
    nudgeAcrossMm: number;
}

/** Track 5b — print / shell shape & finish modifiers (per foot). */
export interface SideShapeFinish {
    /** Extra top clearance in heel cup / flange for cover bulk (mm). */
    topCoverAccommodateMm: number;
    /** Extend distal footprint past wear trim for solid FDM trimming. */
    trimmableForefoot: boolean;
    /** Distal extension when trimmable forefoot is on (mm). */
    trimmableForefootExtraMm: number;
    /** Bottom plantar deepen in arch ellipse only (mm). */
    archGrindDepthMm: number;
    /** Midfoot arch skive depth (mm) — separate from heel Kirby skive. */
    archSkiveMm: number;
    archSkiveSide: ArchSkiveSide;
}

export interface ShapeFinishModifiers {
    left: SideShapeFinish;
    right: SideShapeFinish;
    linked: boolean;
}

export type ExportFormat = "stl" | "gcode" | "glb" | "3mf";

export type GrindingStyleType = "straight" | "rounded";

export type ShellThicknessMode = "uniform" | "zonal";

export type HeelLiftTaperPreset = "midfoot" | "metHeads" | "sulcus" | "custom";

export interface GrindingStyle {
    type: GrindingStyleType;
    angle_degrees?: number;
    radius_mm?: number;
}

/** Wedge correction specification for rearfoot or forefoot zone. */
export interface WedgeCorrection {
    /** Which edge to raise. */
    side: "medial" | "lateral";
    /** Positive user-entered value. */
    value: number;
    /** Raw unit. Degrees are resolved against current local width at eval time. */
    unit: "mm" | "deg";
}

export interface UserProfile {
    id: string;
    email: string;
    fullName: string | null;
    role: Role;
    tokenBalance: number;
}

export interface License {
    id: string;
    type: LicenseType;
    status: LicenseStatus;
    seats: number;
    startsAt: string;
    expiresAt: string | null;
}

// --- Corrections (parametric, independent per foot) -------------------------

export interface SideCorrections {
    /** Forefoot pronation/supination. Positive = pronation. */
    forefootPostingDeg: number;
    /** Rearfoot pronation/supination. Positive = pronation. */
    rearfootPostingDeg: number;
    /**
     * Kirby heel skive depth (mm) at the one-third heel-width line.
     * Medial skive RAISES the medial heel (+Z) — intrinsic supination moment.
     * Never a subtractive cut; see heel-skive.ts.
     */
    medialSkiveMm: number;
    /** Lateral skive depth (mm); raises the lateral heel — pronation moment. */
    lateralSkiveMm: number;
    /**
     * Skive plane angle (deg) relative to the heel seat. Default 15.
     * Range 5–30. Paired with {@link skiveLocationPct} via {@link skiveDriven}.
     */
    skiveAngleDeg?: number;
    /**
     * Zero-crossing location across the heel as % from medial (0) to lateral (100).
     * Derived when {@link skiveDriven} is `"location"` (default).
     */
    skiveLocationPct?: number;
    /**
     * Which of angle/location is user-locked. Depth is always a driver.
     * Default `"location"` (angle set by user/default 15°, location derived).
     */
    skiveDriven?: "angle" | "location";
    /** @deprecated Migrated into archHeightMm; always 0 after load. */
    archFillMm: number;
    archHeightMm: number;
    /**
     * Medial arch contact relief (mm downward) after arch height — eases shell
     * tightness so soft tissue can spread. Distinct from arch height.
     */
    archEaseMm: number;
    heelCupDepthMm: number;
    heelCupHeightMm: number;
    /**
     * Medial/lateral breadth of the heel cup walls. Positive values tighten the
     * cup (walls move inboard to hug the heel more); 0 = baseline cup breadth.
     */
    heelCupWidthMm: number;
    /**
     * Per-side forefoot outline offset (mm at full envelope). Positive moves each
     * side outward; negative narrows. 0 = baseline outline.
     */
    forefootWidthMm?: number;
    /**
     * Heel lift (longitudinal raise). A value of N mm raises the plantar surface
     * under the center/back of the heel by N mm and tapers linearly to 0 under
     * the metatarsal heads (~75% of insole length). Bottom surface stays flat
     * (z = 0), so the lift is bottom-stable on solid prints. See {@link heelLiftDeltaAt}.
     */
    heelLiftMm: number;
    /** Heel-lift ramp endpoint preset (Track 4 #4). */
    heelLiftTaperPreset?: HeelLiftTaperPreset;
    /** Explicit taper end u ∈ [0.45, 0.90]; overrides preset when set. */
    heelLiftTaperEndU?: number;
    /** Custom %AP (25–75) when preset is `custom`. */
    heelLiftCustomTaperPctAp?: number;
    apexMoveMm: number;
    medialFlangeMm: number;
    lateralFlangeMm: number;

    /**
     * New medial/lateral wedge system (surface modifications on the plantar/top).
     * Only one wedge (medial or lateral) per zone is allowed (enforced by UI + single object).
     * Stored as raw user input; resolution (esp. for degrees) happens at evaluation time.
     */
    rearfootWedge?: WedgeCorrection;
    forefootWedge?: WedgeCorrection;
}

export interface Corrections {
    unit: Unit;
    left: SideCorrections;
    right: SideCorrections;
    /** Link L/R so edits mirror automatically. */
    linked: boolean;
}

// --- Elements (additive features placed on the insole) ----------------------

export type ElementKind =
    | "met_pad"
    | "met_bar"
    | "toe_crest"
    | "cuboid_pad"
    | "cluffy_wedge"
    | "mortons_extension"
    | "reverse_mortons"
    | "heel_sink"
    | "navicular_sink"
    | "kinetic_wedge"
    | "scaphoid_pad"
    | "heel_cushion"
    | "dancers_pad";

/** Top trim preset id — `custom` when the user edits the spline manually. */
export type TrimPresetId = "full" | "sulcus" | "met_head" | "custom";

export type ElementPlacementMode = "flow" | "noFlow";

export interface PlacedElement {
    id: string;
    kind: ElementKind | "custom";
    /** When kind is "custom", references the user's library item id. */
    customElementId?: string;
    customName?: string;
    side: Side;
    /** Position on the insole surface in mm (x along length, y across width). */
    position: { x: number; y: number };
    rotationDeg: number;
    scale: { x: number; y: number };
    /** Missing on older designs means locked. Height remains independent. */
    scaleLocked?: boolean;
    heightMm: number;
    /**
     * Hardness region fields (Phase 1). Settings stay on this element id through
     * move/resize/save/reopen. Absent => device default, no modifier volume.
     */
    regionId?: string;
    hardnessClass?: RegionHardnessClass;
    priority?: number;
    depth?: DepthSpec;
    overrides?: HardnessOverrides;
    /** GLB height-field lift: flow feathers the edge; noFlow keeps a crisp step. */
    placementMode?: ElementPlacementMode;
    zOffsetMm?: number;
}

/**
 * Forefoot / styloid sinks. Not an ElementKind — overlap is max depth, not a sum,
 * and an empty list leaves every existing element output byte-identical.
 * u, v are outline fractions (heel→toe, medial→lateral). A scan marker overrides them.
 */
export type SinkKind = "mpj1" | "mpj2" | "mpj3" | "mpj4" | "mpj5" | "styloid";

export interface PlacedSink {
    id: string;
    kind: SinkKind;
    /** Requested depth. Values above the clinical max warn and clamp at the cut. */
    depthMm: number;
    u?: number;
    v?: number;
    markerId?: string;
}

/** Scan marker that overrides a sink's u, v. */
export interface SinkMarkerRef {
    id: string;
    u: number;
    v: number;
}

/** Serializable trimline control points stored in design state. */
export interface TrimlinePoint {
    x: number;
    y: number;
    z: number;
}

/** Per-side custom insole perimeter curves (local footprint mm). */
export interface DesignTrimlines {
    left?: TrimlinePoint[];
    right?: TrimlinePoint[];
}

/**
 * Optional base template a design starts from (Base + Modifier model — see
 * docs/base-modifier-architecture.md). When absent, the design is generated
 * purely parametrically. When present, corrections / trimline / elements /
 * thickness act as modifiers applied on top of this base mesh.
 */
export interface DesignBase {
    /** Library / custom asset id that provides the base mesh. For stock this is the stock_bases id or stable key (e.g. "stock-default"). */
    assetId: string;
    name?: string;
    /** Where to resolve the GLB from. */
    source: "custom" | "stock";
    /** For stock bases (or any that carry their own path), the glb_path from stock_bases table / storage key. Used by loadBaseGeometry. */
    glbPath?: string;
    /** Authoritative download URL from the server (Supabase public/signed). Required for stock bases when the API is configured. */
    url?: string;
    /** Server stock_bases.primarySide — drives auto-mirroring for single-sided assets. */
    primarySide?: string | null;
    /** True only for the local offline dev placeholder — never set on server-resolved stock bases. */
    offlinePlaceholder?: boolean;
    /**
     * Server resolution was attempted and failed; use local/offline loading and do not
     * auto-retry tRPC resolution (prevents infinite retry loops).
     */
    resolutionFallback?: boolean;
    /** If true, the geometry loader will mirror the loaded mesh across the sagittal plane (used for auto Left from Right-only stock). */
    mirrored?: boolean;
    /** Asset id of the source this mirror was derived from (for labeling and "reset to mirrored" future use). */
    mirroredFrom?: string;
}

export interface DesignState {
    pattern: ScanPattern;
    /** When pattern is driven by a user custom prefab. */
    customPrefabId?: string;
    customPrefabName?: string;
    /** Optional base template; absent ⇒ full parametric generation. */
    base?: DesignBase;
    method: ProductionMethod;
    /** Phase A gyroid hardness ladder (PrintRecipe v1). */
    printRecipe?: PrintRecipeV1;
    thicknessMm: number;
    /** uniform | zonal shell thickness (Track 4 #1). Default zonal. */
    shellThicknessMode?: ShellThicknessMode;
    shellThicknessRfMm?: number;
    shellThicknessMfMm?: number;
    shellThicknessFfMm?: number;
    /** Half-width of RF/MF/FF blends along length (mm). Default 12. */
    shellThicknessBlendMm?: number;
    /**
     * Footprint size system. Default `"us"`.
     * - `us` — US Men's half-size (`usMenSize`); Women's = +1.5; Youth ≤ 7
     * - `uk` — UK adult size (`ukSize`)
     * - `mm` — Mondopoint-style foot length (`footLengthMm`)
     */
    sizeSystem?: "us" | "uk" | "mm";
    /**
     * US Men's shoe size (half steps). Used when `sizeSystem` is `"us"` (default).
     * Absent ⇒ Men's 9 (260 × 95 mm reference template).
     */
    usMenSize?: number;
    /** UK adult shoe size (half steps). Used when `sizeSystem` is `"uk"`. */
    ukSize?: number;
    /** Foot length in mm (Mondopoint-style). Used when `sizeSystem` is `"mm"`. */
    footLengthMm?: number;
    /** Last width vs Medium. Forefoot Δ −5/0/+5/+10 mm; heel capped ±2 mm. */
    shoeWidth?: "narrow" | "medium" | "wide" | "extra_wide";
    /** Per-foot width when L/R corrections are unlinked. Linked designs use `shoeWidth`. */
    shoeWidthBySide?: {
        left?: "narrow" | "medium" | "wide" | "extra_wide";
        right?: "narrow" | "medium" | "wide" | "extra_wide";
    };
    corrections: Corrections;
    elements: PlacedElement[];
    /**
     * MPJ and styloid sinks, per foot. Absent or empty on a side ⇒ no thickness
     * and no cut (exports stay byte-identical). Not summed like elements.
     * `corrections.linked` mirrors edits the same way as the other corrections.
     */
    sinks?: { left?: PlacedSink[]; right?: PlacedSink[] };
    /**
     * Midfoot thickness under the styloid sink, per foot. Default off
     * (forefoot only) until Kendon confirms otherwise.
     */
    sinkStyloidThicken?: { left?: boolean; right?: boolean };
    /** Print-step Split mode: elements are selectable hardness regions. */
    splitElements?: boolean;
    /**
     * Persist-only. Boundary smoothing of split regions needs CAD sign-off —
     * does not change print geometry.
     */
    smoothElements?: boolean;
    /** User-edited insole outline curves — persisted with the design. */
    trimlines?: DesignTrimlines;
    /** Active top-trim preset label per foot (cleared to custom on manual edit). */
    trimPreset?: { left?: TrimPresetId; right?: TrimPresetId };

    /** Track 5b shape / finish (top cover, trimmable forefoot, arch grind / skive). */
    shapeFinish?: ShapeFinishModifiers;

    /**
     * Print-step custom text (engrave / emboss). Empty text is a no-op and is
     * omitted from the design-state hash so frozen STLs stay byte-identical.
     */
    textMarking?: TextMarking;

    /**
     * Paired Left + Right dual-view workspace support.
     * When present, left and right sides are independent (linked=false by default).
     * Each side has its own base, thickness, method, etc.
     * Corrections/trimlines/elements remain in top-level with per-side keys for compat.
     */
    paired?: {
      leftBase?: DesignBase;
      rightBase?: DesignBase;
      leftThicknessMm: number;
      rightThicknessMm: number;
      leftMethod: ProductionMethod;
      rightMethod: ProductionMethod;
      /** Workspace-level linked flag (default false for independence). */
      linked: boolean;
      /** Optional metadata for mirrored side. */
      rightMetadata?: {
        mirroredFrom?: string; // assetId of left
      };
    };
}

// --- Custom library (user-owned GLB assets) --------------------------------

export interface CustomLibraryItem {
    id: string;
    name: string;
    category: string;
    glbPath: string;
    parentStockId: string | null;
    createdAt: string;
    url?: string | null;
}

// --- AI prescription parsing ------------------------------------------------

export interface PrescriptionImage {
    /** Base64 (no data: prefix). */
    dataBase64: string;
    mediaType: string;
}

export interface PrescriptionInput {
    text?: string;
    image?: PrescriptionImage;
    designId?: string;
}

export interface ParsedElement {
    kind: ElementKind;
    side: Side;
}

/** Structured output of prescription parsing — Phase 2 applies this to the model. */
export interface PrescriptionParseResult {
    pattern?: ScanPattern;
    method?: ProductionMethod;
    thicknessMm?: number;
    unit?: Unit;
    corrections: {
        left?: Partial<SideCorrections>;
        right?: Partial<SideCorrections>;
    };
    elements: ParsedElement[];
    notes: string;
    confidence: number;
    provider: "anthropic" | "xai" | "heuristic";
    tokenCost: number;
    balance?: number;
}
