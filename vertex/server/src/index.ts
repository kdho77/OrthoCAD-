import "./load-env.js";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { createContext } from "./context.js";
import { resolveAllowOrigin } from "./lib/cors.js";
import { validateServerEnv } from "./lib/env.js";
import { appRouter } from "./routers/index.js";

validateServerEnv();

const PORT = Number(process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 5181);

// The browser tRPC client targets `${VITE_API_URL}/trpc` (see src/lib/trpc.ts) and
// the Vercel handler serves the same `/trpc` mount. Mount the standalone server
// under `/trpc/` too so both deployment targets share an identical URL surface.
// (The trailing slash is required by the standalone adapter's basePath contract.)
const server = createHTTPServer({
    router: appRouter,
    createContext,
    basePath: "/trpc/",
    onError({ error, path, type }) {
        console.error("[trpc] procedure error", {
            path: path ?? "<unknown>",
            type,
            code: error.code,
            message: error.message,
            cause: error.cause instanceof Error ? error.cause.message : undefined,
        });
    },
    middleware: (req, res, next) => {
        const origin = resolveAllowOrigin(
            typeof req.headers.origin === "string" ? req.headers.origin : undefined,
            process.env.CORS_ORIGIN,
        );
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        next();
    },
});

server.listen(PORT);
console.log(`[vertex] tRPC server listening on http://localhost:${PORT}/trpc`);
