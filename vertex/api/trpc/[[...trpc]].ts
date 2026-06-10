// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createFetchContext } from "../../server/src/context";
import { validateServerEnv } from "../../server/src/lib/env";
import { appRouter } from "../../server/src/routers";

// ---------------------------------------------------------------------------
// Module initialization
// ---------------------------------------------------------------------------

validateServerEnv();

const corsOrigin = process.env.CORS_ORIGIN ?? "*";

// ---------------------------------------------------------------------------
// FUTURE EXTRACTION CANDIDATES (token management, grants, transactions, audit)
// ---------------------------------------------------------------------------
// The following concerns are currently embedded across routers, context, and
// Prisma models. They are the highest-value targets for later service-layer
// extraction so the tRPC entry point and routers stay thin.
//
// 1. Token balance & deduction (manufacturing.ts, ai.ts, export.ts)
//    - Reading user.tokenBalance, checking sufficiency, atomic decrement.
//    - Rate limiting is already in trpc.ts (rateLimitedProcedure) but the
//      token cost itself and the "deduct only on success" contract live in
//      individual procedures.
//
// 2. Token grants / adjustments (admin.ts)
//    - grantTokens (superAdminProcedure) performs:
//        * Lazy user upsert for the actor (workaround for missing sync).
//        * Amount validation + underflow guard.
//        * Prisma $transaction that does user.update + tokenTransaction.create + auditLog.create.
//    - This is the canonical "grant" path; all other token movements should
//      funnel through a single service method.
//
// 3. Transactional workflows with compensation/audit (multiple routers)
//    - design.save: $transaction that rewrites corrections + elements + audit.
//    - stock.ts: create/update/delete + single-default invariant + audit.
//    - manufacturing.ts: token deduction + Export row + tokenTransaction + audit
//      inside a transaction that can throw to avoid partial deduction.
//    - admin.ts grantTokens (see above).
//
// 4. Audit logging (best-effort, scattered)
//    - Almost every mutating procedure eventually does ctx.prisma.auditLog.create.
//    - Patterns: { userId, action, targetId, metadata, ipAddress }.
//    - Many are wrapped in try/catch { /* best effort */ } so they never fail the
//      user action. This is good for availability but hides data-quality issues.
//
// 5. Auth / identity resolution (context.ts + dev-auth.ts)
//    - resolveUser handles Bearer tokens (Supabase) vs. dev: tokens.
//    - Dev bypass (isDevAuthAllowed, resolveDevBearerUser) is env + NODE_ENV driven.
//    - The AuthedUser shape and role derivation (resolveDevRole) are small but
//      sit at the root of every protectedProcedure.
//
// Recommended future structure:
//   server/src/services/
//     tokens.ts          (grantTokens, deductTokens, ensureUserForAudit, getBalance)
//     audit.ts           (recordAudit with best-effort + structured Action enum)
//     transactions.ts    (withTx helper or explicit unit-of-work objects)
//     auth.ts            (resolveUser, provisionActorIfMissing, dev token logic)
//   server/src/routers/* would call the services and only contain input validation
//   + authorization (the t.procedure.use middleware) + orchestration.
//
// Until that extraction happens, any change to token accounting, grant semantics,
// or audit schema must be made in the routers + context and kept consistent.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// tRPC Handler Core (inlined from the previous ./handler.ts module)
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

/**
 * Core tRPC request handler using the fetch adapter.
 * All business logic (routers, procedures, context creation, rate limits,
 * token checks, Prisma transactions, audit writes) is invoked from here via
 * the appRouter + createFetchContext.
 */
export async function handleTrpcRequest(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    console.log("[STOCK_DEBUG] tRPC handler", {
        method: request.method,
        pathname,
        endpoint: resolveTrpcEndpoint(pathname),
    });

    if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
    }

    const endpoint = resolveTrpcEndpoint(pathname);

    try {
        const response = await fetchRequestHandler({
            endpoint,
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
        // fetchRequestHandler normally formats procedure/context errors as JSON,
        // so reaching here means something lower-level failed (e.g. Prisma engine
        // init). Log it and return JSON so the client never sees an HTML 500.
        console.error("[trpc] fatal handler error", {
            pathname,
            error: error instanceof Error ? error.stack ?? error.message : String(error),
        });
        return withCors(
            new Response(
                JSON.stringify({
                    error: {
                        message: error instanceof Error ? error.message : "Internal Server Error",
                        code: -32603,
                        data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
                    },
                }),
                { status: 500, headers: { "Content-Type": "application/json" } },
            ),
        );
    }
}

// ---------------------------------------------------------------------------
// Vercel Fetch Adapter (self-contained; previously split across this file + handler)
// ---------------------------------------------------------------------------

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

/**
 * Vercel serverless entry point for tRPC.
 * This file is intentionally self-contained (no sibling imports from ./handler
 * or ./vercel-entry) so that the bundler reliably includes all adapter + handler
 * logic in a single module graph.
 */
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
