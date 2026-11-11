// Stateless Streamable HTTP for the Vercel function. One server and one transport per request.
// generate_gcode keeps the existing enqueue-and-poll behavior: this route does not wait for loft or slice.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { loadConfig, type OrthocadMcpConfig } from "./config.js";
import {
    authorizeMcpBearer,
    bearerToken,
    DOGFOOD_TENANT_ID,
    isCadOperatorKeyToken,
    lockCadOperatorScopes,
    MCP_AUTH_MESSAGES,
    type McpAuthDecision,
    type McpCadOperatorPrincipal,
    type McpCredentialRow,
    redactSecrets,
    toolMissingScope,
} from "./http-auth.js";
import { createOrthocadMcpServer } from "./server.js";
import type { OrthocadToolDeps } from "./tools/handlers.js";

export { redactSecrets } from "./http-auth.js";

/** Path on the ortho-cad-mcp Vercel project (root directory `vertex`, file `api/mcp.ts`). */
export const MCP_HTTP_PATH = "/api/mcp";

/**
 * Enqueue round-trip only. Loft and slice stay on `vertex/api/trpc` (`maxDuration` 300, `waitUntil`).
 * Do not raise this to cover a synchronous generate_gcode wait.
 */
export const MCP_FUNCTION_MAX_DURATION_SECONDS = 60;

export interface HandleOrthocadMcpHttpOptions {
    findCredentialByHash: (hash: string) => Promise<McpCredentialRow | null>;
    /**
     * Replacement for the default hash lookup. Tests use this to present a narrowed scope set.
     * Production passes only `findCredentialByHash`. A resolver cannot widen scopes: the handler
     * keeps the intersection with CAD_OPERATOR_SCOPES and forwards the request bearer, not a
     * different key.
     */
    authorize?: (authorization: string | undefined) => Promise<McpAuthDecision>;
    /** Integration / manufacturing fakes. Production omits this and uses the real clients. */
    toolDeps?: Omit<OrthocadToolDeps, "config">;
    /**
     * Env used for the API origin. `ORTHOCAD_MCP_API_KEY` is ignored.
     * `ORTHOCAD_API_BASE` wins, then `VERCEL_URL`, then the request origin.
     */
    env?: NodeJS.ProcessEnv;
}

function json(status: number, message: string, extra?: HeadersInit): Response {
    const headers = new Headers(extra);
    headers.set("content-type", "application/json");
    headers.set("cache-control", "no-store");
    const response = new Response(JSON.stringify({ error: message }), { status, headers });
    response.headers.set("content-type", "application/json");
    return response;
}

function copyHeaders(source: Headers): Headers {
    const headers = new Headers();
    source.forEach((value, key) => {
        headers.set(key, value);
    });
    return headers;
}

function withCors(response: Response, env: NodeJS.ProcessEnv): Response {
    const headers = copyHeaders(response.headers);
    headers.set("access-control-allow-origin", env.CORS_ORIGIN?.trim() || "*");
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set(
        "access-control-allow-headers",
        "Content-Type, Authorization, Accept, mcp-protocol-version, mcp-session-id",
    );
    headers.set("cache-control", "no-store");
    const outgoing = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
    const contentType = headers.get("content-type");
    if (contentType?.startsWith("text/plain")) {
        outgoing.headers.set("content-type", "application/json");
    } else if (contentType) {
        outgoing.headers.set("content-type", contentType);
    }
    return outgoing;
}

export function resolveMcpApiBase(request: Request, env: NodeJS.ProcessEnv): string {
    const configured = env.ORTHOCAD_API_BASE?.trim();
    if (configured) return configured.replace(/\/+$/, "");
    const vercel = env.VERCEL_URL?.trim();
    if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
}

function configForCaller(apiKey: string, apiBase: string): OrthocadMcpConfig {
    return loadConfig({
        ORTHOCAD_API_BASE: apiBase,
        ORTHOCAD_MCP_API_KEY: apiKey,
    });
}

function toolNamesInBody(body: unknown): string[] {
    const messages = Array.isArray(body) ? body : [body];
    const names: string[] = [];
    for (const message of messages) {
        if (!message || typeof message !== "object") continue;
        const record = message as { method?: unknown; params?: { name?: unknown } };
        if (record.method !== "tools/call") continue;
        if (typeof record.params?.name === "string") names.push(record.params.name);
    }
    return names;
}

function lockPrincipal(principal: McpCadOperatorPrincipal): McpCadOperatorPrincipal | null {
    if (principal.kind !== "cad_operator" || principal.tenantId !== DOGFOOD_TENANT_ID) return null;
    const scopes = lockCadOperatorScopes(principal.scopes);
    if (scopes.length === 0) return null;
    return {
        kind: "cad_operator",
        credentialId: principal.credentialId,
        tenantId: DOGFOOD_TENANT_ID,
        scopes,
    };
}

function replayRequest(request: Request, body: string): Request {
    return new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: body.length > 0 ? body : undefined,
    });
}

async function redactResponse(response: Response): Promise<Response> {
    if (response.status === 204 || response.status === 202) return response;
    const text = await response.text();
    const headers = copyHeaders(response.headers);
    const declared = response.headers.get("content-type");
    if (declared) headers.set("content-type", declared);
    headers.delete("content-length");
    headers.delete("content-encoding");
    const cleaned = redactSecrets(text);
    const trimmed = cleaned.trimStart();
    if (
        (!declared || declared.startsWith("text/plain")) &&
        (trimmed.startsWith("{") || trimmed.startsWith("["))
    ) {
        headers.set("content-type", "application/json");
    }
    const outgoing = new Response(cleaned, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
    const contentType = headers.get("content-type");
    if (contentType) outgoing.headers.set("content-type", contentType);
    return outgoing;
}

function logFailure(error: unknown): void {
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    console.error("[orthocad-mcp] request failed", redactSecrets(detail));
}

export async function handleOrthocadMcpHttp(
    request: Request,
    options: HandleOrthocadMcpHttpOptions,
): Promise<Response> {
    const env = options.env ?? process.env;
    try {
        if (request.method === "OPTIONS") {
            return withCors(new Response(null, { status: 204 }), env);
        }
        if (request.method !== "POST") {
            return withCors(json(405, "Method not allowed", { Allow: "POST" }), env);
        }

        const authorization = request.headers.get("authorization") ?? undefined;
        const headerKey = bearerToken(authorization);
        if (!headerKey || !isCadOperatorKeyToken(headerKey)) {
            return withCors(json(401, MCP_AUTH_MESSAGES.required), env);
        }

        const decision = options.authorize
            ? await options.authorize(authorization)
            : await authorizeMcpBearer(authorization, options.findCredentialByHash);
        if (!decision.ok) {
            return withCors(json(decision.status, redactSecrets(decision.message)), env);
        }
        if (decision.apiKey !== headerKey) {
            return withCors(json(401, MCP_AUTH_MESSAGES.required), env);
        }
        const principal = lockPrincipal(decision.principal);
        if (!principal) {
            return withCors(json(403, MCP_AUTH_MESSAGES.insufficientScope), env);
        }

        const raw = await request.text();
        let parsed: unknown;
        if (raw) {
            try {
                parsed = JSON.parse(raw) as unknown;
            } catch {
                parsed = undefined;
            }
        }
        for (const name of toolNamesInBody(parsed)) {
            if (toolMissingScope(principal.scopes, name)) {
                return withCors(json(403, MCP_AUTH_MESSAGES.insufficientScope), env);
            }
        }

        const server = createOrthocadMcpServer(
            configForCaller(headerKey, resolveMcpApiBase(request, env)),
            options.toolDeps,
        );
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        try {
            await server.connect(transport);
            const response = await transport.handleRequest(
                replayRequest(request, raw),
                parsed === undefined ? undefined : { parsedBody: parsed },
            );
            return withCors(await redactResponse(response), env);
        } finally {
            await transport.close().catch(() => undefined);
            await server.close().catch(() => undefined);
        }
    } catch (error) {
        logFailure(error);
        return withCors(json(500, "Internal server error"), env);
    }
}
