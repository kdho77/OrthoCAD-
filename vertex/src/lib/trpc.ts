import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../server/src/routers";
import { devAuthHeaderValue } from "./dev-auth";
import { getSupabase, isSupabaseConfigured } from "./supabase";

const apiUrl = import.meta.env.VITE_API_URL as string | undefined;

/**
 * True when the client should treat the tRPC server as authoritative (production /
 * connected mode). Supabase-backed deployments always resolve stock bases from the
 * server even when VITE_API_URL is omitted and the app uses the same-origin /trpc proxy.
 */
export function isApiConfigured(): boolean {
    return Boolean(apiUrl) || isSupabaseConfigured();
}

// Type-safe tRPC client. Attaches the Supabase access token so the server can
// authenticate the user for token-consuming operations.
export const trpc = createTRPCClient<AppRouter>({
    links: [
        httpBatchLink({
            url: apiUrl ?? "/trpc",
            transformer: superjson,
            async headers() {
                const supabase = getSupabase();
                if (supabase) {
                    const { data } = await supabase.auth.getSession();
                    const token = data.session?.access_token;
                    if (token) return { authorization: `Bearer ${token}` };
                }
                if (!isSupabaseConfigured()) {
                    return { authorization: `Bearer ${devAuthHeaderValue()}` };
                }
                return {};
            },
        }),
    ],
});
