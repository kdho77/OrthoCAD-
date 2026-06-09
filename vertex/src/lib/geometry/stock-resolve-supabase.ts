// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    classifyStockUrl,
    formatStockUrlLog,
    stockGlbLog,
    stockResolveLog,
} from "@/lib/geometry/stock-debug";
import { getSupabase } from "@/lib/supabase";

/** Supabase Storage bucket for system stock base GLBs (matches server STOCK_STORAGE_BUCKET default). */
export const STOCK_BASES_BUCKET =
    (import.meta.env.VITE_STOCK_STORAGE_BUCKET as string | undefined)?.trim() || "stock-bases";

const SIGNED_URL_TTL_SEC = 3600 * 4;

export type StockBaseDbRow = {
    id: string;
    name: string;
    glbPath: string;
    primarySide: string | null;
};

/**
 * Query `stock_bases` via the browser Supabase client.
 * Uses the row id when `assetId` is a UUID; otherwise loads the active default row.
 */
export async function queryStockBaseRow(assetId: string, useDefault: boolean): Promise<StockBaseDbRow> {
    const supabase = getSupabase();
    if (!supabase) {
        throw new Error("Supabase is not configured");
    }

    stockResolveLog("query stock_bases", { assetId, useDefault, table: "stock_bases" });

    if (useDefault) {
        const { data, error } = await supabase
            .from("stock_bases")
            .select("id, name, glbPath, primarySide")
            .eq("isActive", true)
            .eq("isDefault", true)
            .order("createdAt", { ascending: false })
            .limit(1);

        if (error) {
            stockResolveLog("stock_bases query error", { assetId, error: error.message });
            throw new Error(`stock_bases query failed: ${error.message}`);
        }

        const row = data?.[0] as StockBaseDbRow | undefined;
        if (!row) {
            stockResolveLog("stock_bases default row not found", { assetId });
            throw new Error("No active default stock base is configured (isDefault=true).");
        }

        stockResolveLog("stock_bases row retrieved", {
            assetId: row.id,
            glbPath: row.glbPath,
            name: row.name,
        });
        return row;
    }

    const { data, error } = await supabase
        .from("stock_bases")
        .select("id, name, glbPath, primarySide")
        .eq("id", assetId)
        .eq("isActive", true)
        .maybeSingle();

    if (error) {
        stockResolveLog("stock_bases query error", { assetId, error: error.message });
        throw new Error(`stock_bases query failed: ${error.message}`);
    }

    if (!data) {
        stockResolveLog("stock_bases row not found", { assetId });
        throw new Error(`Stock base not found for assetId=${assetId}`);
    }

    const row = data as StockBaseDbRow;
    stockResolveLog("stock_bases row retrieved", {
        assetId: row.id,
        glbPath: row.glbPath,
        name: row.name,
    });
    return row;
}

/**
 * Generate a signed download URL for a stock base GLB in the `stock-bases` bucket.
 * Falls back to a public URL only when signing is unavailable.
 */
export async function createStockBaseDownloadUrl(glbPath: string): Promise<string> {
    const supabase = getSupabase();
    if (!supabase) {
        throw new Error("Supabase is not configured");
    }

    stockResolveLog("createSignedUrl start", { glbPath, bucket: STOCK_BASES_BUCKET });

    const { data, error } = await supabase.storage
        .from(STOCK_BASES_BUCKET)
        .createSignedUrl(glbPath, SIGNED_URL_TTL_SEC);

    if (!error && data?.signedUrl) {
        stockResolveLog("signed URL generated", {
            glbPath,
            bucket: STOCK_BASES_BUCKET,
            success: true,
            urlKind: classifyStockUrl(data.signedUrl),
        });
        stockGlbLog(formatStockUrlLog(classifyStockUrl(data.signedUrl), data.signedUrl));
        return data.signedUrl;
    }

    const { data: pub } = supabase.storage.from(STOCK_BASES_BUCKET).getPublicUrl(glbPath);
    if (pub?.publicUrl) {
        stockResolveLog("signed URL failed — using public URL", {
            glbPath,
            signedError: error?.message ?? null,
            success: true,
        });
        stockGlbLog(formatStockUrlLog("public", pub.publicUrl));
        return pub.publicUrl;
    }

    stockResolveLog("signed URL generation failed", {
        glbPath,
        bucket: STOCK_BASES_BUCKET,
        error: error?.message ?? "no signed URL returned",
        success: false,
    });
    throw new Error(error?.message ?? "Failed to generate signed URL for stock base GLB");
}
