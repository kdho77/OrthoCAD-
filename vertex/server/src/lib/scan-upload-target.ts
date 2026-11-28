// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// VO2 handoff scan upload targets. The signed URL is a short-lived Supabase
// upload URL for the scan bucket. The object key is tenant-scoped.
// Chart scans are kept for up to 3 years. This path does not store
// manufacturing STL or G-code (those use the manufacturing bucket and the 24h sweep).

import type { SupabaseClient } from "@supabase/supabase-js";

import { SCAN_RETAIN_MS } from "../../../shared/retention.js";
import {
    createSignedUpload,
    GCODE_STORAGE_PREFIX,
    MANUFACTURING_ARCHIVE_PREFIX,
    MANUFACTURING_TEMP_PREFIX,
} from "./storage.js";

export const SCAN_STORAGE_NOT_CONFIGURED = "Scan storage not configured";
export const SCAN_UPLOAD_TARGET_FAILED = "Scan upload target failed";

/** Same window as client-chart scan blobs. Not the manufacturing 24h sweep. */
export const HANDOFF_SCAN_RETAIN_MS = SCAN_RETAIN_MS;

const SCAN_PREFIX = "scans/";
const DEFAULT_SCAN_BUCKET = "vertex-assets";
const DEFAULT_MANUFACTURING_BUCKET = "vertex-manufacturing";
const SCAN_SIDES = new Set(["left", "right", "combined"]);

export class HandoffUploadTargetError extends Error {
    readonly status = 500 as const;
    readonly reason: "scan_storage_not_configured" | "sign_failed";

    constructor(
        message: string,
        reason: "scan_storage_not_configured" | "sign_failed",
        options?: { cause?: unknown },
    ) {
        super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = "HandoffUploadTargetError";
        this.reason = reason;
    }
}

export class ScanStorageConfigError extends HandoffUploadTargetError {
    constructor() {
        super(SCAN_STORAGE_NOT_CONFIGURED, "scan_storage_not_configured");
        this.name = "ScanStorageConfigError";
    }
}

/** Names only. Values are never logged. */
export function scanStorageEnvReady(): boolean {
    return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function handoffScanBucket(): string {
    const bucket = process.env.STORAGE_BUCKET?.trim() || DEFAULT_SCAN_BUCKET;
    const manufacturing = process.env.MANUFACTURING_BUCKET?.trim() || DEFAULT_MANUFACTURING_BUCKET;
    if (bucket === manufacturing || bucket === DEFAULT_MANUFACTURING_BUCKET) {
        throw new ScanStorageConfigError();
    }
    return bucket;
}

export function handoffScanStorageKey(
    tenantId: string,
    designId: string,
    side: string,
    nonce: string,
): string {
    if (!SCAN_SIDES.has(side)) {
        throw new HandoffUploadTargetError(SCAN_UPLOAD_TARGET_FAILED, "sign_failed");
    }
    for (const segment of [tenantId, designId, side, nonce]) {
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(segment)) {
            throw new HandoffUploadTargetError(SCAN_UPLOAD_TARGET_FAILED, "sign_failed");
        }
    }
    return `${SCAN_PREFIX}${tenantId}/${designId}/${side}/${nonce}`;
}

export function assertHandoffScanKey(key: string): void {
    const lower = key.toLowerCase();
    const forbiddenPrefix =
        key.startsWith(MANUFACTURING_TEMP_PREFIX) ||
        key.startsWith(MANUFACTURING_ARCHIVE_PREFIX) ||
        key.startsWith(GCODE_STORAGE_PREFIX);
    const forbiddenSuffix = lower.endsWith(".stl") || lower.endsWith(".gcode") || lower.endsWith(".gco");
    if (!key.startsWith(SCAN_PREFIX) || key.includes("..") || forbiddenPrefix || forbiddenSuffix) {
        throw new HandoffUploadTargetError(SCAN_UPLOAD_TARGET_FAILED, "sign_failed");
    }
}

/** True for the old fake host and for any URL VertexOrders cannot PUT to. */
export function isPlaceholderScanUploadUrl(value: string): boolean {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return true;
    }
    if (url.protocol !== "https:") return true;
    const host = url.hostname.toLowerCase();
    if (host === "storage.orthocad.invalid" || host.endsWith(".invalid")) return true;
    return false;
}

export interface HandoffScanUploadTarget {
    storageKey: string;
    uploadUrl: string;
    bucket: string;
    retainMs: number;
}

export async function createHandoffScanUploadTarget(input: {
    tenantId: string;
    designId: string;
    side: string;
    nonce: string;
    /** Test seam. Production uses the service-role client. */
    supabase?: SupabaseClient | null;
}): Promise<HandoffScanUploadTarget> {
    if (!scanStorageEnvReady()) throw new ScanStorageConfigError();
    const bucket = handoffScanBucket();
    const storageKey = handoffScanStorageKey(input.tenantId, input.designId, input.side, input.nonce);
    assertHandoffScanKey(storageKey);
    const supabase = input.supabase === undefined ? await loadScanStorageAdmin() : input.supabase;
    if (!supabase) throw new ScanStorageConfigError();
    let uploadUrl: string;
    try {
        const signed = await createSignedUpload(supabase, storageKey, bucket);
        uploadUrl = signed.uploadUrl;
    } catch (error) {
        throw new HandoffUploadTargetError(SCAN_UPLOAD_TARGET_FAILED, "sign_failed", { cause: error });
    }
    if (isPlaceholderScanUploadUrl(uploadUrl)) throw new ScanStorageConfigError();
    const token = new URL(uploadUrl).searchParams.get("token");
    if (!uploadUrl.includes(input.tenantId) || !token) {
        throw new HandoffUploadTargetError(SCAN_UPLOAD_TARGET_FAILED, "sign_failed");
    }
    return { storageKey, uploadUrl, bucket, retainMs: HANDOFF_SCAN_RETAIN_MS };
}

/**
 * True when the signed PUT landed in the scan bucket.
 * A missing object means VertexOrders did not complete the upload.
 */
export async function handoffScanObjectExists(
    storageKey: string,
    supabase?: SupabaseClient | null,
): Promise<boolean> {
    assertHandoffScanKey(storageKey);
    if (!scanStorageEnvReady()) throw new ScanStorageConfigError();
    const client = supabase === undefined ? await loadScanStorageAdmin() : supabase;
    if (!client) throw new ScanStorageConfigError();
    const bucket = handoffScanBucket();
    const slash = storageKey.lastIndexOf("/");
    const folder = storageKey.slice(0, slash);
    const name = storageKey.slice(slash + 1);
    const listed = await client.storage.from(bucket).list(folder, { limit: 100, search: name });
    if (listed.error) {
        throw new HandoffUploadTargetError(SCAN_UPLOAD_TARGET_FAILED, "sign_failed", {
            cause: listed.error,
        });
    }
    return (listed.data ?? []).some((item) => item.name === name);
}

async function loadScanStorageAdmin(): Promise<SupabaseClient | null> {
    const { getSupabaseAdmin } = await import("../context.js");
    return getSupabaseAdmin();
}
