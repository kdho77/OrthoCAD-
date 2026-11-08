import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "./package.json";

/** Disposable local integration lifecycle. Not part of the unit shards or the width gate. */
export default defineConfig({
    include: ["vertex/server/src/routers/integrations/integration-lifecycle.pg.optional.test.ts"],
    exclude: ["**/cpp/**", "**/node_modules/**"],
    reporters: ["default", ["json", { outputPath: "/tmp/orthocad-isolated-lifecycle-report.json" }]],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    globals: true,
    testEnvironment: "node",
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
