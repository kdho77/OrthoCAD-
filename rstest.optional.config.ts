import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "./package.json";

/** Non-required job: Default procedural smokes + residual report. */
export default defineConfig({
    exclude: ["**/cpp/**", "**/*.wasm.test.ts", "**/dump-*.test.ts"],
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
