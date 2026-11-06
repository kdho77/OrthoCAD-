import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { viteEnv } from "./vite-env";

// Supabase Auth foundation. Credentials are injected at build time via Vite env
// vars. We export a lazily-created singleton so the rest of the app can import
// `getSupabase()` without crashing when env is not yet configured (Phase 0).

const url = viteEnv().VITE_SUPABASE_URL;
const anonKey = viteEnv().VITE_SUPABASE_ANON_KEY;

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
