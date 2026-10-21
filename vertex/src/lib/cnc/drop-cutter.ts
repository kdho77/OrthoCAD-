// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Heightmap, ToolType } from "./types";

/** Design samples used by the drop cutter. Coarser maps are bilinearly refined to this. */
export const DESIGN_PITCH_MM = 0.2;

/** Outside the outline, and the global tip clamp. Idaho skin is 1 mm. */
export const SKIN_FLOOR_MM = 1;

const prepared = new WeakMap<Heightmap, Heightmap>();

/**
 * Tool-tip Z forced by one design sample at horizontal distance `dist` (dist ≤ r).
 * Ball nose: the tip is the lowest point of the sphere, so
 * tip = z − r + sqrt(r² − d²). The previous z + (r − sqrt) is the inverted cusp
 * and holds the tip a full radius above a flat surface.
 * Flat: the face is at the tip, so the sample's own Z is the constraint.
 */
export function cutterTipFromSample(z: number, dist: number, radius: number, type: ToolType): number {
    if (type !== "ball") return z;
    const r = radius;
    return z - r + Math.sqrt(Math.max(0, r * r - dist * dist));
}

export function clampTipZ(z: number, floor = SKIN_FLOOR_MM): number {
    if (!Number.isFinite(z)) return floor;
    return z < floor ? floor : z;
}

function storedZ(hm: Heightmap, ix: number, iy: number, skin: number): number {
    if (ix < 0 || iy < 0 || ix >= hm.nx || iy >= hm.ny) return skin;
    const i = iy * hm.nx + ix;
    if (hm.inside[i] !== 1) return skin;
    const z = hm.z[i];
    return z !== undefined && Number.isFinite(z) ? z : skin;
}

/** Bilinear design Z. Outside, NaN, and off-grid corners are the skin floor — never a cell max. */
export function sampleDesignZ(hm: Heightmap, x: number, y: number, skin = SKIN_FLOOR_MM): number {
    if (hm.cell <= 0 || hm.nx < 1 || hm.ny < 1) return skin;
    const gx = (x - hm.originX) / hm.cell;
    const gy = (y - hm.originY) / hm.cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    if (x0 < -1 || y0 < -1 || x0 > hm.nx || y0 > hm.ny) return skin;
    const fx = gx - x0;
    const fy = gy - y0;
    const z00 = storedZ(hm, x0, y0, skin);
    const z10 = storedZ(hm, x0 + 1, y0, skin);
    const z01 = storedZ(hm, x0, y0 + 1, skin);
    const z11 = storedZ(hm, x0 + 1, y0 + 1, skin);
    return z00 * (1 - fx) * (1 - fy) + z10 * fx * (1 - fy) + z01 * (1 - fx) * fy + z11 * fx * fy;
}

function bakeSkin(hm: Heightmap, skin: number): Heightmap {
    const z = new Float32Array(hm.nx * hm.ny);
    for (let i = 0; i < z.length; i++) {
        const v = hm.z[i];
        z[i] = hm.inside[i] === 1 && v !== undefined && Number.isFinite(v) ? v : skin;
    }
    return {
        originX: hm.originX,
        originY: hm.originY,
        cell: hm.cell,
        nx: hm.nx,
        ny: hm.ny,
        z,
        inside: hm.inside,
    };
}

/** Pitch ≤ 0.2 mm. Coarser maps are resampled with bilinear Z, not a cell maximum. */
export function prepareDesignGrid(hm: Heightmap, skin = SKIN_FLOOR_MM): Heightmap {
    const hit = prepared.get(hm);
    if (hit) return hit;
    let grid: Heightmap;
    if (hm.cell <= DESIGN_PITCH_MM + 1e-9) {
        grid = bakeSkin(hm, skin);
    } else {
        const pitch = DESIGN_PITCH_MM;
        const spanX = Math.max(pitch, (hm.nx - 1) * hm.cell);
        const spanY = Math.max(pitch, (hm.ny - 1) * hm.cell);
        const nx = Math.max(2, Math.floor(spanX / pitch) + 1);
        const ny = Math.max(2, Math.floor(spanY / pitch) + 1);
        const z = new Float32Array(nx * ny);
        const inside = new Uint8Array(nx * ny);
        for (let iy = 0; iy < ny; iy++) {
            const y = hm.originY + iy * pitch;
            for (let ix = 0; ix < nx; ix++) {
                const x = hm.originX + ix * pitch;
                const i = iy * nx + ix;
                z[i] = sampleDesignZ(hm, x, y, skin);
                const sx = Math.round((x - hm.originX) / hm.cell);
                const sy = Math.round((y - hm.originY) / hm.cell);
                if (sx >= 0 && sy >= 0 && sx < hm.nx && sy < hm.ny && hm.inside[sy * hm.nx + sx] === 1) {
                    inside[i] = 1;
                }
            }
        }
        grid = { originX: hm.originX, originY: hm.originY, cell: pitch, nx, ny, z, inside };
    }
    prepared.set(hm, grid);
    return grid;
}

function tipAt(grid: Heightmap, x: number, y: number, radius: number, type: ToolType, skin: number): number {
    const r = Math.max(0.05, radius);
    const r2 = r * r;
    const cell = grid.cell;
    const x0 = Math.max(0, Math.floor((x - r - grid.originX) / cell));
    const x1 = Math.min(grid.nx - 1, Math.ceil((x + r - grid.originX) / cell));
    const y0 = Math.max(0, Math.floor((y - r - grid.originY) / cell));
    const y1 = Math.min(grid.ny - 1, Math.ceil((y + r - grid.originY) / cell));
    let best = Number.NEGATIVE_INFINITY;
    for (let iy = y0; iy <= y1; iy++) {
        const dy = grid.originY + iy * cell - y;
        const dy2 = dy * dy;
        if (dy2 > r2) continue;
        const row = iy * grid.nx;
        for (let ix = x0; ix <= x1; ix++) {
            const dx = grid.originX + ix * cell - x;
            const d2 = dx * dx + dy2;
            if (d2 > r2 + 1e-9) continue;
            const z = grid.z[row + ix];
            if (z === undefined || !Number.isFinite(z)) continue;
            const cand = cutterTipFromSample(z, Math.sqrt(d2), r, type);
            if (cand > best) best = cand;
        }
    }
    return clampTipZ(best, skin);
}

/** Gouge-free tool-tip Z. Same sample rule as {@link buildDropMap}. */
export function dropCutterZ(
    hm: Heightmap,
    x: number,
    y: number,
    radiusMm: number,
    type: ToolType,
    skin = SKIN_FLOOR_MM,
): number {
    return tipAt(prepareDesignGrid(hm, skin), x, y, radiusMm, type, skin);
}

/**
 * Tool-tip Z on the design grid. Each cell is the max tip forced by design
 * samples inside the cutter disc. No max-Z downsample.
 */
export function buildDropMap(
    hm: Heightmap,
    radiusMm: number,
    type: ToolType,
    skin = SKIN_FLOOR_MM,
): Heightmap {
    const grid = prepareDesignGrid(hm, skin);
    const r = Math.max(0.05, radiusMm);
    const r2 = r * r;
    const cell = grid.cell;
    const nx = grid.nx;
    const ny = grid.ny;
    const rCells = Math.ceil(r / cell);
    const kdx: number[] = [];
    const kdy: number[] = [];
    const kDist: number[] = [];
    for (let dy = -rCells; dy <= rCells; dy++) {
        const y = dy * cell;
        for (let dx = -rCells; dx <= rCells; dx++) {
            const x = dx * cell;
            const d2 = x * x + y * y;
            if (d2 > r2 + 1e-9) continue;
            kdx.push(dx);
            kdy.push(dy);
            kDist.push(Math.sqrt(d2));
        }
    }
    const out = new Float32Array(nx * ny);
    out.fill(Number.NEGATIVE_INFINITY);
    const srcZ = grid.z;
    const kn = kdx.length;
    for (let i = 0; i < srcZ.length; i++) {
        const z = srcZ[i];
        if (z === undefined || !Number.isFinite(z)) continue;
        const ix = i % nx;
        const iy = (i / nx) | 0;
        for (let k = 0; k < kn; k++) {
            const jx = ix + kdx[k]!;
            const jy = iy + kdy[k]!;
            if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
            const v = cutterTipFromSample(z, kDist[k]!, r, type);
            const j = jy * nx + jx;
            const prev = out[j]!;
            if (v > prev) out[j] = v;
        }
    }
    for (let i = 0; i < out.length; i++) out[i] = clampTipZ(out[i]!, skin);
    return { originX: grid.originX, originY: grid.originY, cell, nx, ny, z: out, inside: grid.inside };
}

export function sampleDrop(map: Heightmap, x: number, y: number): number {
    const gx = (x - map.originX) / map.cell;
    const gy = (y - map.originY) / map.cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    if (x0 < 0 || y0 < 0 || x0 >= map.nx - 1 || y0 >= map.ny - 1) return Number.NaN;
    const z00 = map.z[y0 * map.nx + x0];
    const z10 = map.z[y0 * map.nx + x0 + 1];
    const z01 = map.z[(y0 + 1) * map.nx + x0];
    const z11 = map.z[(y0 + 1) * map.nx + x0 + 1];
    if (
        z00 === undefined ||
        z10 === undefined ||
        z01 === undefined ||
        z11 === undefined ||
        !Number.isFinite(z00) ||
        !Number.isFinite(z10) ||
        !Number.isFinite(z01) ||
        !Number.isFinite(z11)
    ) {
        return Number.NaN;
    }
    const fx = gx - x0;
    const fy = gy - y0;
    return z00 * (1 - fx) * (1 - fy) + z10 * fx * (1 - fy) + z01 * (1 - fx) * fy + z11 * fx * fy;
}

export function ballScallopMm(radiusMm: number, stepoverMm: number): number {
    const r = Math.max(1e-6, radiusMm);
    const half = stepoverMm / 2;
    if (half >= r) return r;
    return r - Math.sqrt(Math.max(0, r * r - half * half));
}
