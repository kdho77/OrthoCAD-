import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "../../package.json";

const productRoot = resolve(process.env.GATE_PRODUCT_ROOT ?? process.cwd());

/**
 * Loads product code from GATE_PRODUCT_ROOT and runs only the gate files.
 * The default `npm test` include does not match `*.gate.ts`.
 */
export default defineConfig({
    include: ["validation/narrow_heelcup_preloft_gates/runtime/**/*.gate.ts"],
    exclude: [],
    testTimeout: 900_000,
    hookTimeout: 120_000,
    slowTestThreshold: 120_000,
    globals: true,
    testEnvironment: "happy-dom",
    tools: {
        rspack: {
            resolve: {
                modules: [
                    resolve(productRoot, "packages/mcp/node_modules"),
                    resolve(productRoot, "vertex/node_modules"),
                    resolve(productRoot, "node_modules"),
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
