// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { IncomingMessage, ServerResponse } from "node:http";

import { redactSecrets } from "../../auth/integration-keys.js";
import { handleIntegrationFetch } from "./http.js";

function readRawBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer | string) => {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

async function toFetch(req: IncomingMessage): Promise<Request> {
    const protoHeader = req.headers["x-forwarded-proto"];
    const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) ?? "http";
    const host = req.headers.host ?? "localhost";
    const path = req.url ?? "/";
    const url = `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    }
    let body: Uint8Array | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
        const raw = await readRawBody(req);
        if (raw.length > 0) {
            body = new Uint8Array(raw.length);
            body.set(raw);
        }
    }
    return new Request(url, { method: req.method, headers, body });
}

export async function handleIntegrationNode(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const response = await handleIntegrationFetch(await toFetch(req));
        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
            const lower = key.toLowerCase();
            if (lower === "content-length" || lower === "content-encoding") return;
            res.setHeader(key, value);
        });
        res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
        const message = redactSecrets(error instanceof Error ? error.message : "error");
        console.error("[integrations] handler failed", { message });
        if (res.headersSent) {
            res.end();
            return;
        }
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
}
