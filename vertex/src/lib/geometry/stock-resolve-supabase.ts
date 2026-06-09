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

/**
 * Last-resort public URL for the default stock base GLB. The `stock-bases` bucket
 * is public, so this URL is directly fetchable without auth, signing, or tRPC.
 * Used only when neither the Supabase client nor VITE_SUPABASE_URL is available.
 */
export const DEFAULT_STOCK_PUBLIC_URL =
    "https://wstneucimlemaokoyjwh.supabase.co/storage/v1/object/public/stock-bases/Templates/Default.glb";

function supabaseProjectUrl(): string | null {
    const raw = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, "");
    return raw || null;
}

/**
 * Build the PUBLIC storage URL for a stock base GLB. The `stock-bases` bucket is
 * public, so this needs no auth, no signing, and no tRPC — it is deterministic.
 * Prefers the Supabase client, then derives from VITE_SUPABASE_URL, and finally
 * falls back to the known default URL for the default GLB path.
 */
export function getStockBasePublicUrl(glbPath: string): string | null {
    const key = glbPath.replace(/^\/+/, "");

    const supabase = getSupabase();
    if (supabase) {
        const { data } = supabase.storage.from(STOCK_BASES_BUCKET).getPublicUrl(key);
        if (data?.publicUrl) {
            stockResolveLog("getStockBasePublicUrl() via client", { glbPath: key, url: data.publicUrl });
            return data.publicUrl;
        }
    }

    const projectUrl = supabaseProjectUrl();
    if (projectUrl) {
        const url = `${projectUrl}/storage/v1/object/public/${STOCK_BASES_BUCKET}/${key}`;
        stockResolveLog("getStockBasePublicUrl() via env", { glbPath: key, url });
        return url;
    }

    if (key === "Templates/Default.glb") {
        stockResolveLog("getStockBasePublicUrl() via hardcoded default", { glbPath: key });
        return DEFAULT_STOCK_PUBLIC_URL;
    }

    stockResolveLog("getStockBasePublicUrl() failed — no Supabase URL available", { glbPath: key });
    return null;
}

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
 * Resolve a fetchable download URL for a stock base GLB in the public
 * `stock-bases` bucket. Returns the deterministic PUBLIC URL — no signing, no
 * auth, no tRPC. (The bucket is public, so signed URLs are unnecessary and only
 * add an auth/RLS dependency that frequently breaks on deploys.)
 */
export async function createStockBaseDownloadUrl(glbPath: string): Promise<string> {
    const url = getStockBasePublicUrl(glbPath);
    if (!url) {
        throw new Error(
            `Cannot build a public URL for stock base "${glbPath}": Supabase is not configured (VITE_SUPABASE_URL missing).`,
        );
    }
    stockGlbLog(formatStockUrlLog(classifyStockUrl(url), url));
    return url;
}
