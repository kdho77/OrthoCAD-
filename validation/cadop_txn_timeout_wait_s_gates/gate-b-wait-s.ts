// Gate B. get_production wait_s long-polls until a terminal state or the deadline,
// cap 300. Omitted or 0 is one fetch. The advertised schema includes wait_s.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LEFT_ID = "11111111-1111-4111-8111-111111111111";
const WAIT_CAP_S = 300;
const POLL_FLOOR_MS = 1_900;
const SINGLE_FETCH_CEILING_MS = 500;

interface WaitField {
    type?: string;
    minimum?: number;
    maximum?: number;
}

export function judgeAdvertisedWaitS(wait: WaitField | undefined, required: string[] | undefined): string[] {
    const problems: string[] = [];
    if (!wait) {
        problems.push("wait_s missing from advertised properties");
        return problems;
    }
    if (wait.type !== "number") problems.push(`wait_s type is ${String(wait.type)} (threshold number)`);
    if (wait.minimum !== 0) problems.push(`wait_s minimum is ${String(wait.minimum)} (threshold 0)`);
    if (wait.maximum !== WAIT_CAP_S)
        problems.push(`wait_s maximum is ${String(wait.maximum)} (threshold ${WAIT_CAP_S})`);
    if ((required ?? []).includes("wait_s")) problems.push("wait_s is required (threshold optional)");
    return problems;
}

export function judgeBundleSchema(schemaSlice: string): string[] {
    const problems: string[] = [];
    if (!schemaSlice.includes("wait_s")) problems.push("bundle getProductionInputSchema has no wait_s");
    if (!schemaSlice.includes(".min(0)")) problems.push("bundle wait_s has no .min(0)");
    if (!schemaSlice.includes(".max(300)")) problems.push("bundle wait_s has no .max(300)");
    return problems;
}

export function judgeBundleHandler(handlerSlice: string): string[] {
    const problems: string[] = [];
    if (!handlerSlice.includes("getProductionWithOptionalWait")) {
        problems.push("bundle get_production does not call getProductionWithOptionalWait");
    }
    if (
        handlerSlice.includes(
            "return publicProductionFromResult(await manufacturing.getProduction(input.production_id))",
        )
    ) {
        problems.push("bundle get_production is a single fetch");
    }
    return problems;
}

function productRoot(): string {
    return resolve(process.env.ORTHOCAD_ROOT ?? new URL("../../", import.meta.url).pathname);
}

function finish(result: { pass: boolean; summary: string; measured: unknown }): void {
    const path = process.env.GATE_RESULT_PATH;
    if (path) writeFileSync(path, JSON.stringify(result, null, 2));
    console.log(result.summary);
}

function selfTest(): number {
    const good = judgeAdvertisedWaitS({ type: "number", minimum: 0, maximum: 300 }, ["production_id"]);
    const missing = judgeAdvertisedWaitS(undefined, ["production_id"]);
    const noBounds = judgeAdvertisedWaitS({ type: "number" }, ["production_id"]);
    const lowCap = judgeAdvertisedWaitS({ type: "number", minimum: 0, maximum: 30 }, ["production_id"]);
    const required = judgeAdvertisedWaitS({ type: "number", minimum: 0, maximum: 300 }, [
        "production_id",
        "wait_s",
    ]);
    const bundleMissing = judgeBundleSchema(
        "var getProductionInputSchema = external_exports.object({\n  production_id: external_exports.string().uuid()\n});",
    );
    const bundleGood = judgeBundleSchema("wait_s: external_exports.number().min(0).max(300).optional()");
    const handlerDropped = judgeBundleHandler(
        "return publicProductionFromResult(await manufacturing.getProduction(input.production_id));",
    );
    const handlerGood = judgeBundleHandler(
        "return getProductionWithOptionalWait(manufacturing, input.production_id, input.wait_s ?? 0);",
    );
    const rejected =
        good.length === 0 &&
        missing.length > 0 &&
        noBounds.length > 0 &&
        lowCap.length > 0 &&
        required.length > 0 &&
        bundleMissing.length > 0 &&
        bundleGood.length === 0 &&
        handlerDropped.length > 0 &&
        handlerGood.length === 0;
    finish({
        pass: rejected,
        summary: rejected
            ? "self-test rejected a missing wait_s field, missing 0–300 bounds, a required wait_s, and a single-fetch handler"
            : "self-test did not reject every bad wait_s advertisement",
        measured: { good, missing, noBounds, lowCap, required, bundleMissing, handlerDropped },
    });
    return rejected ? 0 : 1;
}

function toolJson(result: { content: Array<{ text: string }> }): Record<string, unknown> {
    return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

function readMaxDuration(root: string): { http_function_s: number | null; api_route_s: number | null } {
    const http = readFileSync(resolve(root, "packages/mcp/src/http.ts"), "utf8");
    const route = readFileSync(resolve(root, "vertex/api/mcp.ts"), "utf8");
    const httpMatch = http.match(/MCP_FUNCTION_MAX_DURATION_SECONDS = (\d+)/);
    const routeMatch = route.match(/export const maxDuration = (\d+)/);
    return {
        http_function_s: httpMatch ? Number(httpMatch[1]) : null,
        api_route_s: routeMatch ? Number(routeMatch[1]) : null,
    };
}

async function main(): Promise<number> {
    if (process.argv.includes("--self-test")) return selfTest();

    const root = productRoot();
    const schemasUrl = pathToFileURL(resolve(root, "packages/mcp/src/tools/schemas.ts")).href;
    const handlersUrl = pathToFileURL(resolve(root, "packages/mcp/src/tools/handlers.ts")).href;
    const schemas = await import(schemasUrl);
    const handlers = await import(handlersUrl);
    const problems: string[] = [];

    const tool = schemas.MCP_TOOL_DEFINITIONS.find(
        (item: { name: string }) => item.name === "get_production",
    );
    const jsonSchema = schemas.zodToJsonSchema(tool.inputSchema) as {
        properties?: Record<string, WaitField>;
        required?: string[];
    };
    const wait = jsonSchema.properties?.wait_s;
    problems.push(...judgeAdvertisedWaitS(wait, jsonSchema.required));
    const description = String(tool?.description ?? "");
    if (!/wait_s/i.test(description)) problems.push("tool description does not mention wait_s");
    if (!/0–300|0-300/.test(description)) problems.push("tool description does not state the 0–300 cap");

    const parsed300 = schemas.getProductionInputSchema.safeParse({
        production_id: LEFT_ID,
        wait_s: 300,
    }).success;
    const parsed301 = schemas.getProductionInputSchema.safeParse({
        production_id: LEFT_ID,
        wait_s: 301,
    }).success;
    const parsed0 = schemas.getProductionInputSchema.safeParse({ production_id: LEFT_ID, wait_s: 0 }).success;
    const parsedOmit = schemas.getProductionInputSchema.safeParse({ production_id: LEFT_ID }).success;
    const parsedNeg = schemas.getProductionInputSchema.safeParse({
        production_id: LEFT_ID,
        wait_s: -1,
    }).success;
    if (!parsed300) problems.push("wait_s 300 was rejected (threshold accept)");
    if (parsed301) problems.push("wait_s 301 was accepted (threshold reject)");
    if (!parsed0) problems.push("wait_s 0 was rejected");
    if (!parsedOmit) problems.push("omitted wait_s was rejected");
    if (parsedNeg) problems.push("wait_s -1 was accepted (threshold reject)");

    const bundle = readFileSync(resolve(root, "vertex/server/src/orthocad-mcp.bundled.mjs"), "utf8");
    const schemaStart = bundle.indexOf("var getProductionInputSchema = ");
    const schemaEnd = bundle.indexOf("var listProductionsByDesignInputSchema", schemaStart);
    const schemaSlice =
        schemaStart >= 0 && schemaEnd > schemaStart ? bundle.slice(schemaStart, schemaEnd) : "";
    problems.push(...judgeBundleSchema(schemaSlice));
    const handlerStart = bundle.indexOf('case "get_production"');
    const handlerEnd = bundle.indexOf('case "list_productions_by_design"', handlerStart);
    const handlerSlice =
        handlerStart >= 0 && handlerEnd > handlerStart ? bundle.slice(handlerStart, handlerEnd) : "";
    problems.push(...judgeBundleHandler(handlerSlice));

    const config = {
        apiBase: "http://127.0.0.1:9",
        trpcUrl: "http://127.0.0.1:9/trpc",
        apiKey: "ocad_test",
    };

    let omittedFetches = 0;
    const omittedStarted = Date.now();
    const omitted = await handlers.handleOrthocadTool(
        "get_production",
        { production_id: LEFT_ID },
        {
            config,
            manufacturing: {
                getProduction: async () => {
                    omittedFetches += 1;
                    return { productionId: LEFT_ID, status: "pending", side: "left" };
                },
            },
        },
    );
    const omittedMs = Date.now() - omittedStarted;
    if (omitted.isError) problems.push(`omitted wait_s returned an error: ${omitted.content[0]?.text ?? ""}`);
    if (omittedFetches !== 1) problems.push(`omitted wait_s fetches=${omittedFetches} (threshold 1)`);
    if (omittedMs > SINGLE_FETCH_CEILING_MS)
        problems.push(`omitted wait_s elapsed ${omittedMs} ms (threshold <= ${SINGLE_FETCH_CEILING_MS})`);

    let zeroFetches = 0;
    const zeroStarted = Date.now();
    const zero = await handlers.handleOrthocadTool(
        "get_production",
        { production_id: LEFT_ID, wait_s: 0 },
        {
            config,
            manufacturing: {
                getProduction: async () => {
                    zeroFetches += 1;
                    return { productionId: LEFT_ID, status: "running", side: "left" };
                },
            },
        },
    );
    const zeroMs = Date.now() - zeroStarted;
    if (zero.isError) problems.push("wait_s 0 returned an error");
    if (zeroFetches !== 1) problems.push(`wait_s 0 fetches=${zeroFetches} (threshold 1)`);
    if (zeroMs > SINGLE_FETCH_CEILING_MS)
        problems.push(`wait_s 0 elapsed ${zeroMs} ms (threshold <= ${SINGLE_FETCH_CEILING_MS})`);
    if (toolJson(zero).status !== "running")
        problems.push(`wait_s 0 status=${String(toolJson(zero).status)}`);

    let pollFetches = 0;
    const pollStarted = Date.now();
    const polled = await handlers.handleOrthocadTool(
        "get_production",
        { production_id: LEFT_ID, wait_s: 30 },
        {
            config,
            manufacturing: {
                getProduction: async () => {
                    pollFetches += 1;
                    return {
                        productionId: LEFT_ID,
                        status: pollFetches >= 2 ? "succeeded" : "pending",
                        side: "left",
                        gcodeStorageKey: pollFetches >= 2 ? "gcode/cad-operator/gate/left.gcode" : null,
                    };
                },
            },
        },
    );
    const pollMs = Date.now() - pollStarted;
    const pollStatus = toolJson(polled).status;
    if (polled.isError) problems.push("wait_s 30 returned an error");
    if (pollFetches < 2) problems.push(`wait_s 30 fetches=${pollFetches} (threshold >= 2)`);
    if (pollStatus !== "succeeded")
        problems.push(`wait_s 30 status=${String(pollStatus)} (threshold succeeded)`);
    if (pollMs < POLL_FLOOR_MS)
        problems.push(`wait_s 30 elapsed ${pollMs} ms (threshold >= ${POLL_FLOOR_MS})`);

    let deadlineFetches = 0;
    const deadlineStarted = Date.now();
    const deadline = await handlers.handleOrthocadTool(
        "get_production",
        { production_id: LEFT_ID, wait_s: 1 },
        {
            config,
            manufacturing: {
                getProduction: async () => {
                    deadlineFetches += 1;
                    return { productionId: LEFT_ID, status: "running", side: "left" };
                },
            },
        },
    );
    const deadlineMs = Date.now() - deadlineStarted;
    const deadlineStatus = toolJson(deadline).status;
    if (deadline.isError) problems.push("wait_s 1 returned an error");
    if (deadlineStatus === "succeeded" || deadlineStatus === "failed") {
        problems.push(`wait_s 1 returned terminal ${String(deadlineStatus)} while the row stayed running`);
    }
    if (deadlineMs < 800)
        problems.push(
            `wait_s 1 elapsed ${deadlineMs} ms (threshold >= 800, it must block until the deadline)`,
        );
    if (deadlineStatus !== "running")
        problems.push(`wait_s 1 status=${String(deadlineStatus)} (threshold running)`);

    const hosted = readMaxDuration(root);
    const pass = problems.length === 0;
    const measured = {
        problems,
        advertised: wait ?? null,
        required: jsonSchema.required ?? [],
        parse: {
            wait_s_300: parsed300,
            wait_s_301: parsed301,
            wait_s_0: parsed0,
            omitted: parsedOmit,
            wait_s_neg: parsedNeg,
        },
        omitted: { fetches: omittedFetches, elapsed_ms: omittedMs, status: toolJson(omitted).status ?? null },
        zero: { fetches: zeroFetches, elapsed_ms: zeroMs, status: toolJson(zero).status ?? null },
        long_poll: { fetches: pollFetches, elapsed_ms: pollMs, status: pollStatus ?? null, wait_s: 30 },
        deadline: {
            fetches: deadlineFetches,
            elapsed_ms: deadlineMs,
            status: deadlineStatus ?? null,
            wait_s: 1,
        },
        cap_s: WAIT_CAP_S,
        bundle_schema_has_wait_s: schemaSlice.includes("wait_s"),
        bundle_handler_long_polls: handlerSlice.includes("getProductionWithOptionalWait"),
        hosted_max_duration_s: hosted,
        hosted_max_duration_note:
            "Informational residual. A hosted /api/mcp max duration of 60 s can cut off wait_s 300. This gate grades the handler and the advertised schema, not that platform cap.",
    };
    finish({
        pass,
        summary: pass
            ? `wait_s advertised 0–300; omitted fetches=${omittedFetches}; long-poll fetches=${pollFetches} in ${pollMs} ms; deadline ${deadlineMs} ms; hosted maxDuration ${hosted.api_route_s}s (residual)`
            : (problems[0] ?? "wait_s gate failed"),
        measured,
    });
    return pass ? 0 : 1;
}

main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        finish({
            pass: false,
            summary: message.split("\n")[0] ?? "gate B crashed",
            measured: { crash: message },
        });
        process.exit(1);
    });
