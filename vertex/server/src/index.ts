import "./load-env.js";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { createContext } from "./context.js";
import { validateServerEnv } from "./lib/env.js";
import {
    handleSlicerRequest,
    incomingMessageToRequest,
    isSlicerProxyPath,
    sendFetchResponse,
} from "./lib/vertexslice-proxy.js";
import { appRouter } from "./routers/index.js";

validateServerEnv();

const PORT = Number(process.env.PORT ?? 5181);
const ORIGIN = process.env.CORS_ORIGIN ?? "*";

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
        const pathname = (req.url ?? "/").split("?")[0] ?? "/";
        if (isSlicerProxyPath(pathname) || pathname === "/api/slicer") {
            void incomingMessageToRequest(req)
                .then((request) => handleSlicerRequest(request))
                .then((response) => sendFetchResponse(res, response))
                .catch((err) => {
                    console.error("[vertex] slicer proxy error", err);
                    if (!res.headersSent) {
                        res.statusCode = 500;
                        res.setHeader("Content-Type", "application/json");
                        res.end(
                            JSON.stringify({
                                ok: false,
                                error: {
                                    code: "auth_config",
                                    cause: "Proxy failed",
                                    nextStep: "Retry",
                                    requestId: "",
                                },
                            }),
                        );
                    }
                });
            return;
        }
        res.setHeader("Access-Control-Allow-Origin", ORIGIN);
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Slicer-Fault");
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
