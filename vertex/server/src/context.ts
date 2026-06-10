import { PrismaClient } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { CreateHTTPContextOptions } from "@trpc/server/adapters/standalone";
import { isDevAuthAllowed, resolveDevBearerUser, resolveDevRole } from "./lib/dev-auth.js";

// Singletons reused across requests.
export const prisma = new PrismaClient();

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

async function resolveUser(authHeader?: string): Promise<AuthedUser | null> {
    if (isDevAuthAllowed(supabaseConfigured)) {
        const devUser = resolveDevBearerUser(authHeader);
        if (devUser) return devUser;
    }

    if (!supabase || !authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice("Bearer ".length);
    if (token.startsWith("dev:")) return null;
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
    const user = await resolveUser(req.headers.authorization);
    return { prisma, user, ip: req.socket.remoteAddress ?? null };
}

/** Fetch adapter context (Vercel serverless / edge). */
export async function createFetchContext({ req }: FetchCreateContextFnOptions) {
    const authHeader = req.headers.get("authorization");
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
    const user = await resolveUser(authHeader ?? undefined);
    return { prisma, user, ip };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
