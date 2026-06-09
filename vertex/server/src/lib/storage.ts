// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { SupabaseClient } from "@supabase/supabase-js";

export const MAIN_BUCKET = process.env.STORAGE_BUCKET ?? "vertex-assets";

/**
 * Dedicated (or shared) bucket for system stock bases.
 * You can set STOCK_STORAGE_BUCKET=stock-bases to isolate public stock assets
 * from user custom uploads (recommended for RLS / public policy simplicity).
 */
export const STOCK_BUCKET = process.env.STOCK_STORAGE_BUCKET ?? MAIN_BUCKET;

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
