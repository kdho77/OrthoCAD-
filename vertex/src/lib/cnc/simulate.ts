// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { ballBandGeometry, ballProfileZ } from "./band";
import { PERIMETER_FLOOR_MM } from "./contour";
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

export interface SurfaceSample {
    x: number;
    y: number;
    localX: number;
    localY: number;
    design: number;
    stock: number;
    distOutline: number;
}

export interface SimReport {
    /** max(design − stock) on cells whose centre is inside the outline eroded by one cell. */
    gougeMm: number;
    gougeAt: SurfaceSample | null;
    /** Same metric on the one-cell band that the eroded gate excludes. */
    edgeGougeMm: number;
    edgeGougeAt: SurfaceSample | null;
    /** stock − design on the eroded interior. */
    excessMedianMm: number;
    excessP95Mm: number;
    excessMaxMm: number;
    excessMaxAt: SurfaceSample | null;
    /** Cells with excess above 0.25 mm. Count is complete; the list is capped. */
    excessOverCount: number;
    excessOver: SurfaceSample[];
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

const EXCESS_FLAG_MM = 0.25;

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[idx] ?? 0;
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

/** Stock at an arbitrary XY. Design nodes and dexel centres are not the same lattice. */
function sampleGridZAt(grid: SimGrid, x: number, y: number): number {
    if (grid.cell <= 0 || grid.nx < 2 || grid.ny < 2) return sampleGridZ(grid, x, y);
    const gx = (x - grid.originX) / grid.cell;
    const gy = (y - grid.originY) / grid.cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    if (x0 < 0 || y0 < 0 || x0 >= grid.nx - 1 || y0 >= grid.ny - 1) return sampleGridZ(grid, x, y);
    const z00 = grid.z[y0 * grid.nx + x0];
    const z10 = grid.z[y0 * grid.nx + x0 + 1];
    const z01 = grid.z[(y0 + 1) * grid.nx + x0];
    const z11 = grid.z[(y0 + 1) * grid.nx + x0 + 1];
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
        return sampleGridZ(grid, x, y);
    }
    const fx = gx - x0;
    const fy = gy - y0;
    return z00 * (1 - fx) * (1 - fy) + z10 * fx * (1 - fy) + z01 * (1 - fx) * fy + z11 * fx * fy;
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

function machineToWorld(x: number, y: number, profile: MillingProfile): Point {
    const wx = profile.zeroX === "right" ? profile.tableWidthMm - x : x;
    const wy = profile.zeroY === "back" ? profile.tableLengthMm - y : y;
    return { x: wx, y: wy };
}

/**
 * Dexels on this part's heightmap lattice, in local XY.
 * Cell centres are the design samples, so design and stock share one grid.
 */
export function simulateLocal(moves: GMove[], profile: MillingProfile, part: PlacedPart): SimGrid {
    const hm = part.heightmap;
    const z = new Float32Array(hm.nx * hm.ny);
    z.fill(profile.materialHeightMm);
    const grid: SimGrid = {
        originX: hm.originX,
        originY: hm.originY,
        cell: hm.cell,
        nx: hm.nx,
        ny: hm.ny,
        z,
    };
    const skin = Math.abs(profile.extraMovementMm);
    const step = Math.max(0.05, hm.cell * 0.85);
    for (const m of moves) {
        if (m.motion !== "G1") continue;
        const a = localPoint(machineToWorld(m.from.x, m.from.y, profile), part);
        const b = localPoint(machineToWorld(m.x, m.y, profile), part);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = m.z - m.from.z;
        const len = Math.hypot(dx, dy, dz);
        const n = Math.max(1, Math.ceil(len / step));
        for (let i = 1; i <= n; i++) {
            const t = i / n;
            const zz = m.from.z + dz * t;
            const tool = toolAtZ(zz, profile, skin);
            stamp(grid, a.x + dx * t, a.y + dy * t, zz, tool.r, tool.type);
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

export function evaluateStock(
    grid: SimGrid,
    placed: PlacedPart[],
    profile: MillingProfile,
    localGrids?: SimGrid[],
): SimReport {
    const skin = skinZ(profile);
    const radius = toolRadiusMm(profile.contourCutter.diameterMm);
    const wallZ = wallClearZ(profile);
    const ballContour = profile.contourCutter.type === "ball";
    let gougeMm = 0;
    let gougeAt: SurfaceSample | null = null;
    let edgeGougeMm = 0;
    let edgeGougeAt: SurfaceSample | null = null;
    let excessMaxMm = Number.NEGATIVE_INFINITY;
    let excessMaxAt: SurfaceSample | null = null;
    let excessOverCount = 0;
    const excessOver: SurfaceSample[] = [];
    const excesses: number[] = [];
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
                            const expected = ballProfileZ(dC, radius, PERIMETER_FLOOR_MM);
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

    // Gouge and excess use the design-sample grid, at those cell centres, so a
    // bilinear read cannot mix the skin floor into an interior sample. Cells
    // closer than one sample to the outline are the edge band.
    for (let pi = 0; pi < bands.length; pi++) {
        const { part } = bands[pi]!;
        const hm = part.heightmap;
        const local = localGrids?.[pi];
        const aligned =
            local !== undefined && local.nx === hm.nx && local.ny === hm.ny && local.cell === hm.cell;
        for (let iy = 0; iy < hm.ny; iy++) {
            const ly = hm.originY + iy * hm.cell;
            for (let ix = 0; ix < hm.nx; ix++) {
                const i = iy * hm.nx + ix;
                if (hm.inside[i] !== 1) continue;
                const design = hm.z[i];
                if (design === undefined || !Number.isFinite(design)) continue;
                const lx = hm.originX + ix * hm.cell;
                const dOutline = distToPoly(lx, ly, part.outline);
                const w = machineXY({ x: lx, y: ly }, part, profile);
                const stock = aligned ? local.z[i]! : sampleGridZAt(grid, w.x, w.y);
                if (!Number.isFinite(stock)) continue;
                const sample: SurfaceSample = {
                    x: w.x,
                    y: w.y,
                    localX: lx,
                    localY: ly,
                    design,
                    stock,
                    distOutline: dOutline,
                };
                const raw = design - stock;
                if (dOutline >= hm.cell) {
                    insideCount++;
                    if (raw > gougeMm) {
                        gougeMm = raw;
                        gougeAt = sample;
                    }
                    const excess = stock - design;
                    excesses.push(excess);
                    if (excess > excessMaxMm) {
                        excessMaxMm = excess;
                        excessMaxAt = sample;
                    }
                    if (excess > EXCESS_FLAG_MM) {
                        excessOverCount++;
                        if (excessOver.length < 12) excessOver.push(sample);
                    }
                    if (dOutline > 0.5) {
                        const fid = stock - design;
                        if (fid > fidelityMm) fidelityMm = fid;
                    }
                } else if (raw > edgeGougeMm) {
                    edgeGougeMm = raw;
                    edgeGougeAt = sample;
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
                ringBoundaryHausdorff(
                    grid,
                    part,
                    profile,
                    band.centreline,
                    band.outerEdge,
                    radius,
                    PERIMETER_FLOOR_MM,
                ),
            );
        }
    }

    if (!Number.isFinite(skinMin)) skinMin = skin;
    if (!Number.isFinite(skinMax)) skinMax = skin;
    if (!Number.isFinite(wallMaxZ)) wallMaxZ = wallZ;
    if (!Number.isFinite(excessMaxMm)) excessMaxMm = 0;
    const sortedExcess = excesses.slice().sort((a, b) => a - b);
    const excessMedianMm = percentile(sortedExcess, 0.5);
    const excessP95Mm = percentile(sortedExcess, 0.95);
    const gougeLine = gougeAt
        ? `gouge ${gougeMm.toFixed(3)} mm at (${gougeAt.x.toFixed(2)}, ${gougeAt.y.toFixed(2)}) local (${gougeAt.localX.toFixed(2)}, ${gougeAt.localY.toFixed(2)}) design ${gougeAt.design.toFixed(3)} stock ${gougeAt.stock.toFixed(3)} distOutline ${gougeAt.distOutline.toFixed(3)}`
        : "gouge none";
    const edgeLine = edgeGougeAt
        ? `edge-band gouge ${edgeGougeMm.toFixed(3)} mm at (${edgeGougeAt.x.toFixed(2)}, ${edgeGougeAt.y.toFixed(2)}) design ${edgeGougeAt.design.toFixed(3)} stock ${edgeGougeAt.stock.toFixed(3)} distOutline ${edgeGougeAt.distOutline.toFixed(3)}`
        : "edge-band gouge none";
    const excessLine = excessMaxAt
        ? `excess max ${excessMaxMm.toFixed(3)} at local (${excessMaxAt.localX.toFixed(2)}, ${excessMaxAt.localY.toFixed(2)}) design ${excessMaxAt.design.toFixed(3)} stock ${excessMaxAt.stock.toFixed(3)} dist ${excessMaxAt.distOutline.toFixed(3)}`
        : `excess max ${excessMaxMm.toFixed(3)}`;
    console.info(
        `[cnc] ${gougeLine}; ${edgeLine}; excess median ${excessMedianMm.toFixed(3)} P95 ${excessP95Mm.toFixed(3)}; ${excessLine}; over0.25 ${excessOverCount}`,
    );
    return {
        gougeMm,
        gougeAt,
        edgeGougeMm,
        edgeGougeAt,
        excessMedianMm,
        excessP95Mm,
        excessMaxMm,
        excessMaxAt,
        excessOverCount,
        excessOver,
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
