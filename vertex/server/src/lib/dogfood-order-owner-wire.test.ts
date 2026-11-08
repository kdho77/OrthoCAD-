import { readFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";

import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot.js";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import {
    DOGFOOD_ORDER_OWNER_CONFIG_KEYS,
    DOGFOOD_ORDER_OWNER_WIRE,
    dogfoodOrderOwnerVerifierFromEnv,
    httpsOrigin,
    interpretOrderOwnerResponse,
    ORDER_OWNER_VERIFY_PATH,
    orderOwnerWireRequest,
    postOrderOwnerVerify,
    runtimeDogfoodOrderOwnerVerifier,
} from "./dogfood-order-owner-wire.js";
import {
    createDogfoodSavedDesign,
    type DogfoodSavedDesignStore,
    type EstablishVerifiedOrderResult,
} from "./dogfood-saved-design.js";

const fixture = JSON.parse(
    readFileSync("vertex/server/src/lib/dogfood-order-owner-verify.fixture.json", "utf8"),
) as {
    request: {
        v: 1;
        source: "vo2";
        tenant_id: string;
        external_order_id: string;
        audience: string;
        issued_at: number;
        request_id: string;
    };
    response_200: Record<string, unknown>;
    errors: Array<{ status: number; body: Record<string, unknown> }>;
    clock: { request_issued_at: number; response_issued_at: number };
};

const NOW = new Date(fixture.clock.request_issued_at * 1000);
const ORDER = fixture.request.external_order_id;
const PERSON = String(fixture.response_200.person_id);
const REQUEST = fixture.request.request_id;
const BEARER = "synthetic-bearer-not-a-secret";
const ORIGIN = "https://vo.example.test";

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-dogfood",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

const envOn = {
    [DOGFOOD_ORDER_OWNER_CONFIG_KEYS.gate]: "on",
    [DOGFOOD_ORDER_OWNER_CONFIG_KEYS.origin]: ORIGIN,
    [DOGFOOD_ORDER_OWNER_CONFIG_KEYS.bearer]: BEARER,
};

function response(status: number, body: unknown, extra?: { redirected?: boolean }): Response {
    return {
        status,
        redirected: extra?.redirected ?? false,
        type: status >= 300 && status < 400 ? "opaqueredirect" : "basic",
        text: async () => JSON.stringify(body),
    } as Response;
}

function seenFetch(body: unknown, status = 200) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return response(status, body);
    };
    return { calls, fetchImpl };
}

function verifierFor(fetchImpl: typeof fetch) {
    return dogfoodOrderOwnerVerifierFromEnv(envOn, {
        fetchImpl,
        now: () => NOW,
        requestId: () => REQUEST,
    });
}

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

function memory(seed?: { people?: PersonRow[]; orders?: OrderRow[] }) {
    const people = [...(seed?.people ?? [])];
    const orders = [...(seed?.orders ?? [])];
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
            return orders.filter((row) => row.externalOrderId === externalOrderId).slice(0, 2);
        },
        async findClient(clientId) {
            if (
                !people.some((row) => row.clientId === clientId) &&
                !orders.some((row) => row.clientId === clientId)
            ) {
                return null;
            }
            return {
                id: clientId,
                ownerId: "abababab-abab-4aba-8aba-abababababab",
                tenantId: DOGFOOD_TENANT_ID,
            };
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
            return run(() => {
                const person = people.find((row) => row.externalPersonId === input.externalPersonId);
                const order = orders.find((row) => row.externalOrderId === input.externalOrderId);
                if (order && (!person || order.clientId !== person.clientId)) {
                    return { outcome: "mismatch" } satisfies EstablishVerifiedOrderResult;
                }
                if (order && person) {
                    return { outcome: "exists", clientId: person.clientId, designId: order.designId };
                }
                const clientId = person?.clientId ?? "12121212-3434-4343-8343-121212121212";
                if (!person) {
                    people.push({
                        externalPersonId: input.externalPersonId,
                        clientId,
                        givenName: input.givenName,
                        familyName: input.familyName,
                    });
                }
                const designId = "34343434-3434-4343-8343-343434343434";
                orders.push({ externalOrderId: input.externalOrderId, designId, clientId });
                return { outcome: "created", clientId, designId, createdClient: !person };
            });
        },
    };
    return { store, people, orders };
}

describe("order-owner wire contract", () => {
    test("the published fixture is the agreed request, 200, and error envelope", () => {
        expect(fixture.request).toEqual(orderOwnerWireRequest(ORDER, NOW, REQUEST));
        expect(Object.keys(fixture.request).sort()).toEqual(
            ["audience", "external_order_id", "issued_at", "request_id", "source", "tenant_id", "v"].sort(),
        );
        expect(fixture.response_200.issued_at).not.toBe(fixture.request.issued_at);
        expect(fixture.response_200).not.toHaveProperty("person_name");
        expect(fixture.response_200).not.toHaveProperty("given_name");
        expect(DOGFOOD_ORDER_OWNER_WIRE.path).toBe(ORDER_OWNER_VERIFY_PATH);
        expect(DOGFOOD_ORDER_OWNER_WIRE.principal).toBe("orthocad-dogfood-saved-design");
        expect(DOGFOOD_ORDER_OWNER_WIRE.credentialProvisioned).toBe(false);
        expect(DOGFOOD_ORDER_OWNER_WIRE.gate).toBe("off");
        expect(httpsOrigin("http://vo.example.test")).toBeNull();
        expect(httpsOrigin("https://user:pass@vo.example.test")).toBeNull();
        expect(httpsOrigin("https://vo.example.test/verify")).toBeNull();
        expect(httpsOrigin(ORIGIN)).toBe(ORIGIN);
    });

    test("the runtime factory stays off and does not call the network", async () => {
        const { calls, fetchImpl } = seenFetch(fixture.response_200);
        const off = dogfoodOrderOwnerVerifierFromEnv(
            {},
            { fetchImpl, now: () => NOW, requestId: () => REQUEST },
        );
        await expect(off.verify(orderOwnerInternal())).resolves.toEqual({
            ok: false,
            code: "verifier_unconfigured",
        });
        const missing = dogfoodOrderOwnerVerifierFromEnv(
            { [DOGFOOD_ORDER_OWNER_CONFIG_KEYS.gate]: "on" },
            { fetchImpl, now: () => NOW, requestId: () => REQUEST },
        );
        await expect(missing.verify(orderOwnerInternal())).resolves.toEqual({
            ok: false,
            code: "verifier_unauthorized",
        });
        expect(calls).toHaveLength(0);
        expect(runtimeDogfoodOrderOwnerVerifier({}).verify).toBeTypeOf("function");
    });

    test("a fresh 200 is accepted only when every binding matches", async () => {
        const { calls, fetchImpl } = seenFetch(fixture.response_200);
        const result = await postOrderOwnerVerify({ origin: ORIGIN, bearer: BEARER }, ORDER, {
            fetchImpl,
            now: () => NOW,
            requestId: () => REQUEST,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.externalPersonId).toBe(PERSON);
        expect(result.givenName).toBeNull();
        expect(result.principal).toBe("orthocad-dogfood-saved-design");
        expect(result.audience).toBe("dogfood_saved_design_establishment");
        const init = calls[0]?.init;
        expect(calls[0]?.url).toBe(`${ORIGIN}${ORDER_OWNER_VERIFY_PATH}`);
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("manual");
        expect(init?.cache).toBe("no-store");
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${BEARER}`);
        const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(sent).toEqual(fixture.request);
        expect(JSON.stringify(sent)).not.toMatch(/synthetic-bearer|Row|Fixture|person_id/);
        const drifted = { ...fixture.response_200, issued_at: fixture.clock.request_issued_at + 10 };
        expect(
            interpretOrderOwnerResponse({
                status: 200,
                redirected: false,
                body: drifted,
                request: fixture.request,
                now: NOW,
            }).ok,
        ).toBe(true);
    });

    test("each producer error class, a bad pairing, and a mismatched echo are denied", () => {
        const expected: Record<string, string> = {
            unauthenticated: "verifier_unauthorized",
            malformed: "verifier_untrusted",
            stale_request: "verifier_stale",
            audience_rejected: "verifier_unauthorized",
            tenant_rejected: "verifier_unauthorized",
            dogfood_disabled: "verifier_unauthorized",
            order_not_found: "verifier_untrusted",
            order_cancelled: "verifier_untrusted",
            order_unbound: "verifier_untrusted",
            unavailable: "verifier_unavailable",
        };
        for (const error of fixture.errors) {
            const code = String(error.body.code);
            const result = interpretOrderOwnerResponse({
                status: error.status,
                redirected: false,
                body: error.body,
                request: fixture.request,
                now: NOW,
            });
            expect(result, code).toEqual({ ok: false, code: expected[code] });
        }
        expect(
            interpretOrderOwnerResponse({
                status: 401,
                redirected: false,
                body: { v: 1, code: "order_not_found", request_id: REQUEST },
                request: fixture.request,
                now: NOW,
            }),
        ).toEqual({ ok: false, code: "verifier_untrusted" });
        expect(
            interpretOrderOwnerResponse({
                status: 404,
                redirected: false,
                body: { v: 1, code: "order_not_found", request_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
                request: fixture.request,
                now: NOW,
            }),
        ).toEqual({ ok: false, code: "verifier_untrusted" });
    });

    test("wrong bindings, extra keys, stale clocks, redirects, and transport failure do not verify", async () => {
        const badBodies = [
            { ...fixture.response_200, audience: "dogfood-saved-design" },
            { ...fixture.response_200, source: "orthocloud" },
            { ...fixture.response_200, tenant_id: "22222222-2222-4222-8222-222222222222" },
            { ...fixture.response_200, external_order_id: "12121212-1212-4121-8121-121212121212" },
            { ...fixture.response_200, request_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
            { ...fixture.response_200, patient_name: "Row Fixture" },
            { ...fixture.response_200, issued_at: fixture.clock.request_issued_at + 301 },
            { ...fixture.response_200, issued_at: fixture.clock.request_issued_at - 301 },
        ];
        for (const body of badBodies) {
            const result = interpretOrderOwnerResponse({
                status: 200,
                redirected: false,
                body,
                request: fixture.request,
                now: NOW,
            });
            expect(result.ok, JSON.stringify(body)).toBe(false);
        }
        const redirect = await postOrderOwnerVerify({ origin: ORIGIN, bearer: BEARER }, ORDER, {
            fetchImpl: async () => response(302, fixture.response_200),
            now: () => NOW,
            requestId: () => REQUEST,
        });
        expect(redirect).toEqual({ ok: false, code: "verifier_untrusted" });
        const timeout = await postOrderOwnerVerify({ origin: ORIGIN, bearer: BEARER }, ORDER, {
            fetchImpl: async () => {
                throw new Error("timeout");
            },
            now: () => NOW,
            requestId: () => REQUEST,
        });
        expect(timeout).toEqual({ ok: false, code: "verifier_unavailable" });
        expect(JSON.stringify(timeout)).not.toMatch(/synthetic-bearer|vo\.example/);
    });

    test("correlation logging is request_id and outcome only", async () => {
        const lines: string[] = [];
        const original = console.info;
        console.info = ((message?: unknown) => {
            lines.push(String(message));
        }) as typeof console.info;
        try {
            const accepted = await postOrderOwnerVerify({ origin: ORIGIN, bearer: BEARER }, ORDER, {
                fetchImpl: seenFetch(fixture.response_200).fetchImpl,
                now: () => NOW,
                requestId: () => REQUEST,
            });
            expect(accepted.ok).toBe(true);
            const denied = await postOrderOwnerVerify({ origin: ORIGIN, bearer: BEARER }, ORDER, {
                fetchImpl: seenFetch(
                    { ...fixture.response_200, patient_name: "Row Fixture", note: ORDER },
                    200,
                ).fetchImpl,
                now: () => NOW,
                requestId: () => REQUEST,
            });
            expect(denied).toEqual({ ok: false, code: "verifier_untrusted" });
            const offline = await postOrderOwnerVerify(
                { origin: "http://insecure.example", bearer: BEARER },
                ORDER,
                {
                    fetchImpl: async () => {
                        throw new Error("must not send");
                    },
                    now: () => NOW,
                    requestId: () => "patient-order-secret",
                },
            );
            expect(offline).toEqual({ ok: false, code: "verifier_unauthorized" });
        } finally {
            console.info = original;
        }
        expect(lines).toEqual([
            JSON.stringify({ request_id: REQUEST, outcome: "accepted" }),
            JSON.stringify({ request_id: REQUEST, outcome: "verifier_untrusted" }),
            JSON.stringify({ request_id: "invalid", outcome: "verifier_unauthorized" }),
        ]);
        const leaked = lines.join("\n");
        expect(leaked).not.toContain(ORDER);
        expect(leaked).not.toContain(BEARER);
        expect(leaked).not.toContain(fixture.request.tenant_id);
        expect(leaked).not.toContain("Row");
        expect(leaked).not.toContain("patient");
        expect(leaked).not.toContain("external_order_id");
        expect(Object.keys(JSON.parse(lines[0] ?? "{}")).sort()).toEqual(["outcome", "request_id"]);
    });
});

function orderOwnerInternal() {
    return {
        source: "vo2" as const,
        tenantId: DOGFOOD_TENANT_ID,
        externalOrderId: ORDER,
        audience: "dogfood-saved-design" as const,
        operation: "bind-order-person" as const,
    };
}

describe("factory-backed first-time establishment", () => {
    test("a verified new person uses caller chart labels and not the verify body", async () => {
        const db = memory();
        const { calls, fetchImpl } = seenFetch(fixture.response_200);
        const result = await createDogfoodSavedDesign({
            principal,
            externalOrderId: ORDER,
            catalog: { shoe_size: { system: "US_M", size: 10 }, hardness: "Hard" },
            chart: { givenName: "Row", familyName: "Fixture" },
            store: db.store,
            verifier: verifierFor(fetchImpl),
            now: () => NOW,
            buildSnapshot: buildSavedDesignSnapshot,
            persist: async () => {
                throw new Error("persist is the refresh path");
            },
        });
        expect(result.established).toBe(true);
        expect(result.identity).toBe("verified_order_person");
        expect(result.shoe_width_source).toBe("defaulted");
        expect(result.hardness).toBe("Hard");
        expect(result.hardness_source).toBe("prescribed");
        expect(db.people).toEqual([
            {
                externalPersonId: PERSON,
                clientId: result.client_id,
                givenName: "Row",
                familyName: "Fixture",
            },
        ]);
        expect(db.orders).toHaveLength(1);
        expect(JSON.parse(String(calls[0]?.init.body))).not.toHaveProperty("given_name");
        expect(String(calls[0]?.init.body)).not.toMatch(/Row|Fixture/);
    });

    test("an existing person on a new order does not require or replace a name", async () => {
        const db = memory({
            people: [
                {
                    externalPersonId: PERSON,
                    clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    givenName: "Kept",
                    familyName: "Name",
                },
            ],
        });
        const { fetchImpl } = seenFetch(fixture.response_200);
        const result = await createDogfoodSavedDesign({
            principal,
            externalOrderId: ORDER,
            catalog: { shoe_size: { system: "US_M", size: 10 } },
            store: db.store,
            verifier: verifierFor(fetchImpl),
            now: () => NOW,
            buildSnapshot: buildSavedDesignSnapshot,
            persist: async () => {
                throw new Error("unused");
            },
        });
        expect(result.client_id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        expect(db.people[0]?.givenName).toBe("Kept");
        expect(db.orders).toHaveLength(1);
    });

    test("a refused verification writes nothing even when a design already exists", async () => {
        const db = memory({
            people: [
                {
                    externalPersonId: PERSON,
                    clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    givenName: "Kept",
                    familyName: "Name",
                },
            ],
            orders: [
                {
                    externalOrderId: ORDER,
                    designId: "34343434-3434-4343-8343-343434343434",
                    clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                },
            ],
        });
        const persists: string[] = [];
        await expect(
            createDogfoodSavedDesign({
                principal,
                externalOrderId: ORDER,
                store: db.store,
                verifier: verifierFor(seenFetch(fixture.errors[0]?.body, 401).fetchImpl),
                now: () => NOW,
                persist: async (designId) => {
                    persists.push(designId);
                    throw new Error("persist");
                },
            }),
        ).rejects.toMatchObject({ code: "verifier_unauthorized" });
        expect(persists).toEqual([]);
        expect(db.orders).toHaveLength(1);
    });

    test("a new person without chart labels does not invent a name", async () => {
        const db = memory();
        await expect(
            createDogfoodSavedDesign({
                principal,
                externalOrderId: ORDER,
                catalog: { shoe_size: { system: "US_M", size: 10 } },
                store: db.store,
                verifier: verifierFor(seenFetch(fixture.response_200).fetchImpl),
                now: () => NOW,
                buildSnapshot: buildSavedDesignSnapshot,
                persist: async () => {
                    throw new Error("unused");
                },
            }),
        ).rejects.toMatchObject({ code: "verifier_incomplete" });
        expect(db.people).toHaveLength(0);
        expect(db.orders).toHaveLength(0);
    });

    test("two overlapping first-time calls keep one client and one design", async () => {
        const db = memory();
        const http = seenFetch(fixture.response_200);
        const both = await Promise.all([
            createDogfoodSavedDesign({
                principal,
                externalOrderId: ORDER,
                catalog: { shoe_size: { system: "US_M", size: 10 }, hardness: "Hard" },
                chart: { givenName: "Row", familyName: "Fixture" },
                store: db.store,
                verifier: verifierFor(http.fetchImpl),
                now: () => NOW,
                buildSnapshot: buildSavedDesignSnapshot,
                persist: async (designId) => ({
                    ok: true as const,
                    design_id: designId,
                    ignored_fields: [],
                    unmapped_fields: [],
                    paths: [],
                    settingsJson: {},
                    template: "SAMPLE_Top" as const,
                    scans_used: false as const,
                    shoe_width: "medium",
                    shoe_width_source: "defaulted" as const,
                    hardness: "Hard",
                    hardness_source: "prescribed" as const,
                }),
            }),
            createDogfoodSavedDesign({
                principal,
                externalOrderId: ORDER,
                catalog: { shoe_size: { system: "US_M", size: 10 }, hardness: "Hard" },
                chart: { givenName: "Row", familyName: "Fixture" },
                store: db.store,
                verifier: verifierFor(http.fetchImpl),
                now: () => NOW,
                buildSnapshot: buildSavedDesignSnapshot,
                persist: async (designId) => ({
                    ok: true as const,
                    design_id: designId,
                    ignored_fields: [],
                    unmapped_fields: [],
                    paths: [],
                    settingsJson: {},
                    template: "SAMPLE_Top" as const,
                    scans_used: false as const,
                    shoe_width: "medium",
                    shoe_width_source: "defaulted" as const,
                    hardness: "Hard",
                    hardness_source: "prescribed" as const,
                }),
            }),
        ]);
        expect(new Set(both.map((row) => row.client_id)).size).toBe(1);
        expect(db.people).toHaveLength(1);
        expect(db.orders).toHaveLength(1);
        expect(http.calls.length).toBe(2);
    });
});
