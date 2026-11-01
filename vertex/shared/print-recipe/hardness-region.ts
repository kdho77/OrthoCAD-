// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { z } from "zod";
import {
    classDensityPct,
    migrateRegionHardnessClass,
    REGION_HARDNESS_CLASSES,
    type RegionHardnessClass,
    softnessKey,
} from "./hardness-class-table.js";

export const REGION_KINDS = ["zone", "element", "freehand"] as const;
export type RegionKind = (typeof REGION_KINDS)[number];

export const hardnessClassSchema = z.preprocess(
    (raw) => migrateRegionHardnessClass(raw),
    z.enum(REGION_HARDNESS_CLASSES),
);

export const depthSpecSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("full") }),
    z.object({ type: z.literal("mm"), mm: z.number().positive() }),
    z.object({
        type: z.literal("element"),
        depthBelowMm: z.number().positive().default(2),
    }),
]);

export type DepthSpec = z.infer<typeof depthSpecSchema>;

export const hardnessOverridesSchema = z
    .object({
        sparseInfillDensityPct: z.number().min(5).max(100).optional(),
        sparseInfillPattern: z.literal("gyroid").optional(),
        wallLoops: z.number().int().min(0).optional(),
        topShellLayers: z.number().int().min(0).optional(),
        bottomShellLayers: z.number().int().min(0).optional(),
        filament: z.string().min(1).optional(),
    })
    .strict();

export type HardnessOverrides = z.infer<typeof hardnessOverridesSchema>;

const xyPointSchema = z.object({ x: z.number(), y: z.number() });

export const hardnessRegionSchema = z.object({
    regionId: z.string().min(1),
    kind: z.enum(REGION_KINDS),
    hardnessClass: hardnessClassSchema,
    priority: z.number().int(),
    depth: depthSpecSchema,
    overrides: hardnessOverridesSchema.optional(),
    side: z.enum(["left", "right"]),
    /** Closed XY polygon (zone / freehand). Phase 2 draws these; schema is required in Phase 1. */
    polygon: z.array(xyPointSchema).min(3).optional(),
    /** Placed-element id when kind is "element". Settings stay keyed by this id. */
    elementId: z.string().min(1).optional(),
    label: z.string().optional(),
    sourceHash: z.string().optional(),
});

export type HardnessRegion = z.infer<typeof hardnessRegionSchema>;

export const DEFAULT_ELEMENT_DEPTH: DepthSpec = { type: "element", depthBelowMm: 2 };
export const DEFAULT_ZONE_DEPTH: DepthSpec = { type: "full" };
export const DEFAULT_ZONE_PRIORITY = 0;
export const DEFAULT_ELEMENT_PRIORITY = 1;

/** Phase B 2D tags (Architecture.md MaterialZone) → kind "zone", priority 0, full depth. */
const legacyZoneTagSchema = z.object({
    zone_id: z.string().optional(),
    zoneId: z.string().optional(),
    name: z.string().optional(),
    boundary_spline: z.array(xyPointSchema).optional(),
    boundarySpline: z.array(xyPointSchema).optional(),
    polygon: z.array(xyPointSchema).optional(),
    infill_pct: z.number().optional(),
    wall_count: z.number().optional(),
    material_hardness: z.string().optional(),
    side: z.enum(["left", "right"]).optional(),
});

function classFromLegacyHardness(raw: string | undefined): RegionHardnessClass {
    return migrateRegionHardnessClass(raw ?? "Medium");
}

export function migrateLegacyZoneTag(raw: unknown, index: number): HardnessRegion | null {
    const parsed = legacyZoneTagSchema.safeParse(raw);
    if (!parsed.success) return null;
    const tag = parsed.data;
    const polygon = tag.polygon ?? tag.boundary_spline ?? tag.boundarySpline;
    if (!polygon || polygon.length < 3) return null;
    const regionId = tag.zone_id ?? tag.zoneId ?? `zone-legacy-${index}`;
    const density = tag.infill_pct;
    const hardnessClass = classFromLegacyHardness(tag.material_hardness);
    const overrides =
        hardnessClass === "Custom" && density !== undefined
            ? { sparseInfillDensityPct: Math.min(100, Math.max(5, density)) }
            : undefined;
    return hardnessRegionSchema.parse({
        regionId,
        kind: "zone",
        hardnessClass,
        priority: DEFAULT_ZONE_PRIORITY,
        depth: DEFAULT_ZONE_DEPTH,
        overrides,
        side: tag.side ?? "left",
        polygon,
        label: tag.name,
    });
}

export function migrateHardnessZones(raw: unknown): HardnessRegion[] {
    if (!Array.isArray(raw) || raw.length === 0) return [];
    const out: HardnessRegion[] = [];
    raw.forEach((item, i) => {
        const direct = hardnessRegionSchema.safeParse(item);
        if (direct.success) {
            out.push(direct.data);
            return;
        }
        const asZone = item && typeof item === "object" ? { kind: "zone", ...(item as object) } : item;
        const withKind = hardnessRegionSchema.safeParse(asZone);
        if (withKind.success) {
            out.push({
                ...withKind.data,
                kind: "zone",
                priority: withKind.data.priority ?? DEFAULT_ZONE_PRIORITY,
                depth: withKind.data.depth ?? DEFAULT_ZONE_DEPTH,
            });
            return;
        }
        const legacy = migrateLegacyZoneTag(item, i);
        if (legacy) out.push(legacy);
    });
    return out;
}

export function compareRegionResolveOrder(a: HardnessRegion, b: HardnessRegion): number {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const density = (r: HardnessRegion): number => {
        try {
            return classDensityPct(r.hardnessClass, r.overrides);
        } catch {
            return 50;
        }
    };
    const sa = softnessKey(a.hardnessClass, density(a));
    const sb = softnessKey(b.hardnessClass, density(b));
    if (sa !== sb) return sa - sb;
    return a.regionId.localeCompare(b.regionId);
}

export function defaultElementHardnessFields(
    id: string,
): Pick<HardnessRegion, "regionId" | "hardnessClass" | "priority" | "depth"> {
    return {
        regionId: id,
        hardnessClass: "Medium",
        priority: DEFAULT_ELEMENT_PRIORITY,
        depth: { ...DEFAULT_ELEMENT_DEPTH },
    };
}
