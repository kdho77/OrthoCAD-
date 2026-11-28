import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";

const repo = resolve(import.meta.dirname, "../..");
const packages = JSON.parse(readFileSync(resolve(repo, "package.json"), "utf8")) as {
    version: string;
    documentVersion: string;
};

export default defineConfig({
    testTimeout: 180_000,
    hookTimeout: 60_000,
    include: ["validation/mortons_extra_hard_gates/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    globals: true,
    testEnvironment: "happy-dom",
    tools: {
        rspack: {
            resolve: {
                modules: [
                    resolve(repo, "packages/mcp/node_modules"),
                    resolve(repo, "vertex/node_modules"),
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
            "@": resolve(repo, "vertex/src"),
        },
    },
    source: {
        decorators: {
            version: "legacy",
        },
    },
});
