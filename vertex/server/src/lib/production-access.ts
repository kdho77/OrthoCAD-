// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// The only production-job door the router uses. Postgres via Prisma is the
// portable store. This module does not import the Supabase client.

import { TRPCError } from "@trpc/server";
import { type Actor, isSuperAdmin } from "../../../shared/client-files.js";
import { ProductionError } from "../../../shared/production-jobs.js";
import { prisma, resolveDatabaseUrl } from "./prisma.js";
import { actorFromPostgres } from "./prisma-client-file-repo.js";
import { prismaProductionRepo } from "./prisma-production-repo.js";

export async function openProduction(user: { id: string; email: string; role: string }) {
    if (!resolveDatabaseUrl()) {
        throw new ProductionError("BAD_REQUEST", "No production database is configured");
    }
    return { repo: prismaProductionRepo(prisma), actor: await actorFromPostgres(prisma, user) };
}

function requestedShopId(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Shop for this request only. A super_admin whose user row has no tenant must
 * pass one. This does not write public.users.tenantId. Every other role stays
 * on actor.tenantId, and a different shop id is rejected.
 */
export function resolveProductionShop(
    actor: Actor,
    requested: { tenantId?: string | null; shopId?: string | null } | null | undefined,
): { tenantId: string | null } {
    const tenantId = requestedShopId(requested?.tenantId);
    const shopId = requestedShopId(requested?.shopId);
    if (tenantId && shopId && tenantId !== shopId) {
        throw new ProductionError("BAD_REQUEST", "Shop does not match the tenant.");
    }
    const chosen = tenantId ?? shopId;
    if (isSuperAdmin(actor)) {
        const resolved = chosen ?? actor.tenantId;
        if (!resolved) throw new ProductionError("BAD_REQUEST", "A tenant is required.");
        return { tenantId: resolved };
    }
    if (chosen && chosen !== actor.tenantId) {
        throw new ProductionError("FORBIDDEN", "You cannot choose another shop.");
    }
    return { tenantId: actor.tenantId };
}

/** Active shops only. Archived tenants are not a valid enrollment target. */
export async function findActiveTenant(tenantId: string): Promise<{ id: string; name: string } | null> {
    const row = await prisma.tenant.findFirst({
        where: { id: tenantId, archivedAt: null },
        select: { id: true, name: true },
    });
    return row ? { id: row.id, name: row.name } : null;
}

export function rethrowProduction(error: unknown): never {
    if (error instanceof TRPCError) throw error;
    if (error instanceof ProductionError) {
        const code =
            error.code === "NOT_FOUND"
                ? "NOT_FOUND"
                : error.code === "FORBIDDEN"
                  ? "FORBIDDEN"
                  : "BAD_REQUEST";
        throw new TRPCError({ code, message: error.message });
    }
    const message = error instanceof Error ? error.message : "Production request failed";
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
}
