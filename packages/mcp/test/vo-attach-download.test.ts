// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

import type { OrthocadMcpConfig } from "../src/config.js";
import {
    downloadVoAttachFilesForAttempt,
    downloadVoAttachWithBoundedRetries,
    VO_ATTACH_MAX_ATTEMPTS,
} from "../src/payload/vo-attach-files.js";
import { handleOrthocadTool } from "../src/tools/handlers.js";

const config = {
    apiBase: "http://127.0.0.1:9",
    trpcUrl: "http://127.0.0.1:9/trpc",
    apiKey: "ocad_test",
} as OrthocadMcpConfig;

const orderId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const gcodeKey = "gcode/cad-operator/11111111-1111-4111-8111-111111111111/cred/design/left.gcode";

describe("VO attach download and release", () => {
    test("an attach attempt downloads each file once and retries are bounded", async () => {
        const urls: string[] = [];
        const fetchImpl = (async (url: string | URL | Request) => {
            urls.push(String(url));
            return new Response("G1 X0\n", { status: 200 });
        }) as typeof fetch;
        const files = [
            { download_url: "https://files.example.test/left.gcode" },
            { download_url: "https://files.example.test/left.gcode" },
            { content_base64: Buffer.from("G1 X1\n").toString("base64") },
        ];
        const once = await downloadVoAttachFilesForAttempt({ files, attempt: 1, fetchImpl });
        expect(urls).toEqual(["https://files.example.test/left.gcode"]);
        expect(once.get("https://files.example.test/left.gcode")?.byteLength).toBeGreaterThan(0);
        await expect(
            downloadVoAttachFilesForAttempt({ files, attempt: VO_ATTACH_MAX_ATTEMPTS + 1, fetchImpl }),
        ).rejects.toThrow(/attempt/);
        expect(urls).toHaveLength(1);

        let failures = 0;
        const flaky = (async () => {
            failures += 1;
            if (failures < VO_ATTACH_MAX_ATTEMPTS) return new Response("busy", { status: 503 });
            return new Response("G1 X0\n", { status: 200 });
        }) as typeof fetch;
        const retried = await downloadVoAttachWithBoundedRetries({
            files: [{ download_url: "https://files.example.test/left.gcode" }],
            fetchImpl: flaky,
        });
        expect(failures).toBe(VO_ATTACH_MAX_ATTEMPTS);
        expect(Buffer.from(retried.get("https://files.example.test/left.gcode") ?? []).toString("utf8")).toBe(
            "G1 X0\n",
        );

        let exhausted = 0;
        const alwaysDown = (async () => {
            exhausted += 1;
            return new Response("down", { status: 503 });
        }) as typeof fetch;
        await expect(
            downloadVoAttachWithBoundedRetries({
                files: [{ download_url: "https://files.example.test/left.gcode" }],
                fetchImpl: alwaysDown,
            }),
        ).rejects.toThrow(/503/);
        expect(exhausted).toBe(VO_ATTACH_MAX_ATTEMPTS);
    });

    test("confirmed VO attach releases cad-operator G-code and keeps the attach payload", async () => {
        const released: string[] = [];
        const result = await handleOrthocadTool(
            "prepare_vo_attachment",
            {
                order_id: orderId,
                attach_confirmed: true,
                files: [
                    {
                        side: "left",
                        content_base64: Buffer.from("G1 X0\n").toString("base64"),
                        storage_key: gcodeKey,
                    },
                    {
                        side: "right",
                        content_base64: Buffer.from("G1 X1\n").toString("base64"),
                        storage_key: "gcode/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/right.gcode",
                    },
                ],
            },
            {
                config,
                releaseGcodeAfterVoAttach: async (key) => {
                    released.push(key);
                },
            },
        );
        const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
            vo_attach_files: { files: Array<Record<string, unknown>> };
        };
        expect(result.isError).toBeUndefined();
        expect(released).toEqual([gcodeKey]);
        expect(payload.vo_attach_files.files[0]?.download_url).toBeUndefined();
        expect(payload.vo_attach_files.files[0]?.content_base64).toBe(
            Buffer.from("G1 X0\n").toString("base64"),
        );
        expect(payload.vo_attach_files.files[0]).not.toHaveProperty("storage_key");
        expect(JSON.stringify(payload.vo_attach_files)).not.toContain("attach_confirmed");
    });
});
