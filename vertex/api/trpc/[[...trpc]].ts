// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Vercel Serverless Function entry point for the self-contained tRPC API.
// This file (and only this file) is registered as a Node.js function.
// - Must export BOTH `config` (for bodyParser: false) AND a `default` handler.
// - Prisma engine/client files are included via vertex/vercel.json "functions" entry
//   using this exact filename (never use a broad glob like "api/trpc/**/*.ts").
// - The client calls /trpc (see src/lib/trpc.ts); rewrites in vercel.json map it
//   to /api/trpc so this catch-all file-based route handles it.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleTrpcRequest } from "./handler";

// Node.js version is set via package.json engines (20.x). Disable body parsing so
// tRPC receives the raw JSON payload from httpBatchLink.
export const config = {
    api: {
        bodyParser: false,
    },
};

function readRawBody(req: VercelRequest): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer | string) => {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

async function toFetchRequest(req: VercelRequest): Promise<Request> {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
    const host = req.headers.host ?? "localhost";
    const path = req.url ?? "/";
    const url = `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    }

    let body: Buffer | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
        const raw = await readRawBody(req);
        if (raw.length > 0) body = raw;
    }

    return new Request(url, {
        method: req.method,
        headers,
        body,
    });
}

/** tRPC-shaped JSON error so the browser client can always parse the body. */
function trpcErrorBody(message: string) {
    return JSON.stringify({
        error: {
            message,
            code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
        },
    });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    try {
        const request = await toFetchRequest(req);
        const response = await handleTrpcRequest(request);

        res.status(response.status);
        response.headers.forEach((value, key) => {
            // Let Node compute content-length for the buffer we write below and
            // never forward a stale content-encoding from the upstream Response.
            const lower = key.toLowerCase();
            if (lower === "content-length" || lower === "content-encoding") return;
            res.setHeader(key, value);
        });

        const buffer = Buffer.from(await response.arrayBuffer());
        res.end(buffer);
    } catch (err) {
        // Any throw here would otherwise crash the Lambda and make Vercel return
        // its plain-text "A server error has occurred" page (invalid JSON to the
        // tRPC client). Log the real cause and return parseable JSON instead.
        console.error("[vercel] tRPC function crashed", {
            url: req.url,
            method: req.method,
            error: err instanceof Error ? err.stack ?? err.message : String(err),
        });
        if (res.headersSent) {
            res.end();
            return;
        }
        res.status(500);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN ?? "*");
        res.end(trpcErrorBody(err instanceof Error ? err.message : "Internal Server Error"));
    }
}
