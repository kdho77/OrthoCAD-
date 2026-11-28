import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";

export default defineConfig({
    include: [resolve("validation/heel_bridge_watertight_gates/run_gates.ts")],
    testTimeout: 40 * 60 * 1000,
    hookTimeout: 60_000,
    globals: true,
    testEnvironment: "happy-dom",
    tools: {
        rspack: {
            resolve: {
                modules: [resolve("vertex/node_modules"), "node_modules"],
            },
            plugins: [
                new DefinePlugin({
                    __APP_VERSION__: JSON.stringify("heel-bridge-gates"),
                    __DOCUMENT_VERSION__: JSON.stringify("heel-bridge-gates"),
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
