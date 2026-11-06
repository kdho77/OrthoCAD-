import { describe, expect, test } from "@rstest/core";
import { listSavedDesignCatalogKeyPaths } from "../../../vertex/shared/saved-design-catalog.ts";
import type { ManufacturingClient } from "../src/clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../src/config.js";
import { handleOrthocadTool } from "../src/tools/handlers.js";
import {
    listMcpSavedDesignCatalogKeyPaths,
    MCP_TOOL_DEFINITIONS,
    persistSavedDesignSnapshotInputSchema,
} from "../src/tools/schemas.js";

const config = {
    apiBase: "http://127.0.0.1:9",
    trpcUrl: "http://127.0.0.1:9/trpc",
    apiKey: "ocad_test",
} as OrthocadMcpConfig;

const designId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("persist_saved_design_snapshot tool", () => {
    test("catalog keys match the server contract and are documented", () => {
        expect(listMcpSavedDesignCatalogKeyPaths().sort()).toEqual(listSavedDesignCatalogKeyPaths().sort());
        const tool = MCP_TOOL_DEFINITIONS.find((entry) => entry.name === "persist_saved_design_snapshot");
        expect(tool?.description).toMatch(/settingsJson/);
        expect(tool?.description).toMatch(/422/);
        for (const key of listSavedDesignCatalogKeyPaths()) {
            expect(tool?.description, key).toContain(key.split(".").pop());
        }
    });

    test("design_id is required and rx_text is not a clinical field", () => {
        expect(persistSavedDesignSnapshotInputSchema.safeParse({}).success).toBe(false);
        expect(
            persistSavedDesignSnapshotInputSchema.safeParse({
                design_id: designId,
                rx_text: "Morton's extension",
            }).success,
        ).toBe(true);
        expect(
            persistSavedDesignSnapshotInputSchema.safeParse({
                design_id: designId,
                catalog: { invented_mm: 4 },
            }).success,
        ).toBe(false);
    });

    test("forwards design_id and catalog and drops top-level rx_text", async () => {
        let forwarded: { designId?: string; catalog?: unknown } | undefined;
        const manufacturing = {
            persistSavedDesignSnapshot: async (input: { designId: string; catalog?: unknown }) => {
                forwarded = input;
                return { ok: true, design_id: input.designId };
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "persist_saved_design_snapshot",
            {
                design_id: designId,
                rx_text: "Add Morton's extension 6mm and flexible foot",
                notes: "Extra Soft shell",
                catalog: {
                    rx_text: "Morton's",
                    shoe_size: { system: "US_M", size: 9 },
                },
            },
            { config, manufacturing },
        );
        expect(result.isError).toBeUndefined();
        expect(forwarded).toEqual({
            designId,
            catalog: { rx_text: "Morton's", shoe_size: { system: "US_M", size: 9 } },
        });
        expect(JSON.stringify(forwarded)).not.toMatch(/6mm|flexible foot|Extra Soft/);
    });
});
