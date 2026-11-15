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
                    gcodeStorageKey: `gcode/cad-operator/design/${input.side}.gcode`,
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
            files: Array<{ side: string; format: string; download_url: string; storage_key: string }>;
        };
        expect(payload.files).toHaveLength(2);
        expect(payload.files.map((file) => file.side)).toEqual(["left", "right"]);
        expect(payload.files.map((file) => file.format)).toEqual(["gcode", "gcode"]);
        expect(payload.files.map((file) => file.storage_key)).toEqual([
            "gcode/cad-operator/design/left.gcode",
            "gcode/cad-operator/design/right.gcode",
        ]);
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

    test("a hardness question is returned before a pair is claimed", async () => {
        let calls = 0;
        const manufacturing = {
            generateFromSavedDesign: async () => {
                calls += 1;
                return {
                    ok: false,
                    ask: "user",
                    relay: "none",
                    questions: [{ field: "hardness", prompt: "Which hardness?" }],
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
        expect(calls).toBe(1);
        const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
            ask?: string;
            relay?: string;
            files?: unknown;
        };
        expect(payload.ask).toBe("user");
        expect(payload.relay).toBe("none");
        expect(payload.files).toBeUndefined();
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

    test("saved-design generate_gcode forwards apex_light and the ApexLight Foam alias", async () => {
        const seen: Array<{ material?: string; presetId?: string }> = [];
        const manufacturing = {
            generateFromSavedDesign: async (input: { material?: string; presetId?: string }) => {
                seen.push({ material: input.material, presetId: input.presetId });
                return { ok: true, productionId: "prod-left", status: "pending" };
            },
        } as unknown as ManufacturingClient;
        const designId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const light = await handleOrthocadTool(
            "generate_gcode",
            {
                preset_id: "apex-v2-insole-95a",
                use_saved_design: true,
                design_id: designId,
                side: "left",
                material: "apex_light",
            },
            { config, manufacturing },
        );
        const foam = await handleOrthocadTool(
            "generate_gcode",
            {
                preset_id: "apex-v2-insole-95a",
                use_saved_design: true,
                design_id: designId,
                side: "left",
                material: "ApexLight Foam",
            },
            { config, manufacturing },
        );
        expect(light.isError).toBeUndefined();
        expect(foam.isError).toBeUndefined();
        expect(seen.map((row) => row.material)).toEqual(["apex_light", "ApexLight Foam"]);
        expect(seen.every((row) => row.presetId === "apex-v2-insole-95a")).toBe(true);
        expect(seen.every((row) => row.material !== "apex_core")).toBe(true);
    });

    test("omitted material is forwarded unset and an omitted preset is not replaced here", async () => {
        const seen: Array<{ material?: string; presetId?: string }> = [];
        const manufacturing = {
            generateFromSavedDesign: async (input: { material?: string; presetId?: string }) => {
                seen.push({ material: input.material, presetId: input.presetId });
                return { ok: true, productionId: "prod-left", status: "pending" };
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "generate_gcode",
            {
                use_saved_design: true,
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                side: "left",
            },
            { config, manufacturing },
        );
        expect(result.isError).toBeUndefined();
        expect(seen).toEqual([{ material: undefined, presetId: undefined }]);
    });

    test("unknown material is rejected and apex_forge is accepted", async () => {
        let calls = 0;
        const manufacturing = {
            generateFromSavedDesign: async () => {
                calls += 1;
                return { ok: true, productionId: "should-not-run", status: "pending" };
            },
        } as unknown as ManufacturingClient;
        const base = {
            preset_id: "apex-v2-insole-95a",
            use_saved_design: true,
            design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            side: "left" as const,
        };
        const unknown = await handleOrthocadTool(
            "generate_gcode",
            { ...base, material: "TPU 95A" },
            { config, manufacturing },
        );
        let forgeMaterial: string | undefined;
        const manufacturingForge = {
            generateFromSavedDesign: async (input: { material?: string }) => {
                forgeMaterial = input.material;
                calls += 1;
                return { ok: true, productionId: "prod-forge", status: "pending" };
            },
        } as unknown as ManufacturingClient;
        const forge = await handleOrthocadTool(
            "generate_gcode",
            { ...base, material: "apex_forge" },
            { config, manufacturing: manufacturingForge },
        );
        const unlocked = await handleOrthocadTool(
            "generate_gcode",
            { ...base, preset_id: "gyroid-production-v1", material: "apex_light" },
            { config, manufacturing },
        );
        expect(calls).toBe(1);
        expect(forgeMaterial).toBe("apex_forge");
        expect(forge.isError).toBeUndefined();
        expect(unknown.isError).toBe(true);
        expect(unknown.content[0]?.text).toMatch(/Unknown print material/);
        expect(unknown.content[0]?.text).toMatch(/Nothing was substituted/);
        expect(unlocked.isError).toBe(true);
        expect(unlocked.content[0]?.text).toMatch(/apex-v2-insole-95a/);
        expect(unlocked.content[0]?.text).toMatch(/not substituted/);
    });
});
