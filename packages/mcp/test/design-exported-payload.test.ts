import { describe, expect, test } from "@rstest/core";

import { buildDesignExportedPayload } from "../src/payload/design-exported-payload.js";

describe("build_design_exported_payload", () => {
    test("returns exact VO handoff keys and required file metadata", () => {
        const payload = buildDesignExportedPayload({
            design_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            tenant_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            source: "vo2",
            external_order_id: "order-42",
            files: [
                {
                    side: "left",
                    machine: "vertexslice",
                    format: "gcode",
                    material: "TPU",
                    download_url: "https://files.example.test/gcode/left?exp=99&sig=deadbeef",
                    expires_at: "2026-11-06T12:00:00.000Z",
                    content_type: "application/octet-stream",
                    filename: "insole-left.gcode",
                },
            ],
        });

        expect(Object.keys(payload).sort()).toEqual([
            "design_id",
            "external_order_id",
            "files",
            "source",
            "tenant_id",
        ]);
        expect(payload.source).toBe("vo2");
        expect(payload.files[0]).toEqual({
            side: "left",
            machine: "vertexslice",
            format: "gcode",
            material: "TPU",
            download_url: "https://files.example.test/gcode/left?exp=99&sig=deadbeef",
            expires_at: "2026-11-06T12:00:00.000Z",
            content_type: "application/octet-stream",
            filename: "insole-left.gcode",
        });
        expect(Object.hasOwn(payload, "status")).toBe(false);
        expect(Object.hasOwn(payload, "type")).toBe(false);
        expect(JSON.stringify(payload)).not.toMatch(/order_status|file_ready|in_production/i);
    });
});
