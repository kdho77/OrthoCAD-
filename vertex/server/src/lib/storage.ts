// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = process.env.STORAGE_BUCKET ?? "vertex-assets";

export interface StorageUploadResult {
    key: string;
    sizeBytes: number;
}

/**
 * Upload a binary asset to Supabase Storage (or configured S3-compatible bucket).
 * Returns the object key for persistence in Prisma.
 */
export async function uploadAsset(
    supabase: SupabaseClient,
    key: string,
    data: Buffer,
    contentType: string,
): Promise<StorageUploadResult> {
    const { error } = await supabase.storage.from(BUCKET).upload(key, data, {
        contentType,
        upsert: false,
    });
    if (error) {
        throw new Error(`Storage upload failed: ${error.message}`);
    }
    return { key, sizeBytes: data.length };
}

/** Create a time-limited signed URL for downloading a stored asset. */
export async function signedDownloadUrl(
    supabase: SupabaseClient,
    key: string,
    expiresInSec = 3600,
): Promise<string> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(key, expiresInSec);
    if (error || !data?.signedUrl) {
        throw new Error(`Signed URL failed: ${error?.message ?? "unknown"}`);
    }
    return data.signedUrl;
}

/** Remove an object from storage (best-effort on delete). */
export async function deleteAsset(supabase: SupabaseClient, key: string): Promise<void> {
    const { error } = await supabase.storage.from(BUCKET).remove([key]);
    if (error) {
        throw new Error(`Storage delete failed: ${error.message}`);
    }
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
