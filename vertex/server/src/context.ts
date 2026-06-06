import { PrismaClient } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CreateHTTPContextOptions } from "@trpc/server/adapters/standalone";
import { isDevAuthAllowed, resolveDevBearerUser, resolveDevRole } from "./lib/dev-auth";

// Singletons reused across requests.
export const prisma = new PrismaClient();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseConfigured = Boolean(supabaseUrl && supabaseServiceKey);

const supabase: SupabaseClient | null =
    supabaseConfigured ? createClient(supabaseUrl as string, supabaseServiceKey as string) : null;

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

export type Context = Awaited<ReturnType<typeof createContext>>;
