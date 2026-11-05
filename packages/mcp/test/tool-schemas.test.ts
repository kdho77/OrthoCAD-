import { describe, expect, test } from "@rstest/core";

import { MCP_TOOL_DEFINITIONS, zodToJsonSchema } from "../src/tools/schemas.js";

describe("OrthoCAD MCP tool schemas", () => {
    test("Phase A exposes seven tools with unique snake_case names", () => {
        const names = MCP_TOOL_DEFINITIONS.map((t) => t.name);
        expect(names).toEqual([
            "get_design",
            "list_designs_by_order",
            "get_design_params",
            "prepare_manufacturing_stl_upload",
            "generate_gcode",
            "get_export_download",
            "build_design_exported_payload",
        ]);
        expect(new Set(names).size).toBe(names.length);
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
            build_design_exported_payload: {
                id: "evt-1",
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
