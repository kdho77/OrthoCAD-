import { describe, expect, test } from "@rstest/core";

import type { ManufacturingClient } from "../src/clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../src/config.js";
import { handleOrthocadTool } from "../src/tools/handlers.js";
import { createSavedDesignInputSchema, MCP_TOOL_DEFINITIONS } from "../src/tools/schemas.js";

const config = {
    apiBase: "http://127.0.0.1:9",
    trpcUrl: "http://127.0.0.1:9/trpc",
    apiKey: "ocad_test",
} as OrthocadMcpConfig;

const ORDER = "11111111-1111-4111-8111-111111111111";
const CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function toolText(result: { content: Array<{ text: string }> }): string {
    return result.content[0]?.text ?? "";
}

describe("create_saved_design order identity contract", () => {
    test("the input contract confirms an existing binding and rejects caller-asserted identity", () => {
        const tool = MCP_TOOL_DEFINITIONS.find((entry) => entry.name === "create_saved_design");
        expect(tool?.description).toMatch(/does not create a client/i);
        expect(tool?.description).toMatch(/upsert/);
        expect(tool?.description).toMatch(/defaulted/);
        expect(tool?.description).not.toMatch(/Creates the design when that order has none/);
        expect(createSavedDesignInputSchema.safeParse({ external_order_id: ORDER }).success).toBe(true);
        expect(
            createSavedDesignInputSchema.safeParse({
                external_order_id: ORDER,
                client_id: CLIENT,
                patient_name: "ignored",
            }).success,
        ).toBe(true);
        for (const extra of [
            { external_client_id: "chart-1" },
            { first_name: "Ada", last_name: "Lovelace" },
            { tenant_id: CLIENT },
            { source: "vo2" },
        ]) {
            expect(
                createSavedDesignInputSchema.safeParse({ external_order_id: ORDER, ...extra }).success,
                JSON.stringify(extra),
            ).toBe(false);
        }
        expect(
            createSavedDesignInputSchema.safeParse({ external_order_id: ORDER, client_id: "chart-1" })
                .success,
        ).toBe(false);
    });

    test("forwards the order and confirming client and drops the name", async () => {
        let forwarded: { externalOrderId?: string; clientId?: string; catalog?: unknown } | undefined;
        const calls: string[] = [];
        const manufacturing = {
            createSavedDesign: async (input: {
                externalOrderId: string;
                clientId?: string;
                catalog?: unknown;
            }) => {
                calls.push("createSavedDesign");
                forwarded = input;
                return {
                    ok: true,
                    created: false,
                    established: false,
                    identity: "existing_order_binding",
                    design_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    external_order_id: input.externalOrderId,
                    client_id: input.clientId,
                    template: "SAMPLE_Top",
                    scans_used: false,
                    shoe_width: "medium",
                    shoe_width_source: "defaulted",
                    hardness: "Hard",
                    hardness_source: "prescribed",
                };
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "create_saved_design",
            {
                external_order_id: ORDER,
                client_id: CLIENT,
                patient_name: "Not An Identity",
                catalog: { shoe_size: { system: "US_M", size: 10 }, hardness: "Hard" },
            },
            { config, manufacturing },
        );
        expect(result.isError).toBeUndefined();
        expect(calls).toEqual(["createSavedDesign"]);
        expect(forwarded).toEqual({
            externalOrderId: ORDER,
            clientId: CLIENT,
            catalog: { shoe_size: { system: "US_M", size: 10 }, hardness: "Hard" },
        });
        expect(JSON.stringify(forwarded)).not.toMatch(/Not An Identity/);
        const payload = JSON.parse(toolText(result)) as { established?: boolean; hardness?: string };
        expect(payload.established).toBe(false);
        expect(payload.hardness).toBe("Hard");
        expect(toolText(result)).not.toMatch(/pendingCouponValidation|stl/i);
    });

    test("a new order's unbound result is an error and does not invent a client", async () => {
        let calls = 0;
        const manufacturing = {
            createSavedDesign: async () => {
                calls += 1;
                throw new Error(
                    "order_person_unbound: No vo2 dogfood design is linked to this order. This path does not create a client or a design, and it does not call integration client upsert.",
                );
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "create_saved_design",
            { external_order_id: ORDER, client_id: CLIENT, catalog: { hardness: "not-a-hardness" } },
            { config, manufacturing },
        );
        expect(result.isError).toBe(true);
        expect(calls).toBe(1);
        expect(toolText(result)).toMatch(/order_person_unbound/);
        expect(toolText(result)).toMatch(/does not create a client/);
        expect(toolText(result)).not.toMatch(/ask.: .user|pendingCouponValidation/);
    });

    test("a bound refresh still asks for a missing shoe size", async () => {
        const manufacturing = {
            createSavedDesign: async () => {
                throw new Error("422 shoe size is required to loft a saved design. Refusing to invent one.");
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "create_saved_design",
            { external_order_id: ORDER, client_id: CLIENT, catalog: {} },
            { config, manufacturing },
        );
        expect(result.isError).toBeUndefined();
        const payload = JSON.parse(toolText(result)) as {
            ask?: string;
            relay?: string;
            questions?: Array<{ field: string }>;
        };
        expect(payload.ask).toBe("user");
        expect(payload.relay).toBe("none");
        expect(payload.questions?.[0]?.field).toBe("shoe_size");
        expect(toolText(result)).not.toMatch(/pendingCouponValidation/);
    });

    test("a mismatched client is an error and is not turned into a clinical question", async () => {
        const manufacturing = {
            createSavedDesign: async () => {
                throw new Error(
                    "order_client_mismatch: client_id does not match the client already bound to this order. No design was written and the client tenant was not changed.",
                );
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "create_saved_design",
            {
                external_order_id: ORDER,
                client_id: OTHER_CLIENT,
                catalog: { shoe_size: { system: "US_M", size: 10 }, hardness: "Hard" },
            },
            { config, manufacturing },
        );
        expect(result.isError).toBe(true);
        expect(toolText(result)).toMatch(/order_client_mismatch/);
        expect(toolText(result)).not.toMatch(/shoe size is not on this order/i);
    });
});
