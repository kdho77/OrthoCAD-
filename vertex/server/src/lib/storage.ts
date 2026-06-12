// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

export const MAIN_BUCKET = process.env.STORAGE_BUCKET ?? "vertex-assets";

/** Private bucket for manufacturing STL uploads, archives, and G-code output. */
export const MANUFACTURING_BUCKET = process.env.MANUFACTURING_BUCKET ?? "vertex-manufacturing";

if (process.env.MANUFACTURING_BUCKET === undefined) {
    console.warn("WARNING: MANUFACTURING_BUCKET env var not set, defaulting to vertex-manufacturing");
}

/**
 * Dedicated (or shared) bucket for system stock bases.
 * You can set STOCK_STORAGE_BUCKET=stock-bases to isolate public stock assets
 * from user custom uploads (recommended for RLS / public policy simplicity).
 */
export const STOCK_BUCKET = process.env.STOCK_STORAGE_BUCKET ?? MAIN_BUCKET;

/** Ephemeral manufacturing STL uploads (TTL-cleaned). Only `uploadManufacturingStl` may write here. */
export const MANUFACTURING_TEMP_PREFIX = "manufacturing-temp/";

/** Permanent submitted-geometry archive for successful manufacturing jobs. */
export const MANUFACTURING_ARCHIVE_PREFIX = "manufacturing-archive/";

export interface StorageUploadResult {
    key: string;
    sizeBytes: number;
}

/**
 * Upload a binary asset.
 * @param bucket - optional override (defaults to MAIN_BUCKET). Use STOCK_BUCKET for stock bases.
 */
export async function uploadAsset(
    supabase: SupabaseClient,
    key: string,
    data: Buffer,
    contentType: string,
    bucket = MAIN_BUCKET,
): Promise<StorageUploadResult> {
    const { error } = await supabase.storage.from(bucket).upload(key, data, {
        contentType,
        upsert: false,
    });
    if (error) {
        throw new Error(`Storage upload failed: ${error.message}`);
    }
    return { key, sizeBytes: data.length };
}

/**
 * Create a time-limited signed URL.
 * @param bucket - optional (defaults to MAIN_BUCKET). Pass STOCK_BUCKET for stock.
 */
export async function signedDownloadUrl(
    supabase: SupabaseClient,
    key: string,
    expiresInSec = 3600,
    bucket = MAIN_BUCKET,
): Promise<string> {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(key, expiresInSec);
    if (error || !data?.signedUrl) {
        throw new Error(`Signed URL failed: ${error?.message ?? "unknown"}`);
    }
    return data.signedUrl;
}

/** Remove an object (best-effort). */
export async function deleteAsset(supabase: SupabaseClient, key: string, bucket = MAIN_BUCKET): Promise<void> {
    const { error } = await supabase.storage.from(bucket).remove([key]);
    if (error) {
        throw new Error(`Storage delete failed: ${error.message}`);
    }
}

/**
 * Get a public (non-signed) URL for a stock or other publicly readable object.
 * Returns null if the client cannot produce one or the object is not public.
 * Preferred for stock bases when the bucket (e.g. "stock-bases") has public read policy.
 */
export function getPublicUrl(
    supabase: SupabaseClient,
    key: string,
    bucket = STOCK_BUCKET,
): string | null {
    const { data } = supabase.storage.from(bucket).getPublicUrl(key);
    return data?.publicUrl ?? null;
}

/** Build a temporary storage key for a manufacturing STL upload. */
export function buildManufacturingTempStlKey(userId: string, stamp = Date.now(), id = randomUUID()): string {
    return `${MANUFACTURING_TEMP_PREFIX}${userId}/${stamp}-${id}.stl`;
}

/** Permanent archive path for a successful manufacturing export. */
export function buildManufacturingArchiveStlKey(userId: string, exportId: string): string {
    return `${MANUFACTURING_ARCHIVE_PREFIX}${userId}/${exportId}.stl`;
}

export function isManufacturingTempKey(key: string): boolean {
    return key.startsWith(MANUFACTURING_TEMP_PREFIX);
}

export function assertManufacturingTempKeyForUser(key: string, userId: string): void {
    const expectedPrefix = `${MANUFACTURING_TEMP_PREFIX}${userId}/`;
    if (!key.startsWith(expectedPrefix) || !key.endsWith(".stl")) {
        throw new Error(`Invalid manufacturing temp STL key for user: ${key}`);
    }
}

/** Copy an object within the same bucket (download → re-upload). */
export async function copyStorageObject(
    supabase: SupabaseClient,
    sourceKey: string,
    destKey: string,
    contentType: string,
    bucket = MAIN_BUCKET,
): Promise<void> {
    const { data, error } = await supabase.storage.from(bucket).download(sourceKey);
    if (error || !data) {
        throw new Error(`Storage download failed for copy: ${error?.message ?? "no data"}`);
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    await uploadAsset(supabase, destKey, buffer, contentType, bucket);
}

/** Best-effort delete of a temp manufacturing STL; never throws. */
export function deleteManufacturingTempBestEffort(
    supabase: SupabaseClient | null | undefined,
    key: string | undefined,
): void {
    if (!supabase || !key || !isManufacturingTempKey(key)) return;
    void deleteAsset(supabase, key, MANUFACTURING_BUCKET).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[manufacturing] failed to delete temp STL", { key, message });
    });
}

/** Build a unique storage key for a user's custom GLB asset. */
export function buildGlbKey(userId: string, kind: "element" | "prefab", name: string): string {
    const safe = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
    const stamp = Date.now();
    return `custom/${userId}/${kind}/${safe || "asset"}-${stamp}.glb`;
}

/**
 * Build a storage key for system stock base GLBs.
 * Organizes under `stock/{category}/` for maintainability (e.g. stock/standard/, stock/specialty/).
 * Falls back to `stock/general/` when no category is supplied.
 * The returned key is what gets stored in StockBase.glbPath and used for upload / public|signed URLs.
 */
export function buildStockGlbKey(name: string, opts?: { category?: string }): string {
    const safeName = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);

    const rawCat = (opts?.category || "general").toLowerCase();
    const safeCat = rawCat
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "general";

    const stamp = Date.now();
    return `stock/${safeCat}/${safeName || "base"}-${stamp}.glb`;
}

/**
 * @deprecated Prefer the robust `getPublicUrl(supabase, key, bucket)` which uses the
 * Supabase client's getPublicUrl() and the STOCK_BUCKET / MAIN_BUCKET constants.
 * Kept for backward compatibility during transition.
 */
export function getPublicStockUrl(key: string): string | null {
    // This old helper doesn't have the client; callers should migrate to getPublicUrl.
    return null;
}
