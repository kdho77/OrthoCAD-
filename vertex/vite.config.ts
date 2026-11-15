import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

function resolveAppBuildId(): string {
    const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
    if (sha) return sha;
    return new Date().toISOString();
}

function appVersionPlugin(buildId: string): Plugin {
    const versionBody = `${JSON.stringify({ id: buildId })}\n`;
    return {
        name: "orthocad-app-version",
        config() {
            return {
                define: {
                    __APP_BUILD_ID__: JSON.stringify(buildId),
                },
            };
        },
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.method !== "GET" || req.url?.split("?")[0] !== "/version.json") return next();
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Cache-Control", "no-store");
                res.end(versionBody);
            });
        },
        closeBundle() {
            const outDir = path.resolve(__dirname, "dist");
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(path.join(outDir, "version.json"), versionBody);
        },
    };
}

const appBuildId = resolveAppBuildId();

export default defineConfig({
    plugins: [react(), appVersionPlugin(appBuildId)],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5180,
        proxy: {
            "/trpc": {
                target: "http://localhost:5181",
                changeOrigin: true,
            },
        },
    },
    assetsInclude: ["**/*.wasm"],
    worker: {
        format: "es",
    },
    optimizeDeps: {
        exclude: ["manifold-3d"],
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
