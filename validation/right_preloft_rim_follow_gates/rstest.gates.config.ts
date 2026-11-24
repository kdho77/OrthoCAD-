// Frozen Right-foot [S1-PRELOFT] rim-follow gates.
// Local runner config so the default unit shards stay untouched.
// Do not edit after the gates pull request is opened.

import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "../../package.json";

export default defineConfig({
    include: ["validation/right_preloft_rim_follow_gates/**/*.optional.test.ts"],
    exclude: ["**/cpp/**"],
    testTimeout: 360_000,
    hookTimeout: 60_000,
    globals: true,
    testEnvironment: "happy-dom",
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
                    __IS_PRODUCTION__: JSON.stringify(process.env.NODE_ENV === "production"),
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
