import type { PrismaClient } from "@prisma/client";
import { describe, expect, test } from "@rstest/core";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import {
    createDogfoodSavedDesign,
    type DogfoodOrderLink,
    type DogfoodSavedDesignStore,
    prismaDogfoodSavedDesignStore,
} from "./dogfood-saved-design.js";
import type { PersistSavedDesignSnapshotResult } from "./saved-design-snapshot.js";

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-dogfood",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

const ORDER = "11111111-1111-4111-8111-111111111111";
const OTHER_ORDER = "12121212-1212-4121-8121-121212121212";
const CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DESIGN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DESIGN_TWO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OWNER = "abababab-abab-4aba-8aba-abababababab";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";

interface ClientRow {
    id: string;
    ownerId: string;
    tenantId: string;
}

function snapshot(designId: string): PersistSavedDesignSnapshotResult {
    return {
        ok: true,
        design_id: designId,
        ignored_fields: ["rx_text"],
        unmapped_fields: ["rx_text"],
        paths: ["shoe_size.size"],
        settingsJson: { schemaVersion: 4, settings: { hardness: "Hard", shoeWidth: "medium" } },
        template: "SAMPLE_Top",
        scans_used: false,
        shoe_width: "medium",
        shoe_width_source: "defaulted",
        hardness: "Hard",
        hardness_source: "prescribed",
    };
}

function harness(options: {
    links?: DogfoodOrderLink[] | ((orderId: string) => DogfoodOrderLink[]);
    clients?: ClientRow[];
    persist?: (designId: string) => Promise<PersistSavedDesignSnapshotResult>;
}) {
    const clients = options.clients ?? [{ id: CLIENT, ownerId: OWNER, tenantId: DOGFOOD_TENANT_ID }];
    const counts = { links: 0, clients: 0, persists: 0 };
    const persisted: string[] = [];
    const store: DogfoodSavedDesignStore = {
        async findOrderLinks(orderId) {
            counts.links += 1;
            if (typeof options.links === "function") return options.links(orderId);
            return options.links ?? [];
        },
        async findClient(id) {
            counts.clients += 1;
            return clients.find((row) => row.id === id) ?? null;
        },
    };
    return {
        store,
        counts,
        persisted,
        clients,
        persist:
            options.persist ??
            (async (designId: string) => {
                counts.persists += 1;
                persisted.push(designId);
                return snapshot(designId);
            }),
    };
}

function refresh(args: {
    orderId?: string;
    clientId?: string | null;
    store: DogfoodSavedDesignStore;
    persist: (designId: string) => Promise<PersistSavedDesignSnapshotResult>;
    actor?: CadOperatorPrincipal;
}) {
    return createDogfoodSavedDesign({
        principal: args.actor ?? principal,
        externalOrderId: args.orderId ?? ORDER,
        clientId: args.clientId,
        store: args.store,
        persist: args.persist,
    });
}

describe("dogfood order-person identity", () => {
    test("an existing order binding refreshes that design and does not create another", async () => {
        const db = harness({ links: [{ designId: DESIGN, clientId: CLIENT }] });
        const result = await refresh({ store: db.store, persist: db.persist, clientId: CLIENT });
        expect(result.identity).toBe("existing_order_binding");
        expect(result.established).toBe(false);
        expect(result.created).toBe(false);
        expect(result.design_id).toBe(DESIGN);
        expect(result.client_id).toBe(CLIENT);
        expect(result.external_order_id).toBe(ORDER);
        expect(result.template).toBe("SAMPLE_Top");
        expect(result.scans_used).toBe(false);
        expect(result.shoe_width).toBe("medium");
        expect(result.shoe_width_source).toBe("defaulted");
        expect(result.hardness).toBe("Hard");
        expect(result.hardness_source).toBe("prescribed");
        expect(result).not.toHaveProperty("pendingCouponValidation");
        expect(JSON.stringify(result)).not.toMatch(/stl|pendingCouponValidation/i);
        expect(db.persisted).toEqual([DESIGN]);
        expect(db.store).not.toHaveProperty("insert");
        expect(db.store).not.toHaveProperty("createClientWithLink");
    });

    test("omitting client_id still uses only the bound client", async () => {
        const db = harness({ links: [{ designId: DESIGN, clientId: CLIENT }] });
        const result = await refresh({ store: db.store, persist: db.persist });
        expect(result.client_id).toBe(CLIENT);
        expect(db.persisted).toEqual([DESIGN]);
    });

    test("a supplied wrong client does not refresh, write, or reassign the tenant", async () => {
        const db = harness({ links: [{ designId: DESIGN, clientId: CLIENT }] });
        await expect(
            refresh({ store: db.store, persist: db.persist, clientId: OTHER_CLIENT }),
        ).rejects.toMatchObject({ name: "DogfoodOrderIdentityError", code: "order_client_mismatch" });
        expect(db.counts.persists).toBe(0);
        expect(db.counts.clients).toBe(0);
        expect(db.clients[0]?.tenantId).toBe(DOGFOOD_TENANT_ID);
    });

    test("a genuinely new person with no mapping creates neither a client nor a design", async () => {
        const db = harness({
            links: [],
            clients: [{ id: CLIENT, ownerId: OWNER, tenantId: DOGFOOD_TENANT_ID }],
        });
        await expect(refresh({ store: db.store, persist: db.persist })).rejects.toMatchObject({
            code: "order_person_unbound",
        });
        await expect(
            refresh({ store: db.store, persist: db.persist, clientId: CLIENT }),
        ).rejects.toMatchObject({ code: "order_person_unbound" });
        expect(db.counts.persists).toBe(0);
        expect(db.counts.clients).toBe(0);
        expect(db.clients).toHaveLength(1);
        expect(db.clients[0]?.tenantId).toBe(DOGFOOD_TENANT_ID);
    });

    test("an absent mapping is not treated as an existing client uuid", async () => {
        const db = harness({ links: [] });
        await expect(
            refresh({ store: db.store, persist: db.persist, clientId: CLIENT }),
        ).rejects.toMatchObject({ code: "order_person_unbound" });
        expect(db.persisted).toEqual([]);
    });

    test("duplicate links for one order are ambiguous and write nothing", async () => {
        const db = harness({
            links: [
                { designId: DESIGN, clientId: CLIENT },
                { designId: DESIGN_TWO, clientId: OTHER_CLIENT },
            ],
        });
        await expect(
            refresh({ store: db.store, persist: db.persist, clientId: CLIENT }),
        ).rejects.toMatchObject({
            code: "order_client_ambiguous",
        });
        expect(db.counts.persists).toBe(0);
        expect(db.counts.clients).toBe(0);
    });

    test("a bound client outside the dogfood tenant is not refreshed or moved", async () => {
        const foreign: ClientRow = { id: CLIENT, ownerId: OWNER, tenantId: OTHER_TENANT };
        const db = harness({
            links: [{ designId: DESIGN, clientId: CLIENT }],
            clients: [foreign],
        });
        await expect(
            refresh({ store: db.store, persist: db.persist, clientId: CLIENT }),
        ).rejects.toMatchObject({
            code: "order_client_cross_tenant",
        });
        expect(db.counts.persists).toBe(0);
        expect(foreign.tenantId).toBe(OTHER_TENANT);
    });

    test("a missing bound client fails closed instead of adopting another client", async () => {
        const db = harness({ links: [{ designId: DESIGN, clientId: CLIENT }], clients: [] });
        await expect(refresh({ store: db.store, persist: db.persist })).rejects.toMatchObject({
            code: "order_client_cross_tenant",
        });
        expect(db.counts.persists).toBe(0);
        expect(db.counts.clients).toBe(1);
    });

    test("the wrong order does not inherit another order's client", async () => {
        const db = harness({
            links: (orderId) => (orderId === ORDER ? [{ designId: DESIGN, clientId: CLIENT }] : []),
        });
        await expect(
            refresh({
                store: db.store,
                persist: db.persist,
                orderId: OTHER_ORDER,
                clientId: CLIENT,
            }),
        ).rejects.toMatchObject({ code: "order_person_unbound" });
        expect(db.persisted).toEqual([]);
    });

    test("invalid external identity performs no lookup and no write", async () => {
        const db = harness({ links: [{ designId: DESIGN, clientId: CLIENT }] });
        await expect(refresh({ store: db.store, persist: db.persist, orderId: "   " })).rejects.toMatchObject(
            {
                code: "order_identity_invalid",
            },
        );
        await expect(
            refresh({ store: db.store, persist: db.persist, orderId: "x".repeat(201) }),
        ).rejects.toMatchObject({ code: "order_identity_invalid" });
        await expect(
            refresh({ store: db.store, persist: db.persist, clientId: "not-a-person" }),
        ).rejects.toMatchObject({ code: "order_identity_invalid" });
        expect(db.counts.links).toBe(0);
        expect(db.counts.persists).toBe(0);
    });

    test("another tenant's principal does not read or write the dogfood binding", async () => {
        const db = harness({ links: [{ designId: DESIGN, clientId: CLIENT }] });
        const outsider = { ...principal, tenantId: OTHER_TENANT } as CadOperatorPrincipal;
        await expect(
            refresh({ store: db.store, persist: db.persist, actor: outsider, clientId: CLIENT }),
        ).rejects.toThrow(/Design not found/);
        expect(db.counts.links).toBe(0);
        expect(db.counts.persists).toBe(0);
    });

    test("retry and overlap keep the same design and client and do not insert", async () => {
        const db = harness({ links: [{ designId: DESIGN, clientId: CLIENT }] });
        const first = await refresh({ store: db.store, persist: db.persist, clientId: CLIENT });
        const second = await refresh({ store: db.store, persist: db.persist });
        expect(first.design_id).toBe(second.design_id);
        expect(first.client_id).toBe(second.client_id);
        expect(db.persisted).toEqual([DESIGN, DESIGN]);

        let entered = 0;
        let releaseBoth: () => void = () => {};
        const bothEntered = new Promise<void>((resolve) => {
            releaseBoth = resolve;
        });
        const overlapped: string[] = [];
        const overlap = harness({
            links: [{ designId: DESIGN, clientId: CLIENT }],
            persist: async (designId) => {
                entered += 1;
                if (entered === 2) releaseBoth();
                await bothEntered;
                overlapped.push(designId);
                return snapshot(designId);
            },
        });
        const pending = Promise.all([
            refresh({ store: overlap.store, persist: overlap.persist, clientId: CLIENT }),
            refresh({ store: overlap.store, persist: overlap.persist, clientId: CLIENT }),
        ]);
        const [left, right] = await pending;
        expect(left.design_id).toBe(DESIGN);
        expect(right.design_id).toBe(DESIGN);
        expect(left.client_id).toBe(right.client_id);
        expect(new Set(overlapped)).toEqual(new Set([DESIGN]));
        expect(overlap.store).not.toHaveProperty("insert");
    });

    test("a bound refresh still fail-closes an unknown hardness from the snapshot writer", async () => {
        const db = harness({
            links: [{ designId: DESIGN, clientId: CLIENT }],
            persist: async () => {
                db.counts.persists += 1;
                throw new Error("Refusing to guess hardness");
            },
        });
        await expect(refresh({ store: db.store, persist: db.persist, clientId: CLIENT })).rejects.toThrow(
            /hardness/,
        );
        expect(db.counts.persists).toBe(1);
        expect(db.persisted).toEqual([]);
    });

    test("identity failure does not rewrite a prescribed hardness or ask a clinical question", async () => {
        const db = harness({ links: [] });
        await expect(refresh({ store: db.store, persist: db.persist, clientId: CLIENT })).rejects.toThrow(
            /order_person_unbound/,
        );
        expect(db.counts.persists).toBe(0);
    });

    test("a matching refresh returns the snapshot hardness and width unchanged", async () => {
        const db = harness({
            links: [{ designId: DESIGN, clientId: CLIENT }],
            persist: async (designId) => {
                db.counts.persists += 1;
                return {
                    ...snapshot(designId),
                    shoe_width: "wide",
                    shoe_width_source: "prescribed",
                    hardness: "Hard",
                    hardness_source: "prescribed",
                };
            },
        });
        const result = await refresh({ store: db.store, persist: db.persist, clientId: CLIENT });
        expect(result.hardness).toBe("Hard");
        expect(result.hardness_source).toBe("prescribed");
        expect(result.shoe_width).toBe("wide");
        expect(result.shoe_width_source).toBe("prescribed");
        expect(result.settingsJson).toMatchObject({ settings: { hardness: "Hard" } });
    });

    test("the order lookup is vo2 and dogfood only, and the store has no client insert", async () => {
        const queries: Array<{ model: string; args: unknown }> = [];
        const prisma = {
            integrationDesign: {
                findMany: async (args: unknown) => {
                    queries.push({ model: "integrationDesign", args });
                    return [{ designId: DESIGN, clientId: CLIENT }];
                },
            },
            client: {
                findFirst: async (args: unknown) => {
                    queries.push({ model: "client", args });
                    return { id: CLIENT, ownerId: OWNER, tenantId: DOGFOOD_TENANT_ID };
                },
            },
            $transaction: async () => {
                throw new Error("identity resolution must not open a write transaction");
            },
        } as unknown as PrismaClient;
        const store = prismaDogfoodSavedDesignStore(prisma);
        expect(Object.keys(store).sort()).toEqual([
            "establishVerifiedOrder",
            "findClient",
            "findOrderLinks",
            "findPersonLinks",
        ]);
        const result = await refresh({
            store,
            persist: async (designId) => snapshot(designId),
            clientId: CLIENT,
        });
        expect(result.design_id).toBe(DESIGN);
        expect(queries[0]).toEqual({
            model: "integrationDesign",
            args: {
                where: { source: "vo2", tenantId: DOGFOOD_TENANT_ID, externalOrderId: ORDER },
                select: { designId: true, clientId: true },
                take: 2,
            },
        });
        expect(queries[1]).toEqual({
            model: "client",
            args: {
                where: { id: CLIENT, tenantId: DOGFOOD_TENANT_ID },
                select: { id: true, ownerId: true, tenantId: true },
            },
        });
    });
});
