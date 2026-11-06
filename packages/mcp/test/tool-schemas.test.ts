import { describe, expect, test } from "@rstest/core";

import { MCP_TOOL_DEFINITIONS, zodToJsonSchema } from "../src/tools/schemas.js";

describe("OrthoCAD MCP tool schemas", () => {
    test("Phase A exposes eight tools with unique snake_case names", () => {
        const names = MCP_TOOL_DEFINITIONS.map((t) => t.name);
        expect(names).toEqual([
            "get_design",
            "list_designs_by_order",
            "get_design_params",
            "prepare_manufacturing_stl_upload",
            "generate_gcode",
            "get_export_download",
            "build_design_exported_payload",
            "persist_saved_design_snapshot",
        ]);
        expect(new Set(names).size).toBe(names.length);
    });

    test("generate_gcode description references main manufacture path and merged #263 on main", () => {
        const tool = MCP_TOOL_DEFINITIONS.find((t) => t.name === "generate_gcode");
        expect(tool?.description).toMatch(/\/manufacture/);
        expect(tool?.description).toMatch(/70e33f8a/);
        expect(tool?.description).not.toMatch(/open PR #263/i);
    });

    test("generate_gcode advertised JSON schema exposes saved-design and legacy input fields", () => {
        const tool = MCP_TOOL_DEFINITIONS.find((t) => t.name === "generate_gcode");
        expect(tool).toBeTruthy();
        const jsonSchema = zodToJsonSchema(tool!.inputSchema);
        const properties = jsonSchema.properties as Record<string, unknown>;
        expect(properties).toHaveProperty("use_saved_design");
        expect(properties).toHaveProperty("design_id");
        expect(properties).toHaveProperty("side");
        expect(properties).toHaveProperty("preset_id");
        expect(properties).toHaveProperty("stl_storage_key");
        expect(jsonSchema.required).toEqual(expect.arrayContaining(["preset_id"]));
    });

    test("each tool schema accepts a minimal valid payload", () => {
        const samples: Record<string, unknown> = {
            get_design: { design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
            list_designs_by_order: {
                external_order_id: "order-1",
                tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                source: "vo2",
            },
            get_design_params: { design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
            prepare_manufacturing_stl_upload: { side: "left" },
            generate_gcode: {
                preset_id: "gyroid-production-v1",
                stl_storage_key: "manufacturing/tmp/example.stl",
            },
            get_export_download: { production_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
            persist_saved_design_snapshot: {
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                catalog: {
                    arch: "High",
                    flexible_foot: true,
                    elements: [{ name: "mortons_extension", side: "left" }],
                },
                rx_text: "Morton's extension — ignored",
            },
            build_design_exported_payload: {
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                source: "vo2",
                external_order_id: "order-1",
                files: [
                    {
                        side: "left",
                        machine: "vertexslice",
                        format: "gcode",
                        material: "TPU",
                        download_url: "https://files.example.test/left.gcode?exp=1&sig=abc",
                        expires_at: "2026-11-06T00:00:00.000Z",
                        content_type: "application/octet-stream",
                        filename: "left.gcode",
                    },
                ],
            },
        };

        for (const tool of MCP_TOOL_DEFINITIONS) {
            const parsed = tool.inputSchema.safeParse(samples[tool.name]);
            expect(parsed.success, tool.name).toBe(true);
            const jsonSchema = zodToJsonSchema(tool.inputSchema);
            expect(jsonSchema.type).toBe("object");
            expect(jsonSchema.properties).toBeTruthy();
        }
    });
});
