// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Tenant checks for dogfood CAD-operator design read. Cross-tenant ids fail closed.

import { TRPCError } from "@trpc/server";

import { stripMeshBlobs } from "../../../shared/design-settings.js";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "./cad-operator.js";

export interface DogfoodDesignSource {
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
    clientTenantId: string | null;
    linkTenantId: string | null;
    source: string | null;
    externalOrderId: string | null;
    sides: string | null;
}

export interface DogfoodDesignRead {
    id: string;
    name: string;
    kind: string;
    pattern: string;
    method: string;
    thicknessMm: number;
    linked: boolean;
    unit: string;
    settingsJson: unknown;
    updatedAt: Date | string;
    tenantId: typeof DOGFOOD_TENANT_ID;
    source: string | null;
    externalOrderId: string | null;
    sides: string | null;
}

function notFound(): never {
    throw new TRPCError({ code: "NOT_FOUND", message: "Design not found" });
}

/**
 * Dogfood link required. A client row pinned to another tenant fails closed.
 * Notes, names, and dates of birth are not part of this payload.
 */
export function dogfoodDesignRead(
    principal: CadOperatorPrincipal,
    row: DogfoodDesignSource | null,
): DogfoodDesignRead & { ownerId: string } {
    if (principal.tenantId !== DOGFOOD_TENANT_ID) notFound();
    if (!row || row.deletedAt) notFound();
    if (row.linkTenantId !== DOGFOOD_TENANT_ID) notFound();
    if (row.clientTenantId && row.clientTenantId !== DOGFOOD_TENANT_ID) notFound();
    return {
        id: row.id,
        ownerId: row.ownerId,
        name: row.name,
        kind: row.kind,
        pattern: row.pattern,
        method: row.method,
        thicknessMm: row.thicknessMm,
        linked: row.linked,
        unit: row.unit,
        settingsJson: stripMeshBlobs(row.settingsJson),
        updatedAt: row.updatedAt,
        tenantId: DOGFOOD_TENANT_ID,
        source: row.source,
        externalOrderId: row.externalOrderId,
        sides: row.sides,
    };
}

/** Response for design.get. Owner id stays on the server. */
export function publicDogfoodDesignRead(design: DogfoodDesignRead & { ownerId: string }): DogfoodDesignRead {
    const { ownerId: _ownerId, ...publicRead } = design;
    return publicRead;
}
