import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import packages from "./package.json";

export default defineConfig({
    exclude: ["**/cpp/**", "**/*.wasm.test.ts"],
    globals: true,
    testEnvironment: "happy-dom",
    setupFiles: ["./rstest-setup.ts"],
    tools: {
        rspack: {
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
            "./viewGizmo": "./packages/three/test/viewGizmo.ts",
            // Vertex app uses the "@/" path alias (see vertex/tsconfig.json) so
            // its unit tests resolve internal imports under the monorepo runner.
            "@": resolve("vertex/src"),
        },
    },
    source: {
        decorators: {
            version: "legacy",
        },
    },
});
