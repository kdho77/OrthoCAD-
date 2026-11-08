import { describe, expect, test } from "@rstest/core";

import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import { generateIntegrationKey } from "../auth/integration-keys.js";
import { createIntegrationHandler } from "../routers/integrations/http.js";
import { createMemoryIntegrationStore } from "../routers/integrations/memory-store.js";
import type { IntegrationDeps } from "../routers/integrations/service.js";
import type { CredentialRecord } from "../routers/integrations/store.js";
import { buildDesignExportedEvent } from "../webhooks/design-exported.js";
import {
    CURRENT_ORDER_PERSON_INGRESS,
    classifyOrderPersonEvidence,
    type OrderPersonEvidence,
} from "./dogfood-order-person-boundary.js";
import { createDogfoodSavedDesign, type DogfoodSavedDesignStore } from "./dogfood-saved-design.js";

const ORDER = "11111111-1111-4111-8111-111111111111";
const OTHER_ORDER = "12121212-1212-4121-8121-121212121212";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const PERSON = "person-synthetic-1";
const OTHER_PERSON = "person-synthetic-2";

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-dogfood",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

function expectNoWrite(evidence: OrderPersonEvidence, code: string) {
    const decision = classifyOrderPersonEvidence(evidence);
    expect(decision.established).toBe(false);
    expect(decision.writes).toBe("none");
    expect(decision.code).toBe(code);
    return decision;
}

describe("order-person verifier boundary", () => {
    test("the boundary names only the integration routes and the outbound export", () => {
        expect(CURRENT_ORDER_PERSON_INGRESS).toEqual([
            "POST /api/integrations/v1/clients/upsert",
            "POST /api/integrations/v1/designs",
            "POST /api/integrations/v1/launch",
            "GET /api/integrations/v1/designs",
            "design.exported",
        ]);
    });

    test("a proof-shaped new person is not sealed and authorizes no write", () => {
        expectNoWrite(
            {
                kind: "proof_shaped",
                source: "vo2",
                tenantId: DOGFOOD_TENANT_ID,
                externalOrderId: ORDER,
                externalPersonId: PERSON,
                audience: "dogfood-cad",
                proofId: "proof-synthetic-1",
            },
            "order_person_unbound",
        );
    });

    test("an existing person id with a new order is not a verified binding", () => {
        expectNoWrite(
            { kind: "existing_client_link_only", externalClientId: PERSON, externalOrderId: OTHER_ORDER },
            "order_person_unbound",
        );
    });

    test("caller uuid, name, chart id, and external client id are the same unbound result", () => {
        for (const evidence of [
            {
                kind: "cad_operator_request" as const,
                externalOrderId: ORDER,
                clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                externalClientId: PERSON,
                patientName: "Row Fixture",
            },
            {
                kind: "integration_client_upsert" as const,
                source: "vo2",
                tenantId: DOGFOOD_TENANT_ID,
                externalClientId: PERSON,
                firstName: "Row",
                lastName: "Fixture",
            },
            {
                kind: "integration_design_create" as const,
                source: "vo2",
                tenantId: DOGFOOD_TENANT_ID,
                clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                externalOrderId: ORDER,
            },
        ]) {
            expectNoWrite(evidence, "order_person_unbound");
        }
    });

    test("ambiguous persons, replay, substitution, and another tenant authorize nothing", () => {
        expectNoWrite(
            { kind: "ambiguous_persons", externalOrderId: ORDER, personIds: [PERSON, OTHER_PERSON] },
            "order_client_ambiguous",
        );
        expectNoWrite(
            {
                kind: "replayed_proof",
                proofId: "proof-synthetic-1",
                externalOrderId: ORDER,
                externalPersonId: PERSON,
            },
            "order_person_unbound",
        );
        expectNoWrite(
            {
                kind: "substituted_order",
                proofOrderId: ORDER,
                requestedOrderId: OTHER_ORDER,
                externalPersonId: PERSON,
            },
            "order_client_mismatch",
        );
        expectNoWrite(
            {
                kind: "cross_tenant_proof",
                tenantId: OTHER_TENANT,
                externalOrderId: ORDER,
                externalPersonId: PERSON,
            },
            "order_client_cross_tenant",
        );
        expectNoWrite(
            { kind: "integration_launch", designId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
            "order_person_unbound",
        );
    });

    test("the outbound export names an order and no person", () => {
        const event = buildDesignExportedEvent({
            id: "event-synthetic-1",
            tenantId: DOGFOOD_TENANT_ID,
            designId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            source: "vo2",
            externalOrderId: ORDER,
            files: [],
        });
        expect(event).not.toHaveProperty("external_client_id");
        expect(event).not.toHaveProperty("client_id");
        expectNoWrite(
            { kind: "design_exported", externalOrderId: event.external_order_id, personId: null },
            "order_person_unbound",
        );
    });

    test("a missing link still writes nothing when the evidence looks verified", async () => {
        let persists = 0;
        const store: DogfoodSavedDesignStore = {
            async findOrderLinks() {
                return [];
            },
            async findClient() {
                throw new Error("client lookup is not order-person proof");
            },
        };
        await expect(
            createDogfoodSavedDesign({
                principal,
                externalOrderId: ORDER,
                clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                store,
                persist: async () => {
                    persists += 1;
                    throw new Error("persist");
                },
            }),
        ).rejects.toMatchObject({ code: "order_person_unbound" });
        expect(persists).toBe(0);
    });
});

function integrationHarness() {
    const store = createMemoryIntegrationStore();
    store.addTenant({ id: DOGFOOD_TENANT_ID, name: "Dogfood" });
    store.addUser({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        tenantId: DOGFOOD_TENANT_ID,
        role: "clinician",
        email: "cad@dogfood.test",
    });
    let uploadWrites = 0;
    const replace = store.replaceOpenUploads.bind(store);
    store.replaceOpenUploads = async (designLinkId, next) => {
        uploadWrites += 1;
        await replace(designLinkId, next);
    };
    const deps: IntegrationDeps = {
        store,
        now: () => new Date("2026-11-07T00:00:00.000Z"),
        uploadSigningKey: "test-upload-signing-key",
        uploadBaseUrl: "https://uploads.example.test/put",
        appOrigin: "https://app.example.test",
    };
    return { store, uploadWrites: () => uploadWrites, handler: createIntegrationHandler(deps) };
}

async function insertKey(env: ReturnType<typeof integrationHarness>, tenantIds: string[]) {
    const { token, hash } = generateIntegrationKey();
    const row: CredentialRecord = {
        id: "cred-synthetic",
        label: "cad",
        keyHash: hash,
        tenantIds,
        webhookUrl: null,
        webhookSecretCiphertext: null,
        revokedAt: null,
    };
    await env.store.insertCredential(row);
    return token;
}

function call(
    env: ReturnType<typeof integrationHarness>,
    method: string,
    path: string,
    token: string,
    body?: unknown,
) {
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

function clientBody(externalId: string) {
    return {
        source: "vo2",
        external_client_id: externalId,
        tenant_id: DOGFOOD_TENANT_ID,
        first_name: "Row",
        last_name: "Fixture",
        dob: "1980-01-02",
        shoe_size: { system: "US_M" as const, size: 9 },
    };
}

describe("integration ingress is not an order-person verifier", () => {
    test("a repeated design post with another client does not mint uploads or move the link", async () => {
        const env = integrationHarness();
        const token = await insertKey(env, [DOGFOOD_TENANT_ID]);
        const firstClient = await read(
            await call(env, "POST", "/api/integrations/v1/clients/upsert", token, clientBody(PERSON)),
        );
        const secondClient = await read(
            await call(env, "POST", "/api/integrations/v1/clients/upsert", token, clientBody(OTHER_PERSON)),
        );
        expect(firstClient.status).toBe(200);
        expect(secondClient.status).toBe(200);
        const created = await read(
            await call(env, "POST", "/api/integrations/v1/designs", token, {
                source: "vo2",
                tenant_id: DOGFOOD_TENANT_ID,
                client_id: firstClient.body.client_id,
                external_order_id: ORDER,
                type: "insole",
                sides: "pair",
            }),
        );
        expect(created.status).toBe(200);
        expect(env.uploadWrites()).toBe(1);
        const linkBefore = await env.store.findDesignLink({
            source: "vo2",
            tenantId: DOGFOOD_TENANT_ID,
            externalOrderId: ORDER,
        });
        const again = await read(
            await call(env, "POST", "/api/integrations/v1/designs", token, {
                source: "vo2",
                tenant_id: DOGFOOD_TENANT_ID,
                client_id: secondClient.body.client_id,
                external_order_id: ORDER,
                type: "insole",
                sides: "pair",
            }),
        );
        expect(again.status).toBe(403);
        expect(env.uploadWrites()).toBe(1);
        const linkAfter = await env.store.findDesignLink({
            source: "vo2",
            tenantId: DOGFOOD_TENANT_ID,
            externalOrderId: ORDER,
        });
        expect(linkAfter?.clientId).toBe(linkBefore?.clientId);
        expect(linkAfter?.designId).toBe(created.body.design_id);
        const kept = await env.store.findClient(String(linkAfter?.clientId));
        expect(kept?.tenantId).toBe(DOGFOOD_TENANT_ID);
    });

    test("launch without a design establishes no client", async () => {
        const env = integrationHarness();
        const token = await insertKey(env, [DOGFOOD_TENANT_ID]);
        const launch = await read(
            await call(env, "POST", "/api/integrations/v1/launch", token, {
                design_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            }),
        );
        expect(launch.status).toBe(404);
        expect(
            await env.store.findClientLink({
                source: "vo2",
                tenantId: DOGFOOD_TENANT_ID,
                externalClientId: PERSON,
            }),
        ).toBeNull();
        expect(
            await env.store.findDesignLink({
                source: "vo2",
                tenantId: DOGFOOD_TENANT_ID,
                externalOrderId: ORDER,
            }),
        ).toBeNull();
    });

    test("the same order with the same client retries one design", async () => {
        const env = integrationHarness();
        const token = await insertKey(env, [DOGFOOD_TENANT_ID]);
        const client = await read(
            await call(env, "POST", "/api/integrations/v1/clients/upsert", token, clientBody(PERSON)),
        );
        const body = {
            source: "vo2",
            tenant_id: DOGFOOD_TENANT_ID,
            client_id: client.body.client_id,
            external_order_id: ORDER,
            type: "insole",
            sides: "pair",
        };
        const created = await read(await call(env, "POST", "/api/integrations/v1/designs", token, body));
        const again = await read(await call(env, "POST", "/api/integrations/v1/designs", token, body));
        expect(again.status).toBe(200);
        expect(again.body.design_id).toBe(created.body.design_id);
        expect(env.uploadWrites()).toBe(2);
        const links = await env.store.findDesignLink({
            source: "vo2",
            tenantId: DOGFOOD_TENANT_ID,
            externalOrderId: ORDER,
        });
        expect(links?.clientId).toBe(client.body.client_id);
    });

    test("concurrent mismatched posts do not fork the order link", async () => {
        const env = integrationHarness();
        const token = await insertKey(env, [DOGFOOD_TENANT_ID]);
        const firstClient = await read(
            await call(env, "POST", "/api/integrations/v1/clients/upsert", token, clientBody(PERSON)),
        );
        const secondClient = await read(
            await call(env, "POST", "/api/integrations/v1/clients/upsert", token, clientBody(OTHER_PERSON)),
        );
        const created = await read(
            await call(env, "POST", "/api/integrations/v1/designs", token, {
                source: "vo2",
                tenant_id: DOGFOOD_TENANT_ID,
                client_id: firstClient.body.client_id,
                external_order_id: ORDER,
                type: "insole",
                sides: "left",
            }),
        );
        const posts = await Promise.all(
            [secondClient.body.client_id, firstClient.body.client_id].map(async (clientId) =>
                read(
                    await call(env, "POST", "/api/integrations/v1/designs", token, {
                        source: "vo2",
                        tenant_id: DOGFOOD_TENANT_ID,
                        client_id: clientId,
                        external_order_id: ORDER,
                        type: "insole",
                        sides: "left",
                    }),
                ),
            ),
        );
        const statuses = posts.map((post) => post.status).sort();
        expect(statuses).toEqual([200, 403]);
        const link = await env.store.findDesignLink({
            source: "vo2",
            tenantId: DOGFOOD_TENANT_ID,
            externalOrderId: ORDER,
        });
        expect(link?.designId).toBe(created.body.design_id);
        expect(link?.clientId).toBe(firstClient.body.client_id);
    });
});
