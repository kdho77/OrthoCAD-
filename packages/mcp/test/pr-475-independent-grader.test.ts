// Independent grader: MCP pair enqueue gates for PR #475 (do not merge).

import { describe, expect, test } from "@rstest/core";
import type { ManufacturingClient } from "../src/clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../src/config.js";
import { handleOrthocadTool } from "../src/tools/handlers.js";

const config = {
    apiBase: "http://127.0.0.1:9",
    trpcUrl: "http://127.0.0.1:9/trpc",
    apiKey: "ocad_grader",
} as OrthocadMcpConfig;

const designId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const rightId = "33333333-3333-4333-8333-333333333333";

describe("PR #475 MCP pair grader", () => {
    test("a non-transient left failure returns no partial pair and omits the right production id", async () => {
        const manufacturing = {
            generateFromSavedDesign: async (input: { side: "left" | "right" }) => {
                if (input.side === "left") {
                    throw new Error("No valid license for this tenant");
                }
                return { productionId: rightId, status: "pending", side: "right" };
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "generate_gcode",
            {
                preset_id: "apex-v2-insole-95a",
                use_saved_design: true,
                design_id: designId,
            },
            { config, manufacturing },
        );
        expect(result.isError).toBe(true);
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("left");
        expect(text).toContain("No partial pair");
        expect(text).toContain("No valid license");
        expect(text).not.toContain(rightId);
    });
});
