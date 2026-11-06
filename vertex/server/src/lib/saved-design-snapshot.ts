// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Writes a fail-closed SAMPLE_Top settingsJson onto one existing dogfood design.

import type { Prisma, PrismaClient } from "@prisma/client";

import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import {
    parseSavedDesignCatalog,
    type SavedDesignCatalog,
    SavedDesignSnapshotError,
    type StoredLinkShoe,
} from "../../../shared/saved-design-catalog.js";
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

/**
 * Replace settingsJson on the given design. Does not create a design, touch
 * production status, or read rx text / notes from the integration link.
 */
type SnapshotBuilder = (input: { stored: StoredLinkShoe | null; catalog: SavedDesignCatalog }) => {
    design: unknown;
    paths: string[];
    ignoredFields: string[];
    usMenSize: number;
};

async function loadSnapshotBuilder(): Promise<SnapshotBuilder> {
    // Non-literal specifier so server tsc does not pull the client loft module.
    const builderSpecifier: string = "../../../src/lib/clinical/saved-design-snapshot.ts";
    const module = (await import(builderSpecifier)) as { buildSavedDesignSnapshot: SnapshotBuilder };
    return module.buildSavedDesignSnapshot;
}

export async function persistSavedDesignSnapshotOnDesign(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal;
    designId: string;
    catalog: unknown;
    /** Test seam. Production loads the SAMPLE_Top builder. */
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
    if (row?.method === "milling_3axis") {
        throw new SavedDesignSnapshotError(
            "Milled orders are not belt G-code. Refusing to write a print snapshot.",
        );
    }

    const catalog = parseSavedDesignCatalog(args.catalog);
    const buildSnapshot = args.buildSnapshot ?? (await loadSnapshotBuilder());
    const built = buildSnapshot({
        stored: storedShoe(row?.integrationLink ?? null),
        catalog,
    });

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

    await args.prisma.design.update({
        where: { id: design.id },
        data: { settingsJson: settingsJson as Prisma.InputJsonValue },
    });

    return {
        ok: true,
        design_id: design.id,
        ignored_fields: built.ignoredFields,
        unmapped_fields: built.ignoredFields,
        paths: built.paths,
        settingsJson,
    };
}
