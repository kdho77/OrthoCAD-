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

/** US women's retail label is men's + 1.5 (shoe-size.ts). Inverse maps a stored US_W size. */
export const US_WOMEN_TO_MENS_OFFSET = 1.5;

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

/** Present on the catalog and never copied into clinical settings. Hardness is handled separately. */
export const IGNORED_CATALOG_KEYS = ["rx_text", "notes", "rigidity", "extra_soft", "hardness"] as const;

export type IgnoredCatalogKey = (typeof IGNORED_CATALOG_KEYS)[number];

const shoeSystemSchema = z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "_") : value),
    z.enum(["US_M", "US_W", "EU"]),
);

const widthSchema = z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, "_") : value),
    z.enum(["narrow", "medium", "wide", "extra_narrow", "extra_wide"]),
);

const archSchema = z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.enum(["low", "medium", "standard", "high"]),
);

const sliderShape = {
    forefoot_posting_deg: z.number().finite().optional(),
    rearfoot_posting_deg: z.number().finite().optional(),
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

const fullLengthWedgeSchema = z
    .object({
        side: z.enum(["medial", "lateral"]),
        value: z.number().finite(),
        unit: z.enum(["mm", "deg"]),
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
        rearfoot_wedge: wedgeSchema.optional(),
        forefoot_wedge: wedgeSchema.optional(),
        full_length_wedge: fullLengthWedgeSchema.optional(),
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
