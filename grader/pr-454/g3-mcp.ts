// Independent grader: generate_gcode for a pair is two HTTP requests and
// returns after both enqueues, well under the 60s MCP limit.

import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { Client } from "../../packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StreamableHTTPClientTransport } from "../../packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js";
import { handleOrthocadMcpHttp as handleSource } from "../../packages/mcp/src/http.ts";
import { CAD_OPERATOR_SCOPES, DOGFOOD_TENANT_ID } from "../../packages/mcp/src/http-auth.ts";
import { handleOrthocadMcpHttp as handleBundle } from "../../vertex/server/src/orthocad-mcp.bundled.mjs";

const CALLER = "ocad_graderpairkey";
const DESIGN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEFT_ID = "11111111-1111-4111-8111-111111111111";
const RIGHT_ID = "22222222-2222-4222-8222-222222222222";
const HOLD_MS = 2000;
const OUT = fileURLToPath(new URL("./results/g3-report.json", import.meta.url));

interface SeenRequest {
    url: string;
    body: string;
    startedMs: number;
    endedMs: number;
}

async function runPair(label: string, handle: typeof handleSource): Promise<Record<string, unknown>> {
    const seen: SeenRequest[] = [];
    const origin = performance.now();
    const original = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const startedMs = performance.now() - origin;
        let body = "";
        if (typeof init?.body === "string") body = init.body;
        else if (input instanceof Request) body = await input.clone().text();
        await new Promise<void>((resolve) => {
            setTimeout(resolve, HOLD_MS);
        });
        const endedMs = performance.now() - origin;
        const url = input instanceof Request ? input.url : String(input);
        seen.push({ url, body, startedMs, endedMs });
        const side = body.includes('"right"') ? "right" : "left";
        const data = {
            json: {
                ok: true,
                outputType: "gcode",
                productionId: side === "left" ? LEFT_ID : RIGHT_ID,
                status: "pending",
                side,
            },
        };
        return new Response(JSON.stringify([{ result: { data } }]), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };

    const failures: string[] = [];
    try {
        const client = new Client({ name: `grader-${label}`, version: "0" });
        const transport = new StreamableHTTPClientTransport(new URL("https://grader.invalid/api/mcp"), {
            requestInit: { headers: { authorization: `Bearer ${CALLER}` } },
            fetch: async (url, init) => {
                const request = new Request(url, init);
                return handle(request, {
                    authorize: async () => ({
                        ok: true as const,
                        apiKey: CALLER,
                        principal: {
                            kind: "cad_operator" as const,
                            credentialId: "grader-cred",
                            tenantId: DOGFOOD_TENANT_ID,
                            scopes: CAD_OPERATOR_SCOPES,
                        },
                    }),
                    env: {
                        ORTHOCAD_API_BASE: "https://grader.invalid",
                        VERCEL_URL: "grader.invalid",
                    },
                });
            },
        });
        await client.connect(transport);
        const started = performance.now();
        const called = await client.callTool({
            name: "generate_gcode",
            arguments: {
                use_saved_design: true,
                design_id: DESIGN_ID,
                preset_id: "apex-v2-insole-95a",
                force_new_slice: true,
            },
        });
        const elapsedMs = performance.now() - started;
        await client.close();

        const textBlock = Array.isArray(called.content)
            ? called.content.find((block) => block.type === "text" && "text" in block)
            : undefined;
        const text = textBlock && "text" in textBlock ? String(textBlock.text) : "";
        const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        const files = Array.isArray(payload.files) ? payload.files : [];
        const batches = seen.map((entry) => {
            const path = entry.url.split("?")[0] ?? "";
            const procedure = path.split("/trpc/")[1] ?? "";
            const procedures = procedure.split(",").filter(Boolean);
            return procedures.length;
        });
        const overlap =
            seen.length === 2 &&
            seen[0] !== undefined &&
            seen[1] !== undefined &&
            Math.min(seen[0].endedMs, seen[1].endedMs) > Math.max(seen[0].startedMs, seen[1].startedMs);

        if (elapsedMs >= 60_000) failures.push(`${label} took ${elapsedMs.toFixed(0)} ms`);
        if (elapsedMs >= HOLD_MS * 2 - 200)
            failures.push(`${label} looks serial (${elapsedMs.toFixed(0)} ms)`);
        if (seen.length !== 2) failures.push(`${label} sent ${seen.length} HTTP requests`);
        if (batches.some((count) => count !== 1))
            failures.push(`${label} procedures per request ${batches.join(",")}`);
        for (const entry of seen) {
            const left = entry.body.includes('"left"');
            const right = entry.body.includes('"right"');
            if (left === right) failures.push(`${label} request did not carry exactly one foot`);
        }
        if (!seen.some((entry) => entry.body.includes('"left"'))) failures.push(`${label} missing left body`);
        if (!seen.some((entry) => entry.body.includes('"right"')))
            failures.push(`${label} missing right body`);
        if (!overlap) failures.push(`${label} HTTP requests did not overlap`);
        if (
            JSON.stringify(payload).includes("G1") ||
            JSON.stringify(payload).toLowerCase().includes("gcode")
        ) {
            // status objects must not carry toolpath bytes. The word gcode may appear as format.
        }
        const fileDump = JSON.stringify(files);
        if (fileDump.includes("G0") || fileDump.includes("G1"))
            failures.push(`${label} returned toolpath bytes`);
        if (files.length !== 2) failures.push(`${label} returned ${files.length} files`);

        return {
            label,
            elapsedMs,
            requestCount: seen.length,
            batchSizes: batches,
            overlap,
            files,
            payloadKeys: Object.keys(payload),
            failures,
            requests: seen.map((entry) => ({
                url: entry.url.split("?")[0],
                startedMs: entry.startedMs,
                endedMs: entry.endedMs,
                bytes: entry.body.length,
                body: entry.body.slice(0, 240),
            })),
        };
    } finally {
        globalThis.fetch = original;
    }
}

const source = await runPair("source-client", handleSource);
const bundle = await runPair("bundled-client", handleBundle);
const failures = [...((source.failures as string[]) ?? []), ...((bundle.failures as string[]) ?? [])];
mkdirSync(fileURLToPath(new URL("./results", import.meta.url)), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ source, bundle, failures }, null, 2)}\n`);
console.log(`[grader] wrote ${OUT}`);
if (failures.length) {
    for (const failure of failures) console.error(`[grader] FAIL ${failure}`);
    process.exit(1);
}
console.log("[grader] G3 passed");
