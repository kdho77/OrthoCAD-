// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Writes a fail-closed SAMPLE_Top settingsJson onto one existing dogfood design.

import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeBottomTextMarking, type TextMarking } from "../../../shared/bottom-text-marking.js";
import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import type { HardnessName } from "../../../shared/print-recipe/print-recipe.js";
import {
    parseSavedDesignCatalog,
    type SavedDesignCatalog,
    type SavedDesignSlider,
    SavedDesignSnapshotError,
    SLIDER_FIELDS,
    type StoredLinkShoe,
} from "../../../shared/saved-design-catalog.js";
import {
    buildSavedDesignSnapshot,
    type SavedDesignSnapshotBuild,
} from "../../../shared/saved-design-snapshot.js";

/** Explicit order method. Omitted means the caller did not choose one. */
export const SAVED_DESIGN_MANUFACTURING_METHODS = ["printing_solid", "milling_3axis"] as const;
export type SavedDesignManufacturingMethod = (typeof SAVED_DESIGN_MANUFACTURING_METHODS)[number];

/**
 * Same fields the editor stores when the order is Mill: design.method and both
 * paired feet. Does not look at material, hardness, or thickness.
 */
export function applySavedDesignManufacturingMethod(
    design: SavedDesignSnapshotBuild["design"],
    method: SavedDesignManufacturingMethod,
): void {
    design.method = method;
    if (design.paired) {
        design.paired.leftMethod = method;
        design.paired.rightMethod = method;
    }
}

import {
    SAMPLE_TOP_ASSET_ID,
    SAMPLE_TOP_GLB_PATH,
} from "../../../src/lib/geometry/procedural-wall/sample-top-id.js";
import type { CadOperatorPrincipal } from "../auth/cad-operator.js";
import { dogfoodDesignRead } from "../auth/dogfood-design-access.js";
import { settingsEnvelopeForSave } from "./design-schema.js";

interface SnapshotLink {
    tenantId: string;
    source: string;
    externalOrderId: string;
    sides: string;
    shoeSizeSystem: "US_M" | "US_W" | "EU";
    shoeSize: number;
    shoeSizeLeft: number | null;
    shoeSizeRight: number | null;
    shoeWidth: string;
}

interface SnapshotRow {
    id: string;
    ownerId: string;
    name: string;
    kind: string;
    pattern: string;
    method: string;
    thicknessMm: number;
    linked: boolean;
    unit: string;
    settingsJson: unknown;
    updatedAt: Date | string;
    deletedAt: Date | string | null;
    client: { tenantId: string | null } | null;
    integrationLink: SnapshotLink | null;
}

export interface PersistSavedDesignSnapshotResult {
    ok: true;
    design_id: string;
    ignored_fields: string[];
    unmapped_fields: string[];
    paths: string[];
    settingsJson: unknown;
    template: "SAMPLE_Top";
    scans_used: false;
    shoe_width: string;
    shoe_width_source: "prescribed" | "defaulted";
    hardness: string | null;
    hardness_source: "prescribed" | "unspecified";
}

function storedShoe(link: SnapshotLink | null): StoredLinkShoe | null {
    if (!link) return null;
    return {
        system: link.shoeSizeSystem,
        size: typeof link.shoeSize === "number" ? link.shoeSize : null,
        left: link.shoeSizeLeft,
        right: link.shoeSizeRight,
        width: link.shoeWidth,
    };
}

function assertSampleTop(settingsJson: unknown): void {
    const settings = readStoredDesignSettings(settingsJson);
    const base = settings?.base as { assetId?: string; glbPath?: string } | undefined;
    const paired = settings?.paired as
        | { leftBase?: { assetId?: string; glbPath?: string }; rightBase?: { mirrored?: boolean } }
        | undefined;
    const assetId = base?.assetId ?? paired?.leftBase?.assetId;
    const glbPath = base?.glbPath ?? paired?.leftBase?.glbPath;
    if (
        assetId !== SAMPLE_TOP_ASSET_ID ||
        glbPath !== SAMPLE_TOP_GLB_PATH ||
        paired?.rightBase?.mirrored !== true
    ) {
        throw new SavedDesignSnapshotError(
            "snapshot is not the bundled SAMPLE_Top template. Refusing to write.",
        );
    }
}

type SnapshotBuilder = (input: {
    stored: StoredLinkShoe | null;
    catalog: SavedDesignCatalog;
}) => SavedDesignSnapshotBuild;

function sliderHasNumber(sliders: SavedDesignSlider | undefined): boolean {
    if (!sliders) return false;
    return Object.values(sliders).some((value) => typeof value === "number");
}

function catalogSetsSliderField(catalog: SavedDesignCatalog, side: "left" | "right", field: string): boolean {
    const bySide = catalog.sliders_by_side?.[side];
    if (bySide) {
        for (const [catalogKey, correctionField] of Object.entries(SLIDER_FIELDS)) {
            if (correctionField === field && bySide[catalogKey] !== undefined) return true;
        }
        return false;
    }
    if (!catalog.sliders) return false;
    for (const [catalogKey, correctionField] of Object.entries(SLIDER_FIELDS)) {
        if (correctionField === field && catalog.sliders[catalogKey] !== undefined) return true;
    }
    return false;
}

/**
 * Omitted catalog keys must not zero clinical fields that were already stored.
 * Only applies when the row already has version-1 settingsJson.
 */
function mergeStoredClinicalIntoSnapshot(
    built: SavedDesignSnapshotBuild,
    catalog: SavedDesignCatalog,
    existing: Record<string, unknown> | null,
): void {
    if (!existing) return;

    // A prior letter-height choice survives. The pre-#353 implicit 6 mm does not.
    if (existing.textMarking && typeof existing.textMarking === "object") {
        built.design.textMarking = normalizeBottomTextMarking(existing.textMarking as Partial<TextMarking>);
    }

    if (catalog.elements === undefined && Array.isArray(existing.elements)) {
        built.design.elements = structuredClone(existing.elements) as typeof built.design.elements;
    }

    if (catalog.sinks === undefined && existing.sinks !== undefined) {
        built.design.sinks = structuredClone(existing.sinks) as typeof built.design.sinks;
    }

    if (catalog.hardness === undefined) {
        const existingRecipe = existing.printRecipe as { defaultHardness?: HardnessName } | undefined;
        if (existingRecipe?.defaultHardness && built.design.printRecipe) {
            built.design.printRecipe = {
                ...built.design.printRecipe,
                defaultHardness: existingRecipe.defaultHardness,
            };
        }
        const existingDogfood = existing.dogfoodManufacturing as
            | {
                  hardness?: HardnessName | null;
                  hardnessSource?: "prescribed" | "unspecified";
                  shoeWidth?: SavedDesignSnapshotBuild["shoeWidth"];
                  shoeWidthSource?: "prescribed" | "defaulted";
              }
            | undefined;
        if (existingDogfood && built.design.dogfoodManufacturing) {
            built.design.dogfoodManufacturing = {
                ...built.design.dogfoodManufacturing,
                ...(existingDogfood.hardness !== undefined ? { hardness: existingDogfood.hardness } : {}),
                ...(existingDogfood.hardnessSource !== undefined
                    ? { hardnessSource: existingDogfood.hardnessSource }
                    : {}),
            };
            built.hardness = built.design.dogfoodManufacturing.hardness ?? built.hardness;
            built.hardnessSource = built.design.dogfoodManufacturing.hardnessSource ?? built.hardnessSource;
        }
    }

    if (catalog.width === undefined && built.design.dogfoodManufacturing) {
        const existingWidth = existing.dogfoodManufacturing as
            | {
                  shoeWidth?: SavedDesignSnapshotBuild["shoeWidth"];
                  shoeWidthSource?: "prescribed" | "defaulted";
              }
            | undefined;
        if (
            existingWidth?.shoeWidthSource === "prescribed" ||
            existingWidth?.shoeWidthSource === "defaulted"
        ) {
            built.design.dogfoodManufacturing = {
                ...built.design.dogfoodManufacturing,
                shoeWidthSource: existingWidth.shoeWidthSource,
                ...(existingWidth.shoeWidth ? { shoeWidth: existingWidth.shoeWidth } : {}),
            };
            if (existingWidth.shoeWidth) {
                built.design.shoeWidth = existingWidth.shoeWidth;
                built.shoeWidth = existingWidth.shoeWidth;
            }
            built.shoeWidthSource = existingWidth.shoeWidthSource;
        }
    }

    const existingCorrections = existing.corrections as
        | {
              linked?: boolean;
              left?: Record<string, unknown>;
              right?: Record<string, unknown>;
          }
        | undefined;
    if (!existingCorrections?.left || !existingCorrections?.right) return;

    const hasSliders =
        sliderHasNumber(catalog.sliders) ||
        Boolean(catalog.sliders_by_side?.left || catalog.sliders_by_side?.right);

    for (const side of ["left", "right"] as const) {
        const target = built.design.corrections[side];
        const source = existingCorrections[side];
        for (const [key, value] of Object.entries(source)) {
            if (key === "rearfootWedge" || key === "forefootWedge" || key === "fullLengthWedge") continue;
            if (catalogSetsSliderField(catalog, side, key)) continue;
            if (key === "archHeightMm" && catalog.arch !== undefined) continue;
            if (key === "apexMoveMm" && catalog.flexible_foot !== undefined) continue;
            if (value === undefined) continue;
            (target as unknown as Record<string, unknown>)[key] = structuredClone(value);
        }
        if (!catalog.rearfoot_wedge && source.rearfootWedge !== undefined) {
            target.rearfootWedge = structuredClone(source.rearfootWedge) as typeof target.rearfootWedge;
        }
        if (!catalog.forefoot_wedge && source.forefootWedge !== undefined) {
            target.forefootWedge = structuredClone(source.forefootWedge) as typeof target.forefootWedge;
        }
        if (!catalog.full_length_wedge && source.fullLengthWedge !== undefined) {
            target.fullLengthWedge = structuredClone(source.fullLengthWedge) as typeof target.fullLengthWedge;
        }
    }

    if (
        !hasSliders &&
        catalog.arch === undefined &&
        catalog.flexible_foot !== true &&
        !catalog.rearfoot_wedge &&
        !catalog.forefoot_wedge &&
        !catalog.full_length_wedge
    ) {
        built.design.corrections.linked = existingCorrections.linked ?? built.design.corrections.linked;
    }
}

/**
 * Replace settingsJson on the given design. Does not create a design, touch
 * production status, or read rx text / notes from the integration link.
 */
export async function persistSavedDesignSnapshotOnDesign(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal;
    designId: string;
    catalog: unknown;
    /**
     * When set, writes this method onto the snapshot and the design column.
     * Omitted leaves the column alone and keeps the snapshot's print method.
     */
    manufacturingMethod?: SavedDesignManufacturingMethod;
    /** Test seam. Production uses {@link buildSavedDesignSnapshot} from shared. */
    buildSnapshot?: SnapshotBuilder;
}): Promise<PersistSavedDesignSnapshotResult> {
    const row = (await args.prisma.design.findUnique({
        where: { id: args.designId },
        select: {
            id: true,
            ownerId: true,
            name: true,
            kind: true,
            pattern: true,
            method: true,
            thicknessMm: true,
            linked: true,
            unit: true,
            settingsJson: true,
            updatedAt: true,
            deletedAt: true,
            client: { select: { tenantId: true } },
            integrationLink: {
                select: {
                    tenantId: true,
                    source: true,
                    externalOrderId: true,
                    sides: true,
                    shoeSizeSystem: true,
                    shoeSize: true,
                    shoeSizeLeft: true,
                    shoeSizeRight: true,
                    shoeWidth: true,
                },
            },
        },
    })) as SnapshotRow | null;

    const design = dogfoodDesignRead(
        args.principal,
        row
            ? {
                  id: row.id,
                  ownerId: row.ownerId,
                  name: row.name,
                  kind: row.kind,
                  pattern: row.pattern,
                  method: row.method,
                  thicknessMm: row.thicknessMm,
                  linked: row.linked,
                  unit: row.unit,
                  settingsJson: row.settingsJson,
                  updatedAt: row.updatedAt,
                  deletedAt: row.deletedAt,
                  clientTenantId: row.client?.tenantId ?? null,
                  linkTenantId: row.integrationLink?.tenantId ?? null,
                  source: row.integrationLink?.source ?? null,
                  externalOrderId: row.integrationLink?.externalOrderId ?? null,
                  sides: row.integrationLink?.sides ?? null,
              }
            : null,
    );

    if (row?.kind === "afo") {
        throw new SavedDesignSnapshotError("AFO designs are not a SAMPLE_Top insole snapshot.");
    }
    // Milled rows may store the SAMPLE_Top snapshot (default mesh + thickness).
    // The method column changes only when manufacturingMethod is sent.
    // Belt G-code still refuses milling_3axis.

    const catalog = parseSavedDesignCatalog(args.catalog);
    const buildSnapshot = args.buildSnapshot ?? buildSavedDesignSnapshot;
    const existingSettings = readStoredDesignSettings(row?.settingsJson ?? null);
    const built = buildSnapshot({
        stored: storedShoe(row?.integrationLink ?? null),
        catalog,
    });
    mergeStoredClinicalIntoSnapshot(built, catalog, existingSettings);
    if (args.manufacturingMethod) {
        applySavedDesignManufacturingMethod(built.design, args.manufacturingMethod);
    }

    let settingsJson: unknown;
    try {
        settingsJson = settingsEnvelopeForSave(built.design);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new SavedDesignSnapshotError(`snapshot is not loftable (${message}). Refusing to write.`);
    }
    assertSampleTop(settingsJson);
    const stored = readStoredDesignSettings(settingsJson);
    if (stored?.usMenSize !== built.usMenSize) {
        throw new SavedDesignSnapshotError("snapshot lost the shoe size. Refusing to write.");
    }

    const updateData: {
        settingsJson: Prisma.InputJsonValue;
        thicknessMm?: number;
        method?: SavedDesignManufacturingMethod;
    } = {
        settingsJson: settingsJson as Prisma.InputJsonValue,
    };
    if (catalog.thickness_mm !== undefined) {
        updateData.thicknessMm = built.design.thicknessMm;
    }
    if (args.manufacturingMethod) {
        updateData.method = args.manufacturingMethod;
    }
    await args.prisma.design.update({
        where: { id: design.id },
        data: updateData,
    });

    return {
        ok: true,
        design_id: design.id,
        ignored_fields: built.ignoredFields,
        unmapped_fields: built.ignoredFields,
        paths: built.paths,
        settingsJson,
        template: "SAMPLE_Top",
        scans_used: false,
        shoe_width: built.shoeWidth,
        shoe_width_source: built.shoeWidthSource,
        hardness: built.hardness,
        hardness_source: built.hardnessSource,
    };
}
