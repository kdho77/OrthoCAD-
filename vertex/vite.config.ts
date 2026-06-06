import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import rootPackage from "../package.json";

const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
    plugins: [react()],
    define: {
        // Chili3D core/wasm packages expect these rspack-style compile-time globals.
        __IS_PRODUCTION__: JSON.stringify(isProduction),
        __APP_VERSION__: JSON.stringify(rootPackage.version),
        __DOCUMENT_VERSION__: JSON.stringify(rootPackage.documentVersion),
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "@chili3d/core": path.resolve(__dirname, "../packages/core/src/index.ts"),
            "@chili3d/wasm": path.resolve(__dirname, "../packages/wasm/src/index.ts"),
        },
    },
    server: {
        port: 5180,
        fs: {
            allow: [path.resolve(__dirname, "..")],
        },
    },
    assetsInclude: ["**/*.wasm"],
    worker: {
        format: "es",
    },
    // OpenCascade WASM is large; keep it out of the eager bundle.
    optimizeDeps: {
        exclude: ["@chili3d/wasm"],
    },
    build: {
        target: "es2022",
        chunkSizeWarningLimit: 1200,
        rollupOptions: {
            output: {
                manualChunks: {
                    three: ["three", "three-stdlib"],
                    r3f: ["@react-three/fiber", "@react-three/drei"],
                    react: ["react", "react-dom"],
                    trpc: ["@trpc/client", "@supabase/supabase-js", "superjson"],
                },
            },
        },
    },
});
