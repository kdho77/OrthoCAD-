import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, test } from "@rstest/core";

import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot.js";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import {
    DOGFOOD_ORDER_PERSON_CONTRACT,
    type OrderPersonVerification,
    type OrderPersonVerificationRequest,
    type OrderPersonVerifier,
    VO_ORDER_OWNER_PRINCIPAL,
} from "./dogfood-order-person-verifier.js";
import {
    createDogfoodSavedDesign,
    type DogfoodSavedDesignStore,
    type EstablishVerifiedOrderInput,
    type EstablishVerifiedOrderResult,
    prismaDogfoodSavedDesignStore,
} from "./dogfood-saved-design.js";

const NOW = new Date("2026-11-07T20:00:00.000Z");
const ORDER = "11111111-1111-4111-8111-111111111111";
const OTHER_ORDER = "12121212-1212-4121-8121-121212121212";
const CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DESIGN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OWNER = "abababab-abab-4aba-8aba-abababababab";
const PERSON = "person-synthetic-1";
const OTHER_PERSON = "person-synthetic-2";

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-dogfood",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

interface PersonRow {
    externalPersonId: string;
    clientId: string;
    givenName: string;
    familyName: string;
}

interface OrderRow {
    externalOrderId: string;
    designId: string;
    clientId: string;
}

function verifier(
    result: OrderPersonVerification | ((request: OrderPersonVerificationRequest) => OrderPersonVerification),
): OrderPersonVerifier & { requests: OrderPersonVerificationRequest[] } {
    const requests: OrderPersonVerificationRequest[] = [];
    return {
        requests,
        async verify(request) {
            requests.push(request);
            return typeof result === "function" ? result(request) : result;
        },
    };
}

function verified(overrides: Record<string, unknown> = {}): OrderPersonVerification {
    return {
        ok: true,
        principal: VO_ORDER_OWNER_PRINCIPAL,
        source: "vo2",
        tenantId: DOGFOOD_TENANT_ID,
        externalOrderId: ORDER,
        externalPersonId: PERSON,
        audience: "dogfood-saved-design",
        operation: "bind-order-person",
        verifiedAt: NOW.toISOString(),
        givenName: "Row",
        familyName: "Fixture",
        ...overrides,
    } as OrderPersonVerification;
}

function memoryStore(seed?: { people?: PersonRow[]; orders?: OrderRow[] }) {
    const people = [...(seed?.people ?? [])];
    const orders = [...(seed?.orders ?? [])];
    const names = new Map(
        people.map((row) => [row.clientId, { givenName: row.givenName, familyName: row.familyName }]),
    );
    let chain: Promise<void> = Promise.resolve();
    let establishes = 0;
    let nameWrites = 0;
    const run = async <T>(fn: () => Promise<T> | T): Promise<T> => {
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
            return orders.filter((row) => row.externalOrderId === externalOrderId).slice(0, 2);
        },
        async findClient(clientId) {
            if (!names.has(clientId) && !people.some((row) => row.clientId === clientId)) return null;
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
                }));
        },
        async establishVerifiedOrder(input) {
            return run(async () => commit(input));
        },
    };
    function commit(input: EstablishVerifiedOrderInput): EstablishVerifiedOrderResult {
        establishes += 1;
        const orderHits = orders.filter((row) => row.externalOrderId === input.externalOrderId);
        const personHits = people.filter((row) => row.externalPersonId === input.externalPersonId);
        if (orderHits.length > 1 || personHits.length > 1) return { outcome: "ambiguous" };
        const order = orderHits[0];
        const person = personHits[0];
        if (order && (!person || order.clientId !== person.clientId)) return { outcome: "mismatch" };
        if (order && person)
            return { outcome: "exists", clientId: person.clientId, designId: order.designId };
        const clientId = person?.clientId ?? "12121212-3434-4343-8343-121212121212";
        if (!person) {
            people.push({
                externalPersonId: input.externalPersonId,
                clientId,
                givenName: input.givenName,
                familyName: input.familyName,
            });
            names.set(clientId, { givenName: input.givenName, familyName: input.familyName });
        } else if (names.get(person.clientId)?.givenName !== person.givenName) {
            nameWrites += 1;
        }
        const designId = "34343434-3434-4343-8343-343434343434";
        if (
            orders.some((row) => row.designId === designId && row.externalOrderId !== input.externalOrderId)
        ) {
            return { outcome: "conflict" };
        }
        if (!orders.some((row) => row.externalOrderId === input.externalOrderId)) {
            orders.push({ externalOrderId: input.externalOrderId, designId, clientId });
        }
        return { outcome: "created", clientId, designId, createdClient: !person };
    }
    return { store, people, orders, names, nameWrites: () => nameWrites, establishes: () => establishes };
}

function bind(args: {
    store: DogfoodSavedDesignStore;
    verifier: OrderPersonVerifier;
    clientId?: string | null;
    catalog?: unknown;
    orderId?: string;
    persists?: string[];
}) {
    return createDogfoodSavedDesign({
        principal,
        externalOrderId: args.orderId ?? ORDER,
        clientId: args.clientId,
        catalog: args.catalog ?? { shoe_size: { system: "US_M", size: 10 }, hardness: "Hard" },
        store: args.store,
        verifier: args.verifier,
        now: () => NOW,
        buildSnapshot: buildSavedDesignSnapshot,
        persist: async (designId) => {
            args.persists?.push(designId);
            return {
                ok: true,
                design_id: designId,
                ignored_fields: [],
                unmapped_fields: [],
                paths: [],
                settingsJson: { settings: { hardness: "Hard" } },
                template: "SAMPLE_Top",
                scans_used: false,
                shoe_width: "medium",
                shoe_width_source: "defaulted",
                hardness: "Hard",
                hardness_source: "prescribed",
            };
        },
    });
}

describe("trusted dogfood order-person consumer", () => {
    test("the shared contract leaves the producer transport unresolved", () => {
        expect(DOGFOOD_ORDER_PERSON_CONTRACT.transport).toBe("unresolved");
        expect(DOGFOOD_ORDER_PERSON_CONTRACT.credentialIssued).toBe(false);
        expect(DOGFOOD_ORDER_PERSON_CONTRACT.productionBotScopesUnchanged).toBe(true);
        expect(DOGFOOD_ORDER_PERSON_CONTRACT.unresolved).toEqual([
            "read method",
            "read path",
            "authenticated principal credential binding",
            "wire field names and types",
            "revocation signal",
            "freshness clock source",
        ]);
        expect(principal.scopes).toEqual([
            "design:read",
            "manufacturing:prepare",
            "manufacturing:generate",
            "manufacturing:download",
        ]);
    });

    test("a verified new person creates one client and one design", async () => {
        const db = memoryStore();
        const check = verifier(verified());
        const result = await bind({ store: db.store, verifier: check });
        expect(result.established).toBe(true);
        expect(result.created).toBe(true);
        expect(result.identity).toBe("verified_order_person");
        expect(result.shoe_width).toBe("medium");
        expect(result.shoe_width_source).toBe("defaulted");
        expect(result.hardness).toBe("Hard");
        expect(result.hardness_source).toBe("prescribed");
        expect(result).not.toHaveProperty("pendingCouponValidation");
        expect(JSON.stringify(check.requests[0])).not.toMatch(/Row|Fixture|client_id|externalPersonId/);
        expect(db.people).toHaveLength(1);
        expect(db.orders).toHaveLength(1);
        expect(db.orders[0]?.clientId).toBe(db.people[0]?.clientId);
    });

    test("an existing person and a new order adds a design and does not rename the client", async () => {
        const db = memoryStore({
            people: [{ externalPersonId: PERSON, clientId: CLIENT, givenName: "Kept", familyName: "Name" }],
        });
        const result = await bind({
            store: db.store,
            verifier: verifier(verified({ givenName: "Other", familyName: "Person" })),
        });
        expect(result.established).toBe(true);
        expect(result.client_id).toBe(CLIENT);
        expect(db.people).toHaveLength(1);
        expect(db.names.get(CLIENT)).toEqual({ givenName: "Kept", familyName: "Name" });
        expect(db.nameWrites()).toBe(0);
        expect(db.orders).toEqual([
            { externalOrderId: ORDER, designId: expect.any(String), clientId: CLIENT },
        ]);
    });

    test("a caller client id, name, or proof-shaped payload is not sent to the verifier", async () => {
        const db = memoryStore();
        const check = verifier(verified());
        await expect(bind({ store: db.store, verifier: check, clientId: CLIENT })).rejects.toMatchObject({
            code: "order_client_mismatch",
        });
        expect(check.requests).toEqual([
            {
                source: "vo2",
                tenantId: DOGFOOD_TENANT_ID,
                externalOrderId: ORDER,
                audience: "dogfood-saved-design",
                operation: "bind-order-person",
            },
        ]);
        expect(db.people).toHaveLength(0);
        expect(db.orders).toHaveLength(0);
    });

    test("missing, revoked, unauthorized, and untrusted verifiers write nothing", async () => {
        const codes = ["verifier_revoked", "verifier_unauthorized", "verifier_untrusted"] as const;
        for (const code of codes) {
            const db = memoryStore({
                people: [
                    { externalPersonId: PERSON, clientId: CLIENT, givenName: "Kept", familyName: "Name" },
                ],
                orders: [{ externalOrderId: ORDER, designId: DESIGN, clientId: CLIENT }],
            });
            const persists: string[] = [];
            await expect(
                bind({ store: db.store, verifier: verifier({ ok: false, code }), persists }),
            ).rejects.toMatchObject({ code });
            expect(persists).toEqual([]);
            expect(db.establishes()).toBe(0);
        }
        const untrusted = verifier(verified({ audience: "clinic-launch" }));
        const db = memoryStore();
        await expect(bind({ store: db.store, verifier: untrusted })).rejects.toMatchObject({
            code: "verifier_untrusted",
        });
        expect(db.orders).toHaveLength(0);
    });

    test("a stale verification and a different order write nothing", async () => {
        const stale = verifier(verified({ verifiedAt: new Date(NOW.getTime() - 60_001).toISOString() }));
        const db = memoryStore();
        await expect(bind({ store: db.store, verifier: stale })).rejects.toMatchObject({
            code: "verifier_stale",
        });
        const swapped = verifier(verified({ externalOrderId: OTHER_ORDER }));
        await expect(bind({ store: db.store, verifier: swapped })).rejects.toMatchObject({
            code: "verifier_untrusted",
        });
        expect(db.people).toHaveLength(0);
    });

    test("a verified person that is not the order's client does not reparent", async () => {
        const db = memoryStore({
            people: [
                {
                    externalPersonId: OTHER_PERSON,
                    clientId: OTHER_CLIENT,
                    givenName: "Kept",
                    familyName: "Name",
                },
            ],
            orders: [{ externalOrderId: ORDER, designId: DESIGN, clientId: CLIENT }],
        });
        const persists: string[] = [];
        await expect(
            bind({
                store: db.store,
                verifier: verifier(verified({ externalPersonId: OTHER_PERSON })),
                persists,
            }),
        ).rejects.toMatchObject({ code: "order_client_mismatch" });
        expect(persists).toEqual([]);
        expect(db.orders[0]?.clientId).toBe(CLIENT);
        expect(db.names.get(OTHER_CLIENT)).toEqual({ givenName: "Kept", familyName: "Name" });
    });

    test("another tenant in the result is refused before a write", async () => {
        const db = memoryStore();
        await expect(
            bind({
                store: db.store,
                verifier: verifier(verified({ tenantId: "22222222-2222-4222-8222-222222222222" })),
            }),
        ).rejects.toMatchObject({ code: "verifier_untrusted" });
        expect(db.orders).toHaveLength(0);
    });

    test("a missing shoe size or unknown hardness does not open a client", async () => {
        const db = memoryStore();
        await expect(bind({ store: db.store, verifier: verifier(verified()), catalog: {} })).rejects.toThrow(
            /shoe size/,
        );
        await expect(
            bind({
                store: db.store,
                verifier: verifier(verified()),
                catalog: { shoe_size: { system: "US_M", size: 10 }, hardness: "sponge" },
            }),
        ).rejects.toThrow(/hardness/);
        expect(db.people).toHaveLength(0);
        expect(db.orders).toHaveLength(0);
        expect(db.establishes()).toBe(0);
    });

    test("a new person without a verifier name writes nothing", async () => {
        const db = memoryStore();
        await expect(
            bind({
                store: db.store,
                verifier: verifier(verified({ givenName: " ", familyName: null })),
            }),
        ).rejects.toMatchObject({ code: "verifier_incomplete" });
        expect(db.people).toHaveLength(0);
    });

    test("retry and overlap keep one client and one design", async () => {
        const db = memoryStore();
        const check = verifier(verified());
        const first = await bind({ store: db.store, verifier: check });
        const persists: string[] = [];
        const second = await bind({ store: db.store, verifier: check, persists });
        expect(first.client_id).toBe(second.client_id);
        expect(second.created).toBe(false);
        expect(db.people).toHaveLength(1);
        expect(db.orders).toHaveLength(1);
        expect(persists).toEqual([second.design_id]);
        const again = memoryStore();
        const parallel = verifier(verified());
        const both = await Promise.all([
            bind({ store: again.store, verifier: parallel }),
            bind({ store: again.store, verifier: parallel }),
        ]);
        expect(new Set(both.map((row) => row.client_id)).size).toBe(1);
        expect(again.people).toHaveLength(1);
        expect(again.orders).toHaveLength(1);
    });

    test("a failed establish rolls back the client and design", async () => {
        const db = memoryStore();
        db.store.establishVerifiedOrder = async () => {
            db.people.push({
                externalPersonId: PERSON,
                clientId: CLIENT,
                givenName: "Row",
                familyName: "Fixture",
            });
            db.people.splice(0, db.people.length);
            db.orders.splice(0, db.orders.length);
            throw new Error("transaction rolled back");
        };
        await expect(bind({ store: db.store, verifier: verifier(verified()) })).rejects.toThrow(
            /rolled back/,
        );
        expect(db.people).toHaveLength(0);
        expect(db.orders).toHaveLength(0);
    });

    test("a prisma transaction that fails while creating the client does not create a design", async () => {
        const writes: string[] = [];
        const tx = {
            integrationDesign: {
                findMany: async () => [],
            },
            integrationClient: {
                findMany: async () => [],
                create: async () => {
                    writes.push("integrationClient");
                },
            },
            user: {
                findFirst: async () => ({ id: OWNER }),
            },
            client: {
                findFirst: async () => null,
                create: async () => {
                    writes.push("client");
                    throw new Error("db down");
                },
            },
            design: {
                create: async () => {
                    writes.push("design");
                },
            },
        };
        const prisma = {
            $transaction: async (fn: (transaction: typeof tx) => Promise<EstablishVerifiedOrderResult>) => {
                const local: string[] = [];
                const wrapped = {
                    ...tx,
                    client: {
                        ...tx.client,
                        create: async () => {
                            local.push("client");
                            throw new Error("db down");
                        },
                    },
                    design: {
                        create: async () => {
                            local.push("design");
                        },
                    },
                    integrationClient: {
                        ...tx.integrationClient,
                        create: async () => {
                            local.push("integrationClient");
                        },
                    },
                    integrationDesign: {
                        ...tx.integrationDesign,
                        create: async () => {
                            local.push("integrationDesign");
                        },
                    },
                };
                try {
                    const result = await fn(wrapped);
                    writes.push(...local);
                    return result;
                } catch (error) {
                    if (local.join(",") !== "client") {
                        const message = error instanceof Error ? error.message : String(error);
                        throw new Error(`${message} writes=${local.join(",") || "none"}`);
                    }
                    throw error;
                }
            },
        } as unknown as PrismaClient;
        const store = prismaDogfoodSavedDesignStore(prisma);
        await expect(
            store.establishVerifiedOrder?.({
                externalOrderId: ORDER,
                externalPersonId: PERSON,
                givenName: "Row",
                familyName: "Fixture",
                verifiedAt: NOW.toISOString(),
                now: NOW,
                settingsJson: { schemaVersion: 4 },
                linkShoe: { system: "US_M", size: 10, left: null, right: null },
                linkShoeWidth: "",
                chartWidth: "medium",
            }),
        ).rejects.toThrow(/db down/);
        expect(writes).toEqual([]);
        expect(Prisma.PrismaClientKnownRequestError).toBeTruthy();
    });
});
