// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import { getDesignTrimline } from "@/lib/geometry/trimline";
import {
    extractMergedGeometry,
    extractMergedGeometryAsync,
    loadGlbFromBuffer,
    loadGlbFromUrl,
    mirrorGeometry,
    reorientToFootprintFrame,
    type ExtractMergedGeometryOptions,
    type MergedGlbGeometry,
} from "@/lib/library/loaders";
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
import { getStockBasePublicUrl, queryStockBaseRow } from "@/lib/geometry/stock-resolve-supabase";
import { isApiConfigured } from "@/lib/trpc";
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

// --- Stock base resolution (direct public Supabase Storage) ---------------------------
// The default stock base GLB lives in the PUBLIC `stock-bases` bucket at
// `Templates/Default.glb`. Because the bucket is public, its URL is deterministic
// and fetchable without auth, signing, or the backend tRPC route. We therefore
// resolve stock bases entirely client-side via the public Storage URL and NEVER
// call trpc.stock.* (the Vercel /trpc route returns HTML, breaking JSON parsing).

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

/** Fix legacy paired bases whose (Left)/(Right) suffixes were swapped for primarySide=left stock. */
function healInvertedPairedSideLabels(design: DesignState): DesignState {
    const paired = design.paired;
    if (!paired?.leftBase || !paired.rightBase) return design;

    const left = paired.leftBase;
    const right = paired.rightBase;
    const leftSaysRight = /\(Right\)/i.test(left.name ?? "");
    const rightSaysLeft = /\(Left\)/i.test(right.name ?? "");
    if (!leftSaysRight || !rightSaysLeft) return design;

    const primary = left.primarySide ?? right.primarySide;
    if (primary?.toLowerCase() !== "left") return design;

    const leftName = left.name?.replace(/\(Right\)/i, "(Left)") ?? left.name;
    const rightName = right.name?.replace(/\(Left\)/i, "(Right)") ?? right.name;
    if (leftName === left.name && rightName === right.name) return design;

    return {
        ...design,
        paired: {
            ...paired,
            leftBase: { ...left, name: leftName },
            rightBase: { ...right, name: rightName },
        },
        ...(design.base === left ? { base: { ...left, name: leftName }, customPrefabName: leftName } : {}),
    };
}

/** Sanitize all stock bases on a design after localStorage rehydrate. */
export function sanitizeDesignStockBases(design: DesignState): DesignState {
    let next = healInvertedPairedSideLabels(design);
    if (!isApiConfigured()) return next;
    const sanitize = (base: DesignBase | undefined): DesignBase | undefined =>
        base ? sanitizeStockBaseForServerMode(base) : undefined;

    const base = sanitize(next.base);
    const leftBase = sanitize(next.paired?.leftBase);
    const rightBase = sanitize(next.paired?.rightBase);

    if (base !== next.base || leftBase !== next.paired?.leftBase || rightBase !== next.paired?.rightBase) {
        next = {
            ...next,
            ...(base ? { base, customPrefabId: base.assetId, customPrefabName: base.name } : {}),
            ...(next.paired
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
 * Fully-resolved default stock base, built **synchronously** from the public
 * Supabase Storage URL. The `stock-bases` bucket is public, so the GLB URL is
 * deterministic — no table query, no signing, no auth, no tRPC, no async wait.
 * This means every new/rehydrated design has a loadable base immediately.
 */
export function getDefaultStockBaseSync(): DesignBase {
    const glbPath = BUILTIN_DEFAULT_STOCK.glbPath;
    const url = getStockBasePublicUrl(glbPath);
    return {
        assetId: DEFAULT_STOCK_BASE_ID,
        name: "Default Stock Base",
        source: "stock",
        glbPath,
        ...(url ? { url } : {}),
        primarySide: "right",
    };
}

/**
 * Emergency fallback — identical to the sync default (public URL). Kept as a
 * separate export for the few call sites that branch on degraded mode.
 */
export function getOfflineFallbackStockBase(): DesignBase {
    return { ...getDefaultStockBaseSync(), resolutionFallback: true };
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

/**
 * Resolve a stock base by assetId entirely from the **public** `stock-bases`
 * bucket — never via tRPC.
 *
 * Strategy:
 *  1. Optionally read `stock_bases` (Supabase JS) to get the real row id +
 *     glb_path. This is best-effort: if the table read is blocked by RLS or the
 *     row is missing, we ignore it and use the known default glb_path.
 *  2. Build the deterministic PUBLIC Storage URL for that glb_path.
 *
 * The bucket is public, so the URL is fetchable without auth/signing. This makes
 * resolution robust to a broken/absent backend tRPC route.
 */
export async function resolveStockBase(assetId: string): Promise<DesignBase> {
    const useDefault =
        assetId === DEFAULT_STOCK_BASE_ID || assetId.startsWith("stock-") || !UUID_RE.test(assetId);

    stockResolveLog("resolveStockBase() start", { assetId, useDefault });
    stockFixLog("resolveStockBase() start", {
        assetId,
        useDefault,
        supabaseConfigured: isSupabaseConfigured(),
    });

    let id = useDefault ? DEFAULT_STOCK_BASE_ID : assetId;
    let glbPath = BUILTIN_DEFAULT_STOCK.glbPath;
    let name = "Default Stock Base";
    let primarySide: string | null = "right";

    // Best-effort: enrich with the real row (id + glb_path) from the table.
    if (isSupabaseConfigured()) {
        try {
            const row = await queryStockBaseRow(assetId, useDefault);
            id = row.id || id;
            glbPath = row.glbPath?.trim() || glbPath;
            name = row.name || name;
            primarySide = row.primarySide ?? primarySide;
            stockResolveLog("resolveStockBase() table row", { id, glbPath, name, primarySide });
        } catch (e) {
            // RLS-blocked / missing row / removed UUID: fall through to the known
            // default glb_path. The public URL still works for the default GLB.
            stockResolveLog("resolveStockBase() table read failed — using known default glb_path", {
                assetId,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    stockGlbLog(`glb_path = "${glbPath}"`);
    const url = getStockBasePublicUrl(glbPath);
    if (!url) {
        throw new StockBaseResolutionError(
            `Cannot build a public URL for the stock base (glb_path="${glbPath}"). Set VITE_SUPABASE_URL.`,
        );
    }

    const base = stockRowToDesignBase({ id, name, glbPath, url, primarySide });
    stockResolveLog("resolveStockBase() success", { assetId: base.assetId, glbPath: base.glbPath, url });
    stockDebug("resolveStockBase() resolved (public URL, no tRPC)", {
        requestedAssetId: assetId,
        id: base.assetId,
        glbPath: base.glbPath,
        url,
        primarySide: base.primarySide,
    });
    return base;
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
 * Resolve the default stock base to its public Supabase Storage URL (no tRPC).
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
    const primarySide = source.primarySide?.toLowerCase();
    const sourceIsLeft = primarySide === "left";
    const authoritativeName = source.name?.replace(/\s*\((Left|Right)\)?$/i, "") ?? "Stock Base";

    const shared: Pick<
        DesignBase,
        "assetId" | "source" | "glbPath" | "url" | "primarySide" | "offlinePlaceholder" | "resolutionFallback"
    > = {
        assetId: source.assetId,
        source: "stock",
        glbPath: source.glbPath,
        ...(source.url ? { url: source.url } : {}),
        ...(source.primarySide !== undefined ? { primarySide: source.primarySide } : {}),
        ...(source.offlinePlaceholder ? { offlinePlaceholder: true } : {}),
        ...(source.resolutionFallback ? { resolutionFallback: true } : {}),
    };

    const sourceBase: DesignBase = {
        ...shared,
        name: `${authoritativeName} (${sourceIsLeft ? "Left" : "Right"})`,
    };

    const mirrorBase: DesignBase = {
        ...shared,
        name: `${authoritativeName} (${sourceIsLeft ? "Right" : "Left"})`,
        mirrored: true,
        mirroredFrom: source.assetId,
    };

    return sourceIsLeft ? { left: sourceBase, right: mirrorBase } : { left: mirrorBase, right: sourceBase };
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
 * Resolve a fetchable URL for a stock base — always the PUBLIC `stock-bases`
 * Storage URL. The bucket is public, so the URL is deterministic and never
 * requires auth, signing, or tRPC. Public URLs do not expire, so we rebuild a
 * fresh one from glb_path every time (and ignore any stale cached `url`).
 */
async function resolveStockFetchUrl(base: DesignBase): Promise<string | null> {
    const glbPath = (base.glbPath && base.glbPath.trim()) || BUILTIN_DEFAULT_STOCK.glbPath;
    stockGlbLog(`resolveStockFetchUrl() glb_path = "${glbPath}" (assetId=${base.assetId})`);

    const url = getStockBasePublicUrl(glbPath);
    if (url) {
        stockGlbLog(formatStockUrlLog(classifyStockUrl(url), url));
        return url;
    }

    // No Supabase URL available — last chance is a cached authoritative URL.
    if (hasAuthoritativeStockUrl(base)) {
        stockGlbLog(`Using cached design ${formatStockUrlLog(classifyStockUrl(base.url!), base.url!)}`);
        return base.url!;
    }

    stockGlbLog('Final URL = "(none — VITE_SUPABASE_URL not set)"');
    return null;
}

/**
 * Load the raw base mesh geometry for a design base.
 *
 * Stock bases (API configured): load exclusively from the server-provided URL.
 * Offline dev: load the local builtin placeholder from public/.
 */
export interface LoadBaseGeometryOptions {
    /**
     * Seal small internal slits on the bottom sub-mesh after load.
     * Disabled on viewer load (main-thread cost); reserved for future worker path.
     */
    sealBottomSlits?: boolean;
}

async function mergeLoadedGlbGroup(
    group: Awaited<ReturnType<typeof loadGlbFromUrl>>,
    options: LoadBaseGeometryOptions,
): Promise<MergedGlbGeometry | null> {
    const mergeOptions: ExtractMergedGeometryOptions = {
        sealBottomSlits: options.sealBottomSlits,
    };
    if (options.sealBottomSlits) {
        return extractMergedGeometryAsync(group, mergeOptions);
    }
    return extractMergedGeometry(group, mergeOptions);
}

export async function loadBaseGeometry(
    base: DesignBase,
    options: LoadBaseGeometryOptions = {},
): Promise<BufferGeometry | null> {
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
            const merged = await mergeLoadedGlbGroup(group, options);
            geo = merged?.geometry ?? null;
            if (!geo) {
                const msg = "GLTF loaded but no mesh geometry was found in the file";
                stockGlbLog(`GLTFLoader error: ${msg} (url="${fetchUrl}")`);
                throw new StockGlbLoadError(fetchUrl, new Error(msg));
            }
            // Normalize into the canonical footprint frame (X=length, Y=width
            // centered, Z=height) so the viewer's per-side sideOffsetX separates
            // the feet across width (side by side) instead of along their length.
            geo = reorientToFootprintFrame(geo);
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
            const merged = await mergeLoadedGlbGroup(group, options);
            if (merged) geo = merged.geometry;
        }

        if (!geo) {
            const prefab = store.customPrefabs.find((p) => p.id === base.assetId);
            if (prefab?.url) {
                const group = await loadGlbFromUrl(prefab.url);
                const merged = await mergeLoadedGlbGroup(group, options);
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
        // Skives excluded from F / heightAt on the base path — applied post-sync
        // as a top-only Kirby plane raise (R11). See heel-skive.ts.
        includeSkives: false,
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
