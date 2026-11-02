// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// The only production-job door the router uses. Postgres via Prisma is the
// portable store. This module does not import the Supabase client.

import { TRPCError } from "@trpc/server";
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
