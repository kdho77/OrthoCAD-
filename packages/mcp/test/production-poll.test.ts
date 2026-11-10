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
const leftId = "11111111-1111-4111-8111-111111111111";
const rightId = "22222222-2222-4222-8222-222222222222";

function toolJson(result: { content: Array<{ text: string }> }): Record<string, unknown> {
    return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("CAD-operator production tools", () => {
    test("generate_gcode returns a production id per foot without waiting for bytes", async () => {
        let downloads = 0;
        const manufacturing = {
            generateFromSavedDesign: async (input: { side: "left" | "right" }) => ({
                ok: true,
                productionId: input.side === "left" ? leftId : rightId,
                status: "pending",
                side: input.side,
                patientName: "Jane Doe",
                gcode: "G1 X0\n",
            }),
            getGcodeDownloadUrl: async () => {
                downloads += 1;
                return {
                    downloadUrl: "https://files.example.test/should-not-be-called",
                    productionId: leftId,
                };
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "generate_gcode",
            {
                preset_id: "apex-v2-insole-95a",
                use_saved_design: true,
                design_id: designId,
                patient_name: "Jane Doe",
            },
            { config, manufacturing },
        );
        expect(result.isError).toBeUndefined();
        expect(downloads).toBe(0);
        const payload = toolJson(result) as {
            files: Array<{ side: string; production_id: string; status: string; content_base64?: string }>;
        };
        expect(payload.files).toEqual([
            { side: "left", production_id: leftId, status: "pending" },
            { side: "right", production_id: rightId, status: "pending" },
        ]);
        expect(result.content[0]?.text).not.toMatch(/Jane Doe|G1 X0|content_base64/);
    });

    test("an in-flight or succeeded id is returned again, and a failed one can come back pending", async () => {
        const script: Array<{ productionId: string; status: string }> = [
            { productionId: leftId, status: "running" },
            { productionId: leftId, status: "succeeded" },
            { productionId: leftId, status: "failed" },
            { productionId: leftId, status: "pending" },
        ];
        const manufacturing = {
            generateFromSavedDesign: async () => {
                const next = script.shift();
                if (!next) throw new Error("unexpected call");
                return { productionId: next.productionId, status: next.status, side: "left" };
            },
        } as unknown as ManufacturingClient;
        const seen: string[] = [];
        for (let i = 0; i < 4; i += 1) {
            const result = await handleOrthocadTool(
                "generate_gcode",
                {
                    preset_id: "apex-v2-insole-95a",
                    use_saved_design: true,
                    design_id: designId,
                    side: "left",
                },
                { config, manufacturing },
            );
            expect(result.isError).toBeUndefined();
            const payload = toolJson(result) as { files: Array<{ production_id: string; status: string }> };
            expect(payload.files).toHaveLength(1);
            expect(payload.files[0]?.production_id).toBe(leftId);
            seen.push(payload.files[0]?.status ?? "");
        }
        expect(seen).toEqual(["running", "succeeded", "failed", "pending"]);
    });

    test("get_production and list_productions_by_design keep the public contract", async () => {
        const manufacturing = {
            getProduction: async () => ({
                productionId: leftId,
                designId,
                side: "left",
                presetId: "apex-v2-insole-95a",
                status: "succeeded",
                createdAt: "2026-11-09T00:00:00.000Z",
                updatedAt: "2026-11-09T00:01:00.000Z",
                gcodeStorageKey: "gcode/cad-operator/tenant/cred/design/left.gcode",
                error: null,
                patientName: "Jane Doe",
                gcode: "G1 X0\n",
                download: { tool: "get_export_download", productionId: leftId },
            }),
            listProductionsByDesign: async (input: { side?: string; presetId?: string }) => {
                expect(input.side).toBe("left");
                expect(input.presetId).toBe("apex-v2-insole-95a");
                return {
                    productions: [
                        {
                            productionId: leftId,
                            designId,
                            side: "left",
                            presetId: "apex-v2-insole-95a",
                            status: "running",
                            createdAt: "2026-11-09T00:00:00.000Z",
                            updatedAt: "2026-11-09T00:00:01.000Z",
                            gcodeStorageKey: null,
                            error: null,
                            settingsJson: { patient: "Jane Doe" },
                        },
                    ],
                };
            },
            getGcodeDownloadUrl: async (productionId: string) => ({
                downloadUrl: "https://files.example.test/left.gcode",
                productionId,
            }),
        } as unknown as ManufacturingClient;

        const one = await handleOrthocadTool(
            "get_production",
            { production_id: leftId },
            { config, manufacturing },
        );
        expect(one.isError).toBeUndefined();
        expect(toolJson(one)).toEqual({
            production_id: leftId,
            design_id: designId,
            side: "left",
            preset_id: "apex-v2-insole-95a",
            status: "succeeded",
            created_at: "2026-11-09T00:00:00.000Z",
            updated_at: "2026-11-09T00:01:00.000Z",
            gcode_storage_key: "gcode/cad-operator/tenant/cred/design/left.gcode",
            error: null,
            download: { tool: "get_export_download", production_id: leftId },
        });
        expect(one.content[0]?.text).not.toMatch(/Jane Doe|G1 X0/);

        const listed = await handleOrthocadTool(
            "list_productions_by_design",
            { design_id: designId, side: "left", preset_id: "apex-v2-insole-95a" },
            { config, manufacturing },
        );
        const rows = toolJson(listed) as { productions: Array<{ status: string; download: unknown }> };
        expect(rows.productions).toHaveLength(1);
        expect(rows.productions[0]?.status).toBe("running");
        expect(rows.productions[0]?.download).toBeNull();
        expect(listed.content[0]?.text).not.toMatch(/Jane Doe|settingsJson/);

        const download = await handleOrthocadTool(
            "get_export_download",
            { production_id: leftId },
            { config, manufacturing },
        );
        expect(toolJson(download)).toEqual({
            downloadUrl: "https://files.example.test/left.gcode",
            productionId: leftId,
        });
    });
});
