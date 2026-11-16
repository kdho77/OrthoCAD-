// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

import type { ManufacturingClient } from "../src/clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../src/config.js";
import { handleOrthocadTool } from "../src/tools/handlers.js";

const config = {
    apiBase: "http://127.0.0.1:9",
    trpcUrl: "http://127.0.0.1:9/trpc",
    apiKey: "ocad_test",
} as OrthocadMcpConfig;

const designId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const productionId = "11111111-1111-4111-8111-111111111111";

function toolJson(result: { content: Array<{ text: string }> }): Record<string, unknown> {
    return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("generate_cnc_gcode", () => {
    test("returns one pair production id and no G-code bytes", async () => {
        const manufacturing = {
            generateCncGcode: async () => ({
                ok: true,
                outputType: "gcode",
                productionId,
                status: "pending",
                side: null,
                sides: ["left", "right"],
                fileExtension: ".gcode",
                gcode: "G1 X0 Y0 ; should-not-leak",
            }),
        } as unknown as ManufacturingClient;

        const enqueued = await handleOrthocadTool(
            "generate_cnc_gcode",
            { design_id: designId },
            { config, manufacturing },
        );
        expect(enqueued.isError).toBeUndefined();
        expect(toolJson(enqueued)).toEqual({
            ok: true,
            format: "gcode",
            file_extension: ".gcode",
            sides: ["left", "right"],
            files: [{ production_id: productionId, status: "pending", sides: ["left", "right"] }],
        });
        expect(enqueued.content[0]?.text).not.toMatch(/should-not-leak|G1 /);
        expect(toolJson(enqueued).files).toHaveLength(1);
    });

    test("a print design error is returned and no file is invented", async () => {
        const manufacturing = {
            generateCncGcode: async () => {
                throw new Error("Print orders are not CNC G-code");
            },
        } as unknown as ManufacturingClient;
        const refused = await handleOrthocadTool(
            "generate_cnc_gcode",
            { design_id: designId },
            { config, manufacturing },
        );
        expect(refused.isError).toBe(true);
        expect(refused.content[0]?.text).toContain("Print orders are not CNC G-code");
        expect(refused.content[0]?.text).not.toContain("production_id");
    });
});
