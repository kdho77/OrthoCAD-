// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as THREE from "three";
import { extractMeshOutline, type TrimlineCurve } from "@/lib/geometry/trimline";

/**
 * Production BaseBounds for imported clinical base templates (Phase 3A+).
 *
 * Captures the stable geometric + clinical envelope of a *neutral* base mesh
 * so that interactive edits (especially trimline drags in production editing)
 * and later boolean sewing (Phase 3B) can respect the lab's original intent:
 * - Do not silently erase registration features or critical load-bearing margins.
 * - Provide zone hints (heel/arch/forefoot) for STA-aware posting and regional
 *   blend weights (Phase 4).
 * - Seed safe default trimlines and provide drag limits.
 *
 * BaseBounds are computed once per loaded assetId (cached) from the raw GLB
 * geometry before any modifiers are applied. They are read-only facts about
 * the template.
 */

export interface BaseClinicalZones {
    /** Normalized u [0 heel .. 1 toe] intervals for major anatomical regions. */
    heel: [number, number];
    arch: [number, number];
    forefoot: [number, number];
}

export interface BaseBounds {
    assetId: string;
    /** Closed outline in the base's own raw footprint frame (matches extractMeshOutline). */
    outline: TrimlineCurve | null;
    /** Which local axis is length/width/thickness (robust to authored orientation). */
    lengthAxis: 0 | 1 | 2;
    widthAxis: 0 | 1 | 2;
    thickAxis: 0 | 1 | 2;
    /** Rough extents in the base's local frame (mm). */
    lengthMm: number;
    widthMm: number;
    thicknessMm: number;
    /** Recommended minimum margin (mm) from any user trimline to the original silhouette.
     *  Used in 3A to warn on aggressive trims and in orphan detection for "base feature orphaned".
     */
    safeMarginMm: number;
    /** Rough clinical zoning derived from silhouette extrema and bounding box. */
    zones: BaseClinicalZones;
    /** Timestamp of computation (for cache invalidation if we ever hot-reload assets). */
    computedAt: string;
}

const baseBoundsCache = new Map<string, BaseBounds>();

/** Very lightweight zone estimator from a filled station list (see extractMeshOutline logic). */
function estimateZonesFromStations(stations: { len: number; lo: number; hi: number }[], lenMin: number, lenSize: number): BaseClinicalZones {
    if (stations.length < 4) {
        return { heel: [0, 0.22], arch: [0.22, 0.62], forefoot: [0.62, 1] };
    }
    // Find waist (minimum width) as arch/fore transition proxy.
    let minWidthIdx = 0;
    let minW = Infinity;
    stations.forEach((st, i) => {
        const w = st.hi - st.lo;
        if (w < minW) {
            minW = w;
            minWidthIdx = i;
        }
    });
    const uWaist = stations.length > 1 ? (stations[minWidthIdx]!.len - lenMin) / lenSize : 0.45;

    // Heel is the rear ~18-25% where width is still relatively broad and then narrows into arch.
    const heelEnd = Math.max(0.18, Math.min(0.28, uWaist * 0.55));
    // Arch occupies from heelEnd to a bit past the waist.
    const archEnd = Math.min(0.68, uWaist + 0.18);
    return {
        heel: [0, heelEnd],
        arch: [heelEnd, archEnd],
        forefoot: [archEnd, 1],
    };
}

/**
 * Compute (or return cached) rich bounds for a neutral base GLB geometry.
 * The geometry must be in the "render" frame used by BaseInsoleMesh (no extra
 * rotation applied yet). Safe to call repeatedly; result is stable per assetId.
 */
export function computeBaseBounds(geometry: THREE.BufferGeometry, assetId: string): BaseBounds {
    const cached = baseBoundsCache.get(assetId);
    if (cached) return cached;

    const pos = geometry.getAttribute("position");
    if (!pos || pos.count < 3) {
        const fallback: BaseBounds = {
            assetId,
            outline: null,
            lengthAxis: 0,
            widthAxis: 1,
            thickAxis: 2,
            lengthMm: 0,
            widthMm: 0,
            thicknessMm: 0,
            safeMarginMm: 2.0,
            zones: { heel: [0, 0.22], arch: [0.22, 0.62], forefoot: [0.62, 1] },
            computedAt: new Date().toISOString(),
        };
        baseBoundsCache.set(assetId, fallback);
        return fallback;
    }

    // Replicate lightweight extent + axis logic (kept in sync with base-modifier resolveBaseAxes).
    let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    const sx = maxX - minX;
    const sy = maxY - minY;
    const sz = maxZ - minZ;

    const sizes: Array<{ axis: 0 | 1 | 2; size: number }> = [
        { axis: 0, size: sx },
        { axis: 1, size: sy },
        { axis: 2, size: sz },
    ];
    sizes.sort((a, b) => a.size - b.size);
    const thickAxis = sizes[0]!.axis;
    const widthAxis = sizes[1]!.axis;
    const lengthAxis = sizes[2]!.axis;

    const lengthMm = sizes[2]!.size;
    const widthMm = sizes[1]!.size;
    const thicknessMm = sizes[0]!.size;

    const outline = extractMeshOutline(geometry, 36);

    // Safe margin: at least 1.5 mm or ~1.2% of length, whichever larger for small pediatric bases.
    const safeMarginMm = Math.max(1.5, lengthMm * 0.012);

    // Build a station list similar to extract for zone estimation.
    const n = 36;
    const lenMin = lengthAxis === 0 ? minX : minY;
    const lenSize = lengthMm || 1;
    const lo = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
    const hi = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
    for (let i = 0; i < pos.count; i++) {
        const lenCoord = lengthAxis === 0 ? pos.getX(i) : pos.getY(i);
        const widCoord = lengthAxis === 0 ? pos.getY(i) : pos.getX(i);
        let s = Math.round(((lenCoord - lenMin) / lenSize) * (n - 1));
        if (s < 0) s = 0;
        else if (s > n - 1) s = n - 1;
        if (widCoord < lo[s]!) lo[s] = widCoord;
        if (widCoord > hi[s]!) hi[s] = widCoord;
    }
    const stations: { len: number; lo: number; hi: number }[] = [];
    for (let s = 0; s < n; s++) {
        if (lo[s]! === Number.POSITIVE_INFINITY) continue;
        stations.push({ len: lenMin + (s / (n - 1)) * lenSize, lo: lo[s]!, hi: hi[s]! });
    }
    const zones = estimateZonesFromStations(stations, lenMin, lenSize);

    const bounds: BaseBounds = {
        assetId,
        outline,
        lengthAxis,
        widthAxis,
        thickAxis,
        lengthMm,
        widthMm,
        thicknessMm,
        safeMarginMm,
        zones,
        computedAt: new Date().toISOString(),
    };
    baseBoundsCache.set(assetId, bounds);
    return bounds;
}

export function getBaseBounds(assetId: string | null | undefined): BaseBounds | null {
    if (!assetId) return null;
    return baseBoundsCache.get(assetId) ?? null;
}

export function clearBaseBoundsCache(assetId?: string): void {
    if (assetId) baseBoundsCache.delete(assetId);
    else baseBoundsCache.clear();
}

/** Helper: does the given point (in base local footprint) lie safely inside the original outline + margin? */
export function isInsideBaseSafeMargin(point: THREE.Vector3, bounds: BaseBounds | null): boolean {
    if (!bounds || !bounds.outline || bounds.outline.points.length < 4) return true;
    // Reuse the even-odd test from trimline (small import to avoid circularity; duplicated 8-line predicate is acceptable).
    const poly = bounds.outline.points;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i]!.x;
        const yi = poly[i]!.y;
        const xj = poly[j]!.x;
        const yj = poly[j]!.y;
        const intersects = yi > y !== yj > y && point.x < ((xj - xi) * (point.x - xi)) / (yj - yi) + xi; // note: uses x/y as footprint
        if (intersects) inside = !inside;
    }
    if (!inside) return false;

    // Margin inset test: compute distance to nearest edge and require >= safeMargin.
    let minDist = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        const ab = new THREE.Vector3(b.x - a.x, b.y - a.y, 0);
        const ap = new THREE.Vector3(point.x - a.x, point.y - a.y, 0);
        const t = Math.max(0, Math.min(1, ap.dot(ab) / (ab.lengthSq() || 1)));
        const proj = new THREE.Vector3(a.x + ab.x * t, a.y + ab.y * t, 0);
        const d = proj.distanceTo(new THREE.Vector3(point.x, point.y, 0));
        if (d < minDist) minDist = d;
    }
    return minDist >= (bounds.safeMarginMm ?? 1.5);
}
