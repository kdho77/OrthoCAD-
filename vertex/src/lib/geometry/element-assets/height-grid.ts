// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { ELEMENT_GRID_MM } from "./types";

export interface ElementHeightGrid {
    cellMm: number;
    originX: number;
    originY: number;
    nx: number;
    ny: number;
    /** Max upper-envelope z per cell (mm); NaN = empty. */
    z: Float32Array;
    maxZ: number;
}

const gridCache = new Map<string, ElementHeightGrid>();

export function heightGridCacheKey(assetHash: string, transformKey: string): string {
    return `${assetHash.slice(0, 16)}|${transformKey}`;
}

export function rasterizeUpperEnvelope(positions: Float32Array, cellMm = ELEMENT_GRID_MM): ElementHeightGrid {
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
    const pad = cellMm * 2;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const nx = Math.max(4, Math.ceil((maxX - minX) / cellMm));
    const ny = Math.max(4, Math.ceil((maxY - minY) / cellMm));
    const z = new Float32Array(nx * ny);
    z.fill(Number.NaN);
    for (let i = 0; i < positions.length / 3; i++) {
        const px = positions[i * 3]!;
        const py = positions[i * 3 + 1]!;
        const pz = positions[i * 3 + 2]!;
        if (pz < -1e-6) continue;
        const ix = Math.floor((px - minX) / cellMm);
        const iy = Math.floor((py - minY) / cellMm);
        if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) continue;
        const k = iy * nx + ix;
        const prev = z[k]!;
        z[k] = Number.isFinite(prev) ? Math.max(prev, pz) : pz;
    }
    return { cellMm, originX: minX, originY: minY, nx, ny, z, maxZ };
}

export function sampleGridBilinear(grid: ElementHeightGrid, lx: number, ly: number): number {
    const u = (lx - grid.originX) / grid.cellMm;
    const v = (ly - grid.originY) / grid.cellMm;
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

export function getOrRasterizeGrid(cacheKey: string, positions: Float32Array): ElementHeightGrid {
    const hit = gridCache.get(cacheKey);
    if (hit) return hit;
    const grid = rasterizeUpperEnvelope(positions);
    gridCache.set(cacheKey, grid);
    return grid;
}

export function footprintHalfExtentsFromGrid(grid: ElementHeightGrid): { rx: number; ry: number } {
    return {
        rx: (grid.nx * grid.cellMm) / 2,
        ry: (grid.ny * grid.cellMm) / 2,
    };
}
