// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Online consumer for POST /api/integrations/orthocad/v1/order-owner/verify.
// The gate is off until server config supplies an HTTPS origin and the dedicated bearer.
// This module does not read process.env unless the runtime factory is called.

import { randomUUID } from "node:crypto";

import { assertDogfoodNotHeld } from "../../../shared/dogfood-holds.js";
import { DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import {
    DOGFOOD_BIND_ORDER_PERSON,
    DOGFOOD_SAVED_DESIGN_ESTABLISHMENT_AUDIENCE,
    ORDER_OWNER_WIRE_FRESH_MS,
    ORTHOCAD_DOGFOOD_SAVED_DESIGN_PRINCIPAL,
    type OrderPersonVerification,
    type OrderPersonVerificationFailure,
    type OrderPersonVerifier,
    unconfiguredOrderPersonVerifier,
} from "./dogfood-order-person-verifier.js";

export const ORDER_OWNER_VERIFY_PATH = "/api/integrations/orthocad/v1/order-owner/verify";

/** New server-only config names. Not provisioned. Not public. */
export const DOGFOOD_ORDER_OWNER_CONFIG_KEYS = {
    gate: "ORTHOCAD_DOGFOOD_ORDER_OWNER_VERIFY",
    origin: "ORTHOCAD_DOGFOOD_ORDER_OWNER_ORIGIN",
    bearer: "ORTHOCAD_DOGFOOD_ORDER_OWNER_BEARER",
} as const;

export const DOGFOOD_ORDER_OWNER_WIRE = {
    method: "POST",
    path: ORDER_OWNER_VERIFY_PATH,
    auth: "Authorization: Bearer",
    principal: ORTHOCAD_DOGFOOD_SAVED_DESIGN_PRINCIPAL,
    audience: DOGFOOD_SAVED_DESIGN_ESTABLISHMENT_AUDIENCE,
    source: "vo2",
    tenantId: DOGFOOD_TENANT_ID,
    freshForMs: ORDER_OWNER_WIRE_FRESH_MS,
    cache: "no-store",
    redirects: "forbidden",
    credentialProvisioned: false,
    gate: "off",
    producerOwner: "VO PM",
    consumerSetupOwner: "OrthoCAD server operator",
    configKeys: DOGFOOD_ORDER_OWNER_CONFIG_KEYS,
} as const;

const REQUEST_KEYS = [
    "audience",
    "external_order_id",
    "issued_at",
    "request_id",
    "source",
    "tenant_id",
    "v",
] as const;

const SUCCESS_KEYS = [...REQUEST_KEYS, "person_id"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STATUS_CODES: Record<number, readonly string[]> = {
    400: ["malformed", "stale_request"],
    401: ["unauthenticated"],
    403: ["audience_rejected", "tenant_rejected", "dogfood_disabled"],
    404: ["order_not_found"],
    409: ["order_cancelled", "order_unbound"],
    503: ["unavailable"],
};

export interface OrderOwnerWireRequest {
    v: 1;
    source: "vo2";
    tenant_id: typeof DOGFOOD_TENANT_ID;
    external_order_id: string;
    audience: typeof DOGFOOD_SAVED_DESIGN_ESTABLISHMENT_AUDIENCE;
    issued_at: number;
    request_id: string;
}

export function orderOwnerWireRequest(orderId: string, now: Date, requestId: string): OrderOwnerWireRequest {
    return {
        v: 1,
        source: "vo2",
        tenant_id: DOGFOOD_TENANT_ID,
        external_order_id: orderId,
        audience: DOGFOOD_SAVED_DESIGN_ESTABLISHMENT_AUDIENCE,
        issued_at: Math.floor(now.getTime() / 1000),
        request_id: requestId,
    };
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const present = Object.keys(value).sort();
    const expected = [...keys].sort();
    return present.length === expected.length && present.every((key, index) => key === expected[index]);
}

function isUuid(value: unknown): value is string {
    return typeof value === "string" && UUID.test(value);
}

function isUnixSeconds(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && Math.abs(value) < 10_000_000_000;
}

function freshSeconds(issuedAt: number, now: Date): boolean {
    const ageMs = now.getTime() - issuedAt * 1000;
    return ageMs >= -ORDER_OWNER_WIRE_FRESH_MS && ageMs <= ORDER_OWNER_WIRE_FRESH_MS;
}

export function httpsOrigin(value: string): string | null {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    if (url.search || url.hash) return null;
    return url.origin;
}

function failure(code: OrderPersonVerificationFailure): OrderPersonVerification {
    return { ok: false, code };
}

function codeForStatus(status: number, code: string): OrderPersonVerificationFailure {
    if (status === 401 && code === "unauthenticated") return "verifier_unauthorized";
    if (
        status === 403 &&
        (code === "audience_rejected" || code === "tenant_rejected" || code === "dogfood_disabled")
    ) {
        return "verifier_unauthorized";
    }
    if (status === 400 && code === "stale_request") return "verifier_stale";
    if (status === 400 && code === "malformed") return "verifier_untrusted";
    if (status === 503 && code === "unavailable") return "verifier_unavailable";
    if (
        (status === 404 || status === 409) &&
        (code === "order_not_found" || code === "order_cancelled" || code === "order_unbound")
    ) {
        return "verifier_untrusted";
    }
    return "verifier_untrusted";
}

function parseError(
    status: number,
    value: Record<string, unknown>,
    requestId: string,
): OrderPersonVerification {
    const keys = Object.keys(value);
    if (keys.some((key) => key !== "v" && key !== "code" && key !== "request_id"))
        return failure("verifier_untrusted");
    if (value.v !== 1 || typeof value.code !== "string") return failure("verifier_untrusted");
    if ("request_id" in value && value.request_id !== requestId) return failure("verifier_untrusted");
    const allowed = STATUS_CODES[status];
    if (!allowed?.includes(value.code)) return failure("verifier_untrusted");
    return failure(codeForStatus(status, value.code));
}

export function interpretOrderOwnerResponse(args: {
    status: number;
    redirected: boolean;
    body: unknown;
    request: OrderOwnerWireRequest;
    now: Date;
}): OrderPersonVerification {
    if (args.redirected || (args.status >= 300 && args.status < 400)) return failure("verifier_untrusted");
    if (!args.body || typeof args.body !== "object" || Array.isArray(args.body))
        return failure("verifier_untrusted");
    const value = args.body as Record<string, unknown>;
    if (args.status !== 200) return parseError(args.status, value, args.request.request_id);
    if (!exactKeys(value, SUCCESS_KEYS)) return failure("verifier_untrusted");
    if (value.v !== 1 || value.source !== "vo2" || value.tenant_id !== DOGFOOD_TENANT_ID) {
        return failure("verifier_untrusted");
    }
    if (value.audience !== DOGFOOD_SAVED_DESIGN_ESTABLISHMENT_AUDIENCE) return failure("verifier_untrusted");
    if (
        value.external_order_id !== args.request.external_order_id ||
        value.request_id !== args.request.request_id
    ) {
        return failure("verifier_untrusted");
    }
    if (!isUuid(value.person_id) || !isUnixSeconds(value.issued_at)) return failure("verifier_untrusted");
    if (!freshSeconds(value.issued_at, args.now)) return failure("verifier_stale");
    try {
        assertDogfoodNotHeld(value.person_id);
    } catch {
        return failure("verifier_untrusted");
    }
    return {
        ok: true,
        principal: ORTHOCAD_DOGFOOD_SAVED_DESIGN_PRINCIPAL,
        source: "vo2",
        tenantId: DOGFOOD_TENANT_ID,
        externalOrderId: args.request.external_order_id,
        externalPersonId: value.person_id,
        audience: DOGFOOD_SAVED_DESIGN_ESTABLISHMENT_AUDIENCE,
        operation: DOGFOOD_BIND_ORDER_PERSON,
        verifiedAt: new Date(value.issued_at * 1000).toISOString(),
        givenName: null,
        familyName: null,
    };
}

export interface OrderOwnerFetchDeps {
    fetchImpl: typeof fetch;
    now: () => Date;
    requestId: () => string;
    timeoutMs?: number;
}

export async function postOrderOwnerVerify(
    config: { origin: string; bearer: string },
    orderId: string,
    deps: OrderOwnerFetchDeps,
): Promise<OrderPersonVerification> {
    const origin = httpsOrigin(config.origin);
    if (!origin || !config.bearer.trim()) return failure("verifier_unauthorized");
    if (!isUuid(orderId)) return failure("verifier_untrusted");
    const now = deps.now();
    const request = orderOwnerWireRequest(orderId, now, deps.requestId());
    if (!freshSeconds(request.issued_at, now)) return failure("verifier_stale");
    const timeout = AbortSignal.timeout(deps.timeoutMs ?? 10_000);
    let response: Response;
    try {
        const init: RequestInit = {
            method: "POST",
            redirect: "manual",
            signal: timeout,
            headers: {
                authorization: `Bearer ${config.bearer}`,
                accept: "application/json",
                "content-type": "application/json",
                "cache-control": "no-store",
            },
            body: JSON.stringify(request),
        };
        Object.assign(init, { cache: "no-store" });
        response = await deps.fetchImpl(`${origin}${ORDER_OWNER_VERIFY_PATH}`, init);
    } catch {
        return failure("verifier_unavailable");
    }
    if (response.status >= 300 && response.status < 400) return failure("verifier_untrusted");
    if (response.redirected || response.type === "opaqueredirect") return failure("verifier_untrusted");
    const text = await response.text();
    if (text.length > 4_000) return failure("verifier_untrusted");
    let body: unknown;
    try {
        body = JSON.parse(text) as unknown;
    } catch {
        return failure("verifier_untrusted");
    }
    return interpretOrderOwnerResponse({
        status: response.status,
        redirected: response.redirected,
        body,
        request,
        now,
    });
}

export function dogfoodOrderOwnerVerifierFromEnv(
    env: Record<string, string | undefined>,
    deps?: Partial<OrderOwnerFetchDeps>,
): OrderPersonVerifier {
    if (env[DOGFOOD_ORDER_OWNER_CONFIG_KEYS.gate] !== "on") return unconfiguredOrderPersonVerifier;
    const origin = env[DOGFOOD_ORDER_OWNER_CONFIG_KEYS.origin] ?? "";
    const bearer = env[DOGFOOD_ORDER_OWNER_CONFIG_KEYS.bearer] ?? "";
    if (!httpsOrigin(origin) || !bearer.trim()) {
        return {
            async verify() {
                return failure("verifier_unauthorized");
            },
        };
    }
    const fetchImpl = deps?.fetchImpl ?? fetch;
    const now = deps?.now ?? (() => new Date());
    const requestId = deps?.requestId ?? randomUUID;
    return {
        async verify(request) {
            return postOrderOwnerVerify({ origin, bearer }, request.externalOrderId, {
                fetchImpl,
                now,
                requestId,
                timeoutMs: deps?.timeoutMs,
            });
        },
    };
}

/** Runtime factory used by create_saved_design. Caller passes server env. Gate stays off by default. */
export function runtimeDogfoodOrderOwnerVerifier(
    env: Record<string, string | undefined>,
): OrderPersonVerifier {
    return dogfoodOrderOwnerVerifierFromEnv(env);
}
