// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";

/**
 * Absolute shell-thickness datum (Option C).
 *
 * thicknessMm is the minimum material thickness at the thinnest section of the
 * top sheet above the plantar (ground-contact) plane — not a gap to the bottom
 * mesh surface. The bottom mesh is a perimeter shell with a filled plantar
 * plate (coarse central tessellation); its wall-to-top gap is not thickness.
 *
 *   offset = thicknessMm − nativeMinClearance
 *
 * nativeMinClearance is derived per base asset from the raw top sheet and is
 * thickness-/correction-independent. Cached on the geometry.
 */

/** Robust low percentile for native clearance (rejects a single stray vertex). */
export const NATIVE_CLEARANCE_PERCENTILE = 0.01;

/**
 * Bottom verts within this height of the bottom Z-minimum form the plantar
 * ground-contact band used to locate the plantar plane.
 */
export const PLANTAR_CONTACT_BAND_MM = 0.5;

/**
 * Safety margin (mm) kept between the top rim and bottom wall-tops when a
 * negative thickness offset would otherwise sink the rim into the walls.
 */
export const THICKNESS_RIM_SAFETY_MARGIN_MM = 0.05;

type AxisIndex = 0 | 1 | 2;

export interface NativeShellThicknessDatum {
    /** Plantar plane Z (along thickAxis) from the ground-contact band. */
    plantarPlaneZ: number;
    /**
     * Robust minimum top-sheet clearance above the plantar plane (mm).
     * Equals the NATIVE_CLEARANCE_PERCENTILE of per-vertex clearances.
     */
    nativeMinClearanceMm: number;
    /** Min top-rim ↔ wall-top clearance (mm) used for negative-offset safety. */
    minRimWallClearanceMm: number;
    thickAxis: AxisIndex;
    lengthAxis: AxisIndex;
    widthAxis: AxisIndex;
}

const datumCache = new WeakMap<BufferGeometry, NativeShellThicknessDatum>();

function resolveAxes(
    sizeX: number,
    sizeY: number,
    sizeZ: number,
): {
    lengthAxis: AxisIndex;
    widthAxis: AxisIndex;
    thickAxis: AxisIndex;
} {
    const sizes: [AxisIndex, number][] = [
        [0, sizeX],
        [1, sizeY],
        [2, sizeZ],
    ];
    sizes.sort((a, b) => a[1] - b[1]);
    return { thickAxis: sizes[0]![0], widthAxis: sizes[1]![0], lengthAxis: sizes[2]![0] };
}

function percentileSorted(sorted: number[], q: number): number {
    if (sorted.length === 0) return 0;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
    return sorted[i]!;
}

function medianSorted(sorted: number[]): number {
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Derive the plantar plane and native min clearance for a multi-mesh base.
 * Returns null when the geometry has no usable top/bottom split.
 */
export function deriveNativeShellThicknessDatum(base: BufferGeometry): NativeShellThicknessDatum | null {
    const cached = datumCache.get(base);
    if (cached) return cached;

    const pos = base.getAttribute("position");
    if (!pos) return null;
    const ud = base.userData as { isMultiMeshBase?: boolean; topVertexCount?: number };
    const topN =
        ud.isMultiMeshBase && typeof ud.topVertexCount === "number" && ud.topVertexCount > 0
            ? ud.topVertexCount
            : 0;
    if (topN <= 0 || topN >= pos.count) return null;

    base.computeBoundingBox();
    const box = base.boundingBox;
    if (!box) return null;
    const { lengthAxis, widthAxis, thickAxis } = resolveAxes(
        box.max.x - box.min.x,
        box.max.y - box.min.y,
        box.max.z - box.min.z,
    );

    const arr = pos.array as Float32Array;
    const count = pos.count;

    let botZMin = Infinity;
    for (let i = topN; i < count; i++) {
        const z = arr[i * 3 + thickAxis]!;
        if (z < botZMin) botZMin = z;
    }
    if (!Number.isFinite(botZMin)) return null;

    const band: number[] = [];
    for (let i = topN; i < count; i++) {
        const z = arr[i * 3 + thickAxis]!;
        if (z <= botZMin + PLANTAR_CONTACT_BAND_MM) band.push(z);
    }
    band.sort((a, b) => a - b);
    const plantarPlaneZ = band.length > 0 ? medianSorted(band) : botZMin;

    const clearances: number[] = [];
    for (let i = 0; i < topN; i++) {
        clearances.push(arr[i * 3 + thickAxis]! - plantarPlaneZ);
    }
    clearances.sort((a, b) => a - b);
    const nativeMinClearanceMm = percentileSorted(clearances, NATIVE_CLEARANCE_PERCENTILE);

    // Posterior / full-rim: min (top − nearest wall-top) within 1 mm XY.
    // Wall-top candidates: bottom verts more than PLANTAR_Z-like height above plantar.
    const WALL_TOP_MIN_ABOVE_PLANTAR = 2.0;
    let minRimWallClearanceMm = Infinity;
    const cell = 1.0;
    const hash = new Map<string, number[]>();
    for (let i = topN; i < count; i++) {
        const z = arr[i * 3 + thickAxis]!;
        if (z < plantarPlaneZ + WALL_TOP_MIN_ABOVE_PLANTAR) continue;
        const k = `${Math.floor(arr[i * 3 + lengthAxis]! / cell)},${Math.floor(arr[i * 3 + widthAxis]! / cell)}`;
        let b = hash.get(k);
        if (!b) {
            b = [];
            hash.set(k, b);
        }
        b.push(i);
    }
    for (let i = 0; i < topN; i++) {
        const lx = arr[i * 3 + lengthAxis]!;
        const wy = arr[i * 3 + widthAxis]!;
        const tz = arr[i * 3 + thickAxis]!;
        const cx = Math.floor(lx / cell);
        const cy = Math.floor(wy / cell);
        let bestD = Infinity;
        let bestBz = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const bucket = hash.get(`${cx + dx},${cy + dy}`);
                if (!bucket) continue;
                for (const j of bucket) {
                    const d = Math.hypot(arr[j * 3 + lengthAxis]! - lx, arr[j * 3 + widthAxis]! - wy);
                    if (d < bestD) {
                        bestD = d;
                        bestBz = arr[j * 3 + thickAxis]!;
                    }
                }
            }
        }
        if (bestD <= 1.0) {
            const gap = tz - bestBz;
            if (gap < minRimWallClearanceMm) minRimWallClearanceMm = gap;
        }
    }
    if (!Number.isFinite(minRimWallClearanceMm)) minRimWallClearanceMm = 0;

    const datum: NativeShellThicknessDatum = {
        plantarPlaneZ,
        nativeMinClearanceMm,
        minRimWallClearanceMm,
        thickAxis,
        lengthAxis,
        widthAxis,
    };
    datumCache.set(base, datum);
    return datum;
}

/**
 * Rigid top-shell thickness offset (mm) for Option C.
 * Clamped so a negative offset cannot sink the top rim into the wall tops.
 */
export function thicknessOffsetFromDatum(
    thicknessMm: number,
    datum: NativeShellThicknessDatum,
): { offsetMm: number; clamped: boolean; safeFloorThicknessMm: number } {
    const raw = thicknessMm - datum.nativeMinClearanceMm;
    const minOffset = -(datum.minRimWallClearanceMm - THICKNESS_RIM_SAFETY_MARGIN_MM);
    const safeFloorThicknessMm = datum.nativeMinClearanceMm + minOffset;
    if (raw < minOffset) {
        return { offsetMm: minOffset, clamped: true, safeFloorThicknessMm };
    }
    return { offsetMm: raw, clamped: false, safeFloorThicknessMm };
}

/** Convenience: offset for a multi-mesh base, or 0 when no datum exists. */
export function resolveThicknessOffsetMm(base: BufferGeometry, thicknessMm: number): number {
    const datum = deriveNativeShellThicknessDatum(base);
    if (!datum) return 0;
    return thicknessOffsetFromDatum(thicknessMm, datum).offsetMm;
}
