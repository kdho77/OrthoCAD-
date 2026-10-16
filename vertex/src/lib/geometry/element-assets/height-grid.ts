// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ELEMENT_GRID_MM } from "./types";

export interface ElementHeightGrid {
    cellMm: number;
    originX: number;
    originY: number;
    nx: number;
    ny: number;
    /** Max upper-envelope z per cell centre (mm); NaN = empty. */
    z: Float32Array;
    maxZ: number;
}

const gridCache = new Map<string, ElementHeightGrid>();

export function heightGridCacheKey(assetHash: string, transformKey: string): string {
    return `${assetHash.slice(0, 16)}|${transformKey}`;
}

function triangleRasterMaxZ(
    z: Float32Array,
    nx: number,
    ny: number,
    originX: number,
    originY: number,
    cellMm: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
): void {
    const minX = Math.min(ax, bx, cx);
    const maxX = Math.max(ax, bx, cx);
    const minY = Math.min(ay, by, cy);
    const maxY = Math.max(ay, by, cy);
    const i0 = Math.max(0, Math.floor((minX - originX) / cellMm));
    const i1 = Math.min(nx - 1, Math.ceil((maxX - originX) / cellMm));
    const j0 = Math.max(0, Math.floor((minY - originY) / cellMm));
    const j1 = Math.min(ny - 1, Math.ceil((maxY - originY) / cellMm));
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) < 1e-12) return;
    for (let iy = j0; iy <= j1; iy++) {
        const py = originY + (iy + 0.5) * cellMm;
        for (let ix = i0; ix <= i1; ix++) {
            const px = originX + (ix + 0.5) * cellMm;
            const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
            const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
            const w2 = 1 - w0 - w1;
            if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
            const pz = w0 * az + w1 * bz + w2 * cz;
            if (pz < -1e-6) continue;
            const k = iy * nx + ix;
            const prev = z[k]!;
            z[k] = Number.isFinite(prev) ? Math.max(prev, pz) : pz;
        }
    }
}

function boundsFromPositions(positions: Float32Array): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    maxZ: number;
} {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = 0;
    for (let i = 0; i < positions.length / 3; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        const z = positions[i * 3 + 2]!;
        if (z < -1e-6) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
    }
    return { minX, minY, maxX, maxY, maxZ };
}

/** Point-splat fallback (vertices only). */
export function rasterizeUpperEnvelope(positions: Float32Array, cellMm = ELEMENT_GRID_MM): ElementHeightGrid {
    const { minX, minY, maxX, maxY, maxZ: seedMax } = boundsFromPositions(positions);
    const pad = cellMm * 2;
    const oX = minX - pad;
    const oY = minY - pad;
    const nx = Math.max(4, Math.ceil((maxX - minX + 2 * pad) / cellMm));
    const ny = Math.max(4, Math.ceil((maxY - minY + 2 * pad) / cellMm));
    const z = new Float32Array(nx * ny);
    z.fill(Number.NaN);
    let maxZ = seedMax;
    for (let i = 0; i < positions.length / 3; i++) {
        const px = positions[i * 3]!;
        const py = positions[i * 3 + 1]!;
        const pz = positions[i * 3 + 2]!;
        if (pz < -1e-6) continue;
        const ix = Math.floor((px - oX) / cellMm - 0.5);
        const iy = Math.floor((py - oY) / cellMm - 0.5);
        if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) continue;
        const ki = iy * nx + ix;
        const prev = z[ki]!;
        z[ki] = Number.isFinite(prev) ? Math.max(prev, pz) : pz;
        maxZ = Math.max(maxZ, pz);
    }
    return { cellMm, originX: oX, originY: oY, nx, ny, z, maxZ };
}

export function rasterizeUpperEnvelopeFromIndexed(
    positions: Float32Array,
    indices: ArrayLike<number>,
    cellMm = ELEMENT_GRID_MM,
): ElementHeightGrid {
    const { minX, minY, maxX, maxY, maxZ: seedMax } = boundsFromPositions(positions);
    const pad = cellMm * 2;
    const oX = minX - pad;
    const oY = minY - pad;
    const nx = Math.max(4, Math.ceil((maxX - minX + 2 * pad) / cellMm));
    const ny = Math.max(4, Math.ceil((maxY - minY + 2 * pad) / cellMm));
    const z = new Float32Array(nx * ny);
    z.fill(Number.NaN);
    let maxZ = seedMax;
    for (let f = 0; f < indices.length; f += 3) {
        const a = indices[f]! * 3;
        const b = indices[f + 1]! * 3;
        const c = indices[f + 2]! * 3;
        triangleRasterMaxZ(
            z,
            nx,
            ny,
            oX,
            oY,
            cellMm,
            positions[a]!,
            positions[a + 1]!,
            positions[a + 2]!,
            positions[b]!,
            positions[b + 1]!,
            positions[b + 2]!,
            positions[c]!,
            positions[c + 1]!,
            positions[c + 2]!,
        );
    }
    for (let i = 0; i < z.length; i++) {
        if (Number.isFinite(z[i]!)) maxZ = Math.max(maxZ, z[i]!);
    }
    return { cellMm, originX: oX, originY: oY, nx, ny, z, maxZ };
}

export function sampleGridBilinear(grid: ElementHeightGrid, lx: number, ly: number): number {
    const u = (lx - grid.originX) / grid.cellMm - 0.5;
    const v = (ly - grid.originY) / grid.cellMm - 0.5;
    if (u < 0 || v < 0 || u > grid.nx - 1 || v > grid.ny - 1) return 0;
    const u0 = Math.max(0, Math.min(grid.nx - 2, Math.floor(u)));
    const v0 = Math.max(0, Math.min(grid.ny - 2, Math.floor(v)));
    const fu = u - u0;
    const fv = v - v0;
    const at = (iu: number, iv: number): number => {
        const val = grid.z[iv * grid.nx + iu]!;
        return Number.isFinite(val) ? val : 0;
    };
    const z00 = at(u0, v0);
    const z10 = at(u0 + 1, v0);
    const z01 = at(u0, v0 + 1);
    const z11 = at(u0 + 1, v0 + 1);
    return (1 - fu) * (1 - fv) * z00 + fu * (1 - fv) * z10 + (1 - fu) * fv * z01 + fu * fv * z11;
}

export function sequentialTriangleIndices(vertexCount: number): Uint32Array {
    const n = Math.floor(vertexCount / 3) * 3;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    return idx;
}

export function getOrRasterizeGrid(
    cacheKey: string,
    positions: Float32Array,
    indices?: ArrayLike<number> | null,
): ElementHeightGrid {
    const hit = gridCache.get(cacheKey);
    if (hit) return hit;
    const tri = indices && indices.length >= 3 ? indices : sequentialTriangleIndices(positions.length / 3);
    const grid = rasterizeUpperEnvelopeFromIndexed(positions, tri);
    gridCache.set(cacheKey, grid);
    return grid;
}

export function footprintHalfExtentsFromGrid(grid: ElementHeightGrid): { rx: number; ry: number } {
    return {
        rx: (grid.nx * grid.cellMm) / 2,
        ry: (grid.ny * grid.cellMm) / 2,
    };
}

export function gridFootprintBounds(
    grid: ElementHeightGrid,
    zMin = 0.05,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let iy = 0; iy < grid.ny; iy++) {
        for (let ix = 0; ix < grid.nx; ix++) {
            const z = grid.z[iy * grid.nx + ix]!;
            if (!Number.isFinite(z) || z < zMin) continue;
            const x = grid.originX + (ix + 0.5) * grid.cellMm;
            const y = grid.originY + (iy + 0.5) * grid.cellMm;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, maxX, minY, maxY };
}
