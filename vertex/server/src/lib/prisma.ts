// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PrismaClient } from "@prisma/client";

export interface PostgresUrlParts {
    user: string;
    password: string;
    host: string;
    port: string;
    database: string;
    search: string;
}

/** Extract the Supabase project ref from SUPABASE_URL or VITE_SUPABASE_URL. */
export function extractSupabaseProjectRef(url?: string): string | undefined {
    if (!url) return undefined;
    const trimmed = url.trim().replace(/\/+$/, "");
    const match = trimmed.match(/(?:https?:\/\/)?([a-z0-9]{10,})\.supabase\.co/i);
    return match?.[1];
}

/** Parse a postgres/postgresql connection string into components. */
export function parsePostgresUrl(url: string): PostgresUrlParts | null {
    const trimmed = url.trim();
    const protocolMatch = trimmed.match(/^(postgres(?:ql)?):\/\//i);
    if (!protocolMatch) return null;

    const rest = trimmed.slice(protocolMatch[0].length);
    const atIdx = rest.lastIndexOf("@");
    if (atIdx === -1) return null;

    const creds = rest.slice(0, atIdx);
    const hostPart = rest.slice(atIdx + 1);
    const colonIdx = creds.indexOf(":");
    const user = decodeURIComponent(colonIdx === -1 ? creds : creds.slice(0, colonIdx));
    const password = colonIdx === -1 ? "" : decodeURIComponent(creds.slice(colonIdx + 1));

    const slashIdx = hostPart.indexOf("/");
    const hostAndPort = slashIdx === -1 ? hostPart : hostPart.slice(0, slashIdx);
    const databaseAndQuery = slashIdx === -1 ? "postgres" : hostPart.slice(slashIdx + 1);
    const qIdx = databaseAndQuery.indexOf("?");
    const database = (qIdx === -1 ? databaseAndQuery : databaseAndQuery.slice(0, qIdx)) || "postgres";
    const search = qIdx === -1 ? "" : databaseAndQuery.slice(qIdx);

    const portSep = hostAndPort.lastIndexOf(":");
    const host = portSep === -1 ? hostAndPort : hostAndPort.slice(0, portSep);
    const port = portSep === -1 ? "5432" : hostAndPort.slice(portSep + 1);

    if (!host) return null;
    return { user, password, host, port, database, search };
}

/** Build a postgres connection string from components. */
export function buildPostgresUrl(parts: PostgresUrlParts): string {
    const password = parts.password ? `:${encodeURIComponent(parts.password)}` : "";
    const port = parts.port ? `:${parts.port}` : "";
    return `postgresql://${encodeURIComponent(parts.user)}${password}@${parts.host}${port}/${parts.database}${parts.search}`;
}

/** Hostnames like `postgres.{ref}` are not valid DNS names (Vercel integration bug). */
export function isInvalidSupabaseHost(host: string): boolean {
    return /^postgres\.[a-z0-9]+$/i.test(host);
}

function isLikelyPoolerHost(host: string): boolean {
    return host.includes("pooler.supabase.com");
}

function appendQueryParam(search: string, key: string, value: string): string {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    params.set(key, value);
    const serialized = params.toString();
    return serialized ? `?${serialized}` : "";
}

function stripBrokenSupabasePoolerParams(search: string): string {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    for (const key of [...params.keys()]) {
        if (key === "supa" || key.startsWith("supa.")) {
            params.delete(key);
        }
    }
    const serialized = params.toString();
    return serialized ? `?${serialized}` : "";
}

/**
 * Normalize Supabase/Vercel Postgres URLs:
 * - Rewrite invalid `postgres.{ref}` hostnames to `db.{ref}.supabase.co`
 * - Strip broken `supa=base-pooler.*` query params from the Vercel integration
 * - Ensure pooler username format `postgres.{ref}` when using the pooler host
 */
export function normalizeSupabaseDatabaseUrl(
    rawUrl: string,
    options: { pooled?: boolean; projectRef?: string } = {},
): string {
    const parsed = parsePostgresUrl(rawUrl);
    if (!parsed) return rawUrl;

    const ref =
        options.projectRef ??
        extractSupabaseProjectRef(process.env.SUPABASE_URL) ??
        extractSupabaseProjectRef(process.env.VITE_SUPABASE_URL);

    let { host, port, user, search } = parsed;

    if (isInvalidSupabaseHost(host) && ref) {
        host = `db.${ref}.supabase.co`;
        port = "5432";
        if (user.startsWith("postgres.")) {
            user = "postgres";
        }
    }

    search = stripBrokenSupabasePoolerParams(search);

    if (options.pooled && isLikelyPoolerHost(host)) {
        if (ref && user === "postgres") {
            user = `postgres.${ref}`;
        }
        if (!/[?&]pgbouncer=true/i.test(search)) {
            search = appendQueryParam(search, "pgbouncer", "true");
        }
    }

    return buildPostgresUrl({ ...parsed, host, port, user, search });
}

function buildUrlFromPostgresComponents(options: {
    pooled: boolean;
    projectRef?: string;
}): string | undefined {
    const host = process.env.POSTGRES_HOST?.trim();
    const password = process.env.POSTGRES_PASSWORD?.trim();
    if (!host || !password) return undefined;

    const ref = options.projectRef ?? extractSupabaseProjectRef(process.env.SUPABASE_URL);
    const database = process.env.POSTGRES_DATABASE?.trim() ?? "postgres";
    let resolvedHost = host;
    let resolvedUser = process.env.POSTGRES_USER?.trim() ?? (options.pooled && ref ? `postgres.${ref}` : "postgres");
    let resolvedPort = process.env.POSTGRES_PORT?.trim() ?? (options.pooled ? "6543" : "5432");

    if (isInvalidSupabaseHost(host) && ref) {
        resolvedHost = `db.${ref}.supabase.co`;
        resolvedPort = "5432";
        resolvedUser = "postgres";
    }

    return buildPostgresUrl({
        user: resolvedUser,
        password,
        host: resolvedHost,
        port: resolvedPort,
        database,
        search: "",
    });
}

/** Build a direct connection URL from SUPABASE_URL + POSTGRES_PASSWORD when pooler URLs are broken. */
function buildDirectUrlFromSupabase(projectRef?: string): string | undefined {
    const password = process.env.POSTGRES_PASSWORD?.trim();
    if (!projectRef || !password) return undefined;
    return buildPostgresUrl({
        user: "postgres",
        password,
        host: `db.${projectRef}.supabase.co`,
        port: "5432",
        database: process.env.POSTGRES_DATABASE?.trim() ?? "postgres",
        search: "",
    });
}

function pickFirstUsableUrl(
    candidates: string[],
    options: { pooled: boolean; projectRef?: string },
): string | undefined {
    for (const raw of candidates) {
        const normalized = normalizeSupabaseDatabaseUrl(raw, options);
        const parts = parsePostgresUrl(normalized);
        if (parts && !isInvalidSupabaseHost(parts.host)) {
            return normalized;
        }
    }
    return undefined;
}

/** Pooled app connection (PgBouncer / Supabase pooler). */
export function resolveDatabaseUrl(): string | undefined {
    const projectRef =
        extractSupabaseProjectRef(process.env.SUPABASE_URL) ??
        extractSupabaseProjectRef(process.env.VITE_SUPABASE_URL);

    const pooledCandidates = [
        process.env.DATABASE_URL?.trim(),
        process.env.POSTGRES_PRISMA_URL?.trim(),
        process.env.POSTGRES_URL?.trim(),
        buildUrlFromPostgresComponents({ pooled: true, projectRef }),
    ].filter((url): url is string => Boolean(url));

    const pooled = pickFirstUsableUrl(pooledCandidates, { pooled: true, projectRef });
    if (pooled) {
        const parts = parsePostgresUrl(pooled);
        return parts && isLikelyPoolerHost(parts.host) ? withPgbouncerParam(pooled) : pooled;
    }

    // Pooler URL is misconfigured (ENOTFOUND / tenant not found) — fall back to direct.
    return resolveDirectUrl();
}

/** Direct Postgres connection for migrations and prepared-statement work. */
export function resolveDirectUrl(): string | undefined {
    const projectRef =
        extractSupabaseProjectRef(process.env.SUPABASE_URL) ??
        extractSupabaseProjectRef(process.env.VITE_SUPABASE_URL);

    const directCandidates = [
        process.env.DIRECT_URL?.trim(),
        process.env.POSTGRES_URL_NON_POOLING?.trim(),
        buildUrlFromPostgresComponents({ pooled: false, projectRef }),
        buildDirectUrlFromSupabase(projectRef),
    ].filter((url): url is string => Boolean(url));

    return pickFirstUsableUrl(directCandidates, { pooled: false, projectRef });
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

/** Pooled client for routine reads/writes (PgBouncer-safe when using the pooler URL). */
export const prisma = databaseUrl ? createPrismaClient(databaseUrl) : createPrismaClient();

/**
 * Direct client for interactive transactions and other operations that rely on
 * prepared statements. Falls back to `prisma` when DIRECT_URL is not configured.
 */
export const prismaDirect = directUrl ? createPrismaClient(directUrl) : prisma;
