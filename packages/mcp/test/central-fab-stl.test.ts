import { describe, expect, test } from "@rstest/core";

import { parseSavedDesignCatalog } from "../../../vertex/shared/saved-design-catalog.ts";
import { buildSavedDesignSnapshot } from "../../../vertex/shared/saved-design-snapshot.ts";
import type { ManufacturingClient } from "../src/clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../src/config.js";
import { handleOrthocadMcpHttp } from "../src/http.js";
import { DOGFOOD_TENANT_ID, type McpAuthDecision, type McpCredentialRow } from "../src/http-auth.js";
import { buildVoAttachFilesHandoff, isCentralFabStlStorageKey } from "../src/payload/vo-attach-files.js";
import { handleOrthocadTool } from "../src/tools/handlers.js";

const config = {
    apiBase: "http://127.0.0.1:9",
    trpcUrl: "http://127.0.0.1:9/trpc",
    apiKey: "ocad_test",
} as OrthocadMcpConfig;

const designId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const leftId = "11111111-1111-4111-8111-111111111111";
const rightId = "22222222-2222-4222-8222-222222222222";
const orderId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const credentialId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const tenantId = DOGFOOD_TENANT_ID;
const leftKey = `stl/cad-operator/${tenantId}/${credentialId}/${designId}/left-1-${leftId}.stl`;
const rightKey = `stl/cad-operator/${tenantId}/${credentialId}/${designId}/right-1-${rightId}.stl`;

function toolJson(result: { content: Array<{ text: string }> }): Record<string, unknown> {
    return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("central-fab thickness and STL", () => {
    test("4 mm is stored on both feet and the default snapshot is unchanged when omitted", () => {
        const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: null };
        const omitted = buildSavedDesignSnapshot({ stored, catalog: parseSavedDesignCatalog({}) });
        const thick = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ thickness_mm: 4 }),
        });
        expect(omitted.design.thicknessMm).toBe(2);
        expect(omitted.design.shellThicknessMode).toBe("zonal");
        expect(thick.design.thicknessMm).toBe(4);
        expect(thick.design.shellThicknessMode).toBe("uniform");
        expect(thick.design.paired?.leftThicknessMm).toBe(4);
        expect(thick.design.paired?.rightThicknessMm).toBe(4);
        expect(omitted.design.elements).toEqual(thick.design.elements);
    });

    test("generate, poll, and download return ids and a URL, not STL bytes", async () => {
        let downloads = 0;
        const manufacturing = {
            generateCentralFabStl: async (input: { side: "left" | "right" }) => ({
                ok: true,
                outputType: "stl",
                productionId: input.side === "left" ? leftId : rightId,
                status: "pending",
                side: input.side,
                stlBase64: "should-not-leak",
            }),
            getProduction: async (productionId: string) => ({
                productionId,
                designId,
                side: productionId === leftId ? "left" : "right",
                presetId: "central-fab-stl",
                status: "succeeded",
                createdAt: "2026-11-11T00:00:00.000Z",
                updatedAt: "2026-11-11T00:00:02.000Z",
                gcodeStorageKey: productionId === leftId ? leftKey : rightKey,
                error: null,
                download: { tool: "get_export_download", productionId },
                stlBase64: "should-not-leak",
            }),
            getGcodeDownloadUrl: async (productionId: string) => {
                downloads += 1;
                return {
                    downloadUrl: "https://files.example.test/solid",
                    productionId,
                };
            },
        } as unknown as ManufacturingClient;

        const enqueued = await handleOrthocadTool(
            "generate_central_fab_stl",
            { design_id: designId },
            { config, manufacturing },
        );
        expect(enqueued.isError).toBeUndefined();
        expect(downloads).toBe(0);
        expect(toolJson(enqueued)).toEqual({
            ok: true,
            format: "stl",
            files: [
                { side: "left", production_id: leftId, status: "pending" },
                { side: "right", production_id: rightId, status: "pending" },
            ],
        });
        expect(enqueued.content[0]?.text).not.toMatch(/should-not-leak|\.stl/);

        const polled = await handleOrthocadTool(
            "get_production",
            { production_id: leftId },
            { config, manufacturing },
        );
        expect(toolJson(polled)).toMatchObject({
            production_id: leftId,
            status: "succeeded",
            gcode_storage_key: leftKey,
            download: { tool: "get_export_download", production_id: leftId },
        });
        expect(polled.content[0]?.text).not.toMatch(/should-not-leak/);

        const downloaded = await handleOrthocadTool(
            "get_export_download",
            { production_id: leftId },
            { config, manufacturing },
        );
        expect(downloads).toBe(1);
        expect(toolJson(downloaded)).toEqual({
            downloadUrl: "https://files.example.test/solid",
            productionId: leftId,
        });
    });

    test("prepare_vo_attachment accepts STL only with a central-fab storage key", () => {
        expect(isCentralFabStlStorageKey(leftKey)).toBe(true);
        expect(isCentralFabStlStorageKey("gcode/cad-operator/t/c/d/left.gcode")).toBe(false);
        expect(isCentralFabStlStorageKey("manufacturing-temp/left.stl")).toBe(false);

        const prepared = buildVoAttachFilesHandoff({
            order_id: orderId,
            files: [
                {
                    side: "left",
                    storage_key: leftKey,
                    filename: "left.stl",
                    content_base64: "U1RM",
                },
                {
                    side: "right",
                    storage_key: rightKey,
                    filename: "right.stl",
                    download_url: "https://files.example.test/right",
                    expires_at: "2099-01-01T00:00:00.000Z",
                },
            ],
            now: Date.parse("2026-11-11T00:00:00.000Z"),
        });
        expect(prepared.order_status_written).toBe(false);
        expect(prepared.vo_attach_files).not.toHaveProperty("status");
        expect(prepared.vo_attach_files.files.map((file) => file.format)).toEqual(["stl", "stl"]);
        expect(prepared.vo_attach_files.files.map((file) => file.content_type)).toEqual([
            "model/stl",
            "model/stl",
        ]);
        expect(prepared.vo_attach_files.files.map((file) => file.filename)).toEqual([
            "left.stl",
            "right.stl",
        ]);
        expect(prepared.cad_provenance.files.map((file) => file.storage_key)).toEqual([leftKey, rightKey]);

        expect(() =>
            buildVoAttachFilesHandoff({
                order_id: orderId,
                files: [{ side: "left", content_base64: "U1RM", filename: "left.stl" }],
            }),
        ).toThrow(/STL/);
        expect(() =>
            buildVoAttachFilesHandoff({
                order_id: orderId,
                files: [
                    {
                        side: "left",
                        storage_key: "gcode/cad-operator/t/c/left.gcode",
                        content_base64: "U1RM",
                        filename: "left.stl",
                    },
                ],
            }),
        ).toThrow(/STL/);
    });
});

describe("central-fab STL auth", () => {
    const CALLER = "ocad_callerkeyvalue";

    function post(token: string | null, body: unknown): Request {
        const headers: Record<string, string> = {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
        };
        if (token) headers.authorization = `Bearer ${token}`;
        return new Request("https://orthocad.example/api/mcp", {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
    }

    test("enqueue and download are 401 without a CAD-operator key and 403 without the scope", async () => {
        let generated = 0;
        let downloads = 0;
        const manufacturing = {
            generateCentralFabStl: async () => {
                generated += 1;
                return { productionId: leftId, status: "pending", side: "left", outputType: "stl" };
            },
            getGcodeDownloadUrl: async () => {
                downloads += 1;
                return { downloadUrl: "https://files.example.test/solid", productionId: leftId };
            },
        } as unknown as ManufacturingClient;
        const row = {
            id: credentialId,
            revokedAt: null,
            tenantIds: [DOGFOOD_TENANT_ID],
        } satisfies McpCredentialRow;

        const missing = await handleOrthocadMcpHttp(
            post(null, {
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: {
                    name: "generate_central_fab_stl",
                    arguments: { design_id: designId, side: "left" },
                },
            }),
            { findCredentialByHash: async () => row, toolDeps: { manufacturing } },
        );
        expect(missing.status).toBe(401);
        expect(generated).toBe(0);

        const authorize = async (authorization: string | undefined): Promise<McpAuthDecision> => {
            if (!authorization) return { ok: false, status: 401, message: "Authentication required" };
            return {
                ok: true,
                apiKey: CALLER,
                principal: {
                    kind: "cad_operator",
                    credentialId,
                    tenantId: DOGFOOD_TENANT_ID,
                    scopes: ["design:read"],
                },
            };
        };
        const deniedGenerate = await handleOrthocadMcpHttp(
            post(CALLER, {
                jsonrpc: "2.0",
                id: 2,
                method: "tools/call",
                params: {
                    name: "generate_central_fab_stl",
                    arguments: { design_id: designId, side: "left" },
                },
            }),
            { findCredentialByHash: async () => row, authorize, toolDeps: { manufacturing } },
        );
        expect(deniedGenerate.status).toBe(403);
        expect(generated).toBe(0);

        const deniedDownload = await handleOrthocadMcpHttp(
            post(CALLER, {
                jsonrpc: "2.0",
                id: 3,
                method: "tools/call",
                params: { name: "get_export_download", arguments: { production_id: leftId } },
            }),
            { findCredentialByHash: async () => row, authorize, toolDeps: { manufacturing } },
        );
        expect(deniedDownload.status).toBe(403);
        expect(downloads).toBe(0);
    });
});
