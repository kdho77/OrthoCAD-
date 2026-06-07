// Shared domain types for the Vertex Orthopedic insole CAD app.
// These mirror the Prisma schema but are framework-agnostic for use in the
// browser, stores and the 3D pipeline.

export type Role = "super_admin" | "admin" | "clinician";

export type Side = "left" | "right";

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

export type ExportFormat = "stl" | "gcode" | "glb";

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
    medialSkiveMm: number;
    lateralSkiveMm: number;
    archFillMm: number;
    archHeightMm: number;
    heelCupDepthMm: number;
    heelCupHeightMm: number;
    /**
     * Medial/lateral breadth of the heel cup walls. Positive values tighten the
     * cup (walls move inboard to hug the heel more); 0 = baseline cup breadth.
     */
    heelCupWidthMm: number;
    /**
     * Heel lift (longitudinal raise). A value of N mm raises the plantar surface
     * under the center/back of the heel by N mm and tapers linearly to 0 under
     * the metatarsal heads (~75% of insole length). Bottom surface stays flat
     * (z = 0), so the lift is bottom-stable on solid prints. See {@link heelLiftDeltaAt}.
     */
    heelLiftMm: number;
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
    | "cluffy_wedge"
    | "mortons_extension"
    | "reverse_mortons"
    | "heel_sink"
    | "navicular_sink"
    | "kinetic_wedge";

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
    heightMm: number;
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
    /** Library / custom asset id that provides the base mesh. */
    assetId: string;
    name?: string;
    /** Where to resolve the GLB from. */
    source: "custom" | "stock";
}

export interface DesignState {
    pattern: ScanPattern;
    /** When pattern is driven by a user custom prefab. */
    customPrefabId?: string;
    customPrefabName?: string;
    /** Optional base template; absent ⇒ full parametric generation. */
    base?: DesignBase;
    method: ProductionMethod;
    thicknessMm: number;
    corrections: Corrections;
    elements: PlacedElement[];
    /** User-edited insole outline curves — persisted with the design. */
    trimlines?: DesignTrimlines;

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
