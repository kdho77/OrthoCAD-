import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "../../package.json";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const product = process.env.GATE_PRODUCT_ROOT ? resolve(process.env.GATE_PRODUCT_ROOT) : repo;

export default defineConfig({
    testTimeout: 2_700_000,
    hookTimeout: 120_000,
    slowTestThreshold: 30_000,
    globals: false,
    testEnvironment: "happy-dom",
    tools: {
        rspack: {
            resolve: {
                modules: [
                    resolve(product, "vertex/node_modules"),
                    resolve(repo, "vertex/node_modules"),
                    resolve(product, "node_modules"),
                    resolve(repo, "node_modules"),
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
            "@": resolve(product, "vertex/src"),
        },
    },
    source: {
        decorators: {
            version: "legacy",
        },
    },
});
