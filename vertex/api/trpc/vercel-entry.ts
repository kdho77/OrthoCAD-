// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    const request = await toFetchRequest(req);
    const response = await handleTrpcRequest(request);

    res.status(response.status);
    response.headers.forEach((value, key) => {
        res.setHeader(key, value);
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
}
