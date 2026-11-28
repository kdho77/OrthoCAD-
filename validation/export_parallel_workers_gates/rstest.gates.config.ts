import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "../../package.json";

const productRoot = process.env.GATE_PRODUCT_ROOT ? resolve(process.env.GATE_PRODUCT_ROOT) : resolve(".");

export default defineConfig({
    testTimeout: 2_400_000,
    hookTimeout: 60_000,
    slowTestThreshold: 30_000,
    include: ["validation/export_parallel_workers_gates/**/*.gate.ts"],
    globals: false,
    testEnvironment: "happy-dom",
    tools: {
        rspack: {
            resolve: {
                modules: [
                    resolve("vertex/node_modules"),
                    resolve(productRoot, "vertex/node_modules"),
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
            "@": resolve(productRoot, "vertex/src"),
        },
    },
    source: {
        decorators: {
            version: "legacy",
        },
    },
});
