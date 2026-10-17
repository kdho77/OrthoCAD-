// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Heightmap, ToolType } from "./types";

/** Max-Z downsample so SAMPLE_Top drop maps stay under the 10 s export gate. Synthetic grids stay native. */
export function coarsenHeightmap(hm: Heightmap, cellMm: number): Heightmap {
    if (hm.cell >= cellMm - 1e-12) return hm;
    const factor = Math.max(2, Math.round(cellMm / hm.cell));
    const cell = hm.cell * factor;
    const nx = Math.max(2, Math.ceil(hm.nx / factor));
    const ny = Math.max(2, Math.ceil(hm.ny / factor));
    const z = new Float32Array(nx * ny);
    z.fill(Number.NaN);
    const inside = new Uint8Array(nx * ny);
    for (let iy = 0; iy < hm.ny; iy++) {
        const jy = (iy / factor) | 0;
        for (let ix = 0; ix < hm.nx; ix++) {
            const jx = (ix / factor) | 0;
            const src = hm.z[iy * hm.nx + ix]!;
            const j = jy * nx + jx;
            if (Number.isFinite(src) && (!Number.isFinite(z[j]!) || src > z[j]!)) z[j] = src;
            if (hm.inside[iy * hm.nx + ix] === 1) inside[j] = 1;
        }
    }
    return { originX: hm.originX, originY: hm.originY, cell, nx, ny, z, inside };
}

export function ballScallopMm(radiusMm: number, stepoverMm: number): number {
    const r = Math.max(1e-6, radiusMm);
    const half = stepoverMm / 2;
    if (half >= r) return r;
    return r - Math.sqrt(Math.max(0, r * r - half * half));
}

/** Precompute gouge-free tool-tip Z on the same grid as the surface heightmap. */
export function buildDropMap(hm: Heightmap, radiusMm: number, type: ToolType): Heightmap {
    const grid = hm.nx * hm.ny > 120_000 ? coarsenHeightmap(hm, Math.max(0.5, hm.cell * 2)) : hm;
    const r = Math.max(0.05, radiusMm);
    const r2 = r * r;
    const cell = grid.cell;
    const nx = grid.nx;
    const ny = grid.ny;
    const rCells = Math.ceil(r / cell);
    const kdx: number[] = [];
    const kdy: number[] = [];
    const klift: number[] = [];
    for (let dy = -rCells; dy <= rCells; dy++) {
        const y = dy * cell;
        for (let dx = -rCells; dx <= rCells; dx++) {
            const x = dx * cell;
            const d2 = x * x + y * y;
            if (d2 > r2 + 1e-9) continue;
            kdx.push(dx);
            kdy.push(dy);
            klift.push(type === "ball" ? r - Math.sqrt(Math.max(0, r2 - d2)) : 0);
        }
    }
    const kn = kdx.length;
    const out = new Float32Array(nx * ny);
    out.fill(Number.NaN);
    const srcZ = grid.z;
    for (let i = 0; i < srcZ.length; i++) {
        const z = srcZ[i]!;
        if (!Number.isFinite(z)) continue;
        const ix = i % nx;
        const iy = (i / nx) | 0;
        for (let k = 0; k < kn; k++) {
            const jx = ix + kdx[k]!;
            const jy = iy + kdy[k]!;
            if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
            const v = z + klift[k]!;
            const j = jy * nx + jx;
            const prev = out[j]!;
            if (!Number.isFinite(prev) || v > prev) out[j] = v;
        }
    }
    return { ...grid, z: out };
}

export function sampleDrop(map: Heightmap, x: number, y: number): number {
    const gx = (x - map.originX) / map.cell;
    const gy = (y - map.originY) / map.cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    if (x0 < 0 || y0 < 0 || x0 >= map.nx - 1 || y0 >= map.ny - 1) return Number.NaN;
    const z00 = map.z[y0 * map.nx + x0]!;
    const z10 = map.z[y0 * map.nx + x0 + 1]!;
    const z01 = map.z[(y0 + 1) * map.nx + x0]!;
    const z11 = map.z[(y0 + 1) * map.nx + x0 + 1]!;
    const vals = [z00, z10, z01, z11].filter((z) => Number.isFinite(z));
    if (!vals.length) return Number.NaN;
    if (vals.length < 4) return Math.max(...vals);
    const fx = gx - x0;
    const fy = gy - y0;
    return z00 * (1 - fx) * (1 - fy) + z10 * fx * (1 - fy) + z01 * (1 - fx) * fy + z11 * fx * fy;
}

/** Gouge-free drop-cutter: tool-tip Z so the tool stays above the heightmap. */
export function dropCutterZ(hm: Heightmap, x: number, y: number, radiusMm: number, type: ToolType): number {
    const r = Math.max(0.05, radiusMm);
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor((x - r - hm.originX) / hm.cell));
    const x1 = Math.min(hm.nx - 1, Math.ceil((x + r - hm.originX) / hm.cell));
    const y0 = Math.max(0, Math.floor((y - r - hm.originY) / hm.cell));
    const y1 = Math.min(hm.ny - 1, Math.ceil((y + r - hm.originY) / hm.cell));
    let best = -Infinity;
    for (let iy = y0; iy <= y1; iy++) {
        const sy = hm.originY + iy * hm.cell;
        const dy = sy - y;
        for (let ix = x0; ix <= x1; ix++) {
            const sx = hm.originX + ix * hm.cell;
            const dx = sx - x;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2 + 1e-9) continue;
            const z = hm.z[iy * hm.nx + ix]!;
            if (!Number.isFinite(z)) continue;
            let cand = z;
            if (type === "ball") cand = z + r - Math.sqrt(Math.max(0, r2 - d2));
            if (cand > best) best = cand;
        }
    }
    return best;
}
