import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, test } from "@rstest/core";
import {
    assertAcceptanceSummary,
    assertIsolatedAcceptanceEnv,
    REQUIRED_CASES,
} from "../../../../scripts/ci/isolated-postgres-acceptance.mjs";
import { CHART_SHOE_WIDTHS } from "../../../shared/client-files.js";
import { parseSavedDesignCatalog } from "../../../shared/saved-design-catalog.js";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot.js";
import { normalizeShoeWidth } from "../../../src/lib/geometry/shoe-width.js";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import { settingsEnvelopeForSave } from "./design-schema.js";
import type { OrderPersonVerifier } from "./dogfood-order-person-verifier.js";
import { VO_ORDER_OWNER_PRINCIPAL } from "./dogfood-order-person-verifier.js";
import {
    createDogfoodSavedDesign,
    type DogfoodOrderLink,
    type DogfoodSavedDesignStore,
    type EstablishVerifiedOrderInput,
    IntegrationShoeWidthError,
    integrationLinkShoeWidth,
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

const WIDTH_NOW = new Date("2026-11-08T12:00:00.000Z");

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist") continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
        else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(path);
    }
    return out;
}

function acceptingVerifier(): OrderPersonVerifier {
    return {
        async verify(request) {
            return {
                ok: true,
                principal: VO_ORDER_OWNER_PRINCIPAL,
                source: "vo2",
                tenantId: DOGFOOD_TENANT_ID,
                externalOrderId: request.externalOrderId,
                externalPersonId: "synthetic-person",
                audience: "dogfood-saved-design",
                operation: "bind-order-person",
                verifiedAt: WIDTH_NOW.toISOString(),
                givenName: "Chart",
                familyName: "Label",
            };
        },
    };
}

function recordingStore() {
    const inputs: EstablishVerifiedOrderInput[] = [];
    const store: DogfoodSavedDesignStore = {
        async findOrderLinks() {
            return [];
        },
        async findClient() {
            return null;
        },
        async findPersonLinks() {
            return [];
        },
        async establishVerifiedOrder(input) {
            inputs.push(input);
            return { outcome: "created", clientId: CLIENT, designId: DESIGN, createdClient: true };
        },
    };
    return { store, inputs };
}

function establishInput(
    linkShoeWidth: string,
    chartWidth: "narrow" | "medium" | "wide",
): EstablishVerifiedOrderInput {
    return {
        externalOrderId: ORDER,
        externalPersonId: "synthetic-person",
        givenName: "Chart",
        familyName: "Label",
        verifiedAt: WIDTH_NOW.toISOString(),
        now: WIDTH_NOW,
        settingsJson: { schemaVersion: 1 },
        linkShoe: { system: "US_M", size: 10, left: null, right: null },
        linkShoeWidth,
        chartWidth,
    };
}

describe("integration link width", () => {
    test("an omitted width is medium on the link and stays defaulted on the snapshot", async () => {
        const db = recordingStore();
        const result = await createDogfoodSavedDesign({
            principal,
            externalOrderId: ORDER,
            catalog: { shoe_size: { system: "US_M", size: 10 }, hardness: "Hard" },
            store: db.store,
            verifier: acceptingVerifier(),
            now: () => WIDTH_NOW,
            buildSnapshot: buildSavedDesignSnapshot,
            persist: async () => {
                throw new Error("persist is the refresh path");
            },
        });
        expect(result.shoe_width).toBe("medium");
        expect(result.shoe_width_source).toBe("defaulted");
        expect(result.hardness).toBe("Hard");
        expect(db.inputs).toHaveLength(1);
        expect(db.inputs[0]?.linkShoeWidth).toBe("medium");
        expect(db.inputs[0]?.chartWidth).toBe("medium");
        expect(result.settingsJson).toMatchObject({
            settings: {
                shoeWidth: "medium",
                dogfoodManufacturing: { shoeWidth: "medium", shoeWidthSource: "defaulted" },
            },
        });
    });

    test("prescribed narrow, medium, and wide pass through unchanged", async () => {
        for (const width of ["narrow", "medium", "wide"] as const) {
            const db = recordingStore();
            const result = await createDogfoodSavedDesign({
                principal,
                externalOrderId: ORDER,
                catalog: { shoe_size: { system: "US_M", size: 10 }, width, hardness: "Hard" },
                store: db.store,
                verifier: acceptingVerifier(),
                now: () => WIDTH_NOW,
                buildSnapshot: buildSavedDesignSnapshot,
                persist: async () => {
                    throw new Error("persist is the refresh path");
                },
            });
            expect(result.shoe_width).toBe(width);
            expect(result.shoe_width_source).toBe("prescribed");
            expect(db.inputs[0]?.linkShoeWidth).toBe(width);
            expect(db.inputs[0]?.chartWidth).toBe(width);
        }
    });

    test("extra widths are rejected before establishment", async () => {
        for (const width of ["extra_narrow", "extra_wide"] as const) {
            const db = recordingStore();
            await expect(
                createDogfoodSavedDesign({
                    principal,
                    externalOrderId: ORDER,
                    catalog: { shoe_size: { system: "US_M", size: 10 }, width, hardness: "Hard" },
                    store: db.store,
                    verifier: acceptingVerifier(),
                    now: () => WIDTH_NOW,
                    buildSnapshot: buildSavedDesignSnapshot,
                    persist: async () => {
                        throw new Error("persist is the refresh path");
                    },
                }),
            ).rejects.toBeInstanceOf(IntegrationShoeWidthError);
            expect(db.inputs).toEqual([]);
        }
    });

    test("absent link width normalizes to medium and extra widths do not open a transaction", async () => {
        expect(integrationLinkShoeWidth("", "defaulted")).toBe("medium");
        expect(integrationLinkShoeWidth("wide", "prescribed")).toBe("wide");
        expect(() => integrationLinkShoeWidth("extra_wide", "prescribed")).toThrow(IntegrationShoeWidthError);
        const seen: string[] = [];
        const tx = {
            integrationDesign: {
                findMany: async () => [],
                create: async (args: { data: { shoeWidth: string } }) => {
                    seen.push(`design:${args.data.shoeWidth}`);
                },
            },
            integrationClient: {
                findMany: async () => [],
                create: async (args: { data: { shoeWidth: string } }) => {
                    seen.push(`client-link:${args.data.shoeWidth}`);
                },
            },
            user: { findFirst: async () => ({ id: OWNER }) },
            client: {
                create: async (args: { data: { shoeWidth: string } }) => {
                    seen.push(`client:${args.data.shoeWidth}`);
                },
            },
            design: { create: async () => undefined },
        };
        let began = 0;
        const prisma = {
            $transaction: async (fn: (transaction: typeof tx) => Promise<unknown>) => {
                began += 1;
                return fn(tx);
            },
        } as unknown as PrismaClient;
        const store = prismaDogfoodSavedDesignStore(prisma);
        const created = await store.establishVerifiedOrder?.(establishInput("", "medium"));
        expect(created).toMatchObject({ outcome: "created" });
        expect(seen).toEqual(["client:medium", "client-link:medium", "design:medium"]);
        for (const width of ["extra_narrow", "extra_wide", "giant"]) {
            await expect(
                store.establishVerifiedOrder?.(establishInput(width, "medium")),
            ).rejects.toBeInstanceOf(IntegrationShoeWidthError);
        }
        expect(began).toBe(1);
    });

    test("human create, edit, save, export, and order paths do not use integration width rejection", () => {
        const files = [
            ...sourceFiles("vertex/server/src"),
            ...sourceFiles("vertex/src"),
            ...sourceFiles("vertex/shared"),
        ];
        const readers = files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
        const importsEstablishment = (text: string) =>
            /import\s*\{[^}]*\bcreateDogfoodSavedDesign\b[^}]*\}/s.test(text);
        expect(
            readers.filter((entry) => importsEstablishment(entry.text)).map((entry) => entry.file),
        ).toEqual(["vertex/server/src/routers/manufacturing.ts"]);
        expect(
            readers
                .filter((entry) => entry.text.includes("integrationLinkShoeWidth"))
                .map((entry) => entry.file)
                .sort(),
        ).toEqual(
            [
                "vertex/server/src/lib/dogfood-order-auto-bind.ts",
                "vertex/server/src/lib/dogfood-saved-design.ts",
            ].sort(),
        );
        expect(
            readers
                .filter((entry) => entry.text.includes("IntegrationShoeWidthError"))
                .map((entry) => entry.file)
                .sort(),
        ).toEqual(
            [
                "vertex/server/src/lib/dogfood-saved-design.ts",
                "vertex/server/src/routers/manufacturing.ts",
            ].sort(),
        );
        const human = [
            "vertex/server/src/routers/client.ts",
            "vertex/server/src/routers/export.ts",
            "vertex/server/src/lib/saved-design-snapshot.ts",
            "vertex/shared/saved-design-snapshot.ts",
            "vertex/shared/saved-design-catalog.ts",
            "vertex/shared/client-files.ts",
            "vertex/src/stores/client-store.ts",
            "vertex/src/stores/design-store.ts",
            "vertex/src/features/exports/export-service.ts",
            "vertex/src/features/clients/client-actions.ts",
            "vertex/src/lib/geometry/shoe-width.ts",
            "vertex/server/src/routers/integrations/service.ts",
            "vertex/server/src/routers/integrations/prisma-store.ts",
        ];
        for (const file of human) {
            const text = readFileSync(file, "utf8");
            expect(text, file).not.toContain("integrationLinkShoeWidth");
            expect(text, file).not.toContain("IntegrationShoeWidthError");
            expect(text, file).not.toContain("createDogfoodSavedDesign");
        }
        expect([...CHART_SHOE_WIDTHS]).toEqual(["narrow", "medium", "wide", "extra_wide"]);
        expect(normalizeShoeWidth("extra_narrow")).toBe("extra_narrow");
        expect(normalizeShoeWidth("extra_wide")).toBe("extra_wide");
        expect(normalizeShoeWidth("wide")).toBe("wide");
        expect(normalizeShoeWidth(undefined)).toBe("medium");
        expect(parseSavedDesignCatalog({ width: "extra_narrow" }).width).toBe("extra_narrow");
        expect(parseSavedDesignCatalog({ width: "extra_wide" }).width).toBe("extra_wide");
        const prescribed = buildSavedDesignSnapshot({
            stored: null,
            catalog: parseSavedDesignCatalog({
                shoe_size: { system: "US_M", size: 10 },
                width: "extra_wide",
            }),
        });
        expect(prescribed.shoeWidth).toBe("extra_wide");
        expect(prescribed.shoeWidthSource).toBe("prescribed");
        expect(settingsEnvelopeForSave(prescribed.design).settings).toMatchObject({
            shoeWidth: "extra_wide",
        });
        const omitted = buildSavedDesignSnapshot({
            stored: null,
            catalog: parseSavedDesignCatalog({ shoe_size: { system: "US_M", size: 10 } }),
        });
        expect(omitted.shoeWidth).toBe("medium");
        expect(omitted.shoeWidthSource).toBe("defaulted");
    });
});

describe("isolated postgres acceptance gate", () => {
    test("default unit discovery excludes the acceptance file and the explicit command fails closed", () => {
        const safeUrl = "postgresql://orthocad_test@127.0.0.1:54329/orthocad_width";
        expect(() => assertIsolatedAcceptanceEnv({})).toThrow(/not selected/);
        expect(() => assertIsolatedAcceptanceEnv({ ORTHOCAD_ISOLATED_PG_ACCEPTANCE: "1" })).toThrow(
            /missing/,
        );
        expect(() =>
            assertIsolatedAcceptanceEnv({
                ORTHOCAD_ISOLATED_PG_ACCEPTANCE: "1",
                ORTHOCAD_ISOLATED_PG_URL: "postgresql://user:secret@db.example.supabase.co/postgres",
            }),
        ).toThrow(/localhost|disposable|orthocad_test/);
        expect(
            assertIsolatedAcceptanceEnv({
                ORTHOCAD_ISOLATED_PG_ACCEPTANCE: "1",
                ORTHOCAD_ISOLATED_PG_URL: safeUrl,
            }),
        ).toBe(safeUrl);
        const acceptance = readFileSync(
            "vertex/server/src/lib/dogfood-saved-design.pg.optional.test.ts",
            "utf8",
        );
        expect(REQUIRED_CASES.length).toBeGreaterThanOrEqual(10);
        for (const name of REQUIRED_CASES) expect(acceptance, name).toContain(name);
        expect(readFileSync("rstest.config.ts", "utf8")).toContain('"**/*.optional.test.ts"');
        const isolated = readFileSync("rstest.isolated-pg.config.ts", "utf8");
        expect(isolated).toContain("dogfood-saved-design.pg.optional.test.ts");
        expect(isolated).toContain('["json", { outputPath: "/tmp/orthocad-isolated-pg-report.json" }]');
        expect(isolated).not.toContain("**/*.optional.test.ts");
        const workflow = readFileSync(".github/workflows/main.yml", "utf8");
        expect(workflow).toContain("isolated-postgres-acceptance:");
        expect(workflow).toContain("needs: [unit-tests, isolated-postgres-acceptance]");
        expect(workflow).toContain("node scripts/ci/isolated-postgres-acceptance.mjs run");
        expect(workflow).toContain("postgres:16");
        const missing = spawnSync(process.execPath, ["scripts/ci/isolated-postgres-acceptance.mjs", "run"], {
            encoding: "utf8",
            env: { PATH: process.env.PATH ?? "" },
        });
        expect(missing.status).not.toBe(0);
        expect(`${missing.stdout ?? ""}${missing.stderr ?? ""}`).toMatch(/not selected|Refusing to skip/);
    });

    test("the GitHub compact reporter is not a pass, and a complete JSON summary is", () => {
        const compact = [
            "Rstest v0.10.0",
            ...REQUIRED_CASES.map((name) => `✓ isolated postgres identity transaction > ${name}`),
            "Test Files  1 passed",
            "     Tests  10 passed",
        ].join("\n");
        expect(compact).not.toContain('"passedTests"');
        expect(() => assertAcceptanceSummary(compact)).toThrow(/JSON summary/);
        const passing = {
            tool: "rstest",
            status: "pass",
            summary: {
                tests: REQUIRED_CASES.length,
                passedTests: REQUIRED_CASES.length,
                failedTests: 0,
                skippedTests: 0,
                todoTests: 0,
            },
            tests: REQUIRED_CASES.map((name) => ({
                status: "pass",
                fullName: `isolated postgres identity transaction > ${name}`,
            })),
        };
        expect(() => assertAcceptanceSummary(passing)).not.toThrow();
        expect(() =>
            assertAcceptanceSummary({
                ...passing,
                summary: { ...passing.summary, skippedTests: 1, tests: REQUIRED_CASES.length + 1 },
            }),
        ).toThrow(/skippedTests/);
        expect(() =>
            assertAcceptanceSummary({
                ...passing,
                tests: passing.tests.slice(0, -1),
            }),
        ).toThrow(/missing passed cases/);
        expect(() => assertAcceptanceSummary({ ...passing, status: "fail" })).toThrow(/status fail/);
    });
});
