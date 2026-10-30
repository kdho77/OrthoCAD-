// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { bboxOf, pointInPoly } from "./polygon";
import type { Heightmap, Point } from "./types";

export function sampleHeight(hm: Heightmap, x: number, y: number): number {
    const gx = (x - hm.originX) / hm.cell;
    const gy = (y - hm.originY) / hm.cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    if (x0 < 0 || y0 < 0 || x0 >= hm.nx || y0 >= hm.ny) return Number.NaN;
    const z00 = hm.z[y0 * hm.nx + x0]!;
    if (x0 + 1 >= hm.nx || y0 + 1 >= hm.ny) return z00;
    const z10 = hm.z[y0 * hm.nx + x0 + 1]!;
    const z01 = hm.z[(y0 + 1) * hm.nx + x0]!;
    const z11 = hm.z[(y0 + 1) * hm.nx + x0 + 1]!;
    const fx = gx - x0;
    const fy = gy - y0;
    const vals = [z00, z10, z01, z11].filter((z) => Number.isFinite(z));
    if (vals.length === 0) return Number.NaN;
    if (vals.length < 4) return Math.max(...vals);
    return z00 * (1 - fx) * (1 - fy) + z10 * fx * (1 - fy) + z01 * (1 - fx) * fy + z11 * fx * fy;
}

export function isInside(hm: Heightmap, x: number, y: number): boolean {
    const ix = Math.round((x - hm.originX) / hm.cell);
    const iy = Math.round((y - hm.originY) / hm.cell);
    if (ix < 0 || iy < 0 || ix >= hm.nx || iy >= hm.ny) return false;
    return hm.inside[iy * hm.nx + ix] === 1;
}

/**
 * Rasterize the composed top at the given pitch. Outside the outline the design
 * height is the skin floor (default 1 mm) — not 0, NaN, rim Z, or the stock top.
 */
export function rasterizeTop(
    geometry: BufferGeometry,
    outline: Point[],
    cellMm: number,
    bandMm: number,
    skinFloorMm = 1,
): Heightmap {
    const pos = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (!pos) {
        return {
            originX: 0,
            originY: 0,
            cell: cellMm,
            nx: 1,
            ny: 1,
            z: new Float32Array(1),
            inside: new Uint8Array(1),
        };
    }
    const bb = bboxOf(outline);
    const pad = bandMm + cellMm * 2;
    const originX = bb.minX - pad;
    const originY = bb.minY - pad;
    const nx = Math.max(4, Math.ceil((bb.maxX - bb.minX + 2 * pad) / cellMm) + 1);
    const ny = Math.max(4, Math.ceil((bb.maxY - bb.minY + 2 * pad) / cellMm) + 1);
    const z = new Float32Array(nx * ny);
    z.fill(Number.NaN);
    const inside = new Uint8Array(nx * ny);

    const triCount = index ? index.count / 3 : pos.count / 3;
    const at = (i: number) => (index ? index.getX(i) : i);
    for (let t = 0; t < triCount; t++) {
        const ia = at(t * 3);
        const ib = at(t * 3 + 1);
        const ic = at(t * 3 + 2);
        const ax = pos.getX(ia);
        const ay = pos.getY(ia);
        const az = pos.getZ(ia);
        const bx = pos.getX(ib);
        const by = pos.getY(ib);
        const bz = pos.getZ(ib);
        const cx = pos.getX(ic);
        const cy = pos.getY(ic);
        const cz = pos.getZ(ic);
        const minX = Math.min(ax, bx, cx);
        const maxX = Math.max(ax, bx, cx);
        const minY = Math.min(ay, by, cy);
        const maxY = Math.max(ay, by, cy);
        const x0 = Math.max(0, Math.floor((minX - originX) / cellMm));
        const x1 = Math.min(nx - 1, Math.ceil((maxX - originX) / cellMm));
        const y0 = Math.max(0, Math.floor((minY - originY) / cellMm));
        const y1 = Math.min(ny - 1, Math.ceil((maxY - originY) / cellMm));
        const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(denom) < 1e-18) continue;
        for (let iy = y0; iy <= y1; iy++) {
            const y = originY + iy * cellMm;
            for (let ix = x0; ix <= x1; ix++) {
                const x = originX + ix * cellMm;
                const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom;
                const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom;
                const w2 = 1 - w0 - w1;
                if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
                const zi = w0 * az + w1 * bz + w2 * cz;
                const i = iy * nx + ix;
                const prev = z[i]!;
                if (!Number.isFinite(prev) || zi > prev) z[i] = zi;
            }
        }
    }

    for (let iy = 0; iy < ny; iy++) {
        const y = originY + iy * cellMm;
        for (let ix = 0; ix < nx; ix++) {
            const x = originX + ix * cellMm;
            const i = iy * nx + ix;
            if (pointInPoly(x, y, outline)) {
                inside[i] = 1;
                continue;
            }
            z[i] = skinFloorMm;
        }
    }

    return { originX, originY, cell: cellMm, nx, ny, z, inside };
}

export function heightmapRange(hm: Heightmap): { zMin: number; zMax: number } {
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 0; i < hm.z.length; i++) {
        if (hm.inside[i] !== 1) continue;
        const v = hm.z[i]!;
        if (!Number.isFinite(v)) continue;
        if (v < zMin) zMin = v;
        if (v > zMax) zMax = v;
    }
    if (!Number.isFinite(zMin)) return { zMin: 0, zMax: 0 };
    return { zMin, zMax };
}
