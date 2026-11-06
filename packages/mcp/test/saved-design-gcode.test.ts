import { describe, expect, test } from "@rstest/core";

import type { ManufacturingClient } from "../src/clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../src/config.js";
import { handleOrthocadTool } from "../src/tools/handlers.js";
import { generateGcodeInputSchema } from "../src/tools/schemas.js";

const config = {
    apiBase: "http://127.0.0.1:9",
    trpcUrl: "http://127.0.0.1:9/trpc",
    apiKey: "ocad_test",
} as OrthocadMcpConfig;

describe("saved-design belt G-code tool", () => {
    test("saved design requires a design id and refuses an STL deliverable", () => {
        expect(
            generateGcodeInputSchema.safeParse({
                preset_id: "apex-v2-insole-95a",
                use_saved_design: true,
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            }).success,
        ).toBe(true);
        expect(
            generateGcodeInputSchema.safeParse({ preset_id: "apex-v2-insole-95a", use_saved_design: true })
                .success,
        ).toBe(false);
        expect(
            generateGcodeInputSchema.safeParse({
                preset_id: "apex-v2-insole-95a",
                use_saved_design: true,
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                output_type: "stl",
            }).success,
        ).toBe(false);
    });

    test("a pair returns two G-code files and no STL", async () => {
        const calls: string[] = [];
        const manufacturing = {
            generateFromSavedDesign: async (input: { side: "left" | "right" }) => {
                calls.push(input.side);
                return {
                    ok: true,
                    outputType: "gcode",
                    productionId: `prod-${input.side}`,
                    gcodeDownloadUrl: `https://files.example.test/${input.side}.gcode`,
                    stlBase64: "should-not-leak",
                };
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "generate_gcode",
            {
                preset_id: "apex-v2-insole-95a",
                use_saved_design: true,
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            },
            { config, manufacturing },
        );
        expect(result.isError).toBeUndefined();
        expect(calls).toEqual(["left", "right"]);
        const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
            files: Array<{ side: string; format: string; download_url: string }>;
        };
        expect(payload.files).toHaveLength(2);
        expect(payload.files.map((file) => file.format)).toEqual(["gcode", "gcode"]);
        expect(result.content[0]?.text).not.toMatch(/stlBase64|should-not-leak|\.stl/);
    });

    test("forwards patient_name to saved-design manufacturing", async () => {
        const seen: Array<{ patientName?: string }> = [];
        const manufacturing = {
            generateFromSavedDesign: async (input: { side: "left" | "right"; patientName?: string }) => {
                seen.push({ patientName: input.patientName });
                return {
                    ok: true,
                    outputType: "gcode",
                    productionId: `prod-${input.side}`,
                    gcodeDownloadUrl: `https://files.example.test/${input.side}.gcode`,
                };
            },
        } as unknown as ManufacturingClient;
        await handleOrthocadTool(
            "generate_gcode",
            {
                preset_id: "apex-v2-insole-95a",
                use_saved_design: true,
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                patient_name: "Jane Doe",
            },
            { config, manufacturing },
        );
        expect(seen).toHaveLength(2);
        expect(seen.every((row) => row.patientName === "Jane Doe")).toBe(true);
    });

    test("a failed right foot is not a successful half pair", async () => {
        const manufacturing = {
            generateFromSavedDesign: async (input: { side: "left" | "right" }) => {
                if (input.side === "right") throw new Error("slice failed");
                return {
                    productionId: "prod-left",
                    downloadUrl: "https://files.example.test/left.gcode",
                };
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "generate_gcode",
            {
                preset_id: "apex-v2-insole-95a",
                use_saved_design: true,
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            },
            { config, manufacturing },
        );
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toMatch(/right foot/);
        expect(result.content[0]?.text).not.toMatch(/prod-left|left\.gcode/);
    });
});
