#!/usr/bin/env node
/**
 * Loopback stand-in for the Supabase RPC HTTP surface.
 *
 * It binds 127.0.0.1 only. It executes a repository SQL function only when
 * that function's CREATE body is in vertex/server/supabase/rpcs and this file
 * has an explicit call for it. vertex_authorize_export is not in the
 * repository, so this process cannot and does not invent a success result.
 * Storage and Auth HTTP routes are refused.
 */

import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const require = createRequire(resolve(ROOT, "vertex/package.json"));
const { PrismaClient } = require("@prisma/client");

const HOST = "127.0.0.1";
const PORT = Number(process.env.ORTHOCAD_LOCAL_RPC_PORT ?? 54330);
const DATABASE_URL = process.env.ORTHOCAD_BROWSER_DATABASE_URL ?? "";
const SYNTHETIC_KEY = "synthetic-local-service-role";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function repoFunctionNames() {
    const dir = resolve(ROOT, "vertex/server/supabase/rpcs");
    const names = new Set();
    for (const file of readdirSync(dir)) {
        if (!file.endsWith(".sql")) continue;
        const sql = readFileSync(resolve(dir, file), "utf8");
        for (const match of sql.matchAll(/CREATE OR REPLACE FUNCTION\s+([a-z0-9_]+)/gi)) {
            names.add(match[1]);
        }
    }
    return names;
}

function assertLocalDatabaseUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error("local rpc shim requires ORTHOCAD_BROWSER_DATABASE_URL");
    }
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
        throw new Error("local rpc shim refuses a non-postgres url");
    }
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
        throw new Error("local rpc shim refuses a non-loopback database");
    }
    const lowered = url.toLowerCase();
    for (const banned of ["supabase.co", "amazonaws", "neon.tech", "render.com", "pooler"]) {
        if (lowered.includes(banned)) throw new Error("local rpc shim refuses an external database");
    }
    return url;
}

function safeMessage(error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (raw.includes("NO_VALID_LICENSE")) return "NO_VALID_LICENSE";
    if (raw.includes("INSUFFICIENT_TOKENS")) return "INSUFFICIENT_TOKENS";
    const line = raw.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-url]").split("\n").map((part) => part.trim()).find(Boolean);
    return (line ?? "database call failed").slice(0, 240);
}

const KNOWN = repoFunctionNames();
const databaseUrl = assertLocalDatabaseUrl(DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

async function invoke(name, args) {
    if (!/^[a-z0-9_]+$/i.test(name) || !KNOWN.has(name)) {
        return {
            status: 404,
            body: {
                message: `Could not find the function public.${name} in repository SQL`,
                code: "PGRST202",
            },
        };
    }
    try {
        if (name === "vertex_ensure_app_user") {
            const id = String(args.p_user_id ?? "");
            const email = String(args.p_email ?? "");
            const role = String(args.p_role ?? "");
            if (!UUID.test(id)) throw new Error("invalid user id");
            if (!/^[A-Za-z0-9._%+@-]{1,200}$/.test(email)) throw new Error("invalid email");
            if (!["super_admin", "admin", "clinician"].includes(role)) throw new Error("invalid role");
            await prisma.$executeRaw`SELECT vertex_ensure_app_user(${id}::uuid, ${email}::text, ${role}::text)`;
            return { status: 200, body: null };
        }
        if (name === "vertex_assert_active_license") {
            const id = String(args.p_user_id ?? "");
            if (!UUID.test(id)) throw new Error("invalid user id");
            await prisma.$executeRaw`SELECT vertex_assert_active_license(${id}::uuid)`;
            return { status: 200, body: null };
        }
    } catch (error) {
        return { status: 400, body: { message: safeMessage(error), code: "P0001" } };
    }
    return {
        status: 404,
        body: {
            message: `${name} is defined in repository SQL but this loopback does not invoke it`,
            code: "PGRST202",
        },
    };
}

function authorized(req) {
    const apiKey = req.headers.apikey;
    const authorization = req.headers.authorization;
    const bearer = typeof authorization === "string" ? authorization.replace(/^Bearer\s+/i, "") : "";
    return apiKey === SYNTHETIC_KEY && bearer === SYNTHETIC_KEY;
}

const server = createServer(async (req, res) => {
    const host = req.headers.host ?? "";
    if (!host.startsWith(`${HOST}:`)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "loopback host required" }));
        return;
    }
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    if (!authorized(req)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "synthetic local key required" }));
        return;
    }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/i);
    if (!rpc || req.method !== "POST") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(
            JSON.stringify({
                message: "auth and storage routes are not defined for this loopback",
                code: "PGRST125",
            }),
        );
        return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let args = {};
    try {
        const text = Buffer.concat(chunks).toString("utf8");
        args = text ? JSON.parse(text) : {};
    } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "invalid JSON" }));
        return;
    }
    const result = await invoke(rpc[1], args);
    console.log(`local_rpc ${req.method} ${url.pathname} ${result.status}`);
    res.writeHead(result.status, { "content-type": "application/json" });
    res.end(result.body === null ? "null" : JSON.stringify(result.body));
});

server.listen(PORT, HOST, () => {
    console.log(`local_rpc_shim http://${HOST}:${PORT} functions=${KNOWN.size}`);
});
