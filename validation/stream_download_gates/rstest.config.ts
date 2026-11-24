import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "../../package.json";

const repoRoot = resolve(import.meta.dirname, "../..");

/**
 * Runs only the frozen stream-download gates.
 * These files are not *.test.ts, so the unit-test shard manifest does not pick them up.
 */
export default defineConfig({
    root: repoRoot,
    include: ["validation/stream_download_gates/**/*.gate.ts"],
    exclude: [],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    globals: true,
    testEnvironment: "happy-dom",
    tools: {
        rspack: {
            resolve: {
                modules: [
                    resolve(repoRoot, "packages/mcp/node_modules"),
                    resolve(repoRoot, "vertex/node_modules"),
                    "node_modules",
                ],
            },
            plugins: [
                new DefinePlugin({
                    __APP_VERSION__: JSON.stringify(packages.version),
                    __DOCUMENT_VERSION__: JSON.stringify(packages.documentVersion),
                    __IS_PRODUCTION__: JSON.stringify(process.env.NODE_ENV === "production"),
                }),
            ],
        },
    },
    resolve: {
        alias: {
            "@": resolve(repoRoot, "vertex/src"),
        },
    },
    source: {
        decorators: {
            version: "legacy",
        },
    },
});
