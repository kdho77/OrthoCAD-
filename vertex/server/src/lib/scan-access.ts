// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// The only scan door the router uses. Postgres via Prisma. No Supabase client.

import { TRPCError } from "@trpc/server";
import { ClientFileError } from "../../../shared/client-files.js";
import { prisma, resolveDatabaseUrl } from "./prisma.js";
import { actorFromPostgres } from "./prisma-client-file-repo.js";
import { prismaScanRepo } from "./prisma-scan-repo.js";

export async function openScans(user: { id: string; email: string; role: string }) {
    if (!resolveDatabaseUrl()) {
        throw new ClientFileError("BAD_REQUEST", "No scan database is configured");
    }
    return { repo: prismaScanRepo(prisma), actor: await actorFromPostgres(prisma, user), prisma };
}

export function rethrowScan(error: unknown): never {
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
    const message = error instanceof Error ? error.message : "Scan request failed";
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
}
