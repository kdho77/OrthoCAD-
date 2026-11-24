import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "../../package.json";

/**
 * Independent grader runner. Not part of the unit-test shard list
 * (those files are named *.test.ts; these are *.gate.ts).
 */
export default defineConfig({
    testTimeout: 600_000,
    hookTimeout: 120_000,
    slowTestThreshold: 60_000,
    include: ["validation/export_cache_no_double_engrave_gates/**/*.gate.ts"],
    exclude: [],
    globals: false,
    testEnvironment: "happy-dom",
    pool: {
        type: "forks",
        maxWorkers: 1,
        minWorkers: 1,
    },
    tools: {
        rspack: {
            resolve: {
                modules: [
                    resolve("packages/mcp/node_modules"),
                    resolve("vertex/node_modules"),
                    "node_modules",
                ],
            },
            plugins: [
                new DefinePlugin({
                    __APP_VERSION__: JSON.stringify(packages.version),
                    __DOCUMENT_VERSION__: JSON.stringify(packages.documentVersion),
                    __IS_PRODUCTION__: JSON.stringify(false),
                }),
            ],
        },
    },
    resolve: {
        alias: {
            "@": resolve("vertex/src"),
        },
    },
    source: {
        decorators: {
            version: "legacy",
        },
    },
});
