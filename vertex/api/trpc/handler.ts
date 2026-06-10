// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createFetchContext } from "../../server/src/context";
import { validateServerEnv } from "../../server/src/lib/env";
import { appRouter } from "../../server/src/routers";

validateServerEnv();

const corsOrigin = process.env.CORS_ORIGIN ?? "*";

/** Match the URL prefix tRPC sees after Vercel rewrites (/trpc or /api/trpc). */
export function resolveTrpcEndpoint(pathname: string): string {
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
