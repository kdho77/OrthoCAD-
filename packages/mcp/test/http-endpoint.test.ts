import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "@rstest/core";
import { orthocadMcpHttpSourceHash } from "../../../vertex/scripts/orthocad-mcp-http-bundle-hash.mjs";
import {
    principalFromCredential as serverPrincipal,
    CAD_OPERATOR_SCOPES as serverScopes,
    DOGFOOD_TENANT_ID as serverTenant,
} from "../../../vertex/server/src/auth/cad-operator.js";
import { hashIntegrationKey } from "../../../vertex/server/src/auth/integration-keys.js";
import type { IntegrationClient } from "../src/clients/integration-client.js";
import type { ManufacturingClient } from "../src/clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../src/config.js";
import { handleOrthocadMcpHttp, MCP_FUNCTION_MAX_DURATION_SECONDS, MCP_HTTP_PATH } from "../src/http.js";
import {
    authorizeMcpBearer,
    bearerToken,
    CAD_OPERATOR_SCOPES,
    DOGFOOD_TENANT_ID,
    hashCadOperatorKey,
    MCP_TOOL_REQUIRED_SCOPES,
    type McpAuthDecision,
    type McpCredentialRow,
} from "../src/http-auth.js";
import { createOrthocadMcpServer } from "../src/server.js";
import { handleOrthocadTool } from "../src/tools/handlers.js";
import { MCP_TOOL_DEFINITIONS } from "../src/tools/schemas.js";

const CALLER = "ocad_callerkeyvalue";
const SHARED = "ocad_sharedserverkeynotused";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const DESIGN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MCP_URL = `https://evil.example${MCP_HTTP_PATH}`;

const stdioConfig = {
    apiBase: "http://127.0.0.1:9",
    trpcUrl: "http://127.0.0.1:9/trpc",
    ORTHOCAD_MCP_API_KEY: CALLER,
} as OrthocadMcpConfig;

function row(id: string, tenantIds: string[], revokedAt: string | null = null): McpCredentialRow {
    return { id, revokedAt, tenantIds };
}

function directory(): Map<string, McpCredentialRow> {
    return new Map<string, McpCredentialRow>([
        [hashCadOperatorKey(CALLER), row("cred-dogfood", [DOGFOOD_TENANT_ID])],
        [
            hashCadOperatorKey("ocad_revokedkeyvalue"),
            row("cred-revoked", [DOGFOOD_TENANT_ID], "2026-11-01T00:00:00.000Z"),
        ],
        [hashCadOperatorKey("ocad_othertenantkey"), row("cred-other", [OTHER_TENANT])],
    ]);
}

/** happy-dom's Request drops headers when given a Headers instance. Pass a plain object. */
function requestWith(url: string | URL, init?: RequestInit): Request {
    const source = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    source.forEach((value, key) => {
        headers[key] = value;
    });
    const body = init?.body;
    return new Request(url, {
        method: init?.method ?? "POST",
        headers,
        body: typeof body === "string" || body instanceof Uint8Array ? body : body ? String(body) : undefined,
    });
}

function post(token: string | null, body?: unknown, url = MCP_URL): Request {
    const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
    };
    if (token) headers.authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    return new Request(url, {
        method: "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

async function read(
    response: Response,
): Promise<{ status: number; text: string; json: Record<string, unknown> | null }> {
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
        json = JSON.parse(text) as Record<string, unknown>;
    } catch {
        json = null;
    }
    return { status: response.status, text, json };
}

describe("hosted OrthoCAD MCP auth matches the CAD-operator key", () => {
    test("hash, tenant, and scopes match the server helpers", async () => {
        expect(DOGFOOD_TENANT_ID).toBe(serverTenant);
        expect(CAD_OPERATOR_SCOPES).toEqual(serverScopes);
        expect(hashCadOperatorKey(CALLER)).toBe(hashIntegrationKey(CALLER));
        expect(hashCadOperatorKey(CALLER)).toBe(createHash("sha256").update(CALLER).digest("hex"));
        expect(hashCadOperatorKey(CALLER)).not.toBe(CALLER);

        const dogfood = row("cred-dogfood", [DOGFOOD_TENANT_ID, OTHER_TENANT]);
        expect(serverPrincipal(dogfood)?.scopes).toEqual(CAD_OPERATOR_SCOPES);
        const decision = await authorizeMcpBearer(`Bearer ${CALLER}`, async () => dogfood);
        expect(decision.ok).toBe(true);
        if (!decision.ok) return;
        expect(decision.principal.scopes).toEqual(serverPrincipal(dogfood)?.scopes);
        expect(decision.principal.tenantId).toBe(serverPrincipal(dogfood)?.tenantId);
        expect(decision.apiKey).toBe(CALLER);

        expect(serverPrincipal(row("cred", [DOGFOOD_TENANT_ID], "2026-11-01T00:00:00.000Z"))).toBeNull();
        expect(serverPrincipal(row("cred", [OTHER_TENANT]))).toBeNull();
        const names = MCP_TOOL_DEFINITIONS.map((tool) => tool.name);
        expect(Object.keys(MCP_TOOL_REQUIRED_SCOPES)).toEqual(names);
        expect(MCP_TOOL_REQUIRED_SCOPES.generate_gcode).toEqual(["manufacturing:generate"]);
        expect(MCP_TOOL_REQUIRED_SCOPES.get_design).toEqual(["design:read"]);
        expect(MCP_FUNCTION_MAX_DURATION_SECONDS).toBe(60);
    });

    test("missing, malformed, unknown, and revoked credentials are 401 and the lookup sees only the hash", async () => {
        const seen: string[] = [];
        const books = directory();
        const findCredentialByHash = async (hash: string) => {
            seen.push(hash);
            return books.get(hash) ?? null;
        };
        const env = { ORTHOCAD_MCP_API_KEY: SHARED, VERCEL_URL: "orthocad.vertexorthopedic.com" };

        const missing = await read(
            await handleOrthocadMcpHttp(post(null, { jsonrpc: "2.0", id: 1, method: "initialize" }), {
                findCredentialByHash,
                env,
            }),
        );
        expect(missing.status).toBe(401);
        expect(missing.json).toEqual({ error: "Authentication required" });

        const jwt = await read(
            await handleOrthocadMcpHttp(
                post("eyJhbGciOiJIUzI1NiJ9.payload.sig", { jsonrpc: "2.0", id: 1, method: "tools/list" }),
                {
                    findCredentialByHash,
                    env,
                },
            ),
        );
        expect(jwt.status).toBe(401);

        const spaced = await read(
            await handleOrthocadMcpHttp(
                post("Bearer ocad_abc def", { jsonrpc: "2.0", id: 1, method: "tools/list" }),
                {
                    findCredentialByHash,
                    env,
                },
            ),
        );
        expect(spaced.status).toBe(401);
        expect(seen).toEqual([]);

        const unknown = await read(
            await handleOrthocadMcpHttp(
                post("ocad_unknownkeyvalue", { jsonrpc: "2.0", id: 1, method: "initialize" }),
                {
                    findCredentialByHash,
                    env,
                },
            ),
        );
        expect(unknown.status).toBe(401);
        expect(seen).toEqual([hashCadOperatorKey("ocad_unknownkeyvalue")]);
        expect(seen[0]).not.toContain("ocad_");

        const revoked = await read(
            await handleOrthocadMcpHttp(
                post("ocad_revokedkeyvalue", { jsonrpc: "2.0", id: 1, method: "tools/list" }),
                {
                    findCredentialByHash,
                    env,
                },
            ),
        );
        expect(revoked.status).toBe(401);
        for (const body of [missing.text, jwt.text, spaced.text, unknown.text, revoked.text]) {
            expect(body).not.toContain(CALLER);
            expect(body).not.toContain(SHARED);
            expect(body).not.toContain("ocad_");
        }
    });

    test("a non-dogfood key and a narrowed scope are 403 and do not run the handler", async () => {
        const books = directory();
        let generated = 0;
        const manufacturing = {
            generateFromSavedDesign: async () => {
                generated += 1;
                return { productionId: DESIGN_ID, status: "pending", side: "left" };
            },
        } as unknown as ManufacturingClient;
        const env = { ORTHOCAD_MCP_API_KEY: SHARED };
        const other = await read(
            await handleOrthocadMcpHttp(
                post("ocad_othertenantkey", { jsonrpc: "2.0", id: 1, method: "tools/list" }),
                {
                    findCredentialByHash: async (hash) => books.get(hash) ?? null,
                    toolDeps: { manufacturing },
                    env,
                },
            ),
        );
        expect(other.status).toBe(403);
        expect(other.json).toEqual({ error: "Insufficient scope" });
        expect(generated).toBe(0);

        const narrow = await read(
            await handleOrthocadMcpHttp(
                post(CALLER, {
                    jsonrpc: "2.0",
                    id: 2,
                    method: "tools/call",
                    params: {
                        name: "generate_gcode",
                        arguments: {
                            use_saved_design: true,
                            design_id: DESIGN_ID,
                            preset_id: "apex-v2-insole-95a",
                        },
                    },
                }),
                {
                    findCredentialByHash: async () => {
                        throw new Error("lookup should not run when authorize is injected");
                    },
                    authorize: async (authorization): Promise<McpAuthDecision> => {
                        const token = bearerToken(authorization);
                        if (!token) return { ok: false, status: 401, message: "Authentication required" };
                        return {
                            ok: true,
                            apiKey: token,
                            principal: {
                                kind: "cad_operator",
                                credentialId: "cred-narrow",
                                tenantId: DOGFOOD_TENANT_ID,
                                scopes: ["design:read", "admin", "order:write"],
                            },
                        };
                    },
                    toolDeps: { manufacturing },
                    env,
                },
            ),
        );
        expect(narrow.status).toBe(403);
        expect(narrow.text).not.toContain(CALLER);
        expect(narrow.text).not.toContain("admin");
        expect(generated).toBe(0);
    });

    test("a resolver cannot swap in a server key", async () => {
        let generated = 0;
        const response = await read(
            await handleOrthocadMcpHttp(post(CALLER, { jsonrpc: "2.0", id: 1, method: "tools/list" }), {
                findCredentialByHash: async () => row("cred-dogfood", [DOGFOOD_TENANT_ID]),
                authorize: async () => ({
                    ok: true,
                    apiKey: SHARED,
                    principal: {
                        kind: "cad_operator",
                        credentialId: "cred-dogfood",
                        tenantId: DOGFOOD_TENANT_ID,
                        scopes: CAD_OPERATOR_SCOPES,
                    },
                }),
                toolDeps: {
                    manufacturing: {
                        generateFromSavedDesign: async () => {
                            generated += 1;
                            return { status: "pending" };
                        },
                    } as unknown as ManufacturingClient,
                },
                env: { ORTHOCAD_MCP_API_KEY: SHARED },
            }),
        );
        expect(response.status).toBe(401);
        expect(response.text).not.toContain(SHARED);
        expect(response.text).not.toContain(CALLER);
        expect(generated).toBe(0);
    });

    test("lookup failures do not echo the credential", async () => {
        const errors: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => {
            errors.push(args.map((part) => String(part)).join(" "));
        };
        try {
            const response = await read(
                await handleOrthocadMcpHttp(post(CALLER, { jsonrpc: "2.0", id: 1, method: "initialize" }), {
                    findCredentialByHash: async () => {
                        throw new Error(
                            `database unavailable for ${CALLER} postgres://user:${CALLER}@db.internal/app`,
                        );
                    },
                    env: {},
                }),
            );
            expect(response.status).toBe(500);
            expect(response.json).toEqual({ error: "Internal server error" });
            expect(response.text).not.toContain(CALLER);
            expect(errors.join("\n")).not.toContain(CALLER);
            expect(errors.join("\n")).toContain("[redacted-key]");
            expect(errors.join("\n")).toContain("[redacted-db-url]");
        } finally {
            console.error = original;
        }
    });
});

describe("hosted OrthoCAD MCP tools match stdio", () => {
    test("tool names and input schemas match the stdio server", async () => {
        const server = createOrthocadMcpServer(stdioConfig);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const stdio = new Client({ name: "stdio-probe", version: "0" });
        await stdio.connect(clientTransport);
        const fromStdio = await stdio.listTools();

        const http = new Client({ name: "http-probe", version: "0" });
        const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
            requestInit: { headers: { authorization: `Bearer ${CALLER}` } },
            fetch: async (url, init) =>
                handleOrthocadMcpHttp(requestWith(url, init), {
                    findCredentialByHash: async (hash) => directory().get(hash) ?? null,
                    env: { ORTHOCAD_MCP_API_KEY: SHARED, VERCEL_URL: "orthocad.vertexorthopedic.com" },
                }),
        });
        await http.connect(transport);
        const fromHttp = await http.listTools();

        expect(fromHttp.tools.map((tool) => tool.name)).toEqual(fromStdio.tools.map((tool) => tool.name));
        expect(fromHttp.tools.map((tool) => tool.name)).toEqual(
            MCP_TOOL_DEFINITIONS.map((tool) => tool.name),
        );
        for (const tool of fromStdio.tools) {
            const hosted = fromHttp.tools.find((candidate) => candidate.name === tool.name);
            expect(hosted?.description).toBe(tool.description);
            expect(hosted?.inputSchema).toEqual(tool.inputSchema);
        }

        await http.close();
        await stdio.close();
        await server.close();
    });

    test("valid auth runs the same handler and forwards the caller key, not the env key", async () => {
        const attachment = {
            order_id: DESIGN_ID,
            files: [{ side: "left" as const, content_base64: "R0NPREU=" }],
        };
        const direct = await handleOrthocadTool("prepare_vo_attachment", attachment, { config: stdioConfig });

        const http = new Client({ name: "http-call", version: "0" });
        const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
            requestInit: { headers: { authorization: `Bearer ${CALLER}` } },
            fetch: async (url, init) =>
                handleOrthocadMcpHttp(requestWith(url, init), {
                    findCredentialByHash: async (hash) => directory().get(hash) ?? null,
                    env: {
                        ORTHOCAD_MCP_API_KEY: SHARED,
                        ORTHOCAD_API_BASE: "https://orthocad.vertexorthopedic.com",
                    },
                }),
        });
        await http.connect(transport);
        const called = await http.callTool({ name: "prepare_vo_attachment", arguments: attachment });
        const hostedText = called.content?.find((block) => block.type === "text" && "text" in block);
        expect(hostedText && "text" in hostedText ? hostedText.text : "").toBe(direct.content[0]?.text);
        expect(JSON.stringify(called)).not.toContain(CALLER);
        expect(JSON.stringify(called)).not.toContain(SHARED);
        await http.close();

        const seen: Array<{ url: string; authorization: string | null }> = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
            const headers = new Headers(init?.headers);
            seen.push({ url: String(input), authorization: headers.get("authorization") });
            return new Response(JSON.stringify({ design_id: DESIGN_ID, echo: CALLER }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        };
        try {
            const designClient = new Client({ name: "http-design", version: "0" });
            const designTransport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
                requestInit: { headers: { authorization: `Bearer ${CALLER}` } },
                fetch: async (url, init) =>
                    handleOrthocadMcpHttp(requestWith(url, init), {
                        findCredentialByHash: async (hash) => directory().get(hash) ?? null,
                        env: {
                            ORTHOCAD_MCP_API_KEY: SHARED,
                            VERCEL_URL: "orthocad.vertexorthopedic.com",
                        },
                    }),
            });
            await designClient.connect(designTransport);
            const design = await designClient.callTool({
                name: "get_design",
                arguments: { design_id: DESIGN_ID },
            });
            expect(seen).toEqual([
                {
                    url: `https://orthocad.vertexorthopedic.com/api/integrations/v1/designs/${DESIGN_ID}`,
                    authorization: `Bearer ${CALLER}`,
                },
            ]);
            expect(JSON.stringify(design)).not.toContain(CALLER);
            expect(JSON.stringify(design)).not.toContain(SHARED);
            await designClient.close();
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test("generate_gcode returns pending production ids and does not wait for bytes", async () => {
        const calls: string[] = [];
        const manufacturing = {
            generateFromSavedDesign: async (input: { side: "left" | "right" }) => {
                calls.push(input.side);
                return {
                    productionId: input.side === "left" ? DESIGN_ID : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    status: "pending",
                    side: input.side,
                    gcode: "G1 X0 secret motion",
                    patientName: "Jane Doe",
                };
            },
            getGcodeDownloadUrl: async () => {
                calls.push("download");
                return { downloadUrl: "https://files.example.test/secret", productionId: DESIGN_ID };
            },
        } as unknown as ManufacturingClient;
        const http = new Client({ name: "http-gcode", version: "0" });
        const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
            requestInit: { headers: { authorization: `Bearer ${CALLER}` } },
            fetch: async (url, init) =>
                handleOrthocadMcpHttp(requestWith(url, init), {
                    findCredentialByHash: async (hash) => directory().get(hash) ?? null,
                    toolDeps: { manufacturing },
                    env: { ORTHOCAD_MCP_API_KEY: SHARED, VERCEL_URL: "orthocad.vertexorthopedic.com" },
                }),
        });
        await http.connect(transport);
        const result = await http.callTool({
            name: "generate_gcode",
            arguments: {
                use_saved_design: true,
                design_id: DESIGN_ID,
                preset_id: "apex-v2-insole-95a",
            },
        });
        const text = result.content?.find((block) => block.type === "text" && "text" in block);
        const payload = JSON.parse(text && "text" in text ? text.text : "{}") as {
            files: Array<{ side: string; status: string; production_id: string }>;
        };
        expect(calls).toEqual(["left", "right"]);
        expect(payload.files.map((file) => file.status)).toEqual(["pending", "pending"]);
        expect(JSON.stringify(result)).not.toContain("G1 X0");
        expect(JSON.stringify(result)).not.toContain("Jane Doe");
        expect(JSON.stringify(result)).not.toContain(CALLER);
        await http.close();
    });

    test("narrow design:read still reaches get_design and cannot generate", async () => {
        let reads = 0;
        let generated = 0;
        const integration = {
            getDesign: async () => {
                reads += 1;
                return { design_id: DESIGN_ID };
            },
        } as unknown as IntegrationClient;
        const manufacturing = {
            generateFromSavedDesign: async () => {
                generated += 1;
                return { status: "pending", productionId: DESIGN_ID, side: "left" };
            },
        } as unknown as ManufacturingClient;
        const authorize = async (authorization: string | undefined): Promise<McpAuthDecision> => {
            const token = bearerToken(authorization);
            if (!token) return { ok: false, status: 401, message: "Authentication required" };
            return {
                ok: true,
                apiKey: token,
                principal: {
                    kind: "cad_operator",
                    credentialId: "cred-narrow",
                    tenantId: DOGFOOD_TENANT_ID,
                    scopes: ["design:read"],
                },
            };
        };
        const options = {
            findCredentialByHash: async () => row("cred-narrow", [DOGFOOD_TENANT_ID]),
            authorize,
            toolDeps: { integration, manufacturing },
            env: { ORTHOCAD_MCP_API_KEY: SHARED },
        };
        const allowed = await read(
            await handleOrthocadMcpHttp(
                post(CALLER, {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "tools/call",
                    params: { name: "get_design", arguments: { design_id: DESIGN_ID } },
                }),
                options,
            ),
        );
        expect(allowed.status).toBe(200);
        expect(reads).toBe(1);
        expect(allowed.text).toContain(DESIGN_ID);
        expect(allowed.text).not.toContain(CALLER);

        const denied = await read(
            await handleOrthocadMcpHttp(
                post(CALLER, {
                    jsonrpc: "2.0",
                    id: 2,
                    method: "tools/call",
                    params: {
                        name: "generate_gcode",
                        arguments: {
                            use_saved_design: true,
                            design_id: DESIGN_ID,
                            preset_id: "apex-v2-insole-95a",
                        },
                    },
                }),
                options,
            ),
        );
        expect(denied.status).toBe(403);
        expect(generated).toBe(0);
    });
});

describe("hosted route artifact", () => {
    test("the Vercel bundle matches MCP source and the route does not load a project key", () => {
        const bundlePath = resolve("vertex/server/src/orthocad-mcp.bundled.mjs");
        const routePath = resolve("vertex/api/mcp.ts");
        const bundle = readFileSync(bundlePath, "utf8");
        const route = readFileSync(routePath, "utf8");
        expect(bundle.split("\n")[0]).toBe(`// orthocad-mcp-http-bundle ${orthocadMcpHttpSourceHash()}`);
        expect(route).toContain("export const maxDuration = 60");
        expect(route).toContain("maxDuration: 60");
        expect(route).not.toMatch(/maxDuration:\s*[A-Za-z_]/);
        expect(MCP_FUNCTION_MAX_DURATION_SECONDS).toBe(60);
        expect(route).toContain("findCredentialByHash");
        expect(route).toContain("id: true");
        expect(route).toContain("revokedAt: true");
        expect(route).toContain("tenantId: true");
        expect(route).not.toContain("webhookSecretCiphertext");
        expect(route).not.toMatch(/process\.env\.ORTHOCAD_MCP_API_KEY/);
        expect(route).not.toContain("keyHash: true");
    });
});
