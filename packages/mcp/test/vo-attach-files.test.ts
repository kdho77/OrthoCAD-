import { describe, expect, test } from "@rstest/core";

import { DOGFOOD_HELD_ID_PREFIXES as SHARED_HOLDS } from "../../../vertex/shared/dogfood-holds.ts";
import { FORBIDDEN_ORDER_STATUSES as SHARED_FORBIDDEN } from "../../../vertex/shared/forbidden-order-status.ts";
import type { ManufacturingClient } from "../src/clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../src/config.js";
import {
    buildVoAttachFilesHandoff,
    DOGFOOD_HELD_ID_PREFIXES,
    FORBIDDEN_ORDER_STATUSES,
} from "../src/payload/vo-attach-files.js";
import { handleOrthocadTool } from "../src/tools/handlers.js";

const config = {
    apiBase: "http://127.0.0.1:9",
    trpcUrl: "http://127.0.0.1:9/trpc",
    apiKey: "ocad_test",
} as OrthocadMcpConfig;

const designId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const files = [
    { side: "right" as const, storage_key: "gcode/cad-operator/design/right.gcode" },
    { side: "left" as const, storage_key: "gcode/cad-operator/design/left.gcode", filename: "Left pair.gcode" },
];

describe("VO attach_files handoff", () => {
    test("status lists stay aligned with the shared guard", () => {
        expect([...FORBIDDEN_ORDER_STATUSES]).toEqual([...SHARED_FORBIDDEN]);
        expect([...DOGFOOD_HELD_ID_PREFIXES]).toEqual([...SHARED_HOLDS]);
    });

    test("same order and storage keys are idempotent and carry no order status", () => {
        const first = buildVoAttachFilesHandoff({ order_id: "order-42", design_id: designId, files });
        const second = buildVoAttachFilesHandoff({
            order_id: "order-42",
            design_id: designId,
            files: [...files].reverse(),
        });
        expect(second).toEqual(first);
        expect(first.files.map((file) => file.side)).toEqual(["left", "right"]);
        expect(first.files[0]).toMatchObject({
            side: "left",
            storage_key: "gcode/cad-operator/design/left.gcode",
            format: "gcode",
            content_type: "text/plain",
        });
        expect(first.idempotency_key).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(first)).not.toMatch(/Production|In Production|Ready to Ship|Shipped|File Ready/);
        expect(Object.keys(first)).not.toContain("status");
    });

    test("a different storage key is a different attachment", () => {
        const first = buildVoAttachFilesHandoff({ order_id: "order-42", design_id: designId, files });
        const next = buildVoAttachFilesHandoff({
            order_id: "order-42",
            design_id: designId,
            files: [{ side: "left", storage_key: "gcode/cad-operator/design/left-2.gcode" }],
        });
        expect(next.idempotency_key).not.toBe(first.idempotency_key);
    });

    test("STL keys and forbidden status text are refused", () => {
        expect(() =>
            buildVoAttachFilesHandoff({
                order_id: "order-42",
                design_id: designId,
                files: [{ side: "left", storage_key: "manufacturing/left.stl" }],
            }),
        ).toThrow(/STL/);
        expect(() =>
            buildVoAttachFilesHandoff({
                order_id: "In Production",
                design_id: designId,
                files: [{ side: "left", storage_key: "gcode/left.gcode" }],
            }),
        ).toThrow(/order status/);
    });

    test("the tool returns the handoff and does not call manufacturing", async () => {
        let called = false;
        const manufacturing = {
            generateFromSavedDesign: async () => {
                called = true;
                return {};
            },
        } as unknown as ManufacturingClient;
        const result = await handleOrthocadTool(
            "prepare_vo_attachment",
            { order_id: "order-42", design_id: designId, files },
            { config, manufacturing },
        );
        expect(called).toBe(false);
        expect(result.isError).toBeUndefined();
        const payload = JSON.parse(result.content[0]?.text ?? "{}") as { order_id: string; files: unknown[] };
        expect(payload.order_id).toBe("order-42");
        expect(payload.files).toHaveLength(2);
    });
});
