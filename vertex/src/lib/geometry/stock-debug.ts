// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

const PREFIX = "[STOCK_GLB_DEBUG]";
const FIX_PREFIX = "[STOCK_FIX]";
const RESOLVE_PREFIX = "[STOCK_RESOLVE]";

/** Console logging for stock base assetId → glbPath/url resolution (grep: STOCK_RESOLVE). */
export function stockResolveLog(message: string, data?: Record<string, unknown>): void {
    if (data !== undefined) {
        console.log(`${RESOLVE_PREFIX} ${message}`, data);
    } else {
        console.log(`${RESOLVE_PREFIX} ${message}`);
    }
}

/** Console logging for stock base resolution fixes (grep: STOCK_FIX). */
export function stockFixLog(message: string, data?: Record<string, unknown>): void {
    if (data !== undefined) {
        console.log(`${FIX_PREFIX} ${message}`, data);
    } else {
        console.log(`${FIX_PREFIX} ${message}`);
    }
}

/** Aggressive console logging for stock GLB resolution and loading (grep: STOCK_GLB_DEBUG). */
export function stockDebug(message: string, data?: Record<string, unknown>): void {
    if (data !== undefined) {
        console.log(`${PREFIX} ${message}`, data);
    } else {
        console.log(`${PREFIX} ${message}`);
    }
}

/** Single-line log in the exact format requested for copy/paste debugging. */
export function stockGlbLog(line: string): void {
    console.log(`${PREFIX} ${line}`);
}

export type StockUrlKind = "public" | "signed" | "local" | "unknown";

/** Classify a stock GLB fetch URL for debug output. */
export function classifyStockUrl(url: string): StockUrlKind {
    if (!url || url === "(no URL resolved)") return "unknown";
    if (!/^https?:\/\//i.test(url)) return "local";
    if (url.includes("token=") || url.includes("/object/sign/")) return "signed";
    return "public";
}

export function formatStockUrlLog(kind: StockUrlKind, url: string): string {
    const label =
        kind === "public"
            ? "Final public URL"
            : kind === "signed"
              ? "Final signed URL"
              : kind === "local"
                ? "Final local URL"
                : "Final URL";
    return `${label} = "${url}"`;
}
