import { z } from "zod";

// Zod schema that the AI model's JSON output must satisfy. Kept in sync with
// the client `PrescriptionParseResult` / `SideCorrections` types.

export const ELEMENT_KINDS = [
    "met_pad",
    "met_bar",
    "cluffy_wedge",
    "mortons_extension",
    "reverse_mortons",
    "heel_sink",
    "navicular_sink",
    "kinetic_wedge",
] as const;

export const SCAN_PATTERNS = ["full_contact", "prefab_3d", "flat", "custom"] as const;
export const PRODUCTION_METHODS = ["printing_solid", "printing_shell", "milling_3axis"] as const;

const sideCorrectionPatch = z
    .object({
        forefootPostingDeg: z.number(),
        rearfootPostingDeg: z.number(),
        medialSkiveMm: z.number(),
        lateralSkiveMm: z.number(),
        archFillMm: z.number(),
        archHeightMm: z.number(),
        heelCupDepthMm: z.number(),
        heelCupHeightMm: z.number(),
        apexMoveMm: z.number(),
        medialFlangeMm: z.number().default(0),
        lateralFlangeMm: z.number().default(0),
    })
    .partial();

// Tolerant of model output: coerce/clamp happens after validation.
export const prescriptionParseSchema = z.object({
    pattern: z.enum(SCAN_PATTERNS).optional(),
    method: z.enum(PRODUCTION_METHODS).optional(),
    thicknessMm: z.number().optional(),
    unit: z.enum(["mm", "deg"]).optional(),
    corrections: z
        .object({
            left: sideCorrectionPatch.optional(),
            right: sideCorrectionPatch.optional(),
        })
        .default({}),
    elements: z
        .array(
            z.object({
                kind: z.enum(ELEMENT_KINDS),
                side: z.enum(["left", "right"]),
            }),
        )
        .default([]),
    notes: z.string().default(""),
    confidence: z.number().min(0).max(1).default(0.5),
});

export type PrescriptionParse = z.infer<typeof prescriptionParseSchema>;
