import { describe, expect, test } from "@rstest/core";

import { buildDesignExportedPayload } from "../src/payload/design-exported-payload.js";

describe("build_design_exported_payload", () => {
    test("matches design.exported webhook shape and excludes order status", () => {
        const payload = buildDesignExportedPayload({
            id: "evt-phase-a",
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
                },
            ],
        });

        expect(payload.type).toBe("design.exported");
        expect(payload.design_id).toBe("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
        expect(payload.tenant_id).toBe("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
        expect(payload.external_order_id).toBe("order-42");
        expect(payload.source).toBe("vo2");
        expect(payload.files[0]).toEqual({
            side: "left",
            machine: "vertexslice",
            format: "gcode",
            material: "TPU",
            download_url: "https://files.example.test/gcode/left?exp=99&sig=deadbeef",
        });
        expect(Object.hasOwn(payload, "status")).toBe(false);
        expect(JSON.stringify(payload)).not.toMatch(/order_status|file_ready|in_production/i);
    });
});
