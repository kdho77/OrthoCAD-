// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Outbound design.exported webhook. Signs the body and retries delivery.
// This module does not read or write an order status. File Ready stays a human decision.

import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_REPLAY_WINDOW_SEC = 5 * 60;
export const DOWNLOAD_URL_TTL_SEC = 24 * 60 * 60;
export const WEBHOOK_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000, 21_600_000];

export interface ExportedFile {
    side: string;
    machine: string;
    format: string;
    material: string;
    download_url: string;
}

/** Payload fields are the file links only. There is no order status. */
export interface DesignExportedEvent {
    id: string;
    type: "design.exported";
    tenant_id: string;
    design_id: string;
    source: "vo2" | "orthocloud";
    external_order_id: string;
    files: ExportedFile[];
}

export function buildDesignExportedEvent(input: {
    id: string;
    tenantId: string;
    designId: string;
    source: "vo2" | "orthocloud";
    externalOrderId: string;
    files: ExportedFile[];
}): DesignExportedEvent {
    return {
        id: input.id,
        type: "design.exported",
        tenant_id: input.tenantId,
        design_id: input.designId,
        source: input.source,
        external_order_id: input.externalOrderId,
        files: input.files.map((file) => ({
            side: file.side,
            machine: file.machine,
            format: file.format,
            material: file.material,
            download_url: file.download_url,
        })),
    };
}

export function signDownloadUrl(
    base: string,
    storageKey: string,
    issuedAtSec: number,
    secret: string,
): string {
    const exp = issuedAtSec + DOWNLOAD_URL_TTL_SEC;
    const sig = createHmac("sha256", secret).update(`${storageKey}.${exp}`).digest("hex");
    const root = base.replace(/\/+$/, "");
    return `${root}/${storageKey}?exp=${exp}&sig=${sig}`;
}

export function signDesignExported(secret: string, timestampSec: number, rawBody: string): string {
    const v1 = createHmac("sha256", secret).update(`${timestampSec}.${rawBody}`).digest("hex");
    return `t=${timestampSec},v1=${v1}`;
}

export function verifyDesignExportedSignature(
    secret: string,
    header: string,
    rawBody: string,
    nowSec: number,
): { ok: true } | { ok: false; reason: "malformed" | "replay" | "signature" } {
    const parts = new Map<string, string>();
    for (const piece of header.split(",")) {
        const eq = piece.indexOf("=");
        if (eq <= 0) continue;
        parts.set(piece.slice(0, eq).trim(), piece.slice(eq + 1).trim());
    }
    const tRaw = parts.get("t");
    const v1 = parts.get("v1");
    if (!tRaw || !v1 || !/^\d+$/.test(tRaw)) return { ok: false, reason: "malformed" };
    const timestamp = Number(tRaw);
    if (Math.abs(nowSec - timestamp) > WEBHOOK_REPLAY_WINDOW_SEC) return { ok: false, reason: "replay" };
    const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    const left = Buffer.from(expected);
    const right = Buffer.from(v1);
    if (left.length !== right.length || !timingSafeEqual(left, right))
        return { ok: false, reason: "signature" };
    return { ok: true };
}

/** Next retry instant after `failedAttempts` failures, or null once the 24-hour window is over. */
export function nextWebhookRetryAt(failedAttempts: number, startedAtMs: number): number | null {
    if (failedAttempts < 1) return null;
    let elapsed = 0;
    for (let i = 0; i < failedAttempts; i++) {
        elapsed += RETRY_DELAYS_MS[Math.min(i, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[0];
        if (elapsed > WEBHOOK_RETRY_WINDOW_MS) return null;
    }
    return startedAtMs + elapsed;
}

export interface DeliveryResult {
    ok: boolean;
    status: number;
    signature: string;
    body: string;
}

/**
 * One signed POST. Does not update an order, a job, or a production status.
 */
export async function deliverDesignExported(input: {
    url: string;
    secret: string;
    event: DesignExportedEvent;
    timestampSec: number;
    fetchImpl?: typeof fetch;
}): Promise<DeliveryResult> {
    const body = JSON.stringify(input.event);
    const signature = signDesignExported(input.secret, input.timestampSec, body);
    const fetchImpl = input.fetchImpl ?? fetch;
    const response = await fetchImpl(input.url, {
        method: "POST",
        redirect: "manual",
        headers: {
            "content-type": "application/json",
            "X-OrthoCAD-Signature": signature,
        },
        body,
    });
    return { ok: response.ok, status: response.status, signature, body };
}

/**
 * Retries with backoff until delivery succeeds or the 24-hour window ends.
 * `sleep` is injected so tests do not wait on the clock. No order status is written.
 */
export async function deliverDesignExportedWithRetries(input: {
    url: string;
    secret: string;
    event: DesignExportedEvent;
    timestampSec: number;
    startedAtMs?: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
}): Promise<DeliveryResult> {
    const startedAtMs = input.startedAtMs ?? Date.now();
    const sleep = input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    let now = startedAtMs;
    let failedAttempts = 0;
    let last: DeliveryResult = { ok: false, status: 0, signature: "", body: "" };
    for (;;) {
        last = await deliverDesignExported(input);
        if (last.ok) return last;
        failedAttempts += 1;
        const next = nextWebhookRetryAt(failedAttempts, startedAtMs);
        if (next == null) return last;
        await sleep(Math.max(0, next - now));
        now = next;
    }
}
