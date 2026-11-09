// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { isLocalDevServer } from "./dev-auth";
import { STOCK_BASES_BUCKET } from "./geometry/stock-resolve-supabase";
import { storePhiEnabled } from "./phi-policy";
import { isSupabaseConfigured } from "./supabase";
import { isApiConfigured } from "./trpc";
import { isNodeProcess, readViteConfig } from "./vite-env";

const ENV_KEYS = [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_API_URL",
    "VITE_STOCK_STORAGE_BUCKET",
    "VITE_STORE_PHI",
] as const;

const previous: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (!(key in previous)) continue;
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
        delete previous[key];
    }
});

describe("node headless Vite env", () => {
    test("importing SPA env modules does not throw when import.meta.env is absent", () => {
        expect(isNodeProcess()).toBe(true);
        expect(isLocalDevServer()).toBe(false);
        expect(() => isSupabaseConfigured()).not.toThrow();
        expect(() => isApiConfigured()).not.toThrow();
        expect(() => storePhiEnabled()).not.toThrow();
        expect(STOCK_BASES_BUCKET.length).toBeGreaterThan(0);
        if (!process.env.VITE_STORE_PHI) expect(storePhiEnabled()).toBe(false);
    });

    test("reads VITE_* from process.env and does not treat Node as the Vite dev server", () => {
        for (const key of ENV_KEYS) previous[key] = process.env[key];
        process.env.VITE_SUPABASE_URL = "https://node-vite-env-proof.invalid/supabase";
        process.env.VITE_SUPABASE_ANON_KEY = "node-vite-env-proof-anon";
        process.env.VITE_API_URL = "https://node-vite-env-proof.invalid/api";
        process.env.VITE_STOCK_STORAGE_BUCKET = "node-vite-env-proof-bucket";
        process.env.VITE_STORE_PHI = "yes";

        const env = readViteConfig();
        expect(env.DEV).toBe(false);
        expect(env.VITE_SUPABASE_URL).toBe("https://node-vite-env-proof.invalid/supabase");
        expect(env.VITE_SUPABASE_ANON_KEY).toBe("node-vite-env-proof-anon");
        expect(env.VITE_API_URL).toBe("https://node-vite-env-proof.invalid/api");
        expect(env.VITE_STOCK_STORAGE_BUCKET).toBe("node-vite-env-proof-bucket");
        expect(env.VITE_STORE_PHI).toBe("yes");
        expect(storePhiEnabled()).toBe(true);
        expect(isLocalDevServer()).toBe(false);
    });

    test("browser config uses static import.meta.env member access", () => {
        const source = readFileSync(resolve("vertex/src/lib/vite-env.ts"), "utf8");
        expect(source).toContain("import.meta.env.VITE_SUPABASE_URL");
        expect(source).toContain("import.meta.env.VITE_SUPABASE_ANON_KEY");
        expect(source).toContain("import.meta.env.VITE_API_URL");
        expect(source).toContain("import.meta.env.VITE_STOCK_STORAGE_BUCKET");
        expect(source).toContain("import.meta.env.VITE_STORE_PHI");
        expect(source).not.toContain("const meta = import.meta");
        expect(source).not.toContain("function viteEnv");
        expect(source).not.toContain("return meta.env");
    });
});
