// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "@rstest/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import { issueIntegrationCredential } from "../../../auth/integration-keys.js";
import {
    createHandoffScanUploadTarget,
    HANDOFF_SCAN_RETAIN_MS,
    isPlaceholderScanUploadUrl,
    SCAN_STORAGE_NOT_CONFIGURED,
    SCAN_UPLOAD_TARGET_FAILED,
} from "../../../lib/scan-upload-target.js";
import { createIntegrationHandler } from "../http.js";
import { createMemoryIntegrationStore } from "../memory-store.js";
import type { IntegrationDeps } from "../service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLACEHOLDER_HOST = "storage.orthocad.invalid";

const ENV_KEYS = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STORAGE_BUCKET",
    "MANUFACTURING_BUCKET",
] as const;

function withEnv(
    patch: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
    run: () => Promise<void>,
) {
    const previous = new Map<string, string | undefined>();
    for (const key of ENV_KEYS) {
        if (!Object.hasOwn(patch, key)) continue;
        previous.set(key, process.env[key]);
        const next = patch[key];
        if (next === undefined) delete process.env[key];
        else process.env[key] = next;
    }
    return run().finally(() => {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

function storageEnv(): Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> {
    return {
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
        STORAGE_BUCKET: "vertex-assets",
        MANUFACTURING_BUCKET: "vertex-manufacturing",
    };
}

function fakeStorage(capture: { bucket?: string; key?: string; calls: number }) {
    return {
        storage: {
            from(bucket: string) {
                capture.bucket = bucket;
                return {
                    async createSignedUploadUrl(key: string) {
                        capture.calls += 1;
                        capture.key = key;
                        return {
                            data: {
                                signedUrl: `https://project.supabase.co/storage/v1/object/upload/sign/${bucket}/${key}?token=short-lived`,
                                token: "short-lived",
                            },
                            error: null,
                        };
                    },
                };
            },
        },
    } as unknown as SupabaseClient;
}

function harness(createScanUploadTarget?: IntegrationDeps["createScanUploadTarget"]) {
    const store = createMemoryIntegrationStore();
    store.addTenant({ id: TENANT, name: "Clinic A" });
    store.addUser({ id: USER, tenantId: TENANT, role: "clinician", email: "a@clinic.test" });
    const logs: { event: string; fields: Record<string, string | number> }[] = [];
    const deps: IntegrationDeps = {
        store,
        now: () => new Date("2026-11-04T00:00:00.000Z"),
        uploadSigningKey: "test-upload-signing-key",
        uploadBaseUrl: `https://${PLACEHOLDER_HOST}/integrations`,
        appOrigin: "https://app.example.test",
        createScanUploadTarget,
        log: (event, fields) => logs.push({ event, fields }),
    };
    return { store, logs, handler: createIntegrationHandler(deps) };
}

async function openDesign(env: ReturnType<typeof harness>) {
    const key = await issueIntegrationCredential(env.store, { label: "caller", tenantIds: [TENANT] });
    const client = await env.handler(
        new Request("https://api.example.test/api/integrations/v1/clients/upsert", {
            method: "POST",
            headers: { authorization: `Bearer ${key.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({
                source: "vo2",
                external_client_id: "patient-1",
                tenant_id: TENANT,
                first_name: "Ada",
                last_name: "Lovelace",
                shoe_size: { system: "US_M", size: 9 },
            }),
        }),
    );
    const clientBody = (await client.json()) as { client_id: string };
    const response = await env.handler(
        new Request("https://api.example.test/api/integrations/v1/designs", {
            method: "POST",
            headers: { authorization: `Bearer ${key.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({
                source: "vo2",
                tenant_id: TENANT,
                client_id: clientBody.client_id,
                external_order_id: "order-scans",
                type: "insole",
                sides: "pair",
                scans: [{ side: "left" }, { side: "right" }],
            }),
        }),
    );
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body, raw: JSON.stringify(body) };
}

describe("VO2 handoff scan upload target", () => {
    test("storage env returns a real signed URL on a tenant scan path", async () => {
        const capture = { calls: 0 };
        await withEnv(storageEnv(), async () => {
            const env = harness((input) =>
                createHandoffScanUploadTarget({ ...input, supabase: fakeStorage(capture) }),
            );
            const result = await openDesign(env);
            expect(result.status).toBe(200);
            const urls = result.body.upload_urls as { left: string; right: string };
            expect(
                urls.left.startsWith(
                    "https://project.supabase.co/storage/v1/object/upload/sign/vertex-assets/scans/",
                ),
            ).toBe(true);
            expect(urls.left).toContain(`${TENANT}/`);
            expect(urls.left).toContain("token=short-lived");
            expect(urls.right).toContain(`${TENANT}/`);
            expect(urls.left).not.toBe(urls.right);
            expect(result.raw).not.toContain(PLACEHOLDER_HOST);
            expect(isPlaceholderScanUploadUrl(urls.left)).toBe(false);
            expect(capture.bucket).toBe("vertex-assets");
            expect(capture.calls).toBe(2);
            expect(capture.key?.startsWith(`scans/${TENANT}/`)).toBe(true);
            expect(capture.key?.includes("manufacturing-temp")).toBe(false);
            expect(capture.key?.endsWith(".stl")).toBe(false);
            expect(capture.key?.includes("gcode")).toBe(false);

            const link = await env.store.findDesignLink({
                source: "vo2",
                tenantId: TENANT,
                externalOrderId: "order-scans",
            });
            const uploads = await env.store.listUploads(link?.id ?? "");
            expect(
                uploads.map((row) => row.storageKey).every((key) => key.startsWith(`scans/${TENANT}/`)),
            ).toBe(true);
            expect(HANDOFF_SCAN_RETAIN_MS).toBe(3 * 365 * 24 * 60 * 60 * 1000);
        });
    });

    test("missing storage env is a logged 500 and never a placeholder URL", async () => {
        const capture = { calls: 0 };
        await withEnv(
            {
                SUPABASE_URL: undefined,
                SUPABASE_SERVICE_ROLE_KEY: undefined,
                STORAGE_BUCKET: undefined,
                MANUFACTURING_BUCKET: undefined,
            },
            async () => {
                const env = harness((input) =>
                    createHandoffScanUploadTarget({ ...input, supabase: fakeStorage(capture) }),
                );
                const result = await openDesign(env);
                expect(result.status).toBe(500);
                expect(result.body.error).toBe(SCAN_STORAGE_NOT_CONFIGURED);
                expect(result.body.upload_urls).toBeUndefined();
                expect(result.raw).not.toContain(PLACEHOLDER_HOST);
                expect(result.raw).not.toContain("https://");
                expect(capture.calls).toBe(0);
                expect(env.logs).toEqual([
                    {
                        event: "handoff_upload_target_failed",
                        fields: {
                            tenantId: TENANT,
                            designId: expect.any(String),
                            side: "left",
                            reason: "scan_storage_not_configured",
                            message: SCAN_STORAGE_NOT_CONFIGURED,
                        },
                    },
                ]);
            },
        );
    });

    test("a storage client that returns the placeholder host is rejected", async () => {
        await withEnv(storageEnv(), async () => {
            const env = harness(async (input) => ({
                storageKey: `scans/${input.tenantId}/${input.designId}/${input.side}/${input.nonce}`,
                uploadUrl: `https://${PLACEHOLDER_HOST}/integrations/${input.tenantId}/${input.nonce}`,
            }));
            const result = await openDesign(env);
            expect(result.status).toBe(500);
            expect(result.body.error).toBe(SCAN_STORAGE_NOT_CONFIGURED);
            expect(result.raw).not.toContain(PLACEHOLDER_HOST);
            expect(env.logs[0]?.event).toBe("handoff_upload_target_failed");
            expect(env.logs[0]?.fields.reason).toBe("scan_storage_not_configured");
        });
    });

    test("a signed-upload failure is a logged 500 and does not invent a URL", async () => {
        await withEnv(storageEnv(), async () => {
            const broken = {
                storage: {
                    from() {
                        return {
                            async createSignedUploadUrl() {
                                return { data: null, error: { message: "Bucket not found" } };
                            },
                        };
                    },
                },
            } as unknown as SupabaseClient;
            const env = harness((input) => createHandoffScanUploadTarget({ ...input, supabase: broken }));
            const result = await openDesign(env);
            expect(result.status).toBe(500);
            expect(result.body.error).toBe(SCAN_UPLOAD_TARGET_FAILED);
            expect(result.raw).not.toContain(PLACEHOLDER_HOST);
            expect(result.raw).not.toContain("https://");
            expect(env.logs[0]?.fields.reason).toBe("sign_failed");
            expect(String(env.logs[0]?.fields.message)).toContain("Bucket not found");
            expect(String(env.logs[0]?.fields.message)).not.toContain("https://");
        });
    });

    test("the manufacturing bucket and a missing admin client are config errors", async () => {
        await withEnv({ ...storageEnv(), STORAGE_BUCKET: "vertex-manufacturing" }, async () => {
            await expect(
                createHandoffScanUploadTarget({
                    tenantId: TENANT,
                    designId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    side: "left",
                    nonce: "abc123",
                    supabase: fakeStorage({ calls: 0 }),
                }),
            ).rejects.toThrow(SCAN_STORAGE_NOT_CONFIGURED);
        });
        await withEnv(storageEnv(), async () => {
            await expect(
                createHandoffScanUploadTarget({
                    tenantId: TENANT,
                    designId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    side: "left",
                    nonce: "abc123",
                    supabase: null,
                }),
            ).rejects.toThrow(SCAN_STORAGE_NOT_CONFIGURED);
        });
    });

    test("production binding does not name the placeholder upload host", () => {
        const source = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), "../production.ts"),
            "utf8",
        );
        expect(source).not.toContain(PLACEHOLDER_HOST);
        expect(source).toContain("createHandoffScanUploadTarget");
        expect(source).toContain("orthocad-handoff");
    });
});
