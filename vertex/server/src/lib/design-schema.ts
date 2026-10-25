import { z } from "zod";
import {
    depthSpecSchema,
    hardnessClassSchema,
    hardnessOverridesSchema,
} from "../../../shared/print-recipe/hardness-region.js";
import { printRecipeV1Schema } from "../../../shared/print-recipe/print-recipe.js";
import { ELEMENT_KINDS, PRODUCTION_METHODS, SCAN_PATTERNS } from "./prescription-schema.js";

// Zod schema for a full design payload, used by design.save. Mirrors the
// client `DesignState` type.

const wedgeCorrection = z.object({
    side: z.enum(["medial", "lateral"]),
    value: z.number(),
    unit: z.enum(["mm", "deg"]),
});

const sideShapeFinish = z.object({
    topCoverAccommodateMm: z.number(),
    trimmableForefoot: z.boolean(),
    trimmableForefootExtraMm: z.number(),
    archGrindDepthMm: z.number(),
    archSkiveMm: z.number(),
    archSkiveSide: z.enum(["medial", "lateral", "central"]),
});

const sideCorrection = z.object({
    forefootPostingDeg: z.number(),
    rearfootPostingDeg: z.number(),
    medialSkiveMm: z.number(),
    lateralSkiveMm: z.number(),
    archFillMm: z.number(),
    archHeightMm: z.number(),
    heelCupDepthMm: z.number(),
    heelCupHeightMm: z.number(),
    // Newer fields are optional so previously-saved designs still validate.
    heelCupWidthMm: z.number().optional(),
    forefootWidthMm: z.number().optional(),
    heelLiftMm: z.number().optional(),
    apexMoveMm: z.number(),
    medialFlangeMm: z.number(),
    lateralFlangeMm: z.number(),
    rearfootWedge: wedgeCorrection.optional(),
    forefootWedge: wedgeCorrection.optional(),
});

const placedElement = z.object({
    id: z.string().min(1).optional(),
    kind: z.enum([...ELEMENT_KINDS, "custom"]),
    customElementId: z.string().optional(),
    customName: z.string().optional(),
    side: z.enum(["left", "right"]),
    position: z.object({ x: z.number(), y: z.number() }),
    rotationDeg: z.number(),
    scale: z.object({ x: z.number(), y: z.number() }),
    scaleLocked: z.boolean().optional(),
    heightMm: z.number(),
    regionId: z.string().min(1).optional(),
    hardnessClass: hardnessClassSchema.optional(),
    priority: z.number().int().optional(),
    depth: depthSpecSchema.optional(),
    overrides: hardnessOverridesSchema.optional(),
    placementMode: z.enum(["flow", "noFlow"]).optional(),
    zOffsetMm: z.number().optional(),
});

const trimlinePoint = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
});

const designTrimlines = z
    .object({
        left: z.array(trimlinePoint).optional(),
        right: z.array(trimlinePoint).optional(),
    })
    .optional();

export const designStateSchema = z.object({
    pattern: z.enum(SCAN_PATTERNS),
    method: z.enum(PRODUCTION_METHODS),
    thicknessMm: z.number(),
    corrections: z.object({
        unit: z.enum(["mm", "deg"]),
        linked: z.boolean(),
        left: sideCorrection,
        right: sideCorrection,
    }),
    elements: z.array(placedElement),
    splitElements: z.boolean().optional(),
    smoothElements: z.boolean().optional(),
    trimlines: designTrimlines,
    printRecipe: printRecipeV1Schema.optional(),
    shapeFinish: z
        .object({
            linked: z.boolean(),
            left: sideShapeFinish,
            right: sideShapeFinish,
        })
        .optional(),
    textMarking: z
        .object({
            text: z.string().max(40),
            surface: z.enum(["bottom", "wall"]),
            mode: z.enum(["engrave", "emboss"]),
            bold: z.boolean(),
            capHeightMm: z.number(),
            depthMm: z.number(),
            heightMm: z.number(),
            letterSpacingMm: z.number(),
            rotationDeg: z.number(),
            placementU: z.number(),
        })
        .optional(),
});

export type DesignStatePayload = z.infer<typeof designStateSchema>;
