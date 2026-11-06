// Vite sets import.meta.env in the browser bundle. Node does not.
// Headless Export reads the same modules and must tolerate a missing env object.

type ViteEnv = {
    DEV?: boolean;
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
    VITE_API_URL?: string;
    VITE_STOCK_STORAGE_BUCKET?: string;
    VITE_STORE_PHI?: string;
};

export function viteEnv(): ViteEnv {
    const meta = import.meta as { env?: ViteEnv };
    return meta.env ?? {};
}
