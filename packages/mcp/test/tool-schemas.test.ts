import { describe, expect, test } from "@rstest/core";

import {
    ARCH_APEX_SHIFT_MM_MAX,
    ARCH_APEX_SHIFT_MM_MIN,
    ARCH_RAISE_MM_MAX,
    ARCH_RAISE_MM_MIN,
} from "../../../vertex/shared/saved-design-catalog.ts";
import {
    generateGcodeInputObjectSchema,
    MCP_TOOL_DEFINITIONS,
    persistSavedDesignSnapshotInputSchema,
    zodToJsonSchema,
} from "../src/tools/schemas.js";

const designId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("OrthoCAD MCP tool schemas", () => {
    test("Phase A exposes the dogfood tools with unique snake_case names", () => {
        const names = MCP_TOOL_DEFINITIONS.map((t) => t.name);
        expect(names).toEqual([
            "get_design",
            "list_designs_by_order",
            "get_design_params",
            "prepare_manufacturing_stl_upload",
            "generate_gcode",
            "get_production",
            "list_productions_by_design",
            "get_export_download",
            "build_design_exported_payload",
            "persist_saved_design_snapshot",
            "create_saved_design",
            "prepare_vo_attachment",
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
        if (!tool) throw new Error("generate_gcode tool missing");
        expect(tool.inputSchema).toBe(generateGcodeInputObjectSchema);
        const jsonSchema = zodToJsonSchema(tool.inputSchema);
        const properties = jsonSchema.properties as Record<string, unknown>;
        expect(properties).toHaveProperty("use_saved_design");
        expect(properties).toHaveProperty("patient_name");
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
            get_production: { production_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
            list_productions_by_design: {
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                side: "left",
                preset_id: "apex-v2-insole-95a",
            },
            get_export_download: { production_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
            persist_saved_design_snapshot: {
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                catalog: {
                    arch: "High",
                    flexible_foot: true,
                    elements: [{ name: "mortons_extension", side: "left" }],
                    sinks: [{ name: "1st met head", side: "left", depth_mm: 1.5 }],
                },
                rx_text: "Morton's extension — ignored",
            },
            create_saved_design: {
                external_order_id: "order-1",
                client_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                catalog: { shoe_size: { system: "US_M", size: 9 } },
            },
            prepare_vo_attachment: {
                order_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                files: [
                    { side: "left", content_base64: "RzEgWDAK" },
                    { side: "right", content_base64: "RzEgWDEK" },
                ],
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

    test("arch_raise_mm and arch_apex_shift_mm accept the slider bounds and reject outside them", () => {
        const tool = MCP_TOOL_DEFINITIONS.find((entry) => entry.name === "persist_saved_design_snapshot");
        expect(tool?.description).toMatch(/forward\/anterior\/distal/);
        expect(tool?.description).toMatch(/back\/posterior/);
        expect(tool?.description).toContain("arch_raise_mm");
        expect(tool?.description).toContain("arch_apex_shift_mm");
        expect(tool?.description).toContain("−10");
        expect(tool?.description).toContain("14");
        expect(tool?.description).toContain("−12");
        expect(tool?.description).toContain("12");
        const create = MCP_TOOL_DEFINITIONS.find((entry) => entry.name === "create_saved_design");
        expect(create?.description).toMatch(/forward\/anterior/);
        expect(create?.description).toMatch(/back\/posterior/);

        const accept = (catalog: unknown) =>
            persistSavedDesignSnapshotInputSchema.safeParse({ design_id: designId, catalog }).success;
        expect(accept({ arch_raise_mm: 3, arch_apex_shift_mm: 4 })).toBe(true);
        expect(accept({ arch_raise_mm: ARCH_RAISE_MM_MIN, arch_apex_shift_mm: ARCH_APEX_SHIFT_MM_MIN })).toBe(
            true,
        );
        expect(accept({ arch_raise_mm: ARCH_RAISE_MM_MAX, arch_apex_shift_mm: ARCH_APEX_SHIFT_MM_MAX })).toBe(
            true,
        );
        expect(
            accept({
                arch_by_side: {
                    left: { arch_raise_mm: 3, arch_apex_shift_mm: 4 },
                    right: { arch_raise_mm: -10, arch_apex_shift_mm: -12 },
                },
            }),
        ).toBe(true);
        expect(accept({ arch_raise_mm: ARCH_RAISE_MM_MIN - 0.001 })).toBe(false);
        expect(accept({ arch_raise_mm: ARCH_RAISE_MM_MAX + 0.001 })).toBe(false);
        expect(accept({ arch_apex_shift_mm: ARCH_APEX_SHIFT_MM_MIN - 0.001 })).toBe(false);
        expect(accept({ arch_apex_shift_mm: ARCH_APEX_SHIFT_MM_MAX + 0.001 })).toBe(false);
        expect(accept({ arch_raise_mm: Number.NaN })).toBe(false);
        expect(accept({ arch_apex_shift_mm: Number.POSITIVE_INFINITY })).toBe(false);
        expect(accept({ arch_by_side: { right: { arch_apex_shift_mm: 12.001 } } })).toBe(false);
        expect(accept({ arch: "high", flexible_foot: true })).toBe(true);
    });
});
