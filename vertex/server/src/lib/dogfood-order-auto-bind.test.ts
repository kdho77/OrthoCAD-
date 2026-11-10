// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";

import { DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import { generateIntegrationKey } from "../auth/integration-keys.js";
import { createIntegrationHandler } from "../routers/integrations/http.js";
import { createMemoryIntegrationStore } from "../routers/integrations/memory-store.js";
import type { IntegrationDeps } from "../routers/integrations/service.js";
import type { CredentialRecord, IntegrationStore, ShoeWidth } from "../routers/integrations/store.js";
import {
    autoBindDogfoodOrder,
    DOGFOOD_ORDER_AUTO_BIND_PRODUCER_NAME_FIELDS,
    DogfoodOrderAutoBindUnconfiguredError,
    runtimeAutoBindDogfoodOrder,
} from "./dogfood-order-auto-bind.js";
import { DOGFOOD_ORDER_OWNER_CONFIG_KEYS } from "./dogfood-order-owner-wire.js";
import type { OrderPersonVerifier } from "./dogfood-order-person-verifier.js";
import { VO_ORDER_OWNER_PRINCIPAL } from "./dogfood-order-person-verifier.js";
import {
    type DogfoodPersonShoe,
    type DogfoodSavedDesignStore,
    dogfoodOrderIdentityDetail,
    type EstablishVerifiedOrderInput,
    type EstablishVerifiedOrderResult,
} from "./dogfood-saved-design.js";

const NOW = new Date("2026-11-09T18:00:00.000Z");
const ORDER = "11111111-1111-4111-8111-111111111111";
const PERSON = "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1";
const CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = "abababab-abab-4aba-8aba-abababababab";
const OTHER = "22222222-2222-4222-8222-222222222222";

interface PersonRow {
    externalPersonId: string;
    clientId: string;
    givenName: string;
    familyName: string;
    shoe?: DogfoodPersonShoe;
}

interface OrderRow {
    externalOrderId: string;
    designId: string;
    clientId: string;
    shoeWidth: string;
}

function accepting(
    personId: string,
    names: { givenName?: string | null; familyName?: string | null } = {},
): OrderPersonVerifier {
    return {
        async verify(request) {
            return {
                ok: true,
                principal: VO_ORDER_OWNER_PRINCIPAL,
                source: "vo2",
                tenantId: DOGFOOD_TENANT_ID,
                externalOrderId: request.externalOrderId,
                externalPersonId: personId,
                audience: "dogfood-saved-design",
                operation: "bind-order-person",
                verifiedAt: NOW.toISOString(),
                givenName: names.givenName ?? null,
                familyName: names.familyName ?? null,
            };
        },
    };
}

function memory(seed?: { people?: PersonRow[]; orders?: OrderRow[]; conflictOnce?: boolean }) {
    const people = [...(seed?.people ?? [])];
    const orders = [...(seed?.orders ?? [])];
    const widths: string[] = [];
    const settings: unknown[] = [];
    let lookups = 0;
    let conflictArmed = seed?.conflictOnce ?? false;
    let chain: Promise<void> = Promise.resolve();
    const run = async <T>(fn: () => T | Promise<T>): Promise<T> => {
        const previous = chain;
        let release: () => void = () => {};
        chain = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await fn();
        } finally {
            release();
        }
    };
    const store: DogfoodSavedDesignStore = {
        async findOrderLinks(externalOrderId) {
            lookups += 1;
            return orders
                .filter((row) => row.externalOrderId === externalOrderId)
                .slice(0, 2)
                .map((row) => ({ designId: row.designId, clientId: row.clientId }));
        },
        async findClient(clientId) {
            if (
                !people.some((row) => row.clientId === clientId) &&
                !orders.some((row) => row.clientId === clientId)
            ) {
                return null;
            }
            return { id: clientId, ownerId: OWNER, tenantId: DOGFOOD_TENANT_ID };
        },
        async findPersonLinks(externalPersonId) {
            return people
                .filter((row) => row.externalPersonId === externalPersonId)
                .slice(0, 2)
                .map((row) => ({
                    clientId: row.clientId,
                    givenName: row.givenName,
                    familyName: row.familyName,
                    shoe: row.shoe,
                }));
        },
        async establishVerifiedOrder(input) {
            return run(() => commit(input));
        },
    };
    function commit(input: EstablishVerifiedOrderInput): EstablishVerifiedOrderResult {
        widths.push(input.linkShoeWidth, input.chartWidth);
        settings.push(input.settingsJson);
        const person = people.find((row) => row.externalPersonId === input.externalPersonId);
        const order = orders.find((row) => row.externalOrderId === input.externalOrderId);
        if (order && (!person || order.clientId !== person.clientId)) return { outcome: "mismatch" };
        if (order && person)
            return { outcome: "exists", clientId: person.clientId, designId: order.designId };
        if (conflictArmed) {
            conflictArmed = false;
            const clientId = person?.clientId ?? randomUUID();
            if (!person) {
                people.push({
                    externalPersonId: input.externalPersonId,
                    clientId,
                    givenName: input.givenName,
                    familyName: input.familyName,
                });
            }
            const designId = randomUUID();
            orders.push({
                externalOrderId: input.externalOrderId,
                designId,
                clientId,
                shoeWidth: input.linkShoeWidth,
            });
            return { outcome: "conflict" };
        }
        const clientId = person?.clientId ?? randomUUID();
        if (!person) {
            people.push({
                externalPersonId: input.externalPersonId,
                clientId,
                givenName: input.givenName,
                familyName: input.familyName,
            });
        }
        const designId = randomUUID();
        orders.push({
            externalOrderId: input.externalOrderId,
            designId,
            clientId,
            shoeWidth: input.linkShoeWidth,
        });
        return { outcome: "created", clientId, designId, createdClient: !person };
    }
    return {
        store,
        people,
        orders,
        widths,
        settings,
        lookups: () => lookups,
    };
}

const catalog = { shoe_size: { system: "US_M", size: 10 } };

function bind(store: DogfoodSavedDesignStore, verifier: OrderPersonVerifier, orderId = ORDER) {
    return autoBindDogfoodOrder({
        externalOrderId: orderId,
        store,
        verifier,
        now: () => NOW,
        catalog,
    });
}

describe("dogfood order auto-bind", () => {
    test("a new order for an existing patient binds once and a repeat stays on that client", async () => {
        const db = memory({
            people: [
                {
                    externalPersonId: PERSON,
                    clientId: CLIENT,
                    givenName: "Kept",
                    familyName: "Name",
                    shoe: { system: "US_M", size: 10, left: null, right: null, width: "wide" },
                },
            ],
        });
        const first = await bind(db.store, accepting(PERSON));
        const second = await bind(db.store, accepting(PERSON));
        expect(first.createdClient).toBe(false);
        expect(first.clientId).toBe(CLIENT);
        expect(first.shoeWidth).toBe("medium");
        expect(first.shoeWidthSource).toBe("defaulted");
        expect(second.clientId).toBe(CLIENT);
        expect(second.designId).toBe(first.designId);
        expect(second.established).toBe(false);
        expect(db.people).toHaveLength(1);
        expect(db.orders).toHaveLength(1);
        expect(db.orders[0]?.shoeWidth).toBe("medium");
        expect(db.widths).toEqual(["medium", "medium"]);
        expect(db.settings[0]).toMatchObject({
            settings: {
                shoeWidth: "medium",
                dogfoodManufacturing: { shoeWidth: "medium", shoeWidthSource: "defaulted" },
            },
        });
        expect(JSON.stringify(db.widths)).not.toContain('""');
    });

    test("two overlapping calls keep one patient and one order", async () => {
        const db = memory({
            people: [
                {
                    externalPersonId: PERSON,
                    clientId: CLIENT,
                    givenName: "Kept",
                    familyName: "Name",
                },
            ],
        });
        const [left, right] = await Promise.all([
            bind(db.store, accepting(PERSON)),
            bind(db.store, accepting(PERSON)),
        ]);
        expect(left.clientId).toBe(CLIENT);
        expect(right.clientId).toBe(CLIENT);
        expect(left.designId).toBe(right.designId);
        expect(db.people).toHaveLength(1);
        expect(db.orders).toHaveLength(1);
    });

    test("a unique conflict retries onto the same binding", async () => {
        const db = memory({
            people: [
                {
                    externalPersonId: PERSON,
                    clientId: CLIENT,
                    givenName: "Kept",
                    familyName: "Name",
                },
            ],
            conflictOnce: true,
        });
        const result = await bind(db.store, accepting(PERSON));
        expect(result.clientId).toBe(CLIENT);
        expect(result.established).toBe(false);
        expect(db.people).toHaveLength(1);
        expect(db.orders).toHaveLength(1);
    });

    test("a rejected verifier writes nothing", async () => {
        const db = memory({
            people: [
                {
                    externalPersonId: PERSON,
                    clientId: CLIENT,
                    givenName: "Kept",
                    familyName: "Name",
                },
            ],
        });
        const refused: OrderPersonVerifier = {
            async verify() {
                return { ok: false, code: "verifier_unauthorized" };
            },
        };
        await expect(bind(db.store, refused)).rejects.toMatchObject({ code: "verifier_unauthorized" });
        expect(db.lookups()).toBe(0);
        expect(db.orders).toHaveLength(0);
        expect(db.people).toHaveLength(1);
        expect(db.widths).toEqual([]);
    });

    test("an unconfigured verifier refuses with order_person_unbound and writes nothing", async () => {
        const db = memory();
        const error = await autoBindDogfoodOrder({
            externalOrderId: ORDER,
            store: db.store,
            now: () => NOW,
            catalog,
        }).then(
            () => null,
            (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(DogfoodOrderAutoBindUnconfiguredError);
        expect(error).toMatchObject({
            code: "order_person_unbound",
            unconfigured: true,
            message: `order_person_unbound: ${dogfoodOrderIdentityDetail("order_person_unbound")}`,
        });
        expect(db.lookups()).toBe(0);
        expect(db.people).toHaveLength(0);
        expect(db.orders).toHaveLength(0);
    });

    test("a new person without trusted names is refused and not invented", async () => {
        const db = memory();
        await expect(bind(db.store, accepting(PERSON))).rejects.toMatchObject({
            code: "verifier_incomplete",
        });
        expect(db.people).toHaveLength(0);
        expect(db.orders).toHaveLength(0);
        expect(db.widths).toEqual([]);
        expect(DOGFOOD_ORDER_AUTO_BIND_PRODUCER_NAME_FIELDS).toEqual(["given_name", "family_name"]);
    });

    test("trusted verifier names create one client and medium defaulted rows", async () => {
        const db = memory();
        const result = await bind(db.store, accepting(PERSON, { givenName: "Ada", familyName: "Lovelace" }));
        expect(result.createdClient).toBe(true);
        expect(result.shoeWidth).toBe("medium");
        expect(result.shoeWidthSource).toBe("defaulted");
        expect(db.people).toEqual([
            {
                externalPersonId: PERSON,
                clientId: result.clientId,
                givenName: "Ada",
                familyName: "Lovelace",
            },
        ]);
        expect(db.orders).toHaveLength(1);
        expect(db.widths).toEqual(["medium", "medium"]);
        expect(db.orders[0]?.shoeWidth).toBe("medium");
    });

    test("intake names label a new client and a caller id is not an input", async () => {
        const db = memory();
        const result = await autoBindDogfoodOrder({
            externalOrderId: ORDER,
            store: db.store,
            verifier: accepting(PERSON),
            now: () => NOW,
            catalog,
            intake: { names: { givenName: "Grace", familyName: "Hopper" } },
        });
        expect(result.createdClient).toBe(true);
        expect(db.people[0]?.givenName).toBe("Grace");
        expect(db.people[0]?.familyName).toBe("Hopper");
        expect(db.people[0]?.clientId).not.toBe(CLIENT);
        const source = readFileSync("vertex/server/src/lib/dogfood-order-auto-bind.ts", "utf8");
        expect(source).not.toMatch(/clientId\?:/);
        expect(source).not.toContain("externalClientId");
    });

    test("an unsupported width does not open a write", async () => {
        const db = memory();
        await expect(
            autoBindDogfoodOrder({
                externalOrderId: ORDER,
                store: db.store,
                verifier: accepting(PERSON, { givenName: "Ada", familyName: "Lovelace" }),
                now: () => NOW,
                catalog: { shoe_size: { system: "US_M", size: 10 }, width: "extra_wide" },
            }),
        ).rejects.toMatchObject({ code: "integration_width_unsupported" });
        expect(db.people).toHaveLength(0);
        expect(db.orders).toHaveLength(0);
    });
});

function serviceHarness(bind: IntegrationDeps["bindDogfoodOrder"]) {
    const store = createMemoryIntegrationStore();
    store.addTenant({ id: DOGFOOD_TENANT_ID, name: "Dogfood" });
    store.addTenant({ id: OTHER, name: "Other" });
    store.addUser({ id: OWNER, tenantId: DOGFOOD_TENANT_ID, role: "clinician", email: "cad@dogfood.test" });
    store.addUser({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        tenantId: OTHER,
        role: "clinician",
        email: "other@example.test",
    });
    const deps: IntegrationDeps = {
        store,
        now: () => NOW,
        uploadSigningKey: "test-upload-signing-key",
        uploadBaseUrl: "https://uploads.example.test/put",
        appOrigin: "https://app.example.test",
        bindDogfoodOrder: bind,
    };
    return { store, handler: createIntegrationHandler(deps) };
}

async function insertKey(env: ReturnType<typeof serviceHarness>, tenantIds: string[]) {
    const { token, hash } = generateIntegrationKey();
    const row: CredentialRecord = {
        id: randomUUID(),
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
    env: ReturnType<typeof serviceHarness>,
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

function clientBody(externalId: string, tenantId = DOGFOOD_TENANT_ID) {
    return {
        source: "vo2",
        external_client_id: externalId,
        tenant_id: tenantId,
        first_name: "Kept",
        last_name: "Name",
        dob: "1980-01-02",
        shoe_size: { system: "US_M", size: 10 },
    };
}

function designBody(clientId: string, orderId = ORDER) {
    return {
        source: "vo2",
        tenant_id: DOGFOOD_TENANT_ID,
        client_id: clientId,
        external_order_id: orderId,
        type: "insole",
        sides: "pair",
        shoe_size: { system: "US_M", size: 10 },
    };
}

function integrationBacked(store: IntegrationStore) {
    let chain: Promise<void> = Promise.resolve();
    const run = async <T>(fn: () => T | Promise<T>): Promise<T> => {
        const previous = chain;
        let release: () => void = () => {};
        chain = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await fn();
        } finally {
            release();
        }
    };
    const dogfood: DogfoodSavedDesignStore = {
        async findOrderLinks(externalOrderId) {
            const link = await store.findDesignLink({
                source: "vo2",
                tenantId: DOGFOOD_TENANT_ID,
                externalOrderId,
            });
            return link ? [{ designId: link.designId, clientId: link.clientId }] : [];
        },
        async findClient(clientId) {
            const client = await store.findClient(clientId);
            if (!client || client.tenantId !== DOGFOOD_TENANT_ID) return null;
            return { id: client.id, ownerId: client.ownerId, tenantId: client.tenantId };
        },
        async findPersonLinks(externalPersonId) {
            const link = await store.findClientLink({
                source: "vo2",
                tenantId: DOGFOOD_TENANT_ID,
                externalClientId: externalPersonId,
            });
            if (!link) return [];
            const client = await store.findClient(link.clientId);
            if (!client || client.tenantId !== DOGFOOD_TENANT_ID) return [];
            return [
                {
                    clientId: client.id,
                    givenName: client.firstName,
                    familyName: client.lastName,
                    shoe: {
                        system: link.orderShoe.system,
                        size: link.orderShoe.size,
                        left: link.orderShoe.left,
                        right: link.orderShoe.right,
                        width: link.orderShoe.width,
                    },
                },
            ];
        },
        async establishVerifiedOrder(input) {
            return run(async () => {
                if (input.linkShoeWidth === "" || input.chartWidth === "") {
                    throw new Error("blank shoeWidth");
                }
                const order = await store.findDesignLink({
                    source: "vo2",
                    tenantId: DOGFOOD_TENANT_ID,
                    externalOrderId: input.externalOrderId,
                });
                const person = await store.findClientLink({
                    source: "vo2",
                    tenantId: DOGFOOD_TENANT_ID,
                    externalClientId: input.externalPersonId,
                });
                if (order && (!person || order.clientId !== person.clientId))
                    return { outcome: "mismatch" as const };
                if (order && person) {
                    return {
                        outcome: "exists" as const,
                        clientId: person.clientId,
                        designId: order.designId,
                    };
                }
                const owner = await store.ownerForTenant(DOGFOOD_TENANT_ID);
                if (!owner) return { outcome: "no_owner" as const };
                const clientId = person?.clientId ?? randomUUID();
                const designId = randomUUID();
                const width = input.linkShoeWidth as ShoeWidth;
                const shoe = {
                    system: input.linkShoe.system,
                    size: input.linkShoe.size,
                    left: input.linkShoe.left,
                    right: input.linkShoe.right,
                    width,
                };
                if (!person) {
                    await store.createClientWithLink({
                        client: {
                            id: clientId,
                            tenantId: DOGFOOD_TENANT_ID,
                            ownerId: owner.id,
                            firstName: input.givenName,
                            lastName: input.familyName,
                            dateOfBirth: null,
                            chart: { declared: true, shoe },
                        },
                        link: {
                            id: randomUUID(),
                            source: "vo2",
                            tenantId: DOGFOOD_TENANT_ID,
                            externalClientId: input.externalPersonId,
                            clientId,
                            orderShoe: shoe,
                            shoeSizeMismatch: false,
                        },
                    });
                }
                await store.createDesignWithLink({
                    design: {
                        id: designId,
                        clientId,
                        tenantId: DOGFOOD_TENANT_ID,
                        ownerId: owner.id,
                        kind: "insole",
                        name: `Insole ${input.externalOrderId}`.slice(0, 120),
                        notes: "",
                        updatedAt: NOW.toISOString(),
                        settingsJson: input.settingsJson,
                    },
                    link: {
                        id: randomUUID(),
                        source: "vo2",
                        tenantId: DOGFOOD_TENANT_ID,
                        externalOrderId: input.externalOrderId,
                        designId,
                        clientId,
                        kind: "insole",
                        sides: "pair",
                        rxText: null,
                        notes: null,
                        orderReference: null,
                        orderedByAccount: null,
                        parentExternalOrderId: null,
                        parentDesignId: null,
                        shoe,
                        shoeSizeMismatch: false,
                    },
                });
                return { outcome: "created" as const, clientId, designId, createdClient: !person };
            });
        },
    };
    return dogfood;
}

describe("first-sight intake and list", () => {
    test("intake binds the verified patient and list no longer reports unbound", async () => {
        let binds = 0;
        const env = serviceHarness(async (input) => {
            binds += 1;
            return autoBindDogfoodOrder({
                externalOrderId: input.externalOrderId,
                intake: input.intake,
                now: input.now,
                verifier: accepting(PERSON),
                store: integrationBacked(env.store),
            });
        });
        const token = await insertKey(env, [DOGFOOD_TENANT_ID]);
        const person = await read(
            await call(env, "POST", "/api/integrations/v1/clients/upsert", token, clientBody(PERSON)),
        );
        const decoy = await read(
            await call(env, "POST", "/api/integrations/v1/clients/upsert", token, clientBody("chart-decoy")),
        );
        expect(person.status).toBe(200);
        const created = await read(
            await call(
                env,
                "POST",
                "/api/integrations/v1/designs",
                token,
                designBody(String(decoy.body.client_id)),
            ),
        );
        expect(created.status).toBe(200);
        const link = await env.store.findDesignLink({
            source: "vo2",
            tenantId: DOGFOOD_TENANT_ID,
            externalOrderId: ORDER,
        });
        expect(link?.clientId).toBe(person.body.client_id);
        expect(link?.clientId).not.toBe(decoy.body.client_id);
        expect(link?.shoe.width).toBe("medium");
        const design = await env.store.getDesign(String(created.body.design_id));
        expect(design?.settingsJson).toMatchObject({
            settings: {
                shoeWidth: "medium",
                dogfoodManufacturing: { shoeWidthSource: "defaulted" },
            },
        });
        const listed = await read(
            await call(
                env,
                "GET",
                `/api/integrations/v1/designs?external_order_id=${ORDER}&tenant_id=${DOGFOOD_TENANT_ID}&source=vo2`,
                token,
            ),
        );
        expect(listed.status).toBe(200);
        const designs = listed.body.designs as Array<{ design_id: string }>;
        expect(designs).toHaveLength(1);
        expect(designs[0]?.design_id).toBe(created.body.design_id);
        expect(binds).toBe(1);
        const again = await read(
            await call(
                env,
                "POST",
                "/api/integrations/v1/designs",
                token,
                designBody(String(person.body.client_id)),
            ),
        );
        expect(again.status).toBe(200);
        expect(again.body.design_id).toBe(created.body.design_id);
        expect(binds).toBe(1);
    });

    test("list first sight of an existing patient binds once", async () => {
        let binds = 0;
        const env = serviceHarness(async (input) => {
            binds += 1;
            return autoBindDogfoodOrder({
                externalOrderId: input.externalOrderId,
                intake: input.intake,
                now: input.now,
                verifier: accepting(PERSON),
                store: integrationBacked(env.store),
            });
        });
        const token = await insertKey(env, [DOGFOOD_TENANT_ID]);
        const person = await read(
            await call(env, "POST", "/api/integrations/v1/clients/upsert", token, clientBody(PERSON)),
        );
        const listed = await read(
            await call(
                env,
                "GET",
                `/api/integrations/v1/designs?external_order_id=${ORDER}&tenant_id=${DOGFOOD_TENANT_ID}&source=vo2`,
                token,
            ),
        );
        expect(listed.status).toBe(200);
        const designs = listed.body.designs as Array<{ design_id: string; client_id: string }>;
        expect(designs).toHaveLength(1);
        expect(designs[0]?.client_id).toBe(person.body.client_id);
        const second = await read(
            await call(
                env,
                "GET",
                `/api/integrations/v1/designs?external_order_id=${ORDER}&tenant_id=${DOGFOOD_TENANT_ID}&source=vo2`,
                token,
            ),
        );
        expect(second.body.designs).toEqual(listed.body.designs);
        expect(binds).toBe(1);
        const link = await env.store.findDesignLink({
            source: "vo2",
            tenantId: DOGFOOD_TENANT_ID,
            externalOrderId: ORDER,
        });
        expect(link?.shoe.width).toBe("medium");
        expect(link?.shoe.width).not.toBe("");
    });

    test("concurrent list calls converge on one design and one patient", async () => {
        const env = serviceHarness(async (input) =>
            autoBindDogfoodOrder({
                externalOrderId: input.externalOrderId,
                intake: input.intake,
                now: input.now,
                verifier: accepting(PERSON),
                store: integrationBacked(env.store),
            }),
        );
        const token = await insertKey(env, [DOGFOOD_TENANT_ID]);
        const person = await read(
            await call(env, "POST", "/api/integrations/v1/clients/upsert", token, clientBody(PERSON)),
        );
        const path = `/api/integrations/v1/designs?external_order_id=${ORDER}&tenant_id=${DOGFOOD_TENANT_ID}&source=vo2`;
        const [left, right] = await Promise.all([
            read(await call(env, "GET", path, token)),
            read(await call(env, "GET", path, token)),
        ]);
        expect(left.status).toBe(200);
        expect(right.status).toBe(200);
        const leftId = (left.body.designs as Array<{ design_id: string; client_id: string }>)[0];
        const rightId = (right.body.designs as Array<{ design_id: string; client_id: string }>)[0];
        expect(leftId?.design_id).toBe(rightId?.design_id);
        expect(leftId?.client_id).toBe(person.body.client_id);
        expect(rightId?.client_id).toBe(person.body.client_id);
    });

    test("a rejected or unconfigured verifier does not write a design", async () => {
        const refused = serviceHarness(async (input) =>
            autoBindDogfoodOrder({
                externalOrderId: input.externalOrderId,
                intake: input.intake,
                now: input.now,
                verifier: {
                    async verify() {
                        return { ok: false, code: "verifier_unauthorized" };
                    },
                },
                store: integrationBacked(refused.store),
            }),
        );
        const token = await insertKey(refused, [DOGFOOD_TENANT_ID]);
        await call(refused, "POST", "/api/integrations/v1/clients/upsert", token, clientBody(PERSON));
        const denied = await read(
            await call(
                refused,
                "GET",
                `/api/integrations/v1/designs?external_order_id=${ORDER}&tenant_id=${DOGFOOD_TENANT_ID}&source=vo2`,
                token,
            ),
        );
        expect(denied.status).toBe(403);
        expect(String(denied.body.error)).toMatch(/verifier_unauthorized/);
        expect(
            await refused.store.findDesignLink({
                source: "vo2",
                tenantId: DOGFOOD_TENANT_ID,
                externalOrderId: ORDER,
            }),
        ).toBeNull();

        let sawUnconfigured = false;
        const open = serviceHarness(async () => {
            sawUnconfigured = true;
            throw new DogfoodOrderAutoBindUnconfiguredError();
        });
        const openToken = await insertKey(open, [DOGFOOD_TENANT_ID]);
        const client = await read(
            await call(open, "POST", "/api/integrations/v1/clients/upsert", openToken, clientBody(PERSON)),
        );
        const empty = await read(
            await call(
                open,
                "GET",
                `/api/integrations/v1/designs?external_order_id=${ORDER}&tenant_id=${DOGFOOD_TENANT_ID}&source=vo2`,
                openToken,
            ),
        );
        expect(empty.status).toBe(200);
        expect(empty.body).toEqual({ designs: [] });
        expect(sawUnconfigured).toBe(true);
        const legacy = await read(
            await call(
                open,
                "POST",
                "/api/integrations/v1/designs",
                openToken,
                designBody(String(client.body.client_id)),
            ),
        );
        expect(legacy.status).toBe(200);
        const link = await open.store.findDesignLink({
            source: "vo2",
            tenantId: DOGFOOD_TENANT_ID,
            externalOrderId: ORDER,
        });
        expect(link?.clientId).toBe(client.body.client_id);
    });

    test("another tenant does not invoke auto-bind", async () => {
        let binds = 0;
        const env = serviceHarness(async () => {
            binds += 1;
            throw new Error("must not bind");
        });
        const token = await insertKey(env, [OTHER]);
        const client = await read(
            await call(
                env,
                "POST",
                "/api/integrations/v1/clients/upsert",
                token,
                clientBody("other-chart", OTHER),
            ),
        );
        const created = await read(
            await call(env, "POST", "/api/integrations/v1/designs", token, {
                ...designBody(String(client.body.client_id)),
                tenant_id: OTHER,
            }),
        );
        expect(created.status).toBe(200);
        expect(binds).toBe(0);
    });
});

describe("human client and design paths", () => {
    test("human create, edit, and export paths do not invoke auto-bind", () => {
        const human = [
            "vertex/server/src/routers/client.ts",
            "vertex/server/src/routers/export.ts",
            "vertex/server/src/routers/manufacturing.ts",
            "vertex/server/src/auth/dogfood-design-access.ts",
            "vertex/src/stores/client-store.ts",
            "vertex/src/stores/design-store.ts",
            "vertex/src/features/clients/client-actions.ts",
            "vertex/src/features/exports/export-service.ts",
            "vertex/shared/saved-design-snapshot.ts",
            "vertex/shared/client-files.ts",
            "vertex/shared/dogfood-manufacturing.ts",
        ];
        for (const file of human) {
            const text = readFileSync(file, "utf8");
            expect(text, file).not.toContain("autoBindDogfoodOrder");
            expect(text, file).not.toContain("runtimeAutoBindDogfoodOrder");
            expect(text, file).not.toContain("dogfood-order-auto-bind");
            expect(text, file).not.toContain("bindFirstSightVo2Order");
        }
        const service = readFileSync("vertex/server/src/routers/integrations/service.ts", "utf8");
        expect(service).toContain("names: null");
        expect(service).not.toContain("createDogfoodSavedDesign");
        expect(service.match(/bindFirstSightVo2Order\(/g)).toHaveLength(3);
    });

    test("the runtime entry stays unconfigured when the gate is off", async () => {
        const gate = DOGFOOD_ORDER_OWNER_CONFIG_KEYS.gate;
        const previous = process.env[gate];
        delete process.env[gate];
        try {
            await expect(
                runtimeAutoBindDogfoodOrder({ externalOrderId: ORDER, intake: null, now: () => NOW }),
            ).rejects.toBeInstanceOf(DogfoodOrderAutoBindUnconfiguredError);
        } finally {
            if (previous === undefined) delete process.env[gate];
            else process.env[gate] = previous;
        }
    });
});
