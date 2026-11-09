import { describe, expect, test } from "@rstest/core";

import { DOGFOOD_HELD_ID_PREFIXES as SHARED_HOLDS } from "../../../vertex/shared/dogfood-holds.ts";
import { FORBIDDEN_ORDER_STATUSES as SHARED_FORBIDDEN } from "../../../vertex/shared/forbidden-order-status.ts";
import type { ManufacturingClient } from "../src/clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../src/config.js";
import { voAttachArgumentError } from "../src/payload/vo-attach-contract.js";
import {
    buildVoAttachFilesHandoff,
    DOGFOOD_HELD_ID_PREFIXES,
    FORBIDDEN_ORDER_STATUSES,
    VO_ATTACH_RETRY_PACKET,
} from "../src/payload/vo-attach-files.js";
import { handleOrthocadTool } from "../src/tools/handlers.js";

const config = {
    apiBase: "http://127.0.0.1:9",
    trpcUrl: "http://127.0.0.1:9/trpc",
    apiKey: "ocad_test",
} as OrthocadMcpConfig;

const orderId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const designId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = Date.parse("2026-11-07T12:00:00.000Z");
const leftGcode = Buffer.from("G1 X0\n").toString("base64");
const rightGcode = Buffer.from("G1 X1\n").toString("base64");

function toolJson(result: { content: Array<{ text: string }> }): Record<string, unknown> {
    return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("shipping attach_files contract", () => {
    test("generate_gcode bytes become a live attach_files envelope", async () => {
        const longUrl = `https://files.example.test/${"a".repeat(220)}`;
        const manufacturing = {
            generateFromSavedDesign: async (input: { side: "left" | "right" }) => ({
                ok: true,
                outputType: "gcode",
                productionId: `prod-${input.side}`,
                gcodeDownloadUrl: longUrl,
                gcodeStorageKey: `gcode/cad-operator/${input.side}.gcode`,
                gcode: input.side === "left" ? "G1 X0\n" : "G1 X1\n",
                stlBase64: "should-not-leak",
            }),
        } as unknown as ManufacturingClient;
        const generated = await handleOrthocadTool(
            "generate_gcode",
            {
                preset_id: "apex-v2-insole-95a",
                use_saved_design: true,
                design_id: designId,
                patient_name: "Jane Doe",
                hardness: "Medium",
            },
            { config, manufacturing },
        );
        const produced = toolJson(generated) as {
            files: Array<{ side: string; content_base64: string; storage_key: string; download_url: string }>;
        };
        expect(produced.files.map((file) => file.side)).toEqual(["left", "right"]);
        expect(generated.content[0]?.text).not.toMatch(/should-not-leak|\.stl/);

        const attached = await handleOrthocadTool(
            "prepare_vo_attachment",
            {
                order_id: orderId,
                design_id: designId,
                files: produced.files.map((file) => ({
                    side: file.side,
                    content_base64: file.content_base64,
                    storage_key: file.storage_key,
                    filename: "File Ready",
                })),
            },
            { config, manufacturing },
        );
        expect(attached.isError).toBeUndefined();
        const payload = toolJson(attached) as {
            vo_attach_files: Record<string, unknown> & { files: Array<Record<string, unknown>> };
            cad_provenance: { design_id: string; vo_duplicate_suppression: string; files: Array<{ storage_key: string }> };
            order_status_written: boolean;
        };
        expect(voAttachArgumentError(payload.vo_attach_files, now)).toBeNull();
        expect(Object.keys(payload.vo_attach_files).sort()).toEqual([
            "external_order_id",
            "files",
            "orderId",
            "source",
        ]);
        expect(payload.vo_attach_files.files.map((file) => file.side)).toEqual(["left", "right"]);
        expect(payload.vo_attach_files.files.map((file) => file.filename)).toEqual(["left.gcode", "right.gcode"]);
        for (const key of ["order_id", "storage_key", "idempotency_key", "tenant_id", "design_id", "status"]) {
            expect(payload.vo_attach_files).not.toHaveProperty(key);
        }
        for (const key of ["storage_key", "idempotency_key", "status"]) {
            expect(payload.vo_attach_files.files[0]).not.toHaveProperty(key);
        }
        expect(payload.cad_provenance.design_id).toBe(designId);
        expect(payload.cad_provenance.vo_duplicate_suppression).toBe("unsupported");
        expect(payload.cad_provenance.files.map((file) => file.storage_key)).toEqual([
            "gcode/cad-operator/left.gcode",
            "gcode/cad-operator/right.gcode",
        ]);
        expect(payload.order_status_written).toBe(false);
        expect(payload.vo_attach_files).not.toHaveProperty("status");
    });

    test("the same bytes replay locally and are not a VO dedupe key", () => {
        const input = {
            order_id: orderId,
            design_id: designId,
            files: [
                { side: "right" as const, content_base64: rightGcode, storage_key: "gcode/right.gcode" },
                { side: "left" as const, content_base64: leftGcode, storage_key: "gcode/left.gcode" },
            ],
            now,
        };
        const first = buildVoAttachFilesHandoff(input);
        const second = buildVoAttachFilesHandoff(input);
        expect(second.vo_attach_files).toEqual(first.vo_attach_files);
        expect(second.cad_provenance.cad_replay_sha256).toBe(first.cad_provenance.cad_replay_sha256);
        expect(first.cad_provenance.vo_duplicate_suppression).toBe("unsupported");
        expect(first.vo_attach_files).not.toHaveProperty("idempotency_key");
        expect(VO_ATTACH_RETRY_PACKET.publicSchemaHasIdempotencyKey).toBe(false);
        expect(VO_ATTACH_RETRY_PACKET.proposedPublicField.name).toBe("upload_id");
    });

    test("a long or expired signed URL is rejected and a short https URL is accepted", () => {
        const longUrl = `https://files.example.test/${"a".repeat(180)}`;
        expect(longUrl.length).toBeGreaterThan(200);
        expect(() =>
            buildVoAttachFilesHandoff({
                order_id: orderId,
                files: [{ side: "left", download_url: longUrl, expires_at: "2099-01-01T00:00:00.000Z" }],
                now,
            }),
        ).toThrow(/200/);
        expect(() =>
            buildVoAttachFilesHandoff({
                order_id: orderId,
                files: [
                    {
                        side: "left",
                        download_url: "https://files.example.test/left.gcode",
                        expires_at: "2020-01-01T00:00:00.000Z",
                    },
                ],
                now,
            }),
        ).toThrow(/expired/);
        const accepted = buildVoAttachFilesHandoff({
            order_id: orderId,
            files: [
                {
                    side: "left",
                    download_url: "https://files.example.test/left.gcode",
                    expires_at: "2099-01-01T00:00:00.000Z",
                },
            ],
            now,
        });
        expect(voAttachArgumentError(accepted.vo_attach_files, now)).toBeNull();
        expect(accepted.vo_attach_files.files[0]).not.toHaveProperty("content_base64");
    });

    test("unsupported fields, missing bytes, and both transports fail closed", () => {
        expect(
            voAttachArgumentError({
                order_id: orderId,
                idempotency_key: "abc",
                files: [{ side: "left", storage_key: "gcode/left.gcode" }],
            }),
        ).toMatch(/Unexpected attach_files field/);
        expect(
            voAttachArgumentError({
                orderId,
                source: "vo2",
                files: [{ side: "left", storage_key: "gcode/left.gcode", content_base64: leftGcode }],
            }),
        ).toBe("Unexpected file field");
        expect(() =>
            buildVoAttachFilesHandoff({
                order_id: orderId,
                files: [{ side: "left", storage_key: "gcode/left.gcode" }],
            }),
        ).toThrow(/storage_key is not attachable bytes/);
        expect(() =>
            buildVoAttachFilesHandoff({
                order_id: orderId,
                files: [{ side: "left", content_base64: leftGcode, download_url: "https://files.example.test/a.gcode" }],
            }),
        ).toThrow(/not both/);
        expect(() =>
            buildVoAttachFilesHandoff({
                order_id: orderId,
                files: [{ side: "left", download_url: "http://files.example.test/left.gcode" }],
            }),
        ).toThrow(/https/);
        expect(() =>
            buildVoAttachFilesHandoff({
                order_id: orderId,
                files: [{ side: "left", content_base64: leftGcode, filename: "left.stl" }],
            }),
        ).toThrow(/STL/);
    });
});

describe("VO reference retry semantics", () => {
    function batch(
        uploadId: string,
        failAt: number | null,
        store: Map<string, true>,
    ): { ok: boolean; saved: string[] } {
        const saved: string[] = [];
        for (let index = 0; index < 2; index += 1) {
            const key = `${uploadId}:${index}`;
            if (store.has(key)) {
                saved.push(`${key}:already`);
                continue;
            }
            if (failAt === index) return { ok: false, saved };
            store.set(key, true);
            saved.push(`${key}:new`);
        }
        return { ok: true, saved };
    }

    test("a partial batch is reused only when the same upload id is supplied", () => {
        const store = new Map<string, true>();
        const failed = batch("upload-a", 1, store);
        expect(failed).toEqual({ ok: false, saved: ["upload-a:0:new"] });
        const otherId = batch("upload-b", null, store);
        expect(otherId.saved).toEqual(["upload-b:0:new", "upload-b:1:new"]);
        const sameId = batch("upload-a", null, store);
        expect(sameId.saved).toEqual(["upload-a:0:already", "upload-a:1:new"]);
        expect(VO_ATTACH_RETRY_PACKET.acceptance.some((line) => /same upload_id/.test(line))).toBe(true);
    });
});

describe("status and hold guards", () => {
    test("status lists stay aligned and are not attachment fields", () => {
        expect([...FORBIDDEN_ORDER_STATUSES]).toEqual([...SHARED_FORBIDDEN]);
        expect([...DOGFOOD_HELD_ID_PREFIXES]).toEqual([...SHARED_HOLDS]);
        const prepared = buildVoAttachFilesHandoff({
            order_id: orderId,
            files: [{ side: "left", content_base64: leftGcode, filename: "left file ready.gcode" }],
            now,
        });
        expect(prepared.vo_attach_files.files[0]?.filename).toBe("left file ready.gcode");
        expect(prepared.order_status_written).toBe(false);
        expect(prepared.vo_attach_files).not.toHaveProperty("design_id");
        expect(prepared.vo_attach_files).not.toHaveProperty("tenant_id");
    });
});
