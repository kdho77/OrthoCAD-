import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "../../package.json" with { type: "json" };

/** Runner for the frozen gates only. Does not change the product test config. */
export default defineConfig({
    testTimeout: 1_200_000,
    hookTimeout: 60_000,
    globals: true,
    testEnvironment: "happy-dom",
    include: ["validation/per_side_heel_wedge_gates/grade-gates.ts"],
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
