// Browser SPA: Vite only inlines static `import.meta.env.VITE_*` member access.
// Returning `import.meta.env` as an object (or reading it through a variable) leaves
// those keys undefined in the production bundle, so the app stays on the offline stub.
// Node / headless Export: `import.meta.env` itself is missing and member access throws.
// Read `process.env` there instead. Never return `import.meta.env`.

export type ViteConfig = {
    DEV: boolean;
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
    VITE_API_URL?: string;
    VITE_STOCK_STORAGE_BUCKET?: string;
    VITE_STORE_PHI?: string;
};

/** True in Node (headless Export, rstest). False in the browser SPA bundle. */
export function isNodeProcess(): boolean {
    return typeof process !== "undefined" && process.release?.name === "node";
}

function browserEnv(): ViteConfig {
    return {
        DEV: import.meta.env.DEV,
        VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
        VITE_API_URL: import.meta.env.VITE_API_URL,
        VITE_STOCK_STORAGE_BUCKET: import.meta.env.VITE_STOCK_STORAGE_BUCKET,
        VITE_STORE_PHI: import.meta.env.VITE_STORE_PHI,
    };
}

function nodeEnv(): ViteConfig {
    return {
        DEV: false,
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
        VITE_API_URL: process.env.VITE_API_URL,
        VITE_STOCK_STORAGE_BUCKET: process.env.VITE_STOCK_STORAGE_BUCKET,
        VITE_STORE_PHI: process.env.VITE_STORE_PHI,
    };
}

export function readViteConfig(): ViteConfig {
    if (isNodeProcess()) return nodeEnv();
    // Static member access throws in Node when Vite did not replace `import.meta.env`.
    try {
        return browserEnv();
    } catch {
        return nodeEnv();
    }
}
