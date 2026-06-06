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

export type ExportFormat = "stl" | "gcode";

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
    apexMoveMm: number;
    medialFlangeMm: number;
    lateralFlangeMm: number;
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
    kind: ElementKind;
    side: Side;
    /** Position on the insole surface in mm (x along length, y across width). */
    position: { x: number; y: number };
    rotationDeg: number;
    scale: { x: number; y: number };
    heightMm: number;
}

export interface DesignState {
    pattern: ScanPattern;
    method: ProductionMethod;
    thicknessMm: number;
    corrections: Corrections;
    elements: PlacedElement[];
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
