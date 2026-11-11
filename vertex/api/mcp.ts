// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Streamable HTTP OrthoCAD MCP on the existing ortho-cad-mcp Vercel project.
// Path: POST /api/mcp. Stdio remains packages/mcp/src/cli.ts.
//
// Auth: the caller sends Authorization: Bearer ocad_… (the same CAD-operator integration
// key stdio reads from ORTHOCAD_MCP_API_KEY). This function does not read that env var
// and does not forward a project-wide key. Lookup uses the existing integration credential
// table (context.ts lookupCadOperatorCredential, narrowed so the webhook ciphertext and
// key hash are not loaded into the handler).
//
// maxDuration is the enqueue round-trip. generate_gcode still returns a production id.
// Loft and slice stay on api/trpc (maxDuration 300, waitUntil). Do not poll here.

import type { IncomingMessage } from "node:http";

import type { VercelRequest, VercelResponse } from "@vercel/node";

import { prisma } from "../server/src/lib/prisma.js";
import {
    handleOrthocadMcpHttp,
    MCP_FUNCTION_MAX_DURATION_SECONDS,
    redactSecrets,
} from "../server/src/orthocad-mcp.bundled.mjs";

export const maxDuration = MCP_FUNCTION_MAX_DURATION_SECONDS;

export const config = {
    api: {
        bodyParser: false,
    },
    maxDuration: MCP_FUNCTION_MAX_DURATION_SECONDS,
};

async function findCredentialByHash(hash: string) {
    const row = await prisma.integrationCredential.findUnique({
        where: { keyHash: hash },
        select: {
            id: true,
            revokedAt: true,
            tenants: { select: { tenantId: true } },
        },
    });
    if (!row) return null;
    return {
        id: row.id,
        revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
        tenantIds: row.tenants.map((tenant) => tenant.tenantId),
    };
}

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

async function toFetchRequest(req: VercelRequest): Promise<Request> {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
    const host = req.headers.host ?? "localhost";
    const path = req.url ?? "/api/mcp";
    const url = `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    }
    let body: Uint8Array<ArrayBuffer> | undefined;
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
        const raw = await readRawBody(req);
        if (raw.length > 0) {
            body = new Uint8Array(raw.length);
            body.set(raw);
        }
    }
    return new Request(url, { method: req.method, headers, body });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    try {
        const request = await toFetchRequest(req);
        const response = await handleOrthocadMcpHttp(request, {
            findCredentialByHash,
            env: process.env,
        });
        res.status(response.status);
        response.headers.forEach((value, key) => {
            const lower = key.toLowerCase();
            if (lower === "content-length" || lower === "content-encoding") return;
            res.setHeader(key, value);
        });
        const buffer = Buffer.from(await response.arrayBuffer());
        res.end(buffer);
    } catch (error) {
        const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
        console.error("[orthocad-mcp] function failed", redactSecrets(message));
        if (res.headersSent) {
            res.end();
            return;
        }
        res.status(500);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ error: "Internal server error" }));
    }
}
