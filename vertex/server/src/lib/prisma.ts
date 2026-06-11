// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PrismaClient } from "@prisma/client";

/** Pooled app connection (PgBouncer / Supabase pooler). */
export function resolveDatabaseUrl(): string | undefined {
    return (
        process.env.DATABASE_URL?.trim() ||
        process.env.POSTGRES_PRISMA_URL?.trim() ||
        process.env.POSTGRES_URL?.trim() ||
        undefined
    );
}

/** Direct Postgres connection for migrations and prepared-statement work. */
export function resolveDirectUrl(): string | undefined {
    return (
        process.env.DIRECT_URL?.trim() ||
        process.env.POSTGRES_URL_NON_POOLING?.trim() ||
        undefined
    );
}

/** Tell Prisma to avoid prepared statements on pooled PgBouncer connections. */
export function withPgbouncerParam(url: string): string {
    if (/[?&]pgbouncer=true(?:&|$)/i.test(url)) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}pgbouncer=true`;
}

function createPrismaClient(datasourceUrl?: string): PrismaClient {
    return datasourceUrl ? new PrismaClient({ datasourceUrl }) : new PrismaClient();
}

const databaseUrl = resolveDatabaseUrl();
const directUrl = resolveDirectUrl();

/** Pooled client for routine reads/writes (PgBouncer-safe). */
export const prisma = databaseUrl
    ? createPrismaClient(withPgbouncerParam(databaseUrl))
    : createPrismaClient();

/**
 * Direct client for interactive transactions and other operations that rely on
 * prepared statements. Falls back to `prisma` when DIRECT_URL is not configured.
 */
export const prismaDirect = directUrl ? createPrismaClient(directUrl) : prisma;
