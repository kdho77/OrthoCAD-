// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";

const DUMMY_SUPABASE_URL = "https://vite-env-inline-proof.invalid/supabase";
const DUMMY_ANON_KEY = "vite-env-inline-proof-anon-key";

function collectJs(dir: string): string {
    const chunks: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            chunks.push(collectJs(path));
            continue;
        }
        if (entry.endsWith(".js")) chunks.push(readFileSync(path, "utf8"));
    }
    return chunks.join("\n");
}

describe("production Vite build inlines VITE_*", () => {
    test("dist JS contains the build-time Supabase URL and anon key", () => {
        const outDir = mkdtempSync(join(tmpdir(), "orthocad-vite-env-inline-"));
        const viteBin = join(process.cwd(), "vertex/node_modules/vite/bin/vite.js");
        let js = "";
        try {
            execFileSync(
                process.execPath,
                [viteBin, "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"],
                {
                    cwd: join(process.cwd(), "vertex"),
                    env: {
                        ...process.env,
                        VITE_SUPABASE_URL: DUMMY_SUPABASE_URL,
                        VITE_SUPABASE_ANON_KEY: DUMMY_ANON_KEY,
                    },
                    stdio: ["ignore", "pipe", "pipe"],
                    timeout: 240_000,
                },
            );
            js = collectJs(outDir);
        } catch (error) {
            const failed = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
            const stdout = failed.stdout?.toString() ?? "";
            const stderr = failed.stderr?.toString() ?? "";
            throw new Error(`vite build failed (${failed.message ?? "unknown error"})\n${stdout}\n${stderr}`);
        } finally {
            rmSync(outDir, { recursive: true, force: true });
        }
        expect(js).toContain(DUMMY_SUPABASE_URL);
        expect(js).toContain(DUMMY_ANON_KEY);
    }, 300_000);
});
