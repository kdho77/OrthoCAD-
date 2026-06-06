import { type SupabaseClient, createClient } from "@supabase/supabase-js";

// Supabase Auth foundation. Credentials are injected at build time via Vite env
// vars. We export a lazily-created singleton so the rest of the app can import
// `getSupabase()` without crashing when env is not yet configured (Phase 0).

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
    return Boolean(url && anonKey);
}

/**
 * Returns the Supabase client, or `null` if the environment is not configured.
 * The UI degrades gracefully to a local/offline mode in that case.
 */
export function getSupabase(): SupabaseClient | null {
    if (!isSupabaseConfigured()) return null;
    if (!client) {
        client = createClient(url as string, anonKey as string, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
            },
        });
    }
    return client;
}
