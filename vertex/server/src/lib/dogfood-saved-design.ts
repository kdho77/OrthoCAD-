// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Dogfood SAMPLE_Top design for an existing order. No scan upload and no STL.

import type { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { DOGFOOD_TENANT_ID, type CadOperatorPrincipal } from "../auth/cad-operator.js";
import { assertDogfoodNotHeld } from "../../../shared/dogfood-holds.js";
import {
    buildSavedDesignSnapshot,
    type SavedDesignSnapshotBuild,
} from "../../../shared/saved-design-snapshot.js";
import { settingsEnvelopeForSave } from "./design-schema.js";
import { type PersistSavedDesignSnapshotResult } from "./saved-design-snapshot.js";

export interface DogfoodSavedDesignCreateResult extends PersistSavedDesignSnapshotResult {
    created: boolean;
    external_order_id: string;
}

interface ExistingLink {
    designId: string;
}

interface DogfoodClient {
    id: string;
    ownerId: string;
}

export interface DogfoodSavedDesignStore {
    findExisting(externalOrderId: string): Promise<ExistingLink | null>;
    findClient(clientId: string): Promise<DogfoodClient | null>;
    insert(input: {
        designId: string;
        clientId: string;
        ownerId: string;
        externalOrderId: string;
        settingsJson: unknown;
        linkShoeWidth: string;
        shoeSizeSystem: "US_M" | "US_W";
        shoeSize: number;
        shoeSizeLeft: number | null;
        shoeSizeRight: number | null;
    }): Promise<void>;
}

type SnapshotBuilder = (input: {
    stored: { system: "US_M" | "US_W" | "EU" | null; size: number | null; left: number | null; right: number | null; width: string | null } | null;
    catalog: Parameters<typeof buildSavedDesignSnapshot>[0]["catalog"];
}) => SavedDesignSnapshotBuild;

function envelopeFor(built: SavedDesignSnapshotBuild): unknown {
    try {
        return settingsEnvelopeForSave(built.design);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`snapshot is not loftable (${message}). Refusing to write.`);
    }
}

/**
 * Create a SAMPLE_Top design linked to an existing external order, or refresh
 * the design that order already has. Idempotent on source + dogfood tenant + order id.
 */
export async function createDogfoodSavedDesign(args: {
    principal: CadOperatorPrincipal;
    externalOrderId: string;
    clientId: string;
    catalog: unknown;
    store: DogfoodSavedDesignStore;
    buildSnapshot?: SnapshotBuilder;
    persist: (designId: string) => Promise<PersistSavedDesignSnapshotResult>;
}): Promise<DogfoodSavedDesignCreateResult> {
    if (args.principal.tenantId !== DOGFOOD_TENANT_ID) {
        throw new Error("Design not found");
    }
    const externalOrderId = args.externalOrderId.trim();
    assertDogfoodNotHeld(externalOrderId);
    assertDogfoodNotHeld(args.clientId);
    if (!externalOrderId) throw new Error("external_order_id is required");

    const existing = await args.store.findExisting(externalOrderId);
    if (existing) {
        assertDogfoodNotHeld(existing.designId);
        const persisted = await args.persist(existing.designId);
        return { ...persisted, created: false, external_order_id: externalOrderId };
    }

    const client = await args.store.findClient(args.clientId);
    if (!client) throw new Error("Dogfood client not found");

    const buildSnapshot = args.buildSnapshot ?? buildSavedDesignSnapshot;
    const { parseSavedDesignCatalog } = await import("../../../shared/saved-design-catalog.js");
    const built = buildSnapshot({
        stored: null,
        catalog: parseSavedDesignCatalog(args.catalog),
    });
    const settingsJson = envelopeFor(built);
    const designId = randomUUID();
    assertDogfoodNotHeld(designId);
    await args.store.insert({
        designId,
        clientId: client.id,
        ownerId: client.ownerId,
        externalOrderId,
        settingsJson,
        linkShoeWidth: built.shoeWidthSource === "prescribed" ? built.shoeWidth : "",
        shoeSizeSystem: built.linkShoe.system,
        shoeSize: built.linkShoe.size,
        shoeSizeLeft: built.linkShoe.left,
        shoeSizeRight: built.linkShoe.right,
    });

    return {
        ok: true,
        created: true,
        design_id: designId,
        external_order_id: externalOrderId,
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

export function prismaDogfoodSavedDesignStore(prisma: PrismaClient): DogfoodSavedDesignStore {
    return {
        async findExisting(externalOrderId) {
            const row = await prisma.integrationDesign.findFirst({
                where: {
                    source: "vo2",
                    tenantId: DOGFOOD_TENANT_ID,
                    externalOrderId,
                },
                select: { designId: true },
            });
            return row ? { designId: row.designId } : null;
        },
        async findClient(clientId) {
            const row = await prisma.client.findFirst({
                where: { id: clientId, tenantId: DOGFOOD_TENANT_ID },
                select: { id: true, ownerId: true },
            });
            return row;
        },
        async insert(input) {
            await prisma.$transaction(async (tx) => {
                await tx.design.create({
                    data: {
                        id: input.designId,
                        clientId: input.clientId,
                        ownerId: input.ownerId,
                        kind: "insole",
                        name: `Insole ${input.externalOrderId}`.slice(0, 120),
                        pattern: "full_contact",
                        method: "printing_solid",
                        settingsJson: input.settingsJson as Prisma.InputJsonValue,
                    },
                });
                await tx.integrationDesign.create({
                    data: {
                        source: "vo2",
                        tenantId: DOGFOOD_TENANT_ID,
                        externalOrderId: input.externalOrderId,
                        designId: input.designId,
                        clientId: input.clientId,
                        kind: "insole",
                        sides: "pair",
                        shoeSizeSystem: input.shoeSizeSystem,
                        shoeSize: input.shoeSize,
                        shoeSizeLeft: input.shoeSizeLeft,
                        shoeSizeRight: input.shoeSizeRight,
                        shoeWidth: input.linkShoeWidth,
                    },
                });
            });
        },
    };
}
