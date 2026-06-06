import { z } from "zod";
import { ELEMENT_KINDS, PRODUCTION_METHODS, SCAN_PATTERNS } from "./prescription-schema";

// Zod schema for a full design payload, used by design.save. Mirrors the
// client `DesignState` type.

const sideCorrection = z.object({
    forefootPostingDeg: z.number(),
    rearfootPostingDeg: z.number(),
    medialSkiveMm: z.number(),
    lateralSkiveMm: z.number(),
    archFillMm: z.number(),
    archHeightMm: z.number(),
    heelCupDepthMm: z.number(),
    heelCupHeightMm: z.number(),
    apexMoveMm: z.number(),
    medialFlangeMm: z.number(),
    lateralFlangeMm: z.number(),
});

const placedElement = z.object({
    kind: z.enum(ELEMENT_KINDS),
    side: z.enum(["left", "right"]),
    position: z.object({ x: z.number(), y: z.number() }),
    rotationDeg: z.number(),
    scale: z.object({ x: z.number(), y: z.number() }),
    heightMm: z.number(),
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
    trimlines: designTrimlines,
});

export type DesignStatePayload = z.infer<typeof designStateSchema>;
