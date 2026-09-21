// Correction macro presets — capture/apply Shape-step design slices (corrections, elements, thickness).

import { constrainSideCorrections } from "@/lib/geometry/clinical-constraints";
import { defaultElementPose } from "@/lib/geometry/elements";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import type {
    Corrections,
    DesignState,
    ElementKind,
    PlacedElement,
    PrintRecipeV1,
    Side,
    SideCorrections,
} from "@/types";

/** Serializable preset payload (no element ids — regenerated on apply). */
export interface CorrectionPresetPayload {
    corrections?: {
        linked?: boolean;
        left?: Partial<SideCorrections>;
        right?: Partial<SideCorrections>;
    };
    /** Stock element kinds to place per side when applying (at default pose). */
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
        "heelLiftMm",
        "apexMoveMm",
        "medialFlangeMm",
        "lateralFlangeMm",
        "rearfootWedge",
        "forefootWedge",
    ];
}

function mergeSide(base: SideCorrections, patch: Partial<SideCorrections> | undefined): SideCorrections {
    if (!patch) return { ...base };
    const next = { ...base, ...patch };
    if (patch.rearfootWedge !== undefined) next.rearfootWedge = patch.rearfootWedge;
    if (patch.forefootWedge !== undefined) next.forefootWedge = patch.forefootWedge;
    return next;
}

function replaceSide(
    patch: Partial<SideCorrections> | undefined,
    fallback: SideCorrections,
): SideCorrections {
    const blank = { ...fallback };
    for (const k of sideKeys()) {
        if (k === "rearfootWedge" || k === "forefootWedge") {
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

function newElementsForSide(
    kinds: ElementKind[] | undefined,
    side: Side,
    design: DesignState,
): PlacedElement[] {
    if (!kinds?.length) return [];
    const { lengthMm, widthMm } = insoleLayoutFromDesign(design);
    return kinds.map((kind) => ({
        id: crypto.randomUUID(),
        kind,
        side,
        ...defaultElementPose(kind, side, lengthMm, widthMm),
    }));
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

export interface ApplyCorrectionPresetOptions {
    mode: CorrectionPresetApplyMode;
    /** When true, replace/merge elements for affected sides. */
    includeElements?: boolean;
    activeSide?: Side;
    /** Sides to place stock elements on (e.g. both when L+R linked placement). */
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

    let elements = [...design.elements];
    if (opts.includeElements && preset.elementKinds) {
        const sides: Side[] = opts.placementSides?.length
            ? opts.placementSides
            : linked
              ? ["left", "right"]
              : opts.activeSide
                ? [opts.activeSide]
                : (["left", "right"] as Side[]);

        if (opts.mode === "replace") {
            elements = elements.filter((e) => !sides.includes(e.side) || e.kind === "custom");
        }

        for (const side of sides) {
            const kinds = preset.elementKinds[side] ?? (linked ? preset.elementKinds.left : undefined);
            if (!kinds?.length) continue;
            elements.push(...newElementsForSide(kinds, side, design));
        }
    }

    return {
        ...design,
        thicknessMm: preset.thicknessMm ?? design.thicknessMm,
        printRecipe: preset.printRecipe ?? design.printRecipe,
        corrections: corr,
        elements,
    };
}
