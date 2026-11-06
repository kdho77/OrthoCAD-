import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { CreateHTTPContextOptions } from "@trpc/server/adapters/standalone";
import {
    type CadOperatorCredentialRow,
    type CadOperatorPrincipal,
    resolveCadOperatorFromAuthorization,
} from "./auth/cad-operator.js";
import { isDevAuthAllowed, resolveDevBearerUser, resolveDevRole } from "./lib/dev-auth.js";
import { prisma, prismaDirect } from "./lib/prisma.js";

export { prisma, prismaDirect };

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseConfigured = Boolean(supabaseUrl && supabaseServiceKey);

// Never let Supabase client construction kill the whole API at cold start:
// supabase-js eagerly builds a RealtimeClient, which throws on runtimes
// without native WebSocket (e.g. Node 20). Degrade to auth/storage disabled
// instead of crashing every endpoint.
function buildSupabaseClient(): SupabaseClient | null {
    if (!supabaseConfigured) return null;
    try {
        return createClient(supabaseUrl as string, supabaseServiceKey as string);
    } catch (err) {
        console.error("[vertex] Supabase client init failed — auth/storage disabled", {
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

const supabase: SupabaseClient | null = buildSupabaseClient();

/** Service-role Supabase client for storage operations. */
export function getSupabaseAdmin(): SupabaseClient | null {
    return supabase;
}

export interface AuthedUser {
    id: string;
    email: string;
    role: string;
}

async function lookupCadOperatorCredential(hash: string): Promise<CadOperatorCredentialRow | null> {
    const row = await prisma.integrationCredential.findUnique({
        where: { keyHash: hash },
        include: { tenants: { select: { tenantId: true } } },
    });
    if (!row) return null;
    return {
        id: row.id,
        revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
        tenantIds: row.tenants.map((tenant) => tenant.tenantId),
    };
}

/** ocad_ keys never become session users. Missing, revoked, and non-dogfood keys stay anonymous. */
async function resolveCadOperator(authHeader?: string): Promise<CadOperatorPrincipal | null> {
    return resolveCadOperatorFromAuthorization(authHeader, lookupCadOperatorCredential);
}

async function resolveUser(authHeader?: string): Promise<AuthedUser | null> {
    if (isDevAuthAllowed(supabaseConfigured)) {
        const devUser = resolveDevBearerUser(authHeader);
        if (devUser) return devUser;
    }

    if (!supabase || !authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice("Bearer ".length);
    if (token.startsWith("dev:") || token.startsWith("ocad_")) return null;
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    const email = data.user.email ?? "";
    return {
        id: data.user.id,
        email,
        role: resolveDevRole(email, data.user.app_metadata?.role as string | undefined),
    };
}

export async function createContext({ req }: CreateHTTPContextOptions) {
    const authorization = req.headers.authorization;
    const [user, cadOperator] = await Promise.all([
        resolveUser(authorization),
        resolveCadOperator(authorization),
    ]);
    return { prisma, prismaDirect, user, cadOperator, ip: req.socket.remoteAddress ?? null };
}

/** Fetch adapter context (Vercel serverless / edge). */
export async function createFetchContext({ req }: FetchCreateContextFnOptions) {
    const authHeader = req.headers.get("authorization");
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
    const authorization = authHeader ?? undefined;
    const [user, cadOperator] = await Promise.all([
        resolveUser(authorization),
        resolveCadOperator(authorization),
    ]);
    return { prisma, prismaDirect, user, cadOperator, ip };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
