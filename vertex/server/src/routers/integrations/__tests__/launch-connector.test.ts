// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

import { readStoredDesignSettings } from "../../../../../shared/design-settings.js";
import { issueIntegrationCredential } from "../../../auth/integration-keys.js";
import {
    buildDesignExportedEvent,
    DOWNLOAD_URL_TTL_SEC,
    deliverDesignExportedWithRetries,
    nextWebhookRetryAt,
    signDesignExported,
    signDownloadUrl,
    verifyDesignExportedSignature,
    WEBHOOK_RETRY_WINDOW_MS,
} from "../../../webhooks/design-exported.js";
import { createIntegrationHandler } from "../http.js";
import { createMemoryIntegrationStore } from "../memory-store.js";
import type { IntegrationDeps } from "../service.js";
import { createIntegrationService } from "../service.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const UNKNOWN = "33333333-3333-4333-8333-333333333333";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STAFF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function shoe(size = 9) {
    return { system: "US_M" as const, size };
}

function harness() {
    const store = createMemoryIntegrationStore();
    store.addTenant({ id: TENANT_A, name: "Clinic A" });
    store.addTenant({ id: TENANT_B, name: "Clinic B" });
    store.addUser({ id: USER_A, tenantId: TENANT_A, role: "clinician", email: "a@clinic.test" });
    store.addUser({ id: USER_B, tenantId: TENANT_B, role: "clinician", email: "b@clinic.test" });
    store.addUser({ id: STAFF, tenantId: null, role: "super_admin", email: "staff@vertex.test" });
    let now = new Date("2026-11-04T00:00:00.000Z");
    const logs: string[] = [];
    const deps: IntegrationDeps = {
        store,
        now: () => now,
        uploadSigningKey: "test-upload-signing-key",
        uploadBaseUrl: "https://uploads.example.test/put",
        appOrigin: "https://app.example.test",
        log: (_event, fields) => logs.push(JSON.stringify(fields)),
    };
    return {
        store,
        logs,
        deps,
        handler: createIntegrationHandler(deps),
        service: createIntegrationService(deps),
        setNow(value: Date) {
            now = value;
        },
        now: () => now,
    };
}

async function issueKey(env: ReturnType<typeof harness>, tenantIds: string[]) {
    return issueIntegrationCredential(env.store, { label: "caller", tenantIds });
}

function post(env: ReturnType<typeof harness>, path: string, apiKey: string, body: unknown) {
    return env.handler(
        new Request(`https://api.example.test${path}`, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify(body),
        }),
    );
}

async function read(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function clientBody(tenantId: string, externalId = "patient-1", size = 9) {
    return {
        source: "vo2",
        external_client_id: externalId,
        tenant_id: tenantId,
        first_name: "Ada",
        last_name: "Lovelace",
        dob: "1980-01-02",
        shoe_size: shoe(size),
    };
}

describe("launch connector tenant isolation", () => {
    test("a tenant A key cannot read or write tenant B data", async () => {
        const env = harness();
        const keyA = await issueKey(env, [TENANT_A]);
        const keyB = await issueKey(env, [TENANT_B]);
        const createdB = await read(
            await post(
                env,
                "/api/integrations/v1/clients/upsert",
                keyB.apiKey,
                clientBody(TENANT_B, "patient-b"),
            ),
        );
        expect(createdB.status).toBe(200);
        const clientB = String(createdB.body.client_id);
        const designB = await read(
            await post(env, "/api/integrations/v1/designs", keyB.apiKey, {
                source: "vo2",
                tenant_id: TENANT_B,
                client_id: clientB,
                external_order_id: "order-b",
                type: "insole",
                sides: "left",
            }),
        );
        expect(designB.status).toBe(200);
        const designBId = String(designB.body.design_id);
        const scansBefore = await env.store.countScans(designBId);

        const crossUpsert = await read(
            await post(
                env,
                "/api/integrations/v1/clients/upsert",
                keyA.apiKey,
                clientBody(TENANT_B, "patient-b", 12),
            ),
        );
        expect(crossUpsert.status).toBe(403);
        expect(JSON.stringify(crossUpsert.body)).not.toContain(clientB);
        expect((await env.store.findClient(clientB))?.chart.shoe.size).toBe(9);

        const crossDesign = await read(
            await post(env, "/api/integrations/v1/designs", keyA.apiKey, {
                source: "vo2",
                tenant_id: TENANT_B,
                client_id: clientB,
                external_order_id: "order-b",
                type: "afo",
                sides: "right",
            }),
        );
        expect(crossDesign.status).toBe(403);
        expect(crossDesign.body.design_id).toBeUndefined();

        const foreignClient = await read(
            await post(env, "/api/integrations/v1/designs", keyA.apiKey, {
                source: "vo2",
                tenant_id: TENANT_A,
                client_id: clientB,
                external_order_id: "order-stolen",
                type: "insole",
                sides: "pair",
            }),
        );
        expect(foreignClient.status).toBe(404);

        const complete = await read(
            await post(env, `/api/integrations/v1/designs/${designBId}/scans/complete`, keyA.apiKey, {
                scans: [{ side: "left", file_name: "left.stl", format: "stl", size_bytes: 12 }],
            }),
        );
        expect(complete.status).toBe(404);
        expect(await env.store.countScans(designBId)).toBe(scansBefore);

        const launch = await read(
            await post(env, "/api/integrations/v1/launch", keyA.apiKey, { design_id: designBId }),
        );
        expect(launch.status).toBe(404);
        expect(launch.body.url).toBeUndefined();
        expect(JSON.stringify(launch.body)).not.toContain(keyA.apiKey);
    });

    test("an unknown tenant is rejected and no tenant is created", async () => {
        const env = harness();
        const before = await env.store.countTenants();
        const keyA = await issueKey(env, [TENANT_A]);
        const denied = await read(
            await post(env, "/api/integrations/v1/clients/upsert", keyA.apiKey, clientBody(UNKNOWN)),
        );
        expect(denied.status).toBe(403);
        expect(await env.store.countTenants()).toBe(before);

        const dangling = `ocad_${"d".repeat(40)}`;
        await env.store.insertCredential({
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            label: "dangling",
            keyHash: (await import("../../../auth/integration-keys.js")).hashIntegrationKey(dangling),
            tenantIds: [UNKNOWN],
            webhookUrl: null,
            webhookSecretCiphertext: null,
            revokedAt: null,
        });
        const missingRow = await read(
            await post(env, "/api/integrations/v1/clients/upsert", dangling, clientBody(UNKNOWN)),
        );
        expect(missingRow.status).toBe(403);
        expect(missingRow.body.error).toBe("Unknown tenant");
        expect(await env.store.countTenants()).toBe(before);
        await expect(
            issueIntegrationCredential(env.store, { label: "nope", tenantIds: [UNKNOWN] }),
        ).rejects.toThrow(/Refusing to create a tenant/);
        expect(await env.store.countTenants()).toBe(before);
    });
});

describe("launch connector idempotency, launch, and scans", () => {
    test("client and design upserts are idempotent and repeat calls mint fresh upload urls", async () => {
        const env = harness();
        const key = await issueKey(env, [TENANT_A]);
        const first = await read(
            await post(env, "/api/integrations/v1/clients/upsert", key.apiKey, clientBody(TENANT_A)),
        );
        const second = await read(
            await post(
                env,
                "/api/integrations/v1/clients/upsert",
                key.apiKey,
                clientBody(TENANT_A, "patient-1", 9),
            ),
        );
        expect(first.status).toBe(200);
        expect(second.body.client_id).toBe(first.body.client_id);
        const clientId = String(first.body.client_id);

        const designBody = {
            source: "vo2",
            tenant_id: TENANT_A,
            client_id: clientId,
            external_order_id: "order-1",
            type: "insole",
            sides: "pair",
            order_reference: "VO-100",
            ordered_by_account: "Clinic A",
            notes: "rx note",
        };
        const created = await read(await post(env, "/api/integrations/v1/designs", key.apiKey, designBody));
        env.setNow(new Date(env.now().getTime() + 60_000));
        const again = await read(await post(env, "/api/integrations/v1/designs", key.apiKey, designBody));
        expect(created.status).toBe(200);
        expect(again.body.design_id).toBe(created.body.design_id);
        const firstUrls = created.body.upload_urls as { left: string; right: string };
        const secondUrls = again.body.upload_urls as { left: string; right: string };
        expect(firstUrls.left).not.toBe(secondUrls.left);
        expect(firstUrls.right).not.toBe(secondUrls.right);
        const exp = Number(new URL(firstUrls.left).searchParams.get("exp"));
        expect(exp - Math.floor(new Date("2026-11-04T00:00:00.000Z").getTime() / 1000)).toBe(30 * 60);
        expect(JSON.stringify(created.body)).not.toContain(key.apiKey);

        const otherSource = await read(
            await post(env, "/api/integrations/v1/designs", key.apiKey, {
                ...designBody,
                source: "orthocloud",
            }),
        );
        expect(otherSource.body.design_id).not.toBe(created.body.design_id);
    });

    test("createDesign persists bottom textMarking from the linked client name, not rx_text", async () => {
        const env = harness();
        const key = await issueKey(env, [TENANT_A]);
        const client = await read(
            await post(env, "/api/integrations/v1/clients/upsert", key.apiKey, {
                ...clientBody(TENANT_A, "jane-doe-client", 9),
                first_name: "Jane",
                last_name: "Doe",
            }),
        );
        expect(client.status).toBe(200);
        const created = await read(
            await post(env, "/api/integrations/v1/designs", key.apiKey, {
                source: "vo2",
                tenant_id: TENANT_A,
                client_id: String(client.body.client_id),
                external_order_id: "order-text-mark",
                type: "insole",
                sides: "pair",
                rx_text: "Patient name Jane Smith on rx only",
            }),
        );
        expect(created.status).toBe(200);
        const design = await env.store.getDesign(String(created.body.design_id));
        const settings = readStoredDesignSettings(design?.settingsJson);
        expect(settings?.textMarking).toMatchObject({
            text: "JANE DOE",
            surface: "bottom",
            mode: "engrave",
            feet: "both",
        });
    });

    test("shoe size is required, fills an empty chart, and a mismatch does not overwrite the chart", async () => {
        const env = harness();
        const key = await issueKey(env, [TENANT_A]);
        const missing = await read(
            await post(env, "/api/integrations/v1/clients/upsert", key.apiKey, {
                source: "vo2",
                external_client_id: "patient-1",
                tenant_id: TENANT_A,
                first_name: "Ada",
                last_name: "Lovelace",
            }),
        );
        expect(missing.status).toBe(422);
        expect(missing.body.error).toBe("shoe_size is required");

        const created = await read(
            await post(
                env,
                "/api/integrations/v1/clients/upsert",
                key.apiKey,
                clientBody(TENANT_A, "patient-9", 9),
            ),
        );
        const clientId = String(created.body.client_id);
        env.store.setDeclared(clientId, false);
        const filled = await read(
            await post(
                env,
                "/api/integrations/v1/clients/upsert",
                key.apiKey,
                clientBody(TENANT_A, "patient-9", 8),
            ),
        );
        expect(filled.status).toBe(200);
        expect(filled.body.shoe_size_mismatch).toBe(false);
        expect((await env.store.findClient(clientId))?.chart.shoe.size).toBe(8);

        const mismatch = await read(
            await post(env, "/api/integrations/v1/clients/upsert", key.apiKey, {
                ...clientBody(TENANT_A, "patient-9", 11),
                width: "wide",
            }),
        );
        expect(mismatch.body.shoe_size_mismatch).toBe(true);
        expect((await env.store.findClient(clientId))?.chart.shoe.size).toBe(8);
        expect((await env.store.findClient(clientId))?.chart.shoe.width).toBe("medium");

        const design = await read(
            await post(env, "/api/integrations/v1/designs", key.apiKey, {
                source: "vo2",
                tenant_id: TENANT_A,
                client_id: clientId,
                external_order_id: "order-size",
                type: "afo",
                sides: "right",
            }),
        );
        expect(design.body.shoe_size_mismatch).toBe(true);
        const link = await env.store.findDesignLink({
            source: "vo2",
            tenantId: TENANT_A,
            externalOrderId: "order-size",
        });
        expect(link?.shoe.size).toBe(11);
        expect(link?.shoe.width).toBe("wide");
    });

    test("a missing declared scan side is rejected and a completed scan is stored once", async () => {
        const env = harness();
        const key = await issueKey(env, [TENANT_A]);
        const client = await read(
            await post(env, "/api/integrations/v1/clients/upsert", key.apiKey, clientBody(TENANT_A)),
        );
        const missingSide = await read(
            await post(env, "/api/integrations/v1/designs", key.apiKey, {
                source: "vo2",
                tenant_id: TENANT_A,
                client_id: client.body.client_id,
                external_order_id: "order-scan",
                type: "insole",
                sides: "left",
                scans: [{ format: "stl" }],
            }),
        );
        expect(missingSide.status).toBe(422);
        expect(missingSide.body.error).toBe("scan side is required");

        const design = await read(
            await post(env, "/api/integrations/v1/designs", key.apiKey, {
                source: "vo2",
                tenant_id: TENANT_A,
                client_id: client.body.client_id,
                external_order_id: "order-scan",
                type: "insole",
                sides: "left",
                scans: [{ side: "combined" }],
            }),
        );
        const designId = String(design.body.design_id);
        const urls = design.body.upload_urls as { left?: string; combined?: string };
        expect(urls.left).toBeTruthy();
        expect(urls.combined).toBeTruthy();

        const tooBig = await read(
            await post(env, `/api/integrations/v1/designs/${designId}/scans/complete`, key.apiKey, {
                scans: [
                    { side: "left", file_name: "left.stl", format: "stl", size_bytes: 100 * 1024 * 1024 + 1 },
                ],
            }),
        );
        expect(tooBig.status).toBe(422);

        const done = await read(
            await post(env, `/api/integrations/v1/designs/${designId}/scans/complete`, key.apiKey, {
                scans: [
                    { side: "left", file_name: "left.stl", format: "stl", size_bytes: 128 },
                    { side: "combined", file_name: "both.ply", format: "ply", size_bytes: 64 },
                ],
            }),
        );
        expect(done.status).toBe(200);
        const repeat = await read(
            await post(env, `/api/integrations/v1/designs/${designId}/scans/complete`, key.apiKey, {
                scans: [{ side: "left", file_name: "left.stl", format: "stl", size_bytes: 128 }],
            }),
        );
        expect(repeat.status).toBe(200);
        expect(await env.store.countScans(designId)).toBe(1);
    });

    test("a parent order is cloned into a new design and the parent row is not edited", async () => {
        const env = harness();
        const key = await issueKey(env, [TENANT_A]);
        const client = await read(
            await post(env, "/api/integrations/v1/clients/upsert", key.apiKey, clientBody(TENANT_A)),
        );
        const parent = await read(
            await post(env, "/api/integrations/v1/designs", key.apiKey, {
                source: "vo2",
                tenant_id: TENANT_A,
                client_id: client.body.client_id,
                external_order_id: "parent-order",
                type: "insole",
                sides: "pair",
                notes: "keep-me",
            }),
        );
        const parentId = String(parent.body.design_id);
        const before = await env.store.getDesign(parentId);
        const child = await read(
            await post(env, "/api/integrations/v1/designs", key.apiKey, {
                source: "vo2",
                tenant_id: TENANT_A,
                client_id: client.body.client_id,
                external_order_id: "child-order",
                type: "insole",
                sides: "left",
                parent_external_order_id: "parent-order",
            }),
        );
        expect(child.status).toBe(200);
        expect(child.body.design_id).not.toBe(parentId);
        expect(await env.store.getDesign(parentId)).toEqual(before);
        const childLink = await env.store.findDesignLink({
            source: "vo2",
            tenantId: TENANT_A,
            externalOrderId: "child-order",
        });
        expect(childLink?.parentDesignId).toBe(parentId);
        expect(childLink?.parentExternalOrderId).toBe("parent-order");
    });

    test("the launch token expires, is single-use, and never launches as super admin", async () => {
        const env = harness();
        const key = await issueKey(env, [TENANT_A]);
        const client = await read(
            await post(env, "/api/integrations/v1/clients/upsert", key.apiKey, clientBody(TENANT_A)),
        );
        const design = await read(
            await post(env, "/api/integrations/v1/designs", key.apiKey, {
                source: "vo2",
                tenant_id: TENANT_A,
                client_id: client.body.client_id,
                external_order_id: "order-launch",
                type: "insole",
                sides: "pair",
            }),
        );
        const designId = String(design.body.design_id);
        const issued = await read(
            await post(env, "/api/integrations/v1/launch", key.apiKey, { design_id: designId }),
        );
        expect(issued.status).toBe(200);
        const url = String(issued.body.url);
        expect(url.startsWith("https://app.example.test/launch?token=")).toBe(true);
        expect(url).not.toContain(key.apiKey);
        const token = new URL(url).searchParams.get("token") ?? "";

        const clinic = await env.service.redeemLaunch(token, {
            id: USER_A,
            role: "clinician",
            tenantId: TENANT_A,
        });
        expect(clinic.actor?.role).toBe("clinician");
        expect(clinic.actor?.user_id).toBe(USER_A);
        expect(clinic.actor?.tenant_id).toBe(TENANT_A);
        await expect(
            env.service.redeemLaunch(token, { id: USER_A, role: "clinician", tenantId: TENANT_A }),
        ).rejects.toThrow(/already used/);

        const staffIssue = await read(
            await post(env, "/api/integrations/v1/launch", key.apiKey, {
                design_id: designId,
                actor: { kind: "vertex_staff", user_id: STAFF },
            }),
        );
        const staffToken = new URL(String(staffIssue.body.url)).searchParams.get("token") ?? "";
        const staff = await env.service.redeemLaunch(staffToken, {
            id: STAFF,
            role: "super_admin",
            tenantId: null,
        });
        expect(staff.actor?.kind).toBe("vertex_staff");
        expect(staff.actor?.role).toBe("admin");
        expect(staff.actor?.role).not.toBe("super_admin");
        expect(staff.actor?.tenant_id).toBe(TENANT_A);

        const expiring = await read(
            await post(env, "/api/integrations/v1/launch", key.apiKey, { design_id: designId }),
        );
        const expiringToken = new URL(String(expiring.body.url)).searchParams.get("token") ?? "";
        env.setNow(new Date(env.now().getTime() + 5 * 60 * 1000));
        await expect(
            env.service.redeemLaunch(expiringToken, { id: USER_A, role: "clinician", tenantId: TENANT_A }),
        ).rejects.toThrow(/expired/);
    });

    test("the API key is redacted from handler logs", async () => {
        const env = harness();
        const key = await issueKey(env, [TENANT_A]);
        env.store.findCredentialByHash = async () => {
            throw new Error(`database unavailable for ${key.apiKey}`);
        };
        const response = await read(
            await post(env, "/api/integrations/v1/clients/upsert", key.apiKey, clientBody(TENANT_A)),
        );
        expect(response.status).toBe(500);
        expect(JSON.stringify(response.body)).not.toContain(key.apiKey);
        expect(env.logs.join("\n")).not.toContain(key.apiKey);
        expect(env.logs.join("\n")).toContain("[redacted-key]");
    });
});

describe("design.exported webhook", () => {
    test("the signature verifies, rejects replay, and the payload has no order status", async () => {
        const secret = "test-webhook-secret";
        const issuedAt = 1_700_000_000;
        const download = signDownloadUrl(
            "https://files.example.test",
            "exports/left.gcode",
            issuedAt,
            secret,
        );
        const exp = Number(new URL(download).searchParams.get("exp"));
        expect(exp - issuedAt).toBe(DOWNLOAD_URL_TTL_SEC);

        const event = buildDesignExportedEvent({
            id: "evt-1",
            tenantId: TENANT_A,
            designId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            source: "vo2",
            externalOrderId: "order-1",
            files: [
                { side: "left", machine: "mill", format: "gcode", material: "eva", download_url: download },
            ],
        });
        expect(event.type).toBe("design.exported");
        expect(Object.hasOwn(event, "status")).toBe(false);
        expect(JSON.stringify(event)).not.toMatch(/order_status|file_ready|in_production/i);

        const body = JSON.stringify(event);
        const header = signDesignExported(secret, issuedAt, body);
        expect(header.startsWith(`t=${issuedAt},v1=`)).toBe(true);
        expect(verifyDesignExportedSignature(secret, header, body, issuedAt)).toEqual({ ok: true });
        expect(verifyDesignExportedSignature(secret, header, body, issuedAt + 301).ok).toBe(false);
        expect(verifyDesignExportedSignature(secret, header, `${body} `, issuedAt)).toEqual({
            ok: false,
            reason: "signature",
        });

        const waits: number[] = [];
        let posts = 0;
        const delivered = await deliverDesignExportedWithRetries({
            url: "https://hooks.example.test/orthocad",
            secret,
            event,
            timestampSec: issuedAt,
            startedAtMs: 0,
            fetchImpl: async (_url, init) => {
                posts += 1;
                const signature = new Headers(init?.headers).get("X-OrthoCAD-Signature") ?? "";
                const raw = String(init?.body ?? "");
                expect(verifyDesignExportedSignature(secret, signature, raw, issuedAt).ok).toBe(true);
                expect(JSON.parse(raw).status).toBeUndefined();
                return new Response(null, { status: posts === 1 ? 503 : 204 });
            },
            sleep: async (ms) => {
                waits.push(ms);
            },
        });
        expect(delivered.ok).toBe(true);
        expect(waits).toEqual([30_000]);
        expect(nextWebhookRetryAt(1, 0)).toBe(30_000);
        expect(nextWebhookRetryAt(40, 0)).toBeNull();
        expect(WEBHOOK_RETRY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    });
});
