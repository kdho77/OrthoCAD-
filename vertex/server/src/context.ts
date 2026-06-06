import { PrismaClient } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CreateHTTPContextOptions } from "@trpc/server/adapters/standalone";

// Singletons reused across requests.
export const prisma = new PrismaClient();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase: SupabaseClient | null =
    supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

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
    if (!supabase || !authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice("Bearer ".length);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return {
        id: data.user.id,
        email: data.user.email ?? "",
        role: (data.user.app_metadata?.role as string) ?? "clinician",
    };
}

export async function createContext({ req }: CreateHTTPContextOptions) {
    const user = await resolveUser(req.headers.authorization);
    return { prisma, user, ip: req.socket.remoteAddress ?? null };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
