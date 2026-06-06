import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5180,
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
