import { z } from "zod";
import { designSettingsEnvelope, stripMeshBlobs } from "../../../shared/design-settings.js";
import {
    depthSpecSchema,
    hardnessClassSchema,
    hardnessOverridesSchema,
} from "../../../shared/print-recipe/hardness-region.js";
import { printRecipeV1Schema } from "../../../shared/print-recipe/print-recipe.js";
import { ELEMENT_KINDS, PRODUCTION_METHODS, SCAN_PATTERNS } from "./prescription-schema.js";

// Zod schema for a full design payload, used by design.save. Mirrors the
// client `DesignState` type.

const wedgeCorrection = z
    .object({
        side: z.enum(["medial", "lateral"]),
        value: z.number(),
        unit: z.enum(["mm", "deg"]),
        degreeMode: z.enum(["local", "station"]).optional(),
    })
    .passthrough();

const sideShapeFinish = z
    .object({
        topCoverAccommodateMm: z.number(),
        trimmableForefoot: z.boolean(),
        trimmableForefootExtraMm: z.number(),
        archGrindDepthMm: z.number(),
        archSkiveMm: z.number(),
        archSkiveSide: z.enum(["medial", "lateral", "central"]),
    })
    .passthrough();

const sideCorrection = z
    .object({
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
        heelLiftTaperPreset: z.enum(["midfoot", "metHeads", "sulcus", "custom"]).optional(),
        heelLiftTaperEndU: z.number().optional(),
        heelLiftCustomTaperPctAp: z.number().optional(),
        archEaseMm: z.number().optional(),
        skiveAngleDeg: z.number().optional(),
        skiveLocationPct: z.number().optional(),
        skiveDriven: z.enum(["angle", "location"]).optional(),
        apexMoveMm: z.number(),
        medialFlangeMm: z.number(),
        lateralFlangeMm: z.number(),
        rearfootWedge: wedgeCorrection.optional(),
        forefootWedge: wedgeCorrection.optional(),
        fullLengthWedge: z
            .object({
                side: z.enum(["medial", "lateral"]),
                value: z.number().optional(),
                unit: z.enum(["mm", "deg"]).optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

const placedElement = z
    .object({
        id: z.string().min(1).optional(),
        kind: z.enum([...ELEMENT_KINDS, "toe_crest", "cuboid_pad", "custom"]),
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
    })
    .passthrough();

const shoeWidth = z.enum(["extra_narrow", "narrow", "medium", "wide", "extra_wide"]);

const designBase = z
    .object({
        assetId: z.string().min(1),
        name: z.string().optional(),
        source: z.enum(["custom", "stock"]),
        glbPath: z.string().optional(),
        url: z.string().optional(),
        primarySide: z.string().nullable().optional(),
        offlinePlaceholder: z.boolean().optional(),
        resolutionFallback: z.boolean().optional(),
        mirrored: z.boolean().optional(),
        mirroredFrom: z.string().optional(),
    })
    .passthrough();

const placedSink = z
    .object({
        id: z.string().min(1),
        kind: z.enum(["mpj1", "mpj2", "mpj3", "mpj4", "mpj5", "rkw", "styloid"]),
        depthMm: z.number(),
        u: z.number().optional(),
        v: z.number().optional(),
        markerId: z.string().optional(),
        rimOverride: z.boolean().optional(),
    })
    .passthrough();

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
    .passthrough()
    .optional();

export const designStateSchema = z
    .object({
        pattern: z.enum(SCAN_PATTERNS),
        method: z.enum(PRODUCTION_METHODS),
        thicknessMm: z.number(),
        corrections: z
            .object({
                unit: z.enum(["mm", "deg"]),
                linked: z.boolean(),
                left: sideCorrection,
                right: sideCorrection,
            })
            .passthrough(),
        elements: z.array(placedElement),
        splitElements: z.boolean().optional(),
        smoothElements: z.boolean().optional(),
        trimlines: designTrimlines,
        printRecipe: printRecipeV1Schema.passthrough().optional(),
        customPrefabId: z.string().optional(),
        customPrefabName: z.string().optional(),
        base: designBase.optional(),
        shellThicknessMode: z.enum(["uniform", "zonal"]).optional(),
        shellThicknessRfMm: z.number().optional(),
        shellThicknessMfMm: z.number().optional(),
        shellThicknessFfMm: z.number().optional(),
        shellThicknessBlendMm: z.number().optional(),
        sizeSystem: z.enum(["us", "uk", "mm"]).optional(),
        usMenSize: z.number().optional(),
        ukSize: z.number().optional(),
        footLengthMm: z.number().optional(),
        shoeWidth: shoeWidth.optional(),
        shoeWidthBySide: z
            .object({
                left: shoeWidth.optional(),
                right: shoeWidth.optional(),
            })
            .passthrough()
            .optional(),
        sinks: z
            .object({
                left: z.array(placedSink).optional(),
                right: z.array(placedSink).optional(),
            })
            .passthrough()
            .optional(),
        sinkStyloidThicken: z
            .object({
                left: z.boolean().optional(),
                right: z.boolean().optional(),
            })
            .passthrough()
            .optional(),
        trimPreset: z
            .object({
                left: z.enum(["full", "sulcus", "met_head", "custom"]).optional(),
                right: z.enum(["full", "sulcus", "met_head", "custom"]).optional(),
            })
            .passthrough()
            .optional(),
        paired: z
            .object({
                leftBase: designBase.optional(),
                rightBase: designBase.optional(),
                leftThicknessMm: z.number(),
                rightThicknessMm: z.number(),
                leftMethod: z.enum(PRODUCTION_METHODS),
                rightMethod: z.enum(PRODUCTION_METHODS),
                linked: z.boolean(),
                rightMetadata: z
                    .object({
                        mirroredFrom: z.string().optional(),
                    })
                    .passthrough()
                    .optional(),
            })
            .passthrough()
            .optional(),
        shapeFinish: z
            .object({
                linked: z.boolean(),
                left: sideShapeFinish,
                right: sideShapeFinish,
            })
            .passthrough()
            .optional(),
        textMarking: z
            .object({
                text: z.string().max(40),
                addPatientName: z.boolean().optional(),
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
            .passthrough()
            .optional(),
        pressureMaps: z
            .object({
                left: z.any().optional(),
                right: z.any().optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export type DesignStatePayload = z.infer<typeof designStateSchema>;

/** Validated design parameters with mesh keys removed. Identity for a normal design state. */
export function settingsForDesignSave(state: unknown): DesignStatePayload {
    return stripMeshBlobs(designStateSchema.parse(state));
}

/** Column payload: `{ schemaVersion, settings }`. */
export function settingsEnvelopeForSave(state: unknown) {
    return designSettingsEnvelope(settingsForDesignSave(state) as Record<string, unknown>);
}
