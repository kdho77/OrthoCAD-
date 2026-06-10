import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { createContext } from "./context";
import { validateServerEnv } from "./lib/env";
import { appRouter } from "./routers";

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
    middleware: (req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", ORIGIN);
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
