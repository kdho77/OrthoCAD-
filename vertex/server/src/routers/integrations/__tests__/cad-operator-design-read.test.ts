// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

import { DOGFOOD_TENANT_ID } from "../../../auth/cad-operator.js";
import { generateIntegrationKey } from "../../../auth/integration-keys.js";
import { createIntegrationHandler } from "../http.js";
import { createMemoryIntegrationStore } from "../memory-store.js";
import type { IntegrationDeps } from "../service.js";
import type { CredentialRecord } from "../store.js";

const OTHER = "22222222-2222-4222-8222-222222222222";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function harness() {
    const store = createMemoryIntegrationStore();
    store.addTenant({ id: DOGFOOD_TENANT_ID, name: "Dogfood" });
    store.addTenant({ id: OTHER, name: "Other" });
    store.addUser({ id: USER, tenantId: DOGFOOD_TENANT_ID, role: "clinician", email: "cad@dogfood.test" });
    store.addUser({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        tenantId: OTHER,
        role: "clinician",
        email: "b@other.test",
    });
    const deps: IntegrationDeps = {
        store,
        now: () => new Date("2026-11-06T00:00:00.000Z"),
        supabase: {
            storage: {
                from(bucket: string) {
                    return {
                        async createSignedUploadUrl(key: string) {
                            return {
                                data: {
                                    signedUrl: `https://project.supabase.co/storage/v1/object/upload/sign/${bucket}/${key}?token=tok`,
                                    token: "tok",
                                    path: key,
                                },
                                error: null,
                            };
                        },
                    };
                },
            },
        } as IntegrationDeps["supabase"],
        appOrigin: "https://app.example.test",
    };
    return { store, handler: createIntegrationHandler(deps) };
}

let keySerial = 0;

async function insertKey(
    env: ReturnType<typeof harness>,
    tenantIds: string[],
    revokedAt: string | null = null,
) {
    const { token, hash } = generateIntegrationKey();
    keySerial += 1;
    const row: CredentialRecord = {
        id: `cred-${keySerial}`,
        label: "cad",
        keyHash: hash,
        tenantIds,
        webhookUrl: null,
        webhookSecretCiphertext: null,
        revokedAt,
    };
    await env.store.insertCredential(row);
    return token;
}

function call(env: ReturnType<typeof harness>, method: string, path: string, token: string, body?: unknown) {
    return env.handler(
        new Request(`https://api.example.test${path}`, {
            method,
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        }),
    );
}

async function read(response: Response) {
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const clientBody = {
    source: "vo2",
    external_client_id: "chart-1",
    tenant_id: DOGFOOD_TENANT_ID,
    first_name: "Ada",
    last_name: "Lovelace",
    dob: "1980-01-02",
    shoe_size: { system: "US_M", size: 9 },
};

describe("dogfood design GET", () => {
    test("dogfood key reads one design and lists it by order without patient fields", async () => {
        const env = harness();
        const token = await insertKey(env, [DOGFOOD_TENANT_ID]);
        const createdClient = await read(
            await call(env, "POST", "/api/integrations/v1/clients/upsert", token, clientBody),
        );
        expect(createdClient.status).toBe(200);
        const created = await read(
            await call(env, "POST", "/api/integrations/v1/designs", token, {
                source: "vo2",
                tenant_id: DOGFOOD_TENANT_ID,
                client_id: createdClient.body.client_id,
                external_order_id: "order-dogfood",
                type: "insole",
                sides: "pair",
                notes: "rx secret",
                rx_text: "patient detail",
            }),
        );
        expect(created.status).toBe(200);
        const designId = created.body.design_id as string;
        const got = await read(await call(env, "GET", `/api/integrations/v1/designs/${designId}`, token));
        expect(got.status).toBe(200);
        expect(got.body.design_id).toBe(designId);
        expect(got.body.tenant_id).toBe(DOGFOOD_TENANT_ID);
        expect(got.body.external_order_id).toBe("order-dogfood");
        expect(JSON.stringify(got.body)).not.toMatch(/Ada|Lovelace|rx secret|patient detail|ocad_/);

        const listed = await read(
            await call(
                env,
                "GET",
                `/api/integrations/v1/designs?external_order_id=order-dogfood&tenant_id=${DOGFOOD_TENANT_ID}&source=vo2`,
                token,
            ),
        );
        expect(listed.status).toBe(200);
        expect(listed.body.designs).toEqual([got.body]);
    });

    test("cross-tenant ids, other keys, and revoked keys fail closed", async () => {
        const env = harness();
        const dogfood = await insertKey(env, [DOGFOOD_TENANT_ID]);
        const other = await insertKey(env, [OTHER]);
        const revoked = await insertKey(env, [DOGFOOD_TENANT_ID], "2026-11-01T00:00:00.000Z");
        const createdClient = await read(
            await call(env, "POST", "/api/integrations/v1/clients/upsert", dogfood, clientBody),
        );
        const created = await read(
            await call(env, "POST", "/api/integrations/v1/designs", dogfood, {
                source: "vo2",
                tenant_id: DOGFOOD_TENANT_ID,
                client_id: createdClient.body.client_id,
                external_order_id: "order-dogfood",
                type: "insole",
                sides: "left",
            }),
        );
        const designId = created.body.design_id as string;
        expect(
            (await read(await call(env, "GET", `/api/integrations/v1/designs/${designId}`, other))).status,
        ).toBe(401);
        expect(
            (await read(await call(env, "GET", `/api/integrations/v1/designs/${designId}`, revoked))).status,
        ).toBe(401);
        expect(
            (
                await read(
                    await call(
                        env,
                        "GET",
                        `/api/integrations/v1/designs?external_order_id=order-dogfood&tenant_id=${OTHER}&source=vo2`,
                        dogfood,
                    ),
                )
            ).status,
        ).toBe(404);
        const missing = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        expect(
            (await read(await call(env, "GET", `/api/integrations/v1/designs/${missing}`, dogfood))).status,
        ).toBe(404);
        expect(
            (await read(await call(env, "PUT", `/api/integrations/v1/designs/${designId}`, dogfood))).status,
        ).toBe(405);
    });

    test("a non-dogfood key can still POST its own tenant", async () => {
        const env = harness();
        const other = await insertKey(env, [OTHER]);
        const response = await read(
            await call(env, "POST", "/api/integrations/v1/clients/upsert", other, {
                ...clientBody,
                tenant_id: OTHER,
                external_client_id: "other-chart",
            }),
        );
        expect(response.status).toBe(200);
        expect(response.body.client_id).toBeTruthy();
    });
});
