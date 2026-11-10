// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Vercel function for POST /print-bridge/v1/*. This file is a route, not a helper.
// Tests live outside this directory so Vercel does not publish them as functions.
// The handler is handlePrintBridgeNode, the same contract the standalone Node server uses.
//
// Routing: non-Next Vercel projects only bind single-segment routes under /api.
// vertex/vercel.json rewrites /print-bridge/:path* → /api/print-bridge so req.url
// keeps the original /print-bridge/v1/* path. bodyParser is off so readJson
// consumes the raw request stream.

import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma, resolveDatabaseUrl } from "../../server/src/lib/prisma.js";
import { prismaProductionRepo } from "../../server/src/lib/prisma-production-repo.js";
import { handlePrintBridgeNode, type PrintBridgeHttpDeps } from "../../server/src/print-bridge-http.js";
import { serverBridgeDirectory } from "../../server/src/print-bridge-state.js";

export const config = {
    api: {
        bodyParser: false,
    },
    maxDuration: 60,
};

export interface PrintBridgeFunctionDeps extends PrintBridgeHttpDeps {
    databaseConfigured: boolean;
}

export async function handlePrintBridgeFunction(
    req: IncomingMessage,
    res: ServerResponse,
    deps: PrintBridgeFunctionDeps,
): Promise<void> {
    if (!deps.databaseConfigured) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bridge store is not configured" }));
        return;
    }
    await handlePrintBridgeNode(req, res, deps);
}

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return handlePrintBridgeFunction(req, res, {
        databaseConfigured: Boolean(resolveDatabaseUrl()),
        directory: serverBridgeDirectory,
        repo: prismaProductionRepo(prisma),
    });
}
