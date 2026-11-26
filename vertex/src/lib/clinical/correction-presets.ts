// Correction macro presets — capture/apply Shape-step design slices (corrections, elements, thickness).

import { constrainSideCorrections } from "@/lib/geometry/clinical-constraints";
import type { Corrections, DesignState, ElementKind, PrintRecipeV1, Side, SideCorrections } from "@/types";

/** Serializable preset payload (no element ids — regenerated on apply). */
export interface CorrectionPresetPayload {
    corrections?: {
        linked?: boolean;
        left?: Partial<SideCorrections>;
        right?: Partial<SideCorrections>;
    };
    /** Suggested stock elements; placement is explicit in the Elements library. */
    elementKinds?: { left?: ElementKind[]; right?: ElementKind[] };
    thicknessMm?: number;
    printRecipe?: PrintRecipeV1;
}

export interface CorrectionPresetDefinition {
    id: string;
    name: string;
    scope: "vertex" | "org" | "user";
    description?: string;
    payload: CorrectionPresetPayload;
}

export type CorrectionPresetApplyMode = "replace" | "merge";

function sideKeys(): (keyof SideCorrections)[] {
    return [
        "forefootPostingDeg",
        "rearfootPostingDeg",
        "medialSkiveMm",
        "lateralSkiveMm",
        "archFillMm",
        "archHeightMm",
        "heelCupDepthMm",
        "heelCupHeightMm",
        "heelCupWidthMm",
        "forefootWidthMm",
        "heelLiftMm",
        "apexMoveMm",
        "medialFlangeMm",
        "lateralFlangeMm",
        "rearfootWedge",
        "forefootWedge",
        "fullLengthWedge",
    ];
}

function mergeSide(base: SideCorrections, patch: Partial<SideCorrections> | undefined): SideCorrections {
    if (!patch) return { ...base };
    const next = { ...base, ...patch };
    if (patch.rearfootWedge !== undefined) next.rearfootWedge = patch.rearfootWedge;
    if (patch.forefootWedge !== undefined) next.forefootWedge = patch.forefootWedge;
    if (patch.fullLengthWedge !== undefined) next.fullLengthWedge = patch.fullLengthWedge;
    return next;
}

function replaceSide(
    patch: Partial<SideCorrections> | undefined,
    fallback: SideCorrections,
): SideCorrections {
    const blank = { ...fallback };
    for (const k of sideKeys()) {
        if (k === "rearfootWedge" || k === "forefootWedge" || k === "fullLengthWedge") {
            (blank as SideCorrections)[k] = undefined;
        } else {
            (blank as SideCorrections)[k as keyof SideCorrections] = 0 as never;
        }
    }
    return mergeSide(blank, patch);
}

function clampSide(side: SideCorrections, thicknessMm: number): SideCorrections {
    return constrainSideCorrections(side, thicknessMm).constrained;
}

/**
 * Vertex starter set — labeled clinical starting points (fine-tune ±0.2 mm / ±0.5° in UI).
 * Values are conservative mid-range suggestions, not diagnoses.
 */
export const VERTEX_STARTER_PRESETS: CorrectionPresetDefinition[] = [
    {
        id: "vertex-pf",
        name: "Plantar fasciitis (PF)",
        scope: "vertex",
        description: "Arch fill + heel cup + met pad starting point",
        payload: {
            corrections: {
                linked: true,
                left: { archFillMm: 2, heelCupDepthMm: 14, archHeightMm: 4 },
            },
            elementKinds: { left: ["met_pad"], right: ["met_pad"] },
        },
    },
    {
        id: "vertex-pttd",
        name: "PTTD",
        scope: "vertex",
        payload: {
            corrections: {
                linked: true,
                left: { rearfootPostingDeg: 4, medialSkiveMm: 3, archHeightMm: 6, heelCupDepthMm: 14 },
            },
        },
    },
    {
        id: "vertex-fhl",
        name: "FHL tendinopathy",
        scope: "vertex",
        payload: {
            corrections: {
                linked: true,
                left: { archFillMm: 1.5, heelCupDepthMm: 12, medialSkiveMm: 2 },
            },
            elementKinds: { left: ["scaphoid_pad"], right: ["scaphoid_pad"] },
        },
    },
    {
        id: "vertex-metatarsalgia",
        name: "Metatarsalgia",
        scope: "vertex",
        payload: {
            corrections: { linked: true, left: { forefootPostingDeg: 2 } },
            elementKinds: { left: ["met_pad", "met_bar"], right: ["met_pad", "met_bar"] },
        },
    },
    {
        id: "vertex-achilles",
        name: "Achilles",
        scope: "vertex",
        payload: {
            corrections: { linked: true, left: { heelLiftMm: 4, heelCupDepthMm: 12 } },
            elementKinds: { left: ["heel_cushion"], right: ["heel_cushion"] },
        },
    },
    {
        id: "vertex-planus",
        name: "Planus",
        scope: "vertex",
        payload: {
            corrections: {
                linked: true,
                left: { archHeightMm: 8, archFillMm: 3, rearfootPostingDeg: 3, medialFlangeMm: 2 },
            },
        },
    },
    {
        id: "vertex-cavus",
        name: "Cavus",
        scope: "vertex",
        payload: {
            corrections: {
                linked: true,
                left: { archFillMm: 4, lateralSkiveMm: 2, forefootPostingDeg: -2 },
            },
            elementKinds: { left: ["heel_cushion"], right: ["heel_cushion"] },
        },
    },
    {
        id: "vertex-neuroma",
        name: "Neuroma",
        scope: "vertex",
        payload: {
            corrections: { linked: true, left: { forefootPostingDeg: 1 } },
            elementKinds: { left: ["met_bar"], right: ["met_bar"] },
        },
    },
    {
        id: "vertex-pfps-mtss",
        name: "PFPS / MTSS",
        scope: "vertex",
        payload: {
            corrections: { linked: true, left: { rearfootPostingDeg: 3, medialSkiveMm: 2, archHeightMm: 5 } },
        },
    },
    {
        id: "vertex-sesamoiditis",
        name: "Sesamoiditis",
        scope: "vertex",
        payload: {
            corrections: { linked: true, left: { forefootPostingDeg: -1 } },
            elementKinds: { left: ["dancers_pad"], right: ["dancers_pad"] },
        },
    },
];

/** Capture current design into a named user preset payload. */
export function captureCorrectionPresetFromDesign(design: DesignState): CorrectionPresetPayload {
    const pickSide = (side: Side): Partial<SideCorrections> => {
        const src = design.corrections[side];
        const out: Partial<SideCorrections> = {};
        for (const k of sideKeys()) {
            const v = src[k as keyof SideCorrections];
            if (v !== undefined && v !== 0 && v !== null) {
                (out as Record<string, unknown>)[k] = v;
            }
        }
        return out;
    };

    const elementKinds = {
        left: design.elements
            .filter((e) => e.side === "left" && e.kind !== "custom")
            .map((e) => e.kind as ElementKind),
        right: design.elements
            .filter((e) => e.side === "right" && e.kind !== "custom")
            .map((e) => e.kind as ElementKind),
    };

    return {
        corrections: {
            linked: design.corrections.linked,
            left: pickSide("left"),
            right: pickSide("right"),
        },
        elementKinds,
        thicknessMm: design.thicknessMm,
        printRecipe: design.printRecipe,
    };
}

/** Keys a preset wrote — used to mark slider origin until the user edits them. */
export function correctionPresetOriginKeys(
    payload: CorrectionPresetPayload,
    linked: boolean,
): { left: (keyof SideCorrections)[]; right: (keyof SideCorrections)[] } {
    const left = payload.corrections?.left
        ? (Object.keys(payload.corrections.left) as (keyof SideCorrections)[])
        : [];
    const rightPatch = payload.corrections?.right
        ? (Object.keys(payload.corrections.right) as (keyof SideCorrections)[])
        : [];
    if (linked) {
        const keys = left.length > 0 ? left : rightPatch;
        return { left: keys, right: [...keys] };
    }
    return { left, right: rightPatch };
}

export interface ApplyCorrectionPresetOptions {
    mode: CorrectionPresetApplyMode;
    /** Legacy option retained for saved callers; suggestions never place elements. */
    includeElements?: boolean;
    activeSide?: Side;
    /** Legacy placement option; ignored because only the library places elements. */
    placementSides?: Side[];
}

/**
 * Apply a preset to design state. Does not change workflow step (caller responsibility).
 */
export function applyCorrectionPresetToDesign(
    design: DesignState,
    preset: CorrectionPresetPayload,
    opts: ApplyCorrectionPresetOptions,
): DesignState {
    const thickness = preset.thicknessMm ?? design.thicknessMm;
    const linked = preset.corrections?.linked ?? design.corrections.linked;
    const corr: Corrections = { ...design.corrections, linked };

    const applyToSide = (side: Side) => {
        const patch = preset.corrections?.[side];
        if (opts.mode === "replace") {
            corr[side] = clampSide(replaceSide(patch, design.corrections[side]), thickness);
        } else {
            corr[side] = clampSide(mergeSide(design.corrections[side], patch), thickness);
        }
    };

    if (linked) {
        const patch = preset.corrections?.left ?? preset.corrections?.right;
        if (opts.mode === "replace") {
            const next = clampSide(replaceSide(patch, design.corrections.left), thickness);
            corr.left = next;
            corr.right = { ...next };
        } else {
            corr.left = clampSide(mergeSide(design.corrections.left, patch), thickness);
            corr.right = clampSide(mergeSide(design.corrections.right, patch), thickness);
        }
    } else {
        applyToSide("left");
        applyToSide("right");
    }

    return {
        ...design,
        thicknessMm: preset.thicknessMm ?? design.thicknessMm,
        printRecipe: preset.printRecipe ?? design.printRecipe,
        corrections: corr,
        elements: design.elements,
    };
}

/** Customer macros are clinic starting points. Pathology macros are the Vertex starters. */
export type DesignMacroKind = "customer" | "pathology";

export interface DesignMacro {
    id: string;
    name: string;
    kind: DesignMacroKind;
    description?: string;
    /** Extra lookup names. They do not add clinical values. */
    aliases?: readonly string[];
    payload: CorrectionPresetPayload;
}

/**
 * Clinic customer macros shared by the Corrections panel and the CAD-operator bot.
 * A row belongs here only when its payload is already defined in this repo or in
 * OrthoCAD-LMS. Rhinebeck is not listed: its stored corrections are not in either
 * place, and apply refuses that name instead of inventing millimetres.
 */
export const CUSTOMER_DESIGN_MACROS: readonly DesignMacro[] = [];

/** Lookup names for starters whose UI label is shorter than the prescription word. */
const PATHOLOGY_ALIASES: Readonly<Record<string, readonly string[]>> = {
    "vertex-planus": ["pes planus"],
};

export class DesignMacroError extends Error {
    constructor(message: string) {
        super(message.startsWith("422 ") ? message : `422 ${message}`);
        this.name = "DesignMacroError";
    }
}

function pathologyMacro(preset: CorrectionPresetDefinition): DesignMacro {
    return {
        id: preset.id,
        name: preset.name,
        kind: "pathology",
        description: preset.description,
        aliases: PATHOLOGY_ALIASES[preset.id],
        payload: preset.payload,
    };
}

/** The macros the Corrections panel can apply, customer first, then pathology starters. */
export function listDesignMacros(extraCustomer: readonly DesignMacro[] = []): DesignMacro[] {
    return [...CUSTOMER_DESIGN_MACROS, ...extraCustomer, ...VERTEX_STARTER_PRESETS.map(pathologyMacro)];
}

export function normalizeDesignMacroName(value: string): string {
    return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function macroMatches(macro: DesignMacro, key: string): boolean {
    if (normalizeDesignMacroName(macro.id) === key) return true;
    if (normalizeDesignMacroName(macro.name) === key) return true;
    return (macro.aliases ?? []).some((alias) => normalizeDesignMacroName(alias) === key);
}

function requireDesignMacro(
    macros: readonly DesignMacro[],
    name: string,
    kind: DesignMacroKind,
): DesignMacro {
    const key = normalizeDesignMacroName(name);
    const matches = macros.filter((macro) => macro.kind === kind && macroMatches(macro, key));
    const match = matches[0];
    if (matches.length === 1 && match) return match;
    if (matches.length > 1) {
        throw new DesignMacroError(
            `More than one ${kind} macro matches "${name.trim()}". Refusing to guess a clinical value.`,
        );
    }
    throw new DesignMacroError(
        `No ${kind} macro named "${name.trim()}" is in the library. Refusing to guess a clinical value.`,
    );
}

export interface DesignMacroSelection {
    customer?: string | null;
    pathology?: string | null;
}

/** Names that will be merged, customer then pathology. Empty when both names are omitted. */
export function resolveDesignMacros(
    selection: DesignMacroSelection,
    macros: readonly DesignMacro[] = listDesignMacros(),
): DesignMacro[] {
    const applied: DesignMacro[] = [];
    const customer = selection.customer?.trim() ?? "";
    const pathology = selection.pathology?.trim() ?? "";
    if (customer) applied.push(requireDesignMacro(macros, customer, "customer"));
    if (pathology) applied.push(requireDesignMacro(macros, pathology, "pathology"));
    return applied;
}

/**
 * Merge macros the way the Corrections panel Merge button does.
 * Customer is applied first, then pathology, so the second merge does not wipe
 * keys it does not set. Omit both names and the same design is returned.
 */
export function applyDesignMacrosToDesign(
    design: DesignState,
    selection: DesignMacroSelection,
    macros: readonly DesignMacro[] = listDesignMacros(),
): DesignState {
    const applied = resolveDesignMacros(selection, macros);
    if (applied.length === 0) return design;
    let next = design;
    for (const macro of applied) {
        next = applyCorrectionPresetToDesign(next, macro.payload, { mode: "merge" });
    }
    return next;
}
