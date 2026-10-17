// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ballScallopMm, dropCutterZ } from "./drop-cutter";
import { sampleHeight } from "./heightmap";
import type { ParsedMove as GMove } from "./parse";
import { localPoint, machineXY } from "./placement";
import { distToPoly, offsetClosed, pointInPoly } from "./polygon";
import { skinZ, toolRadiusMm, wallClearZ } from "./profile";
import type { MillingProfile, PlacedPart, ToolType } from "./types";

export interface SimGrid {
    originX: number;
    originY: number;
    cell: number;
    nx: number;
    ny: number;
    z: Float32Array;
}

export interface SimReport {
    gougeMm: number;
    fidelityMm: number;
    wallDevMm: number;
    /** Highest remaining stock in the 0.2 mm band outside the outline. */
    wallMaxZ: number;
    skinMin: number;
    skinMax: number;
    minStock: number;
    insideCount: number;
}

function worldToLocalHm(x: number, y: number, placed: PlacedPart): { x: number; y: number } {
    return localPoint({ x, y }, placed);
}

function stamp(grid: SimGrid, tx: number, ty: number, tz: number, radius: number, type: ToolType): void {
    const r = radius;
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor((tx - r - grid.originX) / grid.cell));
    const x1 = Math.min(grid.nx - 1, Math.ceil((tx + r - grid.originX) / grid.cell));
    const y0 = Math.max(0, Math.floor((ty - r - grid.originY) / grid.cell));
    const y1 = Math.min(grid.ny - 1, Math.ceil((ty + r - grid.originY) / grid.cell));
    for (let iy = y0; iy <= y1; iy++) {
        const y = grid.originY + iy * grid.cell;
        const dy = y - ty;
        for (let ix = x0; ix <= x1; ix++) {
            const x = grid.originX + ix * grid.cell;
            const dx = x - tx;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2 + 1e-12) continue;
            let cutZ = tz;
            if (type === "ball") cutZ = tz + r - Math.sqrt(Math.max(0, r2 - d2));
            const i = iy * grid.nx + ix;
            const prev = grid.z[i]!;
            if (cutZ < prev) grid.z[i] = cutZ;
        }
    }
}

function toolAtZ(z: number, profile: MillingProfile, contourSkin: number): { r: number; type: ToolType } {
    const same =
        profile.toolpathCutter.type === profile.contourCutter.type &&
        profile.toolpathCutter.diameterMm === profile.contourCutter.diameterMm;
    if (same || z <= contourSkin + 0.25) {
        return { r: toolRadiusMm(profile.contourCutter.diameterMm), type: profile.contourCutter.type };
    }
    return { r: toolRadiusMm(profile.toolpathCutter.diameterMm), type: profile.toolpathCutter.type };
}

function sampleGridZ(grid: SimGrid, x: number, y: number): number {
    const ix = Math.round((x - grid.originX) / grid.cell);
    const iy = Math.round((y - grid.originY) / grid.cell);
    if (ix < 0 || iy < 0 || ix >= grid.nx || iy >= grid.ny) return Number.NaN;
    return grid.z[iy * grid.nx + ix]!;
}

export function simulateMoves(moves: GMove[], profile: MillingProfile, cell = 0.1): SimGrid {
    const pad = 12;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of moves) {
        if (m.motion !== "G1") continue;
        minX = Math.min(minX, m.x, m.from.x);
        maxX = Math.max(maxX, m.x, m.from.x);
        minY = Math.min(minY, m.y, m.from.y);
        maxY = Math.max(maxY, m.y, m.from.y);
    }
    if (!Number.isFinite(minX)) {
        minX = 0;
        maxX = 1;
        minY = 0;
        maxY = 1;
    }
    const originX = minX - pad;
    const originY = minY - pad;
    const nx = Math.max(4, Math.ceil((maxX - minX + 2 * pad) / cell) + 1);
    const ny = Math.max(4, Math.ceil((maxY - minY + 2 * pad) / cell) + 1);
    const z = new Float32Array(nx * ny);
    z.fill(profile.materialHeightMm);
    const grid: SimGrid = { originX, originY, cell, nx, ny, z };
    const skin = Math.abs(profile.extraMovementMm);
    const step = cell * 0.85;
    for (const m of moves) {
        if (m.motion !== "G1") continue;
        const dx = m.x - m.from.x;
        const dy = m.y - m.from.y;
        const dz = m.z - m.from.z;
        const len = Math.hypot(dx, dy, dz);
        const n = Math.max(1, Math.ceil(len / step));
        for (let i = 1; i <= n; i++) {
            const t = i / n;
            const x = m.from.x + dx * t;
            const y = m.from.y + dy * t;
            const zz = m.from.z + dz * t;
            const tool = toolAtZ(zz, profile, skin);
            stamp(grid, x, y, zz, tool.r, tool.type);
        }
    }
    return grid;
}

export function evaluateStock(grid: SimGrid, placed: PlacedPart[], profile: MillingProfile): SimReport {
    const skin = skinZ(profile);
    const wallZ = wallClearZ(profile);
    const scallop =
        profile.toolpathCutter.type === "ball"
            ? ballScallopMm(toolRadiusMm(profile.toolpathCutter.diameterMm), profile.stepoverBallMm)
            : 0.05;
    let gougeMm = 0;
    let fidelityMm = 0;
    let wallDevMm = 0;
    let wallMaxZ = -Infinity;
    let skinMin = Infinity;
    let skinMax = -Infinity;
    let minStock = Infinity;
    let insideCount = 0;
    const rContour = toolRadiusMm(profile.contourCutter.diameterMm);
    const ballContour = profile.contourCutter.type === "ball";

    for (let iy = 0; iy < grid.ny; iy++) {
        const y = grid.originY + iy * grid.cell;
        for (let ix = 0; ix < grid.nx; ix++) {
            const x = grid.originX + ix * grid.cell;
            const stock = grid.z[iy * grid.nx + ix]!;
            if (stock < minStock) minStock = stock;
            for (const part of placed) {
                const lp = worldToLocalHm(x, y, part);
                const outline = part.outline;
                const inn = pointInPoly(lp.x, lp.y, outline);
                const d = distToPoly(lp.x, lp.y, outline);
                const design = sampleHeight(part.heightmap, lp.x, lp.y);
                if (inn && Number.isFinite(design)) {
                    insideCount++;
                    const g = design - 0.01 - stock;
                    if (g > gougeMm) gougeMm = g;
                    if (d > 0.5) {
                        const fid = stock - design;
                        if (fid > fidelityMm) fidelityMm = fid;
                    }
                }
                // 0.2 mm band outside the outline: ball must be cleared at Z >= wallClearZ
                // (equator = skin+R); flat must be cleared at skin. Skin itself is measured
                // at the tool tip (flat: this band; ball: ~R outside, sampled below).
                if (!inn && d <= 0.2) {
                    if (stock > wallMaxZ) wallMaxZ = stock;
                    if (stock > wallZ + 0.05) wallDevMm = Math.max(wallDevMm, d);
                    if (!ballContour) {
                        if (stock < skinMin) skinMin = stock;
                        if (stock > skinMax) skinMax = stock;
                    }
                }
            }
        }
    }

    if (ballContour) {
        for (const part of placed) {
            const path = offsetClosed(part.outline, rContour, profile.chordTolMm);
            for (const p of path) {
                const w = machineXY(p, part, profile);
                const s = sampleGridZ(grid, w.x, w.y);
                if (!Number.isFinite(s)) continue;
                if (s < skinMin) skinMin = s;
                if (s > skinMax) skinMax = s;
            }
        }
    }

    if (!Number.isFinite(skinMin)) skinMin = skin;
    if (!Number.isFinite(skinMax)) skinMax = skin;
    if (!Number.isFinite(wallMaxZ)) wallMaxZ = wallZ;
    void scallop;
    return {
        gougeMm,
        fidelityMm,
        wallDevMm,
        wallMaxZ,
        skinMin,
        skinMax,
        minStock,
        insideCount,
    };
}

/** Design Z at a machine XY (max over placed parts). */
export function designZAt(x: number, y: number, placed: PlacedPart[]): number {
    let z = -Infinity;
    for (const part of placed) {
        const lp = localPoint({ x, y }, part);
        if (!pointInPoly(lp.x, lp.y, part.outline)) continue;
        const v = sampleHeight(part.heightmap, lp.x, lp.y);
        if (Number.isFinite(v) && v > z) z = v;
    }
    return z;
}

export { dropCutterZ };
