// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import { getDesignTrimline } from "@/lib/geometry/trimline";
import { extractMergedGeometry, loadGlbFromBuffer, loadGlbFromUrl, mirrorGeometry } from "@/lib/library/loaders";
import { mergeCorrections, mergeElementPreviews } from "@/stores/performance-store";
import { useCustomLibraryStore } from "@/stores/custom-library-store";
import {
    classifyStockUrl,
    formatStockUrlLog,
    stockDebug,
    stockFixLog,
    stockGlbLog,
    stockResolveLog,
} from "@/lib/geometry/stock-debug";
import {
    createStockBaseDownloadUrl,
    queryStockBaseRow,
} from "@/lib/geometry/stock-resolve-supabase";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { DesignBase, DesignState, Side } from "@/types";

// Base resolution + loading for the Base + Modifier model.
// Centralises how a design's optional base template is discovered and turned
// into a Three.js geometry, so the viewer hook and the export pipeline agree.

/**
 * Resolve the effective base template for a design.
 * Supports paired left/right workspace: if design.paired and side provided, returns the side-specific base.
 * Falls back to legacy single base / customPrefabId.
 * Returns `null` for pure parametric designs.
 */
export function getDesignBase(design: DesignState, side?: Side): DesignBase | null {
    if (side && design.paired) {
        const sideBase = side === "left" ? design.paired.leftBase : design.paired.rightBase;
        if (sideBase) return sideBase;
    }
    if (design.base) return design.base;
    if (design.customPrefabId) {
        return { assetId: design.customPrefabId, name: design.customPrefabName, source: "custom" };
    }
    return null;
}

// --- Stock base resolution (server-authoritative) -------------------------------------
// The single source of truth for the default stock base is the server
// (trpc.stock.getDefaultStockBase / listStockBases / getStockBase).
// A tiny synchronous builtin placeholder exists **only** for completely offline
// dev scenarios (API not configured). When the API is configured, stock geometry
// must come from the server-provided URL — never from public/Templates/Default.glb.

export const DEFAULT_STOCK_BASE_ID = "stock-default";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Local offline dev placeholder metadata (public/Templates/Default.glb). */
export const BUILTIN_DEFAULT_STOCK: { id: string; name: string; glbPath: string } = {
    id: DEFAULT_STOCK_BASE_ID,
    name: "Default Stock Base (offline)",
    glbPath: "Templates/Default.glb",
};

function hasAuthoritativeStockUrl(base: DesignBase): boolean {
    return Boolean(base.url && /^https?:\/\//i.test(base.url));
}

/** True when a design base references a stock template (even if `source` was lost on persist). */
export function isStockDesignBase(base: DesignBase | null | undefined): boolean {
    if (!base) return false;
    if (base.source === "stock") return true;
    if (base.assetId === DEFAULT_STOCK_BASE_ID || base.assetId.startsWith("stock-")) return true;
    if (base.mirrored !== undefined || base.mirroredFrom) return true;
    if (base.primarySide !== undefined) return true;
    return false;
}

/** True when a stock base has both glbPath and a fetchable URL from the server. */
export function stockBaseIsFullyResolved(base: DesignBase): boolean {
    if (!isStockDesignBase(base)) return true;
    if (base.resolutionFallback) return true;
    return Boolean(base.glbPath && hasAuthoritativeStockUrl(base));
}

/** True when glbPath points at the bundled public/ placeholder (not Supabase storage). */
export function isLocalPlaceholderGlbPath(glbPath?: string | null): boolean {
    if (!glbPath) return false;
    const normalized = glbPath.replace(/^\//, "");
    return normalized === BUILTIN_DEFAULT_STOCK.glbPath || normalized.startsWith("Templates/");
}

/** True when the base is the local offline placeholder (not a server row). */
export function isOfflineStockPlaceholder(base: DesignBase | null | undefined): boolean {
    if (!base || base.source !== "stock") return false;
    if (base.offlinePlaceholder) return true;
    if (isLocalPlaceholderGlbPath(base.glbPath)) return true;
    return !isApiConfigured() && base.assetId === DEFAULT_STOCK_BASE_ID;
}

/**
 * True when a stock base still needs server resolution (no authoritative URL, or stale local path).
 */
export function stockBaseNeedsServerResolution(base: DesignBase): boolean {
    if (!isStockDesignBase(base)) return false;
    if (base.resolutionFallback) return false;
    // A stock base that already carries a real storage glbPath AND an authoritative
    // (signed/public https) URL is fully resolved — even when glbPath is literally
    // "Templates/Default.glb". The Supabase Storage key can legitimately match the
    // bundled placeholder name, so the path string alone must NOT mark it as local.
    if (!base.offlinePlaceholder && base.glbPath && hasAuthoritativeStockUrl(base)) return false;
    if (base.offlinePlaceholder && base.glbPath && isLocalPlaceholderGlbPath(base.glbPath)) return false;
    if (base.offlinePlaceholder) return true;
    if (base.assetId === DEFAULT_STOCK_BASE_ID || base.assetId.startsWith("stock-")) return true;
    if (!base.glbPath) return true;
    if (!hasAuthoritativeStockUrl(base)) return true;
    return false;
}

/**
 * True when a base is NOT a usable, loadable base and must be (re)resolved from
 * the default stock record. This is intentionally inclusive so that legacy /
 * corrupted persisted bases — which lost their `source`, `glbPath` and `url`
 * (e.g. `{ assetId: "<uuid>" }` with nothing else) — are healed instead of being
 * silently skipped (which previously left the app stuck with no geometry).
 */
function baseRequiresDefaultStockResolution(base: DesignBase): boolean {
    // A user custom-library prefab loads via the library store — never override it.
    if (base.source === "custom") return false;
    // Offline fallback bases are intentionally local — leave them alone.
    if (base.resolutionFallback) return false;
    // A stock base carrying a real storage key + authoritative (https) URL is done.
    if (base.glbPath && hasAuthoritativeStockUrl(base)) return false;
    // Pending stock placeholders AND legacy/corrupted bases (no source / no url /
    // no glbPath) all need the default stock base resolved and applied.
    return true;
}

/**
 * True when the design's stock base still needs server resolution.
 * Used to trigger applyDefaultStockBase after auth, on new designs, and on rehydrate.
 */
export function designNeedsDefaultStockResolution(design: DesignState): boolean {
    if (!isApiConfigured()) return false;

    const bases = [design.base, design.paired?.leftBase, design.paired?.rightBase].filter(
        (b): b is DesignBase => Boolean(b),
    );

    for (const base of bases) {
        if (baseRequiresDefaultStockResolution(base)) return true;
    }
    return false;
}

/** True when every base on the design is a loadable custom prefab or a fully resolved stock base. */
export function designStockBasesAreResolved(design: DesignState): boolean {
    return !designNeedsDefaultStockResolution(design);
}

/**
 * Strip local placeholder paths from persisted stock bases so loadBaseGeometry never
 * fetches public/Templates/Default.glb in server mode.
 */
export function sanitizeStockBaseForServerMode(base: DesignBase): DesignBase {
    if (!isApiConfigured() || !isStockDesignBase(base)) return base;
    if (!stockBaseNeedsServerResolution(base)) return base;

    const { glbPath: _gp, url: _url, offlinePlaceholder: _op, ...rest } = base;
    return {
        ...rest,
        assetId: base.assetId === DEFAULT_STOCK_BASE_ID || isLocalPlaceholderGlbPath(base.glbPath)
            ? DEFAULT_STOCK_BASE_ID
            : base.assetId,
    };
}

/** Sanitize all stock bases on a design after localStorage rehydrate. */
export function sanitizeDesignStockBases(design: DesignState): DesignState {
    if (!isApiConfigured()) return design;

    let next = design;
    const sanitize = (base: DesignBase | undefined): DesignBase | undefined =>
        base ? sanitizeStockBaseForServerMode(base) : undefined;

    const base = sanitize(design.base);
    const leftBase = sanitize(design.paired?.leftBase);
    const rightBase = sanitize(design.paired?.rightBase);

    if (base !== design.base || leftBase !== design.paired?.leftBase || rightBase !== design.paired?.rightBase) {
        next = {
            ...design,
            ...(base ? { base, customPrefabId: base.assetId, customPrefabName: base.name } : {}),
            ...(design.paired
                ? {
                      paired: {
                          ...design.paired,
                          ...(leftBase ? { leftBase } : {}),
                          ...(rightBase ? { rightBase } : {}),
                      },
                  }
                : {}),
        };
    }
    return next;
}

/**
 * Synchronous placeholder — **offline dev only** when API is not configured.
 * When the API is configured, returns a non-loadable pending stub (no glbPath/url)
 * so loadBaseGeometry does not fetch public/Templates/Default.glb.
 */
export function getDefaultStockBaseSync(): DesignBase {
    if (!isApiConfigured()) {
        return getOfflineFallbackStockBase();
    }
    return {
        assetId: DEFAULT_STOCK_BASE_ID,
        name: "Default Stock Base",
        source: "stock",
    };
}

/**
 * Local emergency fallback when the server cannot resolve the default stock base.
 * Uses the bundled public/Templates/Default.glb path (offline dev / degraded mode).
 */
export function getOfflineFallbackStockBase(): DesignBase {
    return {
        assetId: BUILTIN_DEFAULT_STOCK.id,
        name: BUILTIN_DEFAULT_STOCK.name,
        source: "stock",
        glbPath: BUILTIN_DEFAULT_STOCK.glbPath,
        offlinePlaceholder: true,
        primarySide: "right",
        resolutionFallback: true,
    };
}

/** Build a design patch with paired L/R bases from the offline fallback (Right + mirrored Left). */
export function createFallbackStockDesignPatch(design: DesignState): Pick<DesignState, "pattern" | "base" | "customPrefabId" | "customPrefabName" | "paired"> {
    const fallback = getOfflineFallbackStockBase();
    const { left, right } = createDefaultStockPairedBases(fallback);
    const leftBase: DesignBase = { ...left, resolutionFallback: true, offlinePlaceholder: true };
    const rightBase: DesignBase = { ...right, resolutionFallback: true, offlinePlaceholder: true };
    stockFixLog("createFallbackStockDesignPatch() — applying offline paired bases", {
        leftName: leftBase.name,
        rightName: rightBase.name,
        glbPath: fallback.glbPath,
    });
    return {
        pattern: "custom",
        base: leftBase,
        customPrefabId: leftBase.assetId,
        customPrefabName: leftBase.name,
        paired: {
            leftBase,
            rightBase,
            leftThicknessMm: design.paired?.leftThicknessMm ?? design.thicknessMm ?? 3,
            rightThicknessMm: design.paired?.rightThicknessMm ?? design.thicknessMm ?? 3,
            leftMethod: design.paired?.leftMethod ?? design.method,
            rightMethod: design.paired?.rightMethod ?? design.method,
            linked: design.paired?.linked ?? false,
        },
    };
}

/** Thrown when the server cannot supply the mandatory default stock base. */
export class StockBaseResolutionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StockBaseResolutionError";
    }
}

/** Thrown when GLTFLoader cannot fetch/parse a stock base GLB. */
export class StockGlbLoadError extends Error {
    readonly failedUrl: string;

    constructor(failedUrl: string, cause: unknown) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        super(`Failed to load stock base GLB from ${failedUrl}: ${detail}`);
        this.name = "StockGlbLoadError";
        this.failedUrl = failedUrl;
    }
}

type StockBaseRow = {
    id: string;
    name: string;
    glbPath: string;
    url?: string | null;
    primarySide?: string | null;
};

function stockRowToDesignBase(item: StockBaseRow): DesignBase {
    return {
        assetId: item.id,
        name: item.name,
        source: "stock",
        glbPath: item.glbPath,
        ...(item.url ? { url: item.url } : {}),
        ...(item.primarySide ? { primarySide: item.primarySide } : {}),
    };
}

function assertStockBaseResolved(base: DesignBase, context: string): DesignBase {
    if (!base.glbPath) {
        throw new StockBaseResolutionError(
            `${context}: stock base "${base.name ?? base.assetId}" has no glb_path in stock_bases.`,
        );
    }
    if (!base.url) {
        throw new StockBaseResolutionError(
            `${context}: stock base "${base.name ?? base.assetId}" (glb_path="${base.glbPath}") has no downloadable URL. Check Supabase storage configuration.`,
        );
    }
    return base;
}

function logStockResolveFailure(procedure: string, e: unknown): never {
    if (e instanceof StockBaseResolutionError) throw e;
    const detail = e instanceof Error ? e.message : String(e);
    const looksLikeHtml = /unexpected token\s*['"]?</i.test(detail) || /not valid json/i.test(detail);
    if (looksLikeHtml) {
        const apiBase = import.meta.env.VITE_API_URL ?? "/trpc";
        const origin = typeof globalThis.location !== "undefined" ? globalThis.location.origin : "";
        const probeUrl = apiBase.startsWith("http")
            ? `${apiBase}/stock.${procedure}`
            : `${origin}${apiBase}/stock.${procedure}`;
        stockFixLog("tRPC returned HTML instead of JSON — server route misconfigured or unreachable", {
            apiBase,
            probeUrl,
        });
        console.error(
            `[STOCK_FIX] stock.${procedure} returned HTML instead of JSON.\n` +
                "  Cause: Vercel served the SPA index.html instead of the tRPC serverless handler.\n" +
                "  Common fixes:\n" +
                "    • Ensure api/trpc/[[...trpc]].ts is deployed (repo root or vertex/ root).\n" +
                "    • vercel.json must rewrite /trpc → /api/trpc before the SPA fallback.\n" +
                "    • Set VITE_API_URL to the full …/trpc URL if using a separate API host.\n" +
                "    • Run prisma generate during build; set DATABASE_URL on Vercel.\n" +
                `  Request target: ${apiBase}\n` +
                `  Probe in browser (expect JSON, not HTML): ${probeUrl}`,
            e,
        );
    } else {
        stockFixLog(`stock.${procedure} failed`, { detail });
        console.error(`[STOCK_FIX] stock.${procedure} failed:`, e);
    }
    stockResolveLog(`resolveStockBase() error from stock.${procedure}`, { detail, looksLikeHtml });
    throw new StockBaseResolutionError(`Failed to resolve stock base from the server: ${detail}`);
}

async function resolveStockBaseViaSupabase(assetId: string): Promise<DesignBase> {
    const useDefault =
        assetId === DEFAULT_STOCK_BASE_ID || assetId.startsWith("stock-") || !UUID_RE.test(assetId);

    stockResolveLog("resolveStockBaseViaSupabase() start", { assetId, useDefault });

    let row: StockBaseRow;
    try {
        row = await queryStockBaseRow(assetId, useDefault);
    } catch (e) {
        // A persisted/stale assetId (e.g. a UUID whose stock_bases row was removed)
        // must not strand the design. Fall back to the active default stock base.
        if (useDefault) throw e;
        stockResolveLog("resolveStockBaseViaSupabase() by-id lookup failed — falling back to default", {
            assetId,
            error: e instanceof Error ? e.message : String(e),
        });
        row = await queryStockBaseRow(DEFAULT_STOCK_BASE_ID, true);
    }

    const glbPath = row.glbPath?.trim();
    if (!glbPath) {
        stockResolveLog("resolveStockBaseViaSupabase() missing glbPath on row", { assetId: row.id });
        throw new StockBaseResolutionError(
            `resolveStockBaseViaSupabase(): stock base "${row.name}" has no glbPath in stock_bases.`,
        );
    }

    stockGlbLog(`DB glb_path = "${glbPath}"`);

    let url: string;
    try {
        url = await createStockBaseDownloadUrl(glbPath);
    } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        stockResolveLog("resolveStockBaseViaSupabase() signed URL error", {
            assetId: row.id,
            glbPath,
            error: detail,
        });
        throw new StockBaseResolutionError(
            `resolveStockBaseViaSupabase(): could not sign URL for glbPath="${glbPath}": ${detail}`,
        );
    }

    const base = assertStockBaseResolved(
        stockRowToDesignBase({ ...row, glbPath, url }),
        "resolveStockBaseViaSupabase()",
    );
    stockResolveLog("resolveStockBaseViaSupabase() success", {
        assetId: base.assetId,
        glbPath: base.glbPath,
        hasUrl: Boolean(base.url),
    });
    return base;
}

async function resolveStockBaseViaTrpc(assetId: string): Promise<DesignBase> {
    const useDefault =
        assetId === DEFAULT_STOCK_BASE_ID || assetId.startsWith("stock-") || !UUID_RE.test(assetId);

    const item = useDefault
        ? await trpc.stock.getDefaultStockBase.query()
        : await trpc.stock.getStockBase.query({ id: assetId });

    if (!item) {
        stockResolveLog("resolveStockBaseViaTrpc() no row found", { assetId, usedDefault: useDefault });
        throw new StockBaseResolutionError(
            useDefault
                ? "No default stock base is configured on the server. Ask an admin to seed stock_bases (isDefault=true)."
                : `Stock base not found for assetId=${assetId}`,
        );
    }

    stockGlbLog(`DB glb_path = "${item.glbPath}"`);
    if (item.url) {
        stockGlbLog(formatStockUrlLog(classifyStockUrl(item.url), item.url));
    } else {
        stockGlbLog('Final URL = "(missing — server returned no downloadable URL)"');
    }

    return assertStockBaseResolved(stockRowToDesignBase(item), "resolveStockBaseViaTrpc()");
}

/**
 * Resolve a stock base by assetId: looks up `stock_bases`, reads `glbPath`, and returns a signed/public URL.
 * Prefers direct Supabase (table + Storage) when configured; falls back to tRPC.
 */
export async function resolveStockBase(assetId: string): Promise<DesignBase> {
    stockResolveLog("resolveStockBase() start", { assetId });
    stockFixLog("resolveStockBase() start", {
        assetId,
        apiConfigured: isApiConfigured(),
        supabaseConfigured: isSupabaseConfigured(),
    });
    stockDebug("resolveStockBase() start", { assetId, apiConfigured: isApiConfigured() });

    if (!isApiConfigured()) {
        const offline = getDefaultStockBaseSync();
        stockResolveLog("resolveStockBase() offline fallback", {
            assetId: offline.assetId,
            glbPath: offline.glbPath ?? null,
            hasUrl: Boolean(offline.url),
        });
        return offline;
    }

    const useDefault =
        assetId === DEFAULT_STOCK_BASE_ID || assetId.startsWith("stock-") || !UUID_RE.test(assetId);

    if (isSupabaseConfigured()) {
        try {
            const base = await resolveStockBaseViaSupabase(assetId);
            stockDebug("resolveStockBase() Supabase response", {
                requestedAssetId: assetId,
                id: base.assetId,
                name: base.name,
                glbPath: base.glbPath,
                url: base.url ?? null,
                primarySide: base.primarySide,
            });
            return base;
        } catch (e) {
            if (e instanceof StockBaseResolutionError) throw e;
            const detail = e instanceof Error ? e.message : String(e);
            stockResolveLog("resolveStockBase() Supabase error", { assetId, error: detail });
            throw new StockBaseResolutionError(`Failed to resolve stock base from Supabase: ${detail}`);
        }
    }

    try {
        const base = await resolveStockBaseViaTrpc(assetId);
        stockResolveLog("resolveStockBase() success", {
            assetId: base.assetId,
            glbPath: base.glbPath,
            hasUrl: Boolean(base.url),
        });
        stockDebug("resolveStockBase() tRPC response", {
            requestedAssetId: assetId,
            id: base.assetId,
            name: base.name,
            glbPath: base.glbPath,
            url: base.url ?? null,
            primarySide: base.primarySide,
        });
        return base;
    } catch (e) {
        logStockResolveFailure(useDefault ? "getDefaultStockBase" : "getStockBase", e);
    }
}

/** Pick the primary stock assetId already referenced on a design (falls back to default key). */
export function getDesignStockAssetId(design: DesignState): string {
    const candidates = [
        design.paired?.rightBase,
        design.paired?.leftBase,
        design.base,
    ].filter((b): b is DesignBase => Boolean(b && isStockDesignBase(b)));

    const primary = candidates.find((b) => !b.mirrored) ?? candidates[0];
    if (primary?.assetId && UUID_RE.test(primary.assetId)) return primary.assetId;
    if (primary?.assetId) return primary.assetId;
    return DEFAULT_STOCK_BASE_ID;
}

/**
 * PRIMARY (and server-authoritative) async resolver for the default stock base.
 *
 * Calls `trpc.stock.getDefaultStockBase` which queries the real `stock_bases` table.
 * When the API is configured, failure to resolve a default row is a hard error.
 */
export async function resolveDefaultStockBase(): Promise<DesignBase> {
    stockFixLog("resolveDefaultStockBase() start", {
        apiConfigured: isApiConfigured(),
        apiUrl: import.meta.env.VITE_API_URL ?? "/trpc (same-origin)",
    });
    return resolveStockBase(DEFAULT_STOCK_BASE_ID);
}

/** True when the design already references a GLB base (stock or custom). */
export function designHasBase(design: DesignState): boolean {
    return !!(
        design.base ||
        design.customPrefabId ||
        design.paired?.leftBase ||
        design.paired?.rightBase
    );
}

/**
 * Create the Left + Right pair for a (usually Right-only) stock base.
 * Pass the result of resolveDefaultStockBase() — never rely on the sync stub in production.
 */
export function createDefaultStockPairedBases(
    override?: DesignBase,
): { left: DesignBase; right: DesignBase } {
    const source = override ?? getDefaultStockBaseSync();
    const primarySide = source.primarySide;

    const sourceIsRight = !primarySide || primarySide.toLowerCase() === "right";
    const authoritativeName = source.name ?? "Stock Base";

    const right: DesignBase = {
        assetId: source.assetId,
        name: `${authoritativeName} (Right)`,
        source: "stock",
        glbPath: source.glbPath,
        ...(source.url ? { url: source.url } : {}),
        ...(source.primarySide !== undefined ? { primarySide: source.primarySide } : {}),
        ...(source.offlinePlaceholder ? { offlinePlaceholder: true } : {}),
        ...(source.resolutionFallback ? { resolutionFallback: true } : {}),
    };

    const left: DesignBase = {
        assetId: source.assetId,
        name: `${authoritativeName.replace(/\s*\(Right\)?$/i, "")} (Left)`,
        source: "stock",
        glbPath: source.glbPath,
        mirrored: true,
        mirroredFrom: source.assetId,
        ...(source.url ? { url: source.url } : {}),
        ...(source.primarySide !== undefined ? { primarySide: source.primarySide } : {}),
        ...(source.offlinePlaceholder ? { offlinePlaceholder: true } : {}),
        ...(source.resolutionFallback ? { resolutionFallback: true } : {}),
    };

    if (primarySide?.toLowerCase() === "left") {
        return { left: right, right: left };
    }

    return { left, right: sourceIsRight ? right : left };
}

/**
 * Stable cache key for per-base derived data (outlines, bounds, zones).
 */
export function getBaseCacheKey(base: DesignBase | null | undefined): string | null {
    if (!base) return null;
    return base.mirrored ? `${base.assetId}:mirrored` : base.assetId;
}

/** Decide whether a stock base needs an automatically generated mirrored opposite side. */
export function stockBaseRequiresAutoMirror(base: DesignBase | null): boolean {
    if (!base || base.source !== "stock" || base.mirrored) return false;

    const primary = base.primarySide;
    if (primary) {
        return primary.toLowerCase() === "right" || primary.toLowerCase() === "left";
    }

    if (base.assetId === DEFAULT_STOCK_BASE_ID) return true;
    if (base.glbPath && /default/i.test(base.glbPath) && !isLocalPlaceholderGlbPath(base.glbPath)) return true;

    return false;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

/**
 * Resolve a fetchable URL for a stock base.
 * - Production (API configured): server URL only — fetches fresh signed/public URL when missing.
 * - Offline dev: local public/ path for the builtin placeholder only.
 */
async function resolveStockFetchUrl(base: DesignBase): Promise<string | null> {
    const dbGlbPath = base.glbPath ?? "(none on design base)";
    stockGlbLog(`resolveStockFetchUrl() DB glb_path = "${dbGlbPath}" (assetId=${base.assetId})`);

    if (base.resolutionFallback && isLocalPlaceholderGlbPath(base.glbPath)) {
        const gp = base.glbPath ?? BUILTIN_DEFAULT_STOCK.glbPath;
        const local = gp.startsWith("/") ? gp : `/${gp}`;
        stockFixLog("resolveStockFetchUrl() using resolution fallback local path", { local });
        stockGlbLog(formatStockUrlLog("local", local));
        return local;
    }

    if (!isApiConfigured()) {
        if (hasAuthoritativeStockUrl(base)) {
            const urlKind = classifyStockUrl(base.url!);
            stockGlbLog(formatStockUrlLog(urlKind, base.url!));
            return base.url!;
        }
        if (isOfflineStockPlaceholder(base)) {
            const gp = base.glbPath ?? BUILTIN_DEFAULT_STOCK.glbPath;
            const local = gp.startsWith("/") ? gp : `/${gp}`;
            stockGlbLog(formatStockUrlLog("local", local));
            return local;
        }
        stockGlbLog('Final URL = "(none — offline, no placeholder)"');
        return null;
    }

    // API configured — refresh signed/public URL (signed URLs expire).
    try {
        if (isSupabaseConfigured()) {
            const glbPath =
                base.glbPath ??
                (await queryStockBaseRow(
                    base.assetId,
                    base.assetId === DEFAULT_STOCK_BASE_ID ||
                        base.assetId.startsWith("stock-") ||
                        !UUID_RE.test(base.assetId),
                ).then((row) => row.glbPath));

            if (glbPath) {
                stockGlbLog(`DB glb_path = "${glbPath}"`);
                const url = await createStockBaseDownloadUrl(glbPath);
                stockGlbLog(formatStockUrlLog(classifyStockUrl(url), url));
                return url;
            }
        } else if (UUID_RE.test(base.assetId)) {
            stockDebug("resolveStockFetchUrl() fetching by UUID", { assetId: base.assetId });
            const item = await trpc.stock.getStockBase.query({ id: base.assetId });
            stockGlbLog(`DB glb_path = "${item.glbPath}"`);
            if (item.url) {
                const urlKind = classifyStockUrl(item.url);
                stockGlbLog(formatStockUrlLog(urlKind, item.url));
                return item.url;
            }
            stockGlbLog('Final URL = "(missing — getStockBase returned no url)"');
        } else if (base.assetId === DEFAULT_STOCK_BASE_ID || isLocalPlaceholderGlbPath(base.glbPath)) {
            stockDebug("resolveStockFetchUrl() fetching default stock base");
            const item = await trpc.stock.getDefaultStockBase.query();
            if (item) {
                stockGlbLog(`DB glb_path = "${item.glbPath}"`);
                if (item.url) {
                    const urlKind = classifyStockUrl(item.url);
                    stockGlbLog(formatStockUrlLog(urlKind, item.url));
                    return item.url;
                }
                stockGlbLog('Final URL = "(missing — getDefaultStockBase returned no url)"');
            } else {
                stockGlbLog('Final URL = "(missing — no default stock row)"');
            }
        }
    } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        stockGlbLog(`resolveStockFetchUrl() server lookup error: ${detail}`);
        stockDebug("resolveStockFetchUrl() server lookup failed", {
            assetId: base.assetId,
            error: detail,
        });
        console.error("[STOCK_GLB_DEBUG] resolveStockFetchUrl() server lookup failed:", e);
    }

    if (hasAuthoritativeStockUrl(base)) {
        const urlKind = classifyStockUrl(base.url!);
        stockGlbLog(`Using cached design ${formatStockUrlLog(urlKind, base.url!)}`);
        return base.url!;
    }

    stockGlbLog('Final URL = "(none — could not resolve)"');
    return null;
}

/**
 * Load the raw base mesh geometry for a design base.
 *
 * Stock bases (API configured): load exclusively from the server-provided URL.
 * Offline dev: load the local builtin placeholder from public/.
 */
export async function loadBaseGeometry(base: DesignBase): Promise<BufferGeometry | null> {
    const store = useCustomLibraryStore.getState();

    let geo: BufferGeometry | null = null;

    if (base.source === "stock") {
        stockDebug("loadBaseGeometry() stock base", {
            assetId: base.assetId,
            glbPath: base.glbPath,
            hasUrl: Boolean(base.url),
            needsServerResolution: stockBaseNeedsServerResolution(base),
            mirrored: Boolean(base.mirrored),
        });

        if (isApiConfigured() && stockBaseNeedsServerResolution(base)) {
            stockFixLog("loadBaseGeometry() waiting for server resolution", { assetId: base.assetId });
            stockDebug("loadBaseGeometry() waiting for server resolution — not using local placeholder", {
                assetId: base.assetId,
            });
            return null;
        }

        const fetchUrl = await resolveStockFetchUrl(base);
        if (!fetchUrl) {
            const glbPath = base.glbPath ?? "(none)";
            const msg = `No fetchable URL for stock base (assetId=${base.assetId}, glb_path="${glbPath}")`;
            stockGlbLog(msg);
            throw new StockGlbLoadError("(no URL resolved)", new Error(msg));
        }

        stockGlbLog(`GLTFLoader loading URL = "${fetchUrl}"`);
        stockDebug("loadBaseGeometry() loading GLB", {
            assetId: base.assetId,
            glbPath: base.glbPath,
            fetchUrl,
            urlKind: classifyStockUrl(fetchUrl),
        });

        try {
            const group = await loadGlbFromUrl(fetchUrl);
            const merged = extractMergedGeometry(group);
            geo = merged?.geometry ?? null;
            if (!geo) {
                const msg = "GLTF loaded but no mesh geometry was found in the file";
                stockGlbLog(`GLTFLoader error: ${msg} (url="${fetchUrl}")`);
                throw new StockGlbLoadError(fetchUrl, new Error(msg));
            }
            stockGlbLog(`GLTFLoader success — meshCount=${merged?.meshCount ?? 0} url="${fetchUrl}"`);
            stockDebug("loadBaseGeometry() GLB loaded", {
                assetId: base.assetId,
                meshCount: merged?.meshCount ?? 0,
                hasGeometry: true,
                fetchUrl,
            });
        } catch (e) {
            if (e instanceof StockGlbLoadError) throw e;
            const detail = e instanceof Error ? e.message : String(e);
            stockGlbLog(`GLTFLoader error: ${detail} (url="${fetchUrl}")`);
            console.error("[STOCK_GLB_DEBUG] GLTFLoader error:", detail, { url: fetchUrl, error: e });
            throw new StockGlbLoadError(fetchUrl, e);
        }
    } else {
        const local = store.getLocalGlb(base.assetId);
        if (local) {
            const group = await loadGlbFromBuffer(base64ToArrayBuffer(local.glbBase64));
            const merged = extractMergedGeometry(group);
            if (merged) geo = merged.geometry;
        }

        if (!geo) {
            const prefab = store.customPrefabs.find((p) => p.id === base.assetId);
            if (prefab?.url) {
                const group = await loadGlbFromUrl(prefab.url);
                const merged = extractMergedGeometry(group);
                if (merged) geo = merged.geometry;
            }
        }
    }

    if (geo && base.mirrored) {
        const mirrored = mirrorGeometry(geo);
        geo.dispose();
        geo = mirrored;
    }

    return geo;
}

/** Height field (with live correction/element previews) for modifier application. */
export function baseModifierField(design: DesignState, side: Side, thicknessMm: number): HeightFieldParams {
    const params = insoleParamsFromDesign(design, side, "full");
    return {
        side,
        lengthMm: params.lengthMm,
        widthMm: params.widthMm,
        thicknessMm: params.thicknessMm,
        corrections: mergeCorrections(side, design.corrections[side]),
        elements: mergeElementPreviews(design.elements.filter((e) => e.side === side)),
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

/** Authoritative field for the sewn OCCT base path (Phase 3B). */
export function baseModifierFieldAuthoritative(design: DesignState, side: Side, thicknessMm: number): HeightFieldParams {
    const f = baseModifierField(design, side, thicknessMm);
    const committed = getDesignTrimline(design, side);
    return { ...f, trimline: committed };
}
