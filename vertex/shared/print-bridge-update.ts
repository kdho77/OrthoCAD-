// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Signed auto-update manifests. Private keys are not read or stored here.
// Verification rejects unsigned, tampered, expired, and downgrade manifests.

import { createPrivateKey, createPublicKey, type KeyObject, sign, verify } from "node:crypto";
import { compareBridgeVersions, PRINT_BRIDGE_PRODUCT } from "./print-bridge-version.js";

export interface UpdateArtifact {
    url: string;
    sha256: string;
}

export interface UpdatePayload {
    product: typeof PRINT_BRIDGE_PRODUCT;
    channel: "stable";
    version: string;
    minVersion: string;
    releasedAt: string;
    expiresAt: string;
    platforms: Record<string, UpdateArtifact>;
}

export interface SignedUpdateManifest {
    keyId: string;
    payload: UpdatePayload;
    signature: string;
}

export type UpdateDecision =
    | { ok: true; version: string; artifact: UpdateArtifact; platform: string }
    | {
          ok: false;
          reason: "unsigned" | "tampered" | "expired" | "downgrade" | "unexpected" | "untrusted-key";
      };

export function canonicalUpdatePayload(payload: UpdatePayload): string {
    return JSON.stringify(sortValue(payload));
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => sortValue(item));
    if (!value || typeof value !== "object") return value;
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, item] of entries) sorted[key] = sortValue(item);
    return sorted;
}

export function signUpdateManifest(
    payload: UpdatePayload,
    privateKeyPem: string,
    keyId: string,
): SignedUpdateManifest {
    const key = createPrivateKey(privateKeyPem);
    const signature = sign(null, Buffer.from(canonicalUpdatePayload(payload)), key).toString("base64");
    return { keyId, payload, signature };
}

export function verifySignedManifest(input: {
    manifest: unknown;
    publicKeys: Record<string, string>;
    installedVersion: string;
    now: Date;
    platform: string;
}): UpdateDecision {
    const parsed = readManifest(input.manifest);
    if (!parsed) return { ok: false, reason: "unsigned" };
    if (!parsed.signature) return { ok: false, reason: "unsigned" };
    const pem = input.publicKeys[parsed.keyId];
    if (!pem || pem.includes("REPLACE")) return { ok: false, reason: "untrusted-key" };
    let key: KeyObject;
    try {
        key = createPublicKey(pem);
    } catch {
        return { ok: false, reason: "untrusted-key" };
    }
    const valid = verify(
        null,
        Buffer.from(canonicalUpdatePayload(parsed.payload)),
        key,
        Buffer.from(parsed.signature, "base64"),
    );
    if (!valid) return { ok: false, reason: "tampered" };
    const releasedAt = Date.parse(parsed.payload.releasedAt);
    const expiresAt = Date.parse(parsed.payload.expiresAt);
    if (!Number.isFinite(releasedAt) || !Number.isFinite(expiresAt) || expiresAt <= releasedAt) {
        return { ok: false, reason: "unexpected" };
    }
    if (expiresAt <= input.now.getTime()) return { ok: false, reason: "expired" };
    const installed = compareBridgeVersions(input.installedVersion, parsed.payload.version);
    const floor = compareBridgeVersions(input.installedVersion, parsed.payload.minVersion);
    const versions = compareBridgeVersions(parsed.payload.version, parsed.payload.minVersion);
    if (installed === null || floor === null || versions === null || versions < 0) {
        return { ok: false, reason: "unexpected" };
    }
    if (floor < 0) return { ok: false, reason: "unexpected" };
    if (installed >= 0) return { ok: false, reason: "downgrade" };
    const artifact = parsed.payload.platforms[input.platform];
    if (!artifact || !isHttps(artifact.url) || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
        return { ok: false, reason: "unexpected" };
    }
    return { ok: true, version: parsed.payload.version, artifact, platform: input.platform };
}

function isHttps(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
    } catch {
        return false;
    }
}

function readManifest(value: unknown): SignedUpdateManifest | null {
    if (!value || typeof value !== "object") return null;
    const keyId = "keyId" in value && typeof value.keyId === "string" ? value.keyId : "";
    const signature = "signature" in value && typeof value.signature === "string" ? value.signature : "";
    const payload = "payload" in value ? value.payload : null;
    if (!keyId || !payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;
    if (record.product !== PRINT_BRIDGE_PRODUCT || record.channel !== "stable") return null;
    if (typeof record.version !== "string" || typeof record.minVersion !== "string") return null;
    if (typeof record.releasedAt !== "string" || typeof record.expiresAt !== "string") return null;
    if (!record.platforms || typeof record.platforms !== "object" || Array.isArray(record.platforms))
        return null;
    const platforms: Record<string, UpdateArtifact> = {};
    for (const [platform, artifact] of Object.entries(record.platforms as Record<string, unknown>)) {
        if (!artifact || typeof artifact !== "object") return null;
        const url = "url" in artifact && typeof artifact.url === "string" ? artifact.url : "";
        const sha256 = "sha256" in artifact && typeof artifact.sha256 === "string" ? artifact.sha256 : "";
        if (!url || !sha256) return null;
        platforms[platform] = { url, sha256 };
    }
    return {
        keyId,
        signature,
        payload: {
            product: PRINT_BRIDGE_PRODUCT,
            channel: "stable",
            version: record.version,
            minVersion: record.minVersion,
            releasedAt: record.releasedAt,
            expiresAt: record.expiresAt,
            platforms,
        },
    };
}
