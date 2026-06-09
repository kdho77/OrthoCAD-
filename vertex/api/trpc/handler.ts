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
    if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
    }

    const endpoint = resolveTrpcEndpoint(new URL(request.url).pathname);

    const response = await fetchRequestHandler({
        endpoint,
        req: request,
        router: appRouter,
        createContext: createFetchContext,
    });

    return withCors(response);
}
