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
        const sideBase = side === 'left' ? design.paired.leftBase : design.paired.rightBase;
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
// We retain a tiny synchronous builtin placeholder **strictly** as last-resort
// for completely offline/dev scenarios and for the earliest synchronous store
// paths (reset / loadDesign). It is always upgraded when the async resolver runs.
//
// Server responses include a ready-to-use `url` (signed or public) which
// loadBaseGeometry prefers over client-side path guessing. This enables proper
// Supabase storage ("stock-bases" bucket or shared bucket under stock/ prefix).

export const DEFAULT_STOCK_BASE_ID = "stock-default";

/**
 * LAST RESORT ONLY — local placeholder.
 *
 * This is used exclusively when:
 *   - The API is not configured (pure offline / certain dev modes), or
 *   - The server call to trpc.stock.getDefaultStockBase fails, or
 *   - No row with isDefault=true exists in the stock_bases table.
 *
 * Normal connected operation **always** goes through resolveDefaultStockBase() which
 * calls the server and returns a real StockBase row (with authoritative storage URL
 * and primarySide).
 *
 * Never rely on this for production behavior or for new stock bases.
 */
export const BUILTIN_DEFAULT_STOCK: { id: string; name: string; glbPath: string } = {
    id: DEFAULT_STOCK_BASE_ID,
    name: "Default Stock Base",
    glbPath: "Templates/Default.glb",
};

/**
 * Synchronous placeholder (LAST RESORT — see BUILTIN_DEFAULT_STOCK).
 * Only for the earliest synchronous paths inside the design store (reset/loadDesign)
 * so the UI has something to render immediately. It is upgraded as soon as the
 * async server resolution in applyDefaultStockBase / resolveDefaultStockBase completes.
 */
export function getDefaultStockBaseSync(): DesignBase {
    return {
        assetId: BUILTIN_DEFAULT_STOCK.id,
        name: BUILTIN_DEFAULT_STOCK.name,
        source: "stock",
        glbPath: BUILTIN_DEFAULT_STOCK.glbPath,
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
 * The returned object includes:
 *   - Real DB id (UUID)
 *   - glbPath (storage key)
 *   - `url` (public preferred from STOCK_BUCKET / "stock-bases", signed fallback)
 *   - `primarySide` (drives auto-mirroring decision on the client)
 *
 * When the API is configured, failure to resolve a default row is treated as a hard
 * error — new designs must never silently degrade to parametric mode. The synchronous
 * BUILTIN placeholder (getDefaultStockBaseSync) is only used for immediate UI paint
 * before this async call completes, or when the API is not configured (pure offline dev).
 */
export async function resolveDefaultStockBase(): Promise<DesignBase> {
    if (!isApiConfigured()) {
        return getDefaultStockBaseSync();
    }

    try {
        const item = await trpc.stock.getDefaultStockBase.query();
        if (item) {
            const base: DesignBase & { url?: string; primarySide?: string | null } = {
                assetId: item.id,
                name: item.name,
                source: "stock",
                glbPath: item.glbPath,
                ...(item.url ? { url: item.url } : {}),
                ...(item.primarySide ? { primarySide: item.primarySide } : {}),
            };
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
 * When `override` is provided (the result of resolveDefaultStockBase), we use its
 * assetId / glbPath / name and honor `primarySide` for deciding the authoritative side.
 * The mirrored side receives the `mirrored: true` + `mirroredFrom` tags so the rest
 * of the system (load, cache keys, future "reset to mirror") can treat it correctly.
 */
export function createDefaultStockPairedBases(
    override?: DesignBase,
): { left: DesignBase; right: DesignBase } {
    const source = override ?? getDefaultStockBaseSync();
    const primarySide = (source as any).primarySide as string | undefined | null;

    // Determine authoritative side from server data when available.
    // Current production asset (Default) is Right-foot only.
    const sourceIsRight = !primarySide || primarySide.toLowerCase() === "right";
    const authoritativeName = source.name ?? "Stock Base";

    const right: DesignBase = {
        assetId: source.assetId,
        name: `${authoritativeName} (Right)`,
        source: "stock",
        glbPath: source.glbPath,
        ...( (source as any).url ? { url: (source as any).url } : {} ),
    };

    const left: DesignBase = {
        assetId: source.assetId,
        name: `${authoritativeName.replace(/\s*\(Right\)?$/i, "")} (Left)`,
        source: "stock",
        glbPath: source.glbPath,
        mirrored: true,
        mirroredFrom: source.assetId,
        ...( (source as any).url ? { url: (source as any).url } : {} ),
    };

    // If the stock record ever declares itself Left-primary, swap roles.
    if (primarySide?.toLowerCase() === "left") {
        return { left: right, right: left }; // the "right" var is actually the mirrored one in this case
    }

    return { left, right: sourceIsRight ? right : left };
}

/**
 * Stable cache key for per-base derived data (outlines, bounds, zones).
 * For mirrored stock bases (auto Left from Right-only), appends ":mirrored" so that
 * the left side gets its own outline/bounds computed from the mirrored geometry,
 * rather than sharing (and getting wrong) data cached under the plain assetId.
 */
export function getBaseCacheKey(base: DesignBase | null | undefined): string | null {
    if (!base) return null;
    return base.mirrored ? `${base.assetId}:mirrored` : base.assetId;
}

/**
 * Clear predicate (server data preferred) to decide whether a stock base needs
 * an automatically generated mirrored opposite side.
 * Uses `primarySide` when the resolved base came from the server stock_bases row.
 * Falls back to ID / glbPath heuristics only for the local builtin placeholder.
 */
export function stockBaseRequiresAutoMirror(base: DesignBase | null): boolean {
    if (!base || base.source !== "stock" || base.mirrored) return false;

    const primary = (base as any).primarySide as string | undefined | null;
    if (primary) {
        // If server explicitly says the stock is single-sided, we mirror the opposite.
        // (For a future paired stock base, primarySide would be null or "both".)
        return primary.toLowerCase() === "right" || primary.toLowerCase() === "left";
    }

    // Local builtin / pre-server fallback heuristics (only for the known Default).
    if (base.assetId === DEFAULT_STOCK_BASE_ID) return true;
    if (base.glbPath && /default/i.test(base.glbPath)) return true;

    return false;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

/**
 * Load the raw base mesh geometry for a design base.
 *
 * - For source "stock": 
 *     • Prefers the full `url` (signed or public) returned by `trpc.stock.getDefaultStockBase`
 *       / list (Phase 2+ server-authoritative path, works with Supabase stock-bases bucket).
 *     • Falls back to glbPath as a root-relative static URL (for the local BUILTIN
 *       placeholder used in completely offline/dev scenarios).
 * - For source "custom": local IndexedDB/base64 blob first (uploaded or saved), then
 *   remote URL from the user's custom library.
 *
 * If the DesignBase has `mirrored: true`, the loaded geometry is mirrored across the
 * sagittal plane after fetch (supports Phase 2 auto Left from Right-only stock without
 * duplicating the asset bytes).
 */
export async function loadBaseGeometry(base: DesignBase): Promise<BufferGeometry | null> {
    const store = useCustomLibraryStore.getState();

    let geo: BufferGeometry | null = null;

    if (base.source === "stock") {
        // === STOCK vs CUSTOM DISTINCTION (important for long-term maintainability) ===
        // Stock bases:
        //   - Come from the global stock_bases table (server).
        //   - Server response usually includes a ready `url` (public preferred from STOCK_BUCKET / "stock-bases",
        //     signed as fallback). We use the full URL directly.
        //   - Fallback only for the local BUILTIN placeholder (public/ path served by Vite for pure dev).
        // Custom / user bases:
        //   - Resolved via useCustomLibraryStore (local base64 blob or the `url` stored on the customPrefab row).
        //   - Never mixed with stock resolution path.
        const directUrl = (base as any).url as string | undefined;
        const gp = base.glbPath ?? (base.assetId === DEFAULT_STOCK_BASE_ID || base.assetId.includes("default") ? BUILTIN_DEFAULT_STOCK.glbPath : null);

        let fetchUrl: string | null = null;
        if (directUrl && /^https?:\/\//i.test(directUrl)) {
            fetchUrl = directUrl; // authoritative from server (Supabase signed/public, possibly stock-bases bucket)
        } else if (gp) {
            fetchUrl = gp.startsWith("/") ? gp : `/${gp}`;
        }

        if (fetchUrl) {
            try {
                const group = await loadGlbFromUrl(fetchUrl);
                const merged = extractMergedGeometry(group);
                geo = merged?.geometry ?? null;
            } catch (e) {
                console.warn("[base-asset] Failed to load stock base GLB from", fetchUrl, e);
                geo = null;
            }
        }
    } else {
        // Custom / user library path (existing behavior)
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
        trimline: null, // preview path deliberately ignores trimline (clip happens in hook)
    };
}

/**
 * Authoritative field for the sewn OCCT base path (Phase 3B). Includes the
 * committed trimline so that applyTrimlineCut etc. can run as exact booleans
 * on the sewn solid. Only used for idle/Confirm/Export builds.
 */
export function baseModifierFieldAuthoritative(design: DesignState, side: Side, thicknessMm: number): HeightFieldParams {
    const f = baseModifierField(design, side, thicknessMm);
    // Pull the committed (not draft) trimline for manufacturing.
    const committed = getDesignTrimline(design, side); // local import below to avoid cycle in some builds
    return { ...f, trimline: committed };
}
