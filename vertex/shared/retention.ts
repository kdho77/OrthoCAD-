// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Retention labels for scans and stored G-code. No storage client.

import { GCODE_RETAIN_MS } from "./production-jobs";

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Three 365-day years from upload. Not a calendar-year boundary. */
export const SCAN_RETAIN_MS = 3 * 365 * DAY_MS;

export function retentionCountdown(expiresAt: string, now = new Date()): string {
    const ms = new Date(expiresAt).getTime() - now.getTime();
    if (!Number.isFinite(ms) || ms <= 0) return "Removed";
    const days = Math.ceil(ms / DAY_MS);
    if (days === 1) return "Removed in 1 day";
    return `Removed in ${days} days`;
}

export function scanExpiresAt(uploadedAt: string): string {
    return new Date(new Date(uploadedAt).getTime() + SCAN_RETAIN_MS).toISOString();
}

export function isScanRetained(uploadedAt: string, now = new Date()): boolean {
    return now.getTime() <= new Date(uploadedAt).getTime() + SCAN_RETAIN_MS;
}

export function scanRetentionLabel(uploadedAt: string, now = new Date()): string {
    return retentionCountdown(scanExpiresAt(uploadedAt), now);
}

/**
 * G-code stays until 90 days after it was stored, or while the order is open,
 * whichever is longer. An open order has no removal date, so the row says so
 * instead of counting days.
 */
export function gcodeRetentionLabel(storedAt: string | null, orderOpen: boolean, now = new Date()): string {
    if (!storedAt) return "";
    if (orderOpen) return "Kept while the order is open";
    const expires = new Date(new Date(storedAt).getTime() + GCODE_RETAIN_MS).toISOString();
    return retentionCountdown(expires, now);
}
