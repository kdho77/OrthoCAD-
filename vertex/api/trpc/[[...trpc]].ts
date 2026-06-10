// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Self-contained Vercel Serverless Function for the tRPC API.
//
// IMPORTANT — keep this the ONLY module inside api/:
// Vercel deploys every non-underscore file under api/ as its own function and
// compiles ESM output with extensionless relative imports, so a sibling module
// (the old ./handler.ts) produced ERR_MODULE_NOT_FOUND at runtime. All request
// handling is therefore inlined here. The ../../server/src imports below are
// application source that Vercel bundles into this function at build time;
// only node_modules packages remain external (and are traced automatically,
// including the Prisma query engines — no `functions` config is needed).
//
// Routing: the client calls /trpc (see src/lib/trpc.ts); rewrites in
// vertex/vercel.json map /trpc/* to /api/trpc/* so this catch-all handles it.

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createFetchContext } from "../../server/src/context";
import { validateServerEnv } from "../../server/src/lib/env";
import { appRouter } from "../../server/src/routers";

validateServerEnv();

const corsOrigin = process.env.CORS_ORIGIN ?? "*";

// Disable body parsing so tRPC receives the raw JSON payload from httpBatchLink.
export const config = {
    api: {
        bodyParser: false,
    },
};

// ---------------------------------------------------------------------------
// tRPC fetch handling (inlined — do not extract into a sibling api/ module)
// ---------------------------------------------------------------------------

/** Match the URL prefix tRPC sees after Vercel rewrites (/trpc or /api/trpc). */
function resolveTrpcEndpoint(pathname: string): string {
    const normalized = pathname.replace(/\/+$/, "") || "/";
    if (normalized.startsWith("/api/trpc")) return "/api/trpc";
    if (normalized.startsWith("/trpc")) return "/trpc";
    return "/trpc";
}

function withCors(response: Response): Response {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", corsOrigin);
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

/** tRPC-shaped JSON error so the browser client can always parse the body. */
function trpcErrorBody(message: string): string {
    return JSON.stringify({
        error: {
            message,
            code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
        },
    });
}

async function handleTrpcRequest(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
    }

    try {
        const response = await fetchRequestHandler({
            endpoint: resolveTrpcEndpoint(pathname),
            req: request,
            router: appRouter,
            createContext: createFetchContext,
            onError({ error, path, type }) {
                console.error("[trpc] procedure error", {
                    path: path ?? "<unknown>",
                    type,
                    code: error.code,
                    message: error.message,
                    cause: error.cause instanceof Error ? error.cause.message : undefined,
                });
            },
        });
        return withCors(response);
    } catch (error) {
        // fetchRequestHandler formats procedure/context errors as JSON itself,
        // so reaching here means something lower-level failed (e.g. Prisma
        // engine init). Log it and return JSON so the client never sees HTML.
        console.error("[trpc] fatal handler error", {
            pathname,
            error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        });
        return withCors(
            new Response(trpcErrorBody(error instanceof Error ? error.message : "Internal Server Error"), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }),
        );
    }
}

// ---------------------------------------------------------------------------
// Node (VercelRequest/VercelResponse) <-> Fetch API bridging
// ---------------------------------------------------------------------------

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

    let body: Uint8Array<ArrayBuffer> | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
        const raw = await readRawBody(req);
        if (raw.length > 0) {
            // Copy into a plain ArrayBuffer-backed Uint8Array: Buffer (ArrayBufferLike)
            // does not satisfy the BodyInit type.
            body = new Uint8Array(raw.length);
            body.set(raw);
        }
    }

    return new Request(url, {
        method: req.method,
        headers,
        body,
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
            error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        });
        if (res.headersSent) {
            res.end();
            return;
        }
        res.status(500);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", corsOrigin);
        res.end(trpcErrorBody(err instanceof Error ? err.message : "Internal Server Error"));
    }
}
