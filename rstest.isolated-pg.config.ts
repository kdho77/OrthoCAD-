import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "./package.json";

/** Required isolated PostgreSQL acceptance. Not the default unit suite. */
export default defineConfig({
    include: ["vertex/server/src/lib/dogfood-saved-design.pg.optional.test.ts"],
    exclude: ["**/cpp/**", "**/node_modules/**"],
    // Pin reporters. Agent sessions otherwise switch to the markdown reporter,
    // and GitHub Actions uses the compact reporter. The JSON file is the summary.
    reporters: ["default", ["json", { outputPath: "/tmp/orthocad-isolated-pg-report.json" }]],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    globals: true,
    testEnvironment: "happy-dom",
    tools: {
        rspack: {
            resolve: {
                modules: [resolve("vertex/node_modules"), "node_modules"],
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
