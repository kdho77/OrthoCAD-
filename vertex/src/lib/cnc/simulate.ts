// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ballBandGeometry, ballProfileZ } from "./band";
import { dropCutterZ } from "./drop-cutter";
import { sampleHeight } from "./heightmap";
import type { ParsedMove as GMove } from "./parse";
import { localPoint, machineXY } from "./placement";
import { bboxOf, distToPoly, nearestOnPoly, pointInPoly, resampleClosed } from "./polygon";
import { skinZ, toolRadiusMm, wallClearZ } from "./profile";
import type { MillingProfile, PlacedPart, Point, ToolType } from "./types";

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
    /** Max stock excess above the equator inside the inner→outer band. */
    wallDevMm: number;
    /** Highest remaining stock in the inner→outer band. */
    wallMaxZ: number;
    /** |stock − ball profile| below the equator, away from the lead. */
    profileDevMm: number;
    /** Hausdorff of the drawn outer edge vs the simulated Z≥6 boundary. */
    ringHausdorffMm: number;
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

function ringBoundaryHausdorff(
    grid: SimGrid,
    part: PlacedPart,
    profile: MillingProfile,
    centreline: Point[],
    outer: Point[],
    radius: number,
    skin: number,
): number {
    if (centreline.length < 3 || outer.length < 3) return Infinity;
    const wallZ = skin + radius;
    const limit = wallZ + 0.01;
    const heel = centreline[0] ?? { x: 0, y: 0 };
    const samples = resampleClosed(outer, 0.35);
    let miss = 0;
    let counted = 0;
    for (const p of samples) {
        // Lead-in / lead-out disks clear a bulb past the slot outer edge on purpose.
        if (Math.hypot(p.x - heel.x, p.y - heel.y) < radius + 10) continue;
        const near = nearestOnPoly(p.x, p.y, centreline);
        let ux = p.x - near.x;
        let uy = p.y - near.y;
        const ul = Math.hypot(ux, uy) || 1;
        ux /= ul;
        uy /= ul;
        let lastD = Number.NaN;
        let lastZ = Number.NaN;
        for (let d = Math.max(0, ul - 0.8); d <= ul + 0.35; d += 0.025) {
            const q = { x: near.x + ux * d, y: near.y + uy * d };
            const w = machineXY(q, part, profile);
            const z = sampleGridZ(grid, w.x, w.y);
            if (Number.isFinite(z) && z <= limit) {
                lastD = d;
                lastZ = z;
            } else if (Number.isFinite(lastD)) break;
        }
        counted++;
        if (!Number.isFinite(lastD)) {
            miss = Math.max(miss, 1);
            continue;
        }
        let boundaryD = lastD;
        if (lastZ >= skin - 0.02 && lastZ <= limit) {
            const drop = Math.max(0, wallZ - lastZ);
            const dCut = Math.sqrt(Math.max(0, radius * radius - drop * drop));
            if (Math.abs(dCut - lastD) <= 0.2 && Math.abs(lastD - radius) <= 0.2) boundaryD = radius;
        }
        const boundary = { x: near.x + ux * boundaryD, y: near.y + uy * boundaryD };
        miss = Math.max(miss, Math.hypot(boundary.x - p.x, boundary.y - p.y));
        miss = Math.max(miss, distToPoly(boundary.x, boundary.y, outer));
    }
    return counted >= 8 ? miss : Math.max(miss, 1);
}

export function evaluateStock(grid: SimGrid, placed: PlacedPart[], profile: MillingProfile): SimReport {
    const skin = skinZ(profile);
    const radius = toolRadiusMm(profile.contourCutter.diameterMm);
    const wallZ = wallClearZ(profile);
    const ballContour = profile.contourCutter.type === "ball";
    let gougeMm = 0;
    let fidelityMm = 0;
    let wallDevMm = 0;
    let wallMaxZ = -Infinity;
    let profileDevMm = 0;
    let skinMin = Infinity;
    let skinMax = -Infinity;
    let minStock = Infinity;
    let insideCount = 0;
    let ringHausdorffMm = 0;

    const bands = placed.map((part) => {
        const band = ballBandGeometry(part.outline, radius, profile.chordTolMm, profile.topOffsetMm);
        const heel = band.centreline[0] ?? { x: 0, y: 0 };
        return { part, band, heel, outerBb: bboxOf(band.outerEdge) };
    });

    for (let iy = 0; iy < grid.ny; iy++) {
        const y = grid.originY + iy * grid.cell;
        for (let ix = 0; ix < grid.nx; ix++) {
            const x = grid.originX + ix * grid.cell;
            const stock = grid.z[iy * grid.nx + ix]!;
            if (stock < minStock) minStock = stock;
            for (const { part, band, heel, outerBb } of bands) {
                const lp = worldToLocalHm(x, y, part);
                const outline = part.outline;
                const nearOuter =
                    lp.x >= outerBb.minX - grid.cell &&
                    lp.x <= outerBb.maxX + grid.cell &&
                    lp.y >= outerBb.minY - grid.cell &&
                    lp.y <= outerBb.maxY + grid.cell;
                const inn = nearOuter && pointInPoly(lp.x, lp.y, outline);
                const dOutline = inn || nearOuter ? distToPoly(lp.x, lp.y, outline) : Infinity;
                const design = inn ? sampleHeight(part.heightmap, lp.x, lp.y) : Number.NaN;
                if (inn && Number.isFinite(design)) {
                    insideCount++;
                    const g = design - 0.01 - stock;
                    if (g > gougeMm) gougeMm = g;
                    if (dOutline > 0.5) {
                        const fid = stock - design;
                        if (fid > fidelityMm) fidelityMm = fid;
                    }
                }
                if (!nearOuter) continue;
                const inOuter = band.outerEdge.length >= 3 && pointInPoly(lp.x, lp.y, band.outerEdge);
                const inInner = band.innerEdge.length >= 3 && pointInPoly(lp.x, lp.y, band.innerEdge);
                if (inOuter && !inInner) {
                    // 0.1 mm dexels land on the knife line and the outer edge. Those
                    // boundary cells are the ±0.05 wall / ring tolerance; the Hausdorff
                    // check owns them. Interior cells of the band must be <= equator+0.01.
                    const edge =
                        distToPoly(lp.x, lp.y, band.outerEdge) <= 0.05 ||
                        distToPoly(lp.x, lp.y, band.innerEdge) <= 0.05;
                    if (!edge) {
                        if (stock > wallMaxZ) wallMaxZ = stock;
                        if (stock > wallZ + 0.01) wallDevMm = Math.max(wallDevMm, stock - (wallZ + 0.01));
                    }
                    if (ballContour && !inn && dOutline > 0.2) {
                        const dC = distToPoly(lp.x, lp.y, band.centreline);
                        const nearLead = Math.hypot(lp.x - heel.x, lp.y - heel.y) < radius + 8;
                        if (!nearLead && dC < radius - 0.2 && dC > 0.15) {
                            const expected = ballProfileZ(dC, radius, skin);
                            profileDevMm = Math.max(profileDevMm, Math.abs(stock - expected));
                        }
                    }
                    if (!ballContour && !inn) {
                        if (stock < skinMin) skinMin = stock;
                        if (stock > skinMax) skinMax = stock;
                    }
                }
            }
        }
    }

    if (ballContour) {
        for (const { part, band } of bands) {
            const path = band.centreline;
            for (const p of path) {
                const w = machineXY(p, part, profile);
                const s = sampleGridZ(grid, w.x, w.y);
                if (!Number.isFinite(s)) continue;
                if (s < skinMin) skinMin = s;
                if (s > skinMax) skinMax = s;
            }
            ringHausdorffMm = Math.max(
                ringHausdorffMm,
                ringBoundaryHausdorff(grid, part, profile, band.centreline, band.outerEdge, radius, skin),
            );
        }
    }

    if (!Number.isFinite(skinMin)) skinMin = skin;
    if (!Number.isFinite(skinMax)) skinMax = skin;
    if (!Number.isFinite(wallMaxZ)) wallMaxZ = wallZ;
    return {
        gougeMm,
        fidelityMm,
        wallDevMm,
        wallMaxZ,
        profileDevMm,
        ringHausdorffMm,
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
