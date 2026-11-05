import { describe, expect, test } from "@rstest/core";
import { buildDesignExportedEvent } from "../../../vertex/server/src/webhooks/design-exported.js";
import { buildDesignExportedPayload } from "../src/payload/design-exported-payload.js";

describe("design.exported payload parity with server helper", () => {
    test("MCP builder matches buildDesignExportedEvent", () => {
        const input = {
            id: "evt-parity",
            design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            source: "vo2" as const,
            external_order_id: "order-parity",
            files: [
                {
                    side: "right",
                    machine: "mill",
                    format: "gcode",
                    material: "eva",
                    download_url: "https://files.example.test/r.gcode",
                },
            ],
        };

        const fromMcp = buildDesignExportedPayload(input);
        const fromServer = buildDesignExportedEvent({
            id: input.id,
            tenantId: input.tenant_id,
            designId: input.design_id,
            source: input.source,
            externalOrderId: input.external_order_id,
            files: input.files,
        });

        expect(fromMcp).toEqual(fromServer);
    });
});
