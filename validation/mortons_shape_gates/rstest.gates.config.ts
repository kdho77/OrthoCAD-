import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "../../package.json";

const vertexSrc = process.env.GATE_VERTEX ? resolve(process.env.GATE_VERTEX) : resolve("vertex/src");

export default defineConfig({
    testTimeout: 180_000,
    hookTimeout: 60_000,
    globals: true,
    testEnvironment: "happy-dom",
    include: ["validation/mortons_shape_gates/**/*.test.ts"],
    tools: {
        rspack: {
            resolve: {
                modules: [resolve("vertex/node_modules"), "node_modules"],
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
            "@": vertexSrc,
        },
    },
    source: {
        decorators: {
            version: "legacy",
        },
    },
});
