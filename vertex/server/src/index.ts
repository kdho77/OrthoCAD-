import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { createContext } from "./context";
import { validateServerEnv } from "./lib/env";
import { appRouter } from "./routers";

validateServerEnv();

const PORT = Number(process.env.PORT ?? 5181);
const ORIGIN = process.env.CORS_ORIGIN ?? "*";

const server = createHTTPServer({
    router: appRouter,
    createContext,
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
console.log(`[vertex] tRPC server listening on http://localhost:${PORT}`);
