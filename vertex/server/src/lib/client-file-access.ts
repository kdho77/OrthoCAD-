// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// The only client/design data door the routers use. Postgres via Prisma is the
// portable store (RDS later). The Supabase client is a fallback when no
// Postgres URL is configured, and it stays inside this module.

import { TRPCError } from "@trpc/server";
import { ClientFileError, type ClientFileRepo, parseStorePhiFlag } from "../../../shared/client-files.js";
import { getSupabaseAdmin } from "../context.js";
import { actorFor, supabaseClientFileRepo } from "./client-file-repo.js";
import { prisma, resolveDatabaseUrl } from "./prisma.js";
import { actorFromPostgres, prismaClientFileRepo } from "./prisma-client-file-repo.js";

export function storePhiEnabled(): boolean {
    return parseStorePhiFlag(process.env.STORE_PHI);
}

export async function openClientFiles(user: { id: string; email: string; role: string }): Promise<{
    repo: ClientFileRepo;
    actor: Awaited<ReturnType<typeof actorFromPostgres>>;
    storePhi: boolean;
}> {
    const storePhi = storePhiEnabled();
    if (resolveDatabaseUrl()) {
        return { repo: prismaClientFileRepo(prisma), actor: await actorFromPostgres(prisma, user), storePhi };
    }
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new ClientFileError("BAD_REQUEST", "No client database is configured");
    return { repo: supabaseClientFileRepo(supabase), actor: await actorFor(user, supabase), storePhi };
}

export function rethrowClientFile(error: unknown): never {
    if (error instanceof TRPCError) throw error;
    if (error instanceof ClientFileError) {
        const code =
            error.code === "NOT_FOUND"
                ? "NOT_FOUND"
                : error.code === "FORBIDDEN"
                  ? "FORBIDDEN"
                  : "BAD_REQUEST";
        throw new TRPCError({ code, message: error.message });
    }
    const message = error instanceof Error ? error.message : "Client file request failed";
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
}
