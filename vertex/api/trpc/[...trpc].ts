// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createFetchContext } from "../../server/src/context";
import { validateServerEnv } from "../../server/src/lib/env";
import { appRouter } from "../../server/src/routers";

validateServerEnv();

// Prisma requires the Node.js runtime (not Edge).
export const config = {
    runtime: "nodejs",
};

const corsOrigin = process.env.CORS_ORIGIN ?? "*";

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

async function handler(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
    }

    const response = await fetchRequestHandler({
        endpoint: "/trpc",
        req: request,
        router: appRouter,
        createContext: createFetchContext,
    });

    return withCors(response);
}

export default handler;
