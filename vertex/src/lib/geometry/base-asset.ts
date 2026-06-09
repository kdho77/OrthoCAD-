// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import { getDesignTrimline } from "@/lib/geometry/trimline";
import { extractMergedGeometry, loadGlbFromBuffer, loadGlbFromUrl, mirrorGeometry } from "@/lib/library/loaders";
import { mergeCorrections, mergeElementPreviews } from "@/stores/performance-store";
import { useCustomLibraryStore } from "@/stores/custom-library-store";
import { isApiConfigured, trpc } from "@/lib/trpc";
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
    if (base.source !== "stock") return false;
    if (base.offlinePlaceholder) return true;
    if (base.assetId === DEFAULT_STOCK_BASE_ID) return true;
    if (isLocalPlaceholderGlbPath(base.glbPath)) return true;
    if (!hasAuthoritativeStockUrl(base)) return true;
    return false;
}

/**
 * True when the design's stock base still needs server resolution.
 * Used to trigger applyDefaultStockBase after auth, on new designs, and on rehydrate.
 */
export function designNeedsDefaultStockResolution(design: DesignState): boolean {
    if (!isApiConfigured()) return false;

    const seen = new Set<string>();
    const bases: (DesignBase | undefined)[] = [design.base, design.paired?.leftBase, design.paired?.rightBase];

    for (const base of bases) {
        if (!base || base.source !== "stock") continue;
        const key = `${base.assetId}:${base.mirrored ? "m" : "p"}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (stockBaseNeedsServerResolution(base)) return true;
    }
    return false;
}

/**
 * Strip local placeholder paths from persisted stock bases so loadBaseGeometry never
 * fetches public/Templates/Default.glb in server mode.
 */
export function sanitizeStockBaseForServerMode(base: DesignBase): DesignBase {
    if (!isApiConfigured() || base.source !== "stock") return base;
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
        return {
            assetId: BUILTIN_DEFAULT_STOCK.id,
            name: BUILTIN_DEFAULT_STOCK.name,
            source: "stock",
            glbPath: BUILTIN_DEFAULT_STOCK.glbPath,
            offlinePlaceholder: true,
        };
    }
    return {
        assetId: DEFAULT_STOCK_BASE_ID,
        name: "Default Stock Base",
        source: "stock",
    };
}

/** Thrown when the server cannot supply the mandatory default stock base. */
export class StockBaseResolutionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StockBaseResolutionError";
    }
}

/**
 * PRIMARY (and server-authoritative) async resolver for the default stock base.
 *
 * Calls `trpc.stock.getDefaultStockBase` which queries the real `stock_bases` table.
 * When the API is configured, failure to resolve a default row is a hard error.
 */
export async function resolveDefaultStockBase(): Promise<DesignBase> {
    if (!isApiConfigured()) {
        return getDefaultStockBaseSync();
    }

    try {
        const item = await trpc.stock.getDefaultStockBase.query();
        if (item) {
            const base: DesignBase = {
                assetId: item.id,
                name: item.name,
                source: "stock",
                glbPath: item.glbPath,
                ...(item.url ? { url: item.url } : {}),
                ...(item.primarySide ? { primarySide: item.primarySide } : {}),
            };
            if (!base.url) {
                throw new StockBaseResolutionError(
                    `Default stock base "${item.name}" has no downloadable URL. Check Supabase storage configuration.`,
                );
            }
            return base;
        }
        throw new StockBaseResolutionError(
            "No default stock base is configured on the server. Ask an admin to seed stock_bases (isDefault=true).",
        );
    } catch (e) {
        if (e instanceof StockBaseResolutionError) throw e;
        const detail = e instanceof Error ? e.message : String(e);
        throw new StockBaseResolutionError(
            `Failed to load the default stock base from the server: ${detail}`,
        );
    }
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
    if (hasAuthoritativeStockUrl(base)) return base.url!;

    if (!isApiConfigured()) {
        if (isOfflineStockPlaceholder(base)) {
            const gp = base.glbPath ?? BUILTIN_DEFAULT_STOCK.glbPath;
            return gp.startsWith("/") ? gp : `/${gp}`;
        }
        return null;
    }

    // API configured — never use glbPath as a local static path.
    try {
        if (UUID_RE.test(base.assetId)) {
            const item = await trpc.stock.getStockBase.query({ id: base.assetId });
            if (item.url) return item.url;
        } else if (base.assetId === DEFAULT_STOCK_BASE_ID || isLocalPlaceholderGlbPath(base.glbPath)) {
            const item = await trpc.stock.getDefaultStockBase.query();
            if (item?.url) return item.url;
        }
    } catch (e) {
        console.warn("[base-asset] Failed to resolve stock base URL from server:", e);
    }

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
        if (isApiConfigured() && stockBaseNeedsServerResolution(base)) {
            console.warn(
                "[base-asset] Stock base not yet resolved from server — skipping local placeholder",
                base.assetId,
            );
            return null;
        }

        const fetchUrl = await resolveStockFetchUrl(base);
        if (!fetchUrl) {
            if (isApiConfigured()) {
                console.warn(
                    "[base-asset] Stock base has no server URL — waiting for applyDefaultStockBase or check server config",
                    base.assetId,
                );
            }
            return null;
        }

        try {
            const group = await loadGlbFromUrl(fetchUrl);
            const merged = extractMergedGeometry(group);
            geo = merged?.geometry ?? null;
        } catch (e) {
            console.warn("[base-asset] Failed to load stock base GLB from", fetchUrl, e);
            geo = null;
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
