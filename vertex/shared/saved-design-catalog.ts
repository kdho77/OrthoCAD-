// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Structured VertexOrders catalog for a SAMPLE_Top settings snapshot.
// rx_text, notes, rigidity, and extra_soft are accepted and ignored.
// hardness is mapped only when it names Extra Soft, Soft, Medium, Hard, or Extra Hard.

import { z } from "zod";

/** Low −3.5 mm, Medium/Standard 0, High +3 mm. Applied only when `arch` is present. */
export const ARCH_HEIGHT_MM = {
    low: -3.5,
    medium: 0,
    standard: 0,
    high: 3,
} as const;

export type ArchName = keyof typeof ARCH_HEIGHT_MM;

/** Built-in apex shift when flexible_foot is explicitly true. Not derived from rigidity. */
export const FLEXIBLE_FOOT_APEX_MM = 4;

/** Medial/lateral flange heights (mm). Matches CorrectionsPanel and clinical-constraints 0–8. */
export const FLANGE_MM_MIN = 0;
export const FLANGE_MM_MAX = 8;

/** Level shorthand when medial_mm / lateral_mm are omitted on a requested foot side. */
export const FLANGE_LEVEL_MM = {
    mild: 2,
    standard: 3,
    high: 6,
} as const;

export type FlangeLevel = keyof typeof FLANGE_LEVEL_MM;

/** US women's retail label is men's + 1.5 (shoe-size.ts). Inverse maps a stored US_W size. */
export const US_WOMEN_TO_MENS_OFFSET = 1.5;

/**
 * Human Corrections "Shell thickness" (`design.thicknessMm`).
 * This is the labelled shell/base clearance, not the zonal rear/mid/fore walls.
 * Min and max match CLINICAL_LIMITS.thicknessMm and the Corrections slider.
 * The omitted default matches BASE_REFERENCE_THICKNESS_MM.
 */
export const SHELL_THICKNESS_MM_MIN = 1.5;
export const SHELL_THICKNESS_MM_MAX = 8;
export const SHELL_THICKNESS_MM_DEFAULT = 2;

/** Loft dropdown bounds. Sizes outside this are rejected instead of clamped. */
export const LOFT_US_MEN_MIN = 1;
export const LOFT_US_MEN_MAX = 16;

export const SLIDER_FIELDS = {
    forefoot_posting_deg: "forefootPostingDeg",
    rearfoot_posting_deg: "rearfootPostingDeg",
    medial_skive_mm: "medialSkiveMm",
    lateral_skive_mm: "lateralSkiveMm",
    arch_elongation_mm: "archElongationMm",
    heel_cup_depth_mm: "heelCupDepthMm",
    heel_cup_height_mm: "heelCupHeightMm",
    heel_cup_width_mm: "heelCupWidthMm",
    forefoot_width_mm: "forefootWidthMm",
    heel_lift_mm: "heelLiftMm",
    medial_flange_mm: "medialFlangeMm",
    lateral_flange_mm: "lateralFlangeMm",
} as const;

export type SliderField = keyof typeof SLIDER_FIELDS;

/**
 * Sign of `rearfoot_posting_deg` on `sliders` and `sliders_by_side`.
 * Matches the Corrections slider (`positive = pronation`), the posting-edge
 * labels (lateral high = pronation, medial high = supination), and
 * `migrateSideCorrections` (+deg → lateral wedge, −deg → medial wedge).
 * Varus is medial-high. Valgus is lateral-high.
 */
export const REARFOOT_POSTING_DEG_SIGN =
    "Positive is valgus (lateral high, pronation). Negative is varus (medial high, supination). " +
    "The solid migrates a positive degree to a lateral rearfoot wedge and a negative degree to a medial rearfoot wedge, then clears the slider. Zero is no post.";

/**
 * `rearfoot_wedge.foot` and `full_length_wedge.foot`.
 * Omitted is both feet, the same write the catalog did before this field existed.
 */
export const WEDGE_FOOT_FIELD =
    "left, right, or both. Omit or both posts both feet. left or right posts that foot only and unlinks corrections so the other foot stays at the template.";

/** Present on the catalog and never copied into clinical settings. Hardness is handled separately. */
export const IGNORED_CATALOG_KEYS = ["rx_text", "notes", "rigidity", "extra_soft", "hardness"] as const;

export type IgnoredCatalogKey = (typeof IGNORED_CATALOG_KEYS)[number];

const shoeSystemSchema = z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "_") : value),
    z.enum(["US_M", "US_W", "EU"]),
);

const widthSchema = z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, "_") : value),
    z.enum(["narrow", "medium", "wide", "extra_narrow", "extra_wide", "xx_wide"]),
);

const archSchema = z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.enum(["low", "medium", "standard", "high"]),
);

/**
 * Catalog `length` → the #364 trim preset. Full is uncut.
 * 3/4 is Met-head (`TRIM_PRESET_LANDMARK_U.met_head`). Sulcus is the Sulcus preset.
 * Nothing else is accepted.
 */
export function catalogLengthPreset(value: string): "full" | "met_head" | "sulcus" | null {
    const key = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    if (key === "full") return "full";
    if (key === "sulcus") return "sulcus";
    if (
        key === "3/4" ||
        key === "3/4 length" ||
        key === "met head" ||
        key === "methead" ||
        key === "three quarter" ||
        key === "threequarter"
    ) {
        return "met_head";
    }
    return null;
}

export const catalogLengthSchema = z.preprocess(
    (value) => {
        if (typeof value !== "string") return value;
        return catalogLengthPreset(value) ?? value;
    },
    z.enum(["full", "met_head", "sulcus"]),
);

const sliderShape = {
    forefoot_posting_deg: z.number().finite().optional(),
    rearfoot_posting_deg: z.number().finite().optional().describe(REARFOOT_POSTING_DEG_SIGN),
    medial_skive_mm: z.number().finite().optional(),
    lateral_skive_mm: z.number().finite().optional(),
    arch_elongation_mm: z.number().finite().optional(),
    heel_cup_depth_mm: z.number().finite().optional(),
    heel_cup_height_mm: z.number().finite().optional(),
    heel_cup_width_mm: z.number().finite().optional(),
    forefoot_width_mm: z.number().finite().optional(),
    heel_lift_mm: z.number().finite().optional(),
    medial_flange_mm: z.number().finite().optional(),
    lateral_flange_mm: z.number().finite().optional(),
} satisfies Record<SliderField, z.ZodOptional<z.ZodNumber>>;

export const savedDesignSliderSchema = z
    .object({
        ...sliderShape,
        /** Legacy. Accepted so old catalogs load. Not copied onto the design. */
        arch_ease_mm: z.number().finite().optional(),
    })
    .strict();

const wedgeSchema = z
    .object({
        side: z.enum(["medial", "lateral"]),
        value: z.number().finite(),
        unit: z.enum(["mm", "deg"]),
        degree_mode: z.enum(["local", "station"]).optional(),
    })
    .strict();

const wedgeFootSchema = z.enum(["left", "right", "both"]).describe(WEDGE_FOOT_FIELD);

const rearfootWedgeSchema = z
    .object({
        side: z.enum(["medial", "lateral"]),
        value: z.number().finite(),
        unit: z.enum(["mm", "deg"]),
        degree_mode: z.enum(["local", "station"]).optional(),
        foot: wedgeFootSchema.optional(),
    })
    .strict();

const fullLengthWedgeSchema = z
    .object({
        side: z.enum(["medial", "lateral"]),
        value: z.number().finite(),
        unit: z.enum(["mm", "deg"]),
        foot: wedgeFootSchema.optional(),
    })
    .strict();

const elementSchema = z
    .object({
        name: z.string().trim().min(1).max(80),
        side: z.enum(["left", "right"]),
        height_mm: z.number().finite().nonnegative().optional(),
    })
    .strict();

/**
 * Subtractive library sinks. `name` and `kind` accept the same aliases
 * (mpj1, "1st MPJ", "1st met head", and the other SINK_PROFILES labels).
 * depth_mm is checked against that kind's max in the snapshot. Omit u and v
 * so the loft uses the profile the human UI uses.
 */
const sinkSchema = z
    .object({
        name: z.string().trim().min(1).max(80).optional(),
        kind: z.string().trim().min(1).max(80).optional(),
        side: z.enum(["left", "right"]),
        depth_mm: z.number().finite().optional(),
        u: z.number().finite().optional(),
        v: z.number().finite().optional(),
    })
    .strict();

const flangeLevelSchema = z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.enum(["mild", "standard", "high"]),
);

const flangeSideSchema = z
    .object({
        medial_mm: z.number().finite().optional(),
        lateral_mm: z.number().finite().optional(),
        level: flangeLevelSchema.optional(),
    })
    .strict();

export const savedDesignCatalogSchema = z
    .object({
        shoe_size: z
            .object({
                system: shoeSystemSchema,
                size: z.number().finite().positive(),
                left: z.number().finite().positive().nullable().optional(),
                right: z.number().finite().positive().nullable().optional(),
            })
            .strict()
            .optional(),
        width: widthSchema.optional(),
        arch: archSchema.optional(),
        flexible_foot: z.boolean().optional(),
        elements: z.array(elementSchema).max(24).optional(),
        sinks: z.array(sinkSchema).max(14).optional(),
        sliders: savedDesignSliderSchema.optional(),
        sliders_by_side: z
            .object({
                left: savedDesignSliderSchema.optional(),
                right: savedDesignSliderSchema.optional(),
            })
            .strict()
            .optional(),
        rearfoot_wedge: rearfootWedgeSchema.optional(),
        forefoot_wedge: wedgeSchema.optional(),
        full_length_wedge: fullLengthWedgeSchema.optional(),
        /**
         * Shell thickness in mm (`design.thicknessMm`). Optional.
         * Omitted keeps {@link SHELL_THICKNESS_MM_DEFAULT} and the zonal shell.
         */
        thickness_mm: z.number().finite().min(SHELL_THICKNESS_MM_MIN).max(SHELL_THICKNESS_MM_MAX).optional(),
        /**
         * Device length. Full leaves the #364 outline uncut.
         * 3/4 stores the Met-head preset. Sulcus stores the Sulcus preset.
         * Omitted is Full. Unknown text is rejected.
         */
        length: catalogLengthSchema.optional(),
        flange: z
            .object({
                left: flangeSideSchema.optional(),
                right: flangeSideSchema.optional(),
            })
            .strict()
            .optional(),
        rx_text: z.string().max(8000).optional(),
        notes: z.string().max(8000).optional(),
        rigidity: z.string().max(80).optional(),
        extra_soft: z.union([z.string().max(80), z.boolean()]).optional(),
        hardness: z.string().max(80).optional(),
    })
    .strict();

export type SavedDesignCatalog = z.infer<typeof savedDesignCatalogSchema>;
export type SavedDesignSlider = z.infer<typeof savedDesignSliderSchema>;

export interface StoredLinkShoe {
    system: "US_M" | "US_W" | "EU" | null;
    size: number | null;
    left: number | null;
    right: number | null;
    /** Raw integration-link width. Empty means absent. */
    width: string | null;
}

export class SavedDesignSnapshotError extends Error {
    readonly status = 422 as const;

    constructor(message: string) {
        super(message.startsWith("422 ") ? message : `422 ${message}`);
        this.name = "SavedDesignSnapshotError";
    }
}

export function parseSavedDesignCatalog(input: unknown): SavedDesignCatalog {
    const parsed = savedDesignCatalogSchema.safeParse(input ?? {});
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path.join(".") || "catalog";
        throw new SavedDesignSnapshotError(
            `invalid catalog field "${path}": ${issue?.message ?? "invalid"}. Refusing to guess a clinical value.`,
        );
    }
    return parsed.data;
}

function unwrapZod(field: z.ZodTypeAny): z.ZodTypeAny {
    if (field instanceof z.ZodEffects) return unwrapZod(field._def.schema as z.ZodTypeAny);
    if (field instanceof z.ZodOptional) return unwrapZod(field._def.innerType as z.ZodTypeAny);
    if (field instanceof z.ZodNullable) return unwrapZod(field._def.innerType as z.ZodTypeAny);
    if (field instanceof z.ZodDefault) return unwrapZod(field._def.innerType as z.ZodTypeAny);
    return field;
}

/** Dotted catalog keys, including ignored keys. Used to keep the MCP catalog in sync. */
export function listSavedDesignCatalogKeyPaths(schema: z.ZodTypeAny = savedDesignCatalogSchema): string[] {
    const paths: string[] = [];
    const walk = (field: z.ZodTypeAny, prefix: string) => {
        const inner = unwrapZod(field);
        if (inner instanceof z.ZodObject) {
            for (const [key, value] of Object.entries(inner.shape)) {
                const path = prefix ? `${prefix}.${key}` : key;
                paths.push(path);
                walk(value as z.ZodTypeAny, path);
            }
            return;
        }
        if (inner instanceof z.ZodArray) {
            walk(inner._def.type as z.ZodTypeAny, prefix);
        }
    };
    walk(schema, "");
    return paths;
}
