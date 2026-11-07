// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Single-use bridge enrollment. Only hashes are stored. Proofs are not logged.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const BRIDGE_AUDIENCE = "orthocad-print-bridge";
export const ENROLLMENT_TTL_MS = 10 * 60 * 1000;

export interface EnrollmentRecord {
    id: string;
    proofHash: string;
    tenantId: string;
    shopId: string;
    bridgeId: string;
    printerIds: string[];
    audience: typeof BRIDGE_AUDIENCE;
    origin: string;
    expiresAt: string;
    usedAt: string | null;
}

export interface BridgeCredential {
    bridgeId: string;
    tenantId: string;
    shopId: string;
    printerIds: string[];
    credentialHash: string;
    revokedAt: string | null;
    lastSeenAt: string | null;
    origin: string;
}

export function sha256Hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function sameHash(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

export function createEnrollment(input: {
    tenantId: string;
    shopId: string;
    bridgeId: string;
    printerIds: string[];
    origin: string;
    now: Date;
    ttlMs?: number;
}): { proof: string; record: EnrollmentRecord } {
    const proof = randomBytes(32).toString("base64url");
    const record: EnrollmentRecord = {
        id: crypto.randomUUID(),
        proofHash: sha256Hex(proof),
        tenantId: input.tenantId,
        shopId: input.shopId,
        bridgeId: input.bridgeId,
        printerIds: [...input.printerIds],
        audience: BRIDGE_AUDIENCE,
        origin: input.origin,
        expiresAt: new Date(input.now.getTime() + (input.ttlMs ?? ENROLLMENT_TTL_MS)).toISOString(),
        usedAt: null,
    };
    return { proof, record };
}

export function issueCredential(): { credential: string; credentialHash: string } {
    const credential = randomBytes(32).toString("base64url");
    return { credential, credentialHash: sha256Hex(credential) };
}

export type RedeemResult =
    | { ok: true; credential: string; stored: BridgeCredential }
    | { ok: false; reason: "expired" | "used" | "mismatch" | "audience" | "origin" | "bridge" };

export function redeemEnrollment(input: {
    record: EnrollmentRecord;
    proof: string;
    bridgeId: string;
    origin: string;
    now: Date;
}): RedeemResult {
    if (input.record.audience !== BRIDGE_AUDIENCE) return { ok: false, reason: "audience" };
    if (input.record.origin !== input.origin) return { ok: false, reason: "origin" };
    if (input.record.bridgeId !== input.bridgeId) return { ok: false, reason: "bridge" };
    if (input.record.usedAt) return { ok: false, reason: "used" };
    if (new Date(input.record.expiresAt).getTime() <= input.now.getTime())
        return { ok: false, reason: "expired" };
    if (!sameHash(input.record.proofHash, sha256Hex(input.proof))) return { ok: false, reason: "mismatch" };
    const issued = issueCredential();
    return {
        ok: true,
        credential: issued.credential,
        stored: {
            bridgeId: input.record.bridgeId,
            tenantId: input.record.tenantId,
            shopId: input.record.shopId,
            printerIds: [...input.record.printerIds],
            credentialHash: issued.credentialHash,
            revokedAt: null,
            lastSeenAt: null,
            origin: input.record.origin,
        },
    };
}

export function credentialMatches(stored: BridgeCredential, credential: string): boolean {
    return sameHash(stored.credentialHash, sha256Hex(credential));
}
