import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../server/src/routers";
import { getSupabase } from "./supabase";

const apiUrl = import.meta.env.VITE_API_URL as string | undefined;

export function isApiConfigured(): boolean {
    return Boolean(apiUrl);
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
                if (!supabase) return {};
                const { data } = await supabase.auth.getSession();
                const token = data.session?.access_token;
                return token ? { authorization: `Bearer ${token}` } : {};
            },
        }),
    ],
});
