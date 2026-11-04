// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Server-to-server credentials for the launch connector.
// The API key is hashed before it is stored. Nothing in this module logs the key.

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

import type { CredentialRecord, IntegrationStore } from "../routers/integrations/store.js";

const KEY_PREFIX = "ocad_";
const SEAL_VERSION = "v1";

export function hashIntegrationKey(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/** Returns the raw key once. Callers must not log, persist, or send it to a browser. */
export function generateIntegrationKey(): { token: string; hash: string } {
    const token = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    return { token, hash: hashIntegrationKey(token) };
}

export function generateWebhookSecret(): string {
    return randomBytes(32).toString("base64url");
}

export function redactSecrets(value: string): string {
    return value
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted-key]")
        .replace(/ocad_[A-Za-z0-9_-]+/g, "[redacted-key]");
}

function decodeSecretKey(keyBase64: string): Buffer {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32) {
        throw new Error("INTEGRATION_SECRET_KEY must be 32 bytes, base64-encoded");
    }
    return key;
}

/** AES-256-GCM. The ciphertext is what gets stored for the webhook signing secret. */
export function sealSecret(plaintext: string, keyBase64: string): string {
    const key = decodeSecretKey(keyBase64);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${SEAL_VERSION}.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function openSecret(sealed: string, keyBase64: string): string {
    const [version, ivPart, tagPart, bodyPart] = sealed.split(".");
    if (version !== SEAL_VERSION || !ivPart || !tagPart || !bodyPart) {
        throw new Error("Webhook secret ciphertext is not readable");
    }
    const key = decodeSecretKey(keyBase64);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(bodyPart, "base64url")), decipher.final()]);
    return plain.toString("utf8");
}

export interface IssueIntegrationCredentialInput {
    label: string;
    tenantIds: string[];
    webhookUrl?: string | null;
    /** Base64-encoded 32-byte key. Required when webhookUrl is set. Never a tenant API key. */
    secretKey?: string | null;
}

/**
 * Creates one credential for an existing tenant allowlist.
 * The returned apiKey and webhookSecret are shown once and are not stored in plaintext.
 * This does not create tenants.
 */
export async function issueIntegrationCredential(
    store: IntegrationStore,
    input: IssueIntegrationCredentialInput,
): Promise<{ credentialId: string; apiKey: string; webhookSecret: string | null }> {
    const tenantIds = [...new Set(input.tenantIds)];
    if (!input.label.trim()) throw new Error("label is required");
    if (tenantIds.length === 0) throw new Error("A credential needs at least one tenant");
    for (const tenantId of tenantIds) {
        if (!(await store.tenantExists(tenantId))) {
            throw new Error(`Unknown tenant ${tenantId}. Refusing to create a tenant.`);
        }
    }

    const { token, hash } = generateIntegrationKey();
    let webhookSecret: string | null = null;
    let webhookSecretCiphertext: string | null = null;
    if (input.webhookUrl) {
        if (!input.secretKey) {
            throw new Error("INTEGRATION_SECRET_KEY is required to store a webhook secret");
        }
        webhookSecret = generateWebhookSecret();
        webhookSecretCiphertext = sealSecret(webhookSecret, input.secretKey);
    }

    const row: CredentialRecord = {
        id: randomUUID(),
        label: input.label.trim(),
        keyHash: hash,
        tenantIds,
        webhookUrl: input.webhookUrl ?? null,
        webhookSecretCiphertext,
        revokedAt: null,
    };
    await store.insertCredential(row);
    return { credentialId: row.id, apiKey: token, webhookSecret };
}
