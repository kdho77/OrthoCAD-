// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Server-side consumer for a vo2 order-owner verification.
// Wire method, path, and credential binding are unresolved. This file does not
// name an endpoint or a key, and the default verifier denies.

import { DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";

/** Role of the principal that may attest an order's person. Not a credential name. */
export const VO_ORDER_OWNER_PRINCIPAL = "vo-order-owner" as const;

/** Consumer audience. Not a URL and not a caller argument. */
export const DOGFOOD_SAVED_DESIGN_AUDIENCE = "dogfood-saved-design" as const;

export const DOGFOOD_BIND_ORDER_PERSON = "bind-order-person" as const;

/** Use-time freshness. A result older than this is refused. Nothing is cached. */
export const ORDER_PERSON_FRESH_MS = 60_000;

export const ORDER_PERSON_PRODUCER_UNRESOLVED = [
    "read method",
    "read path",
    "authenticated principal credential binding",
    "wire field names and types",
    "revocation signal",
    "freshness clock source",
] as const;

/**
 * Semantic consumer contract. Transport is intentionally unresolved until the
 * VO producer supplies the supported read.
 */
export const DOGFOOD_ORDER_PERSON_CONTRACT = {
    transport: "unresolved",
    source: "vo2",
    tenant: "internal-dogfood",
    audience: DOGFOOD_SAVED_DESIGN_AUDIENCE,
    operation: DOGFOOD_BIND_ORDER_PERSON,
    principal: VO_ORDER_OWNER_PRINCIPAL,
    freshForMs: ORDER_PERSON_FRESH_MS,
    producerOwner: "VO PM",
    consumerWiringOwner: "OrthoCAD server operator",
    productionBotScopesUnchanged: true,
    credentialIssued: false,
    unresolved: ORDER_PERSON_PRODUCER_UNRESOLVED,
} as const;

export interface OrderPersonVerificationRequest {
    source: "vo2";
    tenantId: typeof DOGFOOD_TENANT_ID;
    externalOrderId: string;
    audience: typeof DOGFOOD_SAVED_DESIGN_AUDIENCE;
    operation: typeof DOGFOOD_BIND_ORDER_PERSON;
}

export interface VerifiedOrderPerson {
    principal: typeof VO_ORDER_OWNER_PRINCIPAL;
    source: "vo2";
    tenantId: typeof DOGFOOD_TENANT_ID;
    externalOrderId: string;
    externalPersonId: string;
    audience: typeof DOGFOOD_SAVED_DESIGN_AUDIENCE;
    operation: typeof DOGFOOD_BIND_ORDER_PERSON;
    verifiedAt: string;
    givenName: string | null;
    familyName: string | null;
}

export type OrderPersonVerificationFailure =
    | "verifier_unconfigured"
    | "verifier_unauthorized"
    | "verifier_revoked"
    | "verifier_untrusted"
    | "verifier_stale"
    | "verifier_incomplete";

export type OrderPersonVerification =
    | ({ ok: true } & VerifiedOrderPerson)
    | { ok: false; code: OrderPersonVerificationFailure };

export interface OrderPersonVerifier {
    verify(request: OrderPersonVerificationRequest): Promise<OrderPersonVerification>;
}

export function dogfoodOrderPersonRequest(externalOrderId: string): OrderPersonVerificationRequest {
    return {
        source: "vo2",
        tenantId: DOGFOOD_TENANT_ID,
        externalOrderId,
        audience: DOGFOOD_SAVED_DESIGN_AUDIENCE,
        operation: DOGFOOD_BIND_ORDER_PERSON,
    };
}

/** Deny. No network call and no credential read. */
export const unconfiguredOrderPersonVerifier: OrderPersonVerifier = {
    async verify() {
        return { ok: false, code: "verifier_unconfigured" };
    },
};

function cleanName(value: string | null | undefined): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 100) return null;
    return trimmed;
}

/**
 * Accept a verifier result only when it matches the server request.
 * Caller-shaped fields are not passed here.
 */
export function acceptVerifiedOrderPerson(
    result: OrderPersonVerification,
    request: OrderPersonVerificationRequest,
    now: Date,
): { ok: true; person: VerifiedOrderPerson } | { ok: false; code: OrderPersonVerificationFailure } {
    if (!result.ok) return { ok: false, code: result.code };
    if (result.principal !== VO_ORDER_OWNER_PRINCIPAL) return { ok: false, code: "verifier_unauthorized" };
    if (result.source !== "vo2" || request.source !== "vo2") return { ok: false, code: "verifier_untrusted" };
    if (result.tenantId !== DOGFOOD_TENANT_ID || request.tenantId !== DOGFOOD_TENANT_ID) {
        return { ok: false, code: "verifier_untrusted" };
    }
    if (result.audience !== DOGFOOD_SAVED_DESIGN_AUDIENCE || request.audience !== result.audience) {
        return { ok: false, code: "verifier_untrusted" };
    }
    if (result.operation !== DOGFOOD_BIND_ORDER_PERSON || request.operation !== result.operation) {
        return { ok: false, code: "verifier_untrusted" };
    }
    if (result.externalOrderId !== request.externalOrderId) return { ok: false, code: "verifier_untrusted" };
    const personId = result.externalPersonId.trim();
    if (!personId || personId.length > 200) return { ok: false, code: "verifier_untrusted" };
    const verifiedAt = Date.parse(result.verifiedAt);
    if (!Number.isFinite(verifiedAt)) return { ok: false, code: "verifier_stale" };
    const age = now.getTime() - verifiedAt;
    if (age < -5_000 || age > ORDER_PERSON_FRESH_MS) return { ok: false, code: "verifier_stale" };
    return {
        ok: true,
        person: {
            principal: result.principal,
            source: "vo2",
            tenantId: DOGFOOD_TENANT_ID,
            externalOrderId: request.externalOrderId,
            externalPersonId: personId,
            audience: DOGFOOD_SAVED_DESIGN_AUDIENCE,
            operation: DOGFOOD_BIND_ORDER_PERSON,
            verifiedAt: result.verifiedAt,
            givenName: cleanName(result.givenName),
            familyName: cleanName(result.familyName),
        },
    };
}

export function orderPersonStillFresh(person: VerifiedOrderPerson, now: Date): boolean {
    return acceptVerifiedOrderPerson(
        { ok: true, ...person },
        dogfoodOrderPersonRequest(person.externalOrderId),
        now,
    ).ok;
}
