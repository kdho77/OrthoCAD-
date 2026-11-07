// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Refresh a dogfood SAMPLE_Top design already bound to a vo2 order.
// Does not create a client, does not create a design, and does not upload a scan or STL.

import type { PrismaClient } from "@prisma/client";
import { assertDogfoodNotHeld } from "../../../shared/dogfood-holds.js";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import type { PersistSavedDesignSnapshotResult } from "./saved-design-snapshot.js";

export const DOGFOOD_ORDER_IDENTITY_CODES = [
    "order_person_unbound",
    "order_client_mismatch",
    "order_client_ambiguous",
    "order_client_cross_tenant",
    "order_identity_invalid",
] as const;

export type DogfoodOrderIdentityCode = (typeof DOGFOOD_ORDER_IDENTITY_CODES)[number];

/**
 * First-time establishment is refused.
 * Integration client upsert trusts a caller-supplied external client id under a
 * tenant allowlist. That is not proof the id is the person on this order, and
 * CAD-operator scopes cannot assert it. No order-person column exists until a
 * design link does. A new permission plus a server-verified vo2 person id for
 * the order would be required before a client or design may be created here.
 */
export class DogfoodOrderIdentityError extends Error {
    readonly code: DogfoodOrderIdentityCode;

    constructor(code: DogfoodOrderIdentityCode, detail: string) {
        super(`${code}: ${detail}`);
        this.name = "DogfoodOrderIdentityError";
        this.code = code;
    }
}

export interface DogfoodSavedDesignCreateResult extends PersistSavedDesignSnapshotResult {
    created: false;
    established: false;
    identity: "existing_order_binding";
    external_order_id: string;
    client_id: string;
}

export interface DogfoodOrderLink {
    designId: string;
    clientId: string;
}

interface DogfoodClient {
    id: string;
    ownerId: string;
    tenantId: string;
}

export interface DogfoodSavedDesignStore {
    /** At most two rows. A second row means the order binding is ambiguous. */
    findOrderLinks(externalOrderId: string): Promise<DogfoodOrderLink[]>;
    /** Dogfood tenant only. Any other tenant is absent here. */
    findClient(clientId: string): Promise<DogfoodClient | null>;
}

const CLIENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sameId(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function requireOrderId(value: string): string {
    const externalOrderId = value.trim();
    if (!externalOrderId || externalOrderId.length > 200) {
        throw new DogfoodOrderIdentityError(
            "order_identity_invalid",
            "external_order_id is required and must be at most 200 characters.",
        );
    }
    assertDogfoodNotHeld(externalOrderId);
    return externalOrderId;
}

function requireConfirmingClientId(value: string | null | undefined): string | null {
    if (value == null || value === "") return null;
    const clientId = value.trim();
    if (!CLIENT_UUID.test(clientId)) {
        throw new DogfoodOrderIdentityError(
            "order_identity_invalid",
            "client_id must be a uuid when it is sent. It does not establish identity.",
        );
    }
    assertDogfoodNotHeld(clientId);
    return clientId;
}

/**
 * Refresh the design already linked to this vo2 dogfood order.
 * A supplied client id must match that link. It is not authority to bind a
 * different client, and it is not authority to create the first client.
 */
export async function createDogfoodSavedDesign(args: {
    principal: CadOperatorPrincipal;
    externalOrderId: string;
    clientId?: string | null;
    store: DogfoodSavedDesignStore;
    persist: (designId: string) => Promise<PersistSavedDesignSnapshotResult>;
}): Promise<DogfoodSavedDesignCreateResult> {
    if (args.principal.tenantId !== DOGFOOD_TENANT_ID) {
        throw new Error("Design not found");
    }
    const externalOrderId = requireOrderId(args.externalOrderId);
    const confirmingClientId = requireConfirmingClientId(args.clientId);

    const links = await args.store.findOrderLinks(externalOrderId);
    if (links.length > 1) {
        throw new DogfoodOrderIdentityError(
            "order_client_ambiguous",
            "More than one vo2 dogfood design is linked to this order. No design was written.",
        );
    }
    const link = links[0];
    if (!link) {
        throw new DogfoodOrderIdentityError(
            "order_person_unbound",
            "No vo2 dogfood design is linked to this order. A client UUID, name, or external client id from the caller is not the order's person. This path does not create a client or a design, and it does not call integration client upsert.",
        );
    }
    if (confirmingClientId && !sameId(confirmingClientId, link.clientId)) {
        throw new DogfoodOrderIdentityError(
            "order_client_mismatch",
            "client_id does not match the client already bound to this order. No design was written and the client tenant was not changed.",
        );
    }

    const client = await args.store.findClient(link.clientId);
    if (!client || client.tenantId !== DOGFOOD_TENANT_ID || client.tenantId !== args.principal.tenantId) {
        throw new DogfoodOrderIdentityError(
            "order_client_cross_tenant",
            "The client bound to this order is not in the dogfood tenant. No design was written and the client tenant was not changed.",
        );
    }
    if (!sameId(client.id, link.clientId)) {
        throw new DogfoodOrderIdentityError(
            "order_client_mismatch",
            "client_id does not match the client already bound to this order. No design was written and the client tenant was not changed.",
        );
    }

    assertDogfoodNotHeld(link.designId);
    const persisted = await args.persist(link.designId);
    return {
        ...persisted,
        created: false,
        established: false,
        identity: "existing_order_binding",
        external_order_id: externalOrderId,
        client_id: client.id,
    };
}

export function prismaDogfoodSavedDesignStore(prisma: PrismaClient): DogfoodSavedDesignStore {
    return {
        async findOrderLinks(externalOrderId) {
            const rows = await prisma.integrationDesign.findMany({
                where: {
                    source: "vo2",
                    tenantId: DOGFOOD_TENANT_ID,
                    externalOrderId,
                },
                select: { designId: true, clientId: true },
                take: 2,
            });
            return rows;
        },
        async findClient(clientId) {
            const row = await prisma.client.findFirst({
                where: { id: clientId, tenantId: DOGFOOD_TENANT_ID },
                select: { id: true, ownerId: true, tenantId: true },
            });
            if (!row?.tenantId || row.tenantId !== DOGFOOD_TENANT_ID) return null;
            return { id: row.id, ownerId: row.ownerId, tenantId: row.tenantId };
        },
    };
}
