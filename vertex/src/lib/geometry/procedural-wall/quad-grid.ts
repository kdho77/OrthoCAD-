// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    buildBezierColumns,
    type ColumnFrame,
    type ColumnQuality,
    FILLET_R_CAP_MM,
    type MinWallClamp,
    N_TOP_PATCH_MM,
    SHORT_CHORD_MM,
    TOP_CLEARANCE_DEG as T0_CLEARANCE_DEG,
} from "./bezier-column";
import { minDistToLoopXY, pointInPoly } from "./cdt-band";
import type { PolyPoint } from "./curves";
import { lateralFlangeEnvelope, type WallRegionDefaults } from "./defaults";
import { sampleUvField } from "./extract";
import { type DishZIndex, sampleDishZVertical } from "./height-xy";
import {
    FILLET_MAX_HEIGHT_FRAC,
    MAX_FILLET_ASPECT,
    MIN_FILLET_RING_SPACING_MM,
    MIN_FILLET_RINGS,
    type NZ,
    TOP_ROUND_MIN_ROWS,
} from "./hermite";
import type { HermiteStation } from "./loft";
import { plantarNormalAt } from "./modifiers";
import { segIntersect } from "./outline-clean";
import {
    buildGeneratedPlantar,
    type GeneratedPlantar,
    makePlantarSampler,
    PLANTAR_MARGIN_MM,
} from "./plantar-cdt";
import type { FlareCapReport } from "./stations";
import { S1_MIN_WALL_MM, type UvHeightField } from "./types";

export const PLANTAR_RINGS = 0;
export const WALL_MID_ROWS = 8;
export const INNER_CAP_MM = 4;
export const STATION_MERGE_MM = 0.2;
export const TOP_CLEARANCE_DEG = T0_CLEARANCE_DEG;

export interface QuadGrid {
    /** nS × nJ xyz, row-major j then i. Row 0 is the native rim (not stored). */
    nS: number;
    nJ: number;
    /** Packed xyz for rows j = 1 .. nJ-1 (row 0 lives on the TopSheet rim). */
    body: Float32Array;
    plantar: GeneratedPlantar;
    outlineRow: number;
    innerRow: number;
    innerRing: PolyPoint[];
    usedSliverFallback: boolean;
    fieldsBeforeBF: boolean;
    impliedSeamDeg: number[];
    flareDeg: number[];
    flareCapReport?: FlareCapReport;
    planReversals: number;
    maxFrameAngleDeg: number;
    maxOffPlaneMm: number;
    maxSidewaysMm: number;
    frames: ColumnFrame[];
    chordCrossings: number;
    /** Max tilt (deg from horizontal) of the first plantar ring off BottomOutline. */
    bandTiltDegMax: number;
    /** Outline-row vertices, exactly BottomOutline station samples. */
    outlineRing: PolyPoint[];
    minWallClamps: MinWallClamp[];
    quality: ColumnQuality;
    maxBPlantarDeltaMm: number;
    wallBelowPlantar: number;
}

export interface RimJunction {
    /** Upward TopSheet plane normal at the rim vertex. */
    planeN: { x: number; y: number; z: number };
    /** Rim slope from horizontal in the outboard direction (rad). */
    slopeRad: number;
    /** Start tangent in (outboard n, z): rotated down by slope+5°. */
    tStart: NZ;
}

/** TopSheet tangent planes at each rim vertex. */
export function rimJunctions(
    pos: ArrayLike<number>,
    indices: ArrayLike<number>,
    rim: number[],
    outboard: Array<{ x: number; y: number }>,
    patchMm = N_TOP_PATCH_MM,
): RimJunction[] {
    const vfaces = new Map<number, number[]>();
    for (let t = 0; t < indices.length; t += 3) {
        for (const v of [indices[t]!, indices[t + 1]!, indices[t + 2]!]) {
            let list = vfaces.get(v);
            if (!list) {
                list = [];
                vfaces.set(v, list);
            }
            list.push(t);
        }
    }
    const patch = Math.max(0, patchMm);
    const patch2 = patch * patch;
    return rim.map((vi, si) => {
        const Rx = pos[vi * 3]!;
        const Ry = pos[vi * 3 + 1]!;
        const Rz = pos[vi * 3 + 2]!;
        const nearFaces = new Set<number>();
        for (const [vj, faces] of vfaces) {
            const dx = pos[vj * 3]! - Rx;
            const dy = pos[vj * 3 + 1]! - Ry;
            const dz = pos[vj * 3 + 2]! - Rz;
            if (dx * dx + dy * dy + dz * dz <= patch2) {
                for (const f of faces) nearFaces.add(f);
            }
        }
        if (nearFaces.size === 0) {
            for (const f of vfaces.get(vi) ?? []) nearFaces.add(f);
        }
        const ox = outboard[si]?.x ?? 1;
        const oy = outboard[si]?.y ?? 0;
        let nx = 0;
        let ny = 0;
        let nz = 0;
        let bestAbs = -1;
        let bestN = { x: 0, y: 0, z: 1 };
        for (const f of nearFaces) {
            const ia = indices[f]!;
            const ib = indices[f + 1]!;
            const ic = indices[f + 2]!;
            const ax = pos[ia * 3]!;
            const ay = pos[ia * 3 + 1]!;
            const az = pos[ia * 3 + 2]!;
            const ux = pos[ib * 3]! - ax;
            const uy = pos[ib * 3 + 1]! - ay;
            const uz = pos[ib * 3 + 2]! - az;
            const vx = pos[ic * 3]! - ax;
            const vy = pos[ic * 3 + 1]! - ay;
            const vz = pos[ic * 3 + 2]! - az;
            const fx = uy * vz - uz * vy;
            const fy = uz * vx - ux * vz;
            const fz = ux * vy - uy * vx;
            // Keep past-vertical faces (nz < 0). Flipping them hid the 8→102° cup curl.
            const fl = Math.hypot(fx, fy, fz) || 1;
            const fn = { x: fx / fl, y: fy / fl, z: fz / fl };
            const steep = Math.abs(Math.atan2(fn.x * ox + fn.y * oy, fn.z));
            if (steep > bestAbs) {
                bestAbs = steep;
                bestN = fn;
            }
            nx += fx;
            ny += fy;
            nz += fz;
        }
        if (bestAbs >= 0) {
            nx = bestN.x;
            ny = bestN.y;
            nz = bestN.z;
        } else {
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
        }
        const ns = nx * ox + ny * oy;
        const slopeRad = Math.atan2(ns, nz);
        const alpha = slopeRad + (TOP_CLEARANCE_DEG * Math.PI) / 180;
        return {
            planeN: { x: nx, y: ny, z: nz },
            slopeRad,
            tStart: { n: Math.cos(alpha), z: -Math.sin(alpha) },
        };
    });
}

/**
 * Bottom fillet on the wall side of BottomOutline. n increases to P1.n;
 * arrives with horizontal +n tangent so the plantar can leave inward.
 * Does not sample inward of the outline (that caused plan reversals).
 */
export function sampleBottomWallFillet(P1: NZ, radiusMm: number, circMm: number): NZ[] {
    const r = Math.max(
        MIN_FILLET_RING_SPACING_MM * MIN_FILLET_RINGS * 0.5,
        Math.min(radiusMm, Math.max(P1.n * 0.8, MIN_FILLET_RING_SPACING_MM)),
    );
    const nWant = Math.max(
        MIN_FILLET_RINGS,
        Math.min(
            4,
            r > 1e-8 ? Math.floor((r * (Math.PI / 2)) / MIN_FILLET_RING_SPACING_MM) : MIN_FILLET_RINGS,
        ),
    );
    const rings: NZ[] = [];
    for (let i = 1; i <= nWant; i++) {
        const phi = ((Math.PI / 2) * i) / nWant;
        const p = {
            n: P1.n - r * Math.cos(phi),
            z: P1.z + r * (1 - Math.sin(phi)),
        };
        const prev = rings.length ? rings[rings.length - 1]! : { n: P1.n - r, z: P1.z + r };
        const dist = Math.hypot(p.n - prev.n, p.z - prev.z);
        const force = rings.length < MIN_FILLET_RINGS || i === nWant;
        if (rings.length && dist < MIN_FILLET_RING_SPACING_MM && !force) continue;
        const radial = Math.max(dist, 1e-6);
        const aspect = circMm > 1e-6 ? Math.max(circMm, radial) / Math.min(circMm, radial) : 1;
        if (aspect > MAX_FILLET_ASPECT && !force) continue;
        rings.push(p);
    }
    if (rings.length === 0 || rings[rings.length - 1]!.n < P1.n - 1e-6) {
        rings.push({ n: P1.n, z: P1.z });
    } else {
        rings[rings.length - 1] = { n: P1.n, z: P1.z };
    }
    return rings;
}

export function sampleGeneratedZ(
    x: number,
    y: number,
    dish: DishZIndex | null,
    field: UvHeightField | undefined,
    fallback: number,
    zDelta: (x: number, y: number) => number,
): number {
    let z = dish ? sampleDishZVertical(dish, x, y) : null;
    if (z == null && field) z = sampleUvField(field, x, y);
    if (z == null) z = fallback;
    return Math.max(0, z + zDelta(x, y));
}

function applyLateralFlange(
    columns: PolyPoint[][],
    stations: HermiteStation[],
    outlineRow: number,
    flangeH: number,
    flangeLen: number,
    flangeAng: number,
    footLengthMm: number,
    medialYSign: 1 | -1 = 1,
): void {
    if (flangeH <= 0) return;
    const tan = Math.tan((flangeAng * Math.PI) / 180);
    for (let i = 0; i < columns.length; i++) {
        const st = stations[i]!;
        const env = lateralFlangeEnvelope(st.u, st.outline.y, flangeLen, footLengthMm, medialYSign);
        if (env <= 0) continue;
        const extra = env * flangeH * tan;
        const col = columns[i]!;
        for (let j = 1; j < outlineRow; j++) {
            const s = Math.sin((Math.PI * j) / outlineRow);
            const p = col[j]!;
            col[j] = { x: p.x + st.n.x * extra * s, y: p.y + st.n.y * extra * s, z: p.z };
        }
    }
}

export interface BuildQuadGridInput {
    stations: HermiteStation[];
    junctions: RimJunction[];
    defaults: WallRegionDefaults;
    rimLoop: PolyPoint[];
    dish: DishZIndex | null;
    plantarField?: UvHeightField;
    zDelta: (x: number, y: number) => number;
    topZ: (x: number, y: number) => number | null;
    nWall?: number;
    refineGrind?: boolean;
    flangeHeightMm?: number;
    flangeLengthMm?: number;
    flangeAngleDeg?: number;
    footLengthMm?: number;
    flatPlantar?: boolean;
    /** Sample n_top from the live modified top sheet (t4 / lift / posting). */
    liveSheet?: boolean;
}

function headingOfStation(st: HermiteStation): { h: { x: number; y: number }; planLen: number } {
    const dx = st.outline.x - st.rim.x;
    const dy = st.outline.y - st.rim.y;
    const planLen = Math.hypot(dx, dy);
    if (planLen < 1e-4) {
        const nl = Math.hypot(st.n.x, st.n.y) || 1;
        return { h: { x: st.n.x / nl, y: st.n.y / nl }, planLen };
    }
    return { h: { x: dx / planLen, y: dy / planLen }, planLen };
}

function estimateFilletRadius(st: HermiteStation, planLen: number): number {
    const height = Math.max(st.rim.z - st.outline.z, 0.5);
    const rawR = Math.min(FILLET_MAX_HEIGHT_FRAC * height, FILLET_R_CAP_MM);
    return planLen < SHORT_CHORD_MM ? Math.min(rawR, 0.4) : Math.min(rawR, Math.max(0.15, planLen * 0.8));
}

function outlineInward(i: number, outline: PolyPoint[]): { x: number; y: number } {
    const n = outline.length;
    const a = outline[(i + n - 1) % n]!;
    const b = outline[i]!;
    const c = outline[(i + 1) % n]!;
    const ex = c.x - a.x;
    const ey = c.y - a.y;
    let nx = -ey;
    let ny = ex;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const probe = { x: b.x + nx * 0.5, y: b.y + ny * 0.5 };
    if (!pointInPoly(probe.x, probe.y, outline)) {
        nx = -nx;
        ny = -ny;
    }
    return { x: nx, y: ny };
}

function bandFromInsets(
    outline: PolyPoint[],
    dirs: Array<{ x: number; y: number }>,
    insets: number[],
): PolyPoint[] {
    return outline.map((b, i) => {
        const d = dirs[i]!;
        const s = insets[i]!;
        return { x: b.x + d.x * s, y: b.y + d.y * s, z: b.z };
    });
}

function ringIntersectsOutline(ring: PolyPoint[], outline: PolyPoint[]): number[] {
    const hit = new Set<number>();
    const n = ring.length;
    const m = outline.length;
    for (let i = 0; i < n; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % n]!;
        for (let k = 0; k < m; k++) {
            const c = outline[k]!;
            const d = outline[(k + 1) % m]!;
            if (segIntersect(a, b, c, d)) {
                hit.add(i);
                hit.add((i + 1) % n);
            }
        }
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            const c = ring[j]!;
            const d = ring[(j + 1) % n]!;
            if (segIntersect(a, b, c, d)) {
                hit.add(i);
                hit.add((i + 1) % n);
                hit.add(j);
                hit.add((j + 1) % n);
            }
        }
    }
    return [...hit];
}

function turningNumber(loop: PolyPoint[]): number {
    let sum = 0;
    const n = loop.length;
    for (let i = 0; i < n; i++) {
        const a = loop[(i + n - 1) % n]!;
        const b = loop[i]!;
        const c = loop[(i + 1) % n]!;
        const v1x = b.x - a.x;
        const v1y = b.y - a.y;
        const v2x = c.x - b.x;
        const v2y = c.y - b.y;
        sum += Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y);
    }
    return sum / (Math.PI * 2);
}

function minEdgeMm(loop: PolyPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        best = Math.min(best, Math.hypot(b.x - a.x, b.y - a.y));
    }
    return best;
}

function minClearanceMm(ring: PolyPoint[], outline: PolyPoint[]): number {
    let best = Infinity;
    for (const p of ring) best = Math.min(best, minDistToLoopXY(p.x, p.y, outline));
    return best;
}

function shortEdgeStation(ring: PolyPoint[]): number {
    let bestI = 0;
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d < best) {
            best = d;
            bestI = i;
        }
    }
    return bestI;
}

function smoothInsets(insets: number[], frac = I_SMOOTH_FRAC): void {
    const n = insets.length;
    if (n < 3) return;
    const next = insets.slice();
    for (let i = 0; i < n; i++) {
        const a = insets[(i + n - 1) % n]!;
        const b = insets[i]!;
        const c = insets[(i + 1) % n]!;
        const blended = 0.5 * b + 0.25 * a + 0.25 * c;
        next[i] = Math.min(b * (1 + frac), Math.max(b * (1 - frac), blended));
    }
    for (let i = 0; i < n; i++) insets[i] = next[i]!;
}

function smoothDirs(dirs: Array<{ x: number; y: number }>, frac = I_SMOOTH_FRAC): void {
    const n = dirs.length;
    if (n < 3) return;
    const next = dirs.map((d) => ({ ...d }));
    for (let i = 0; i < n; i++) {
        const a = dirs[(i + n - 1) % n]!;
        const b = dirs[i]!;
        const c = dirs[(i + 1) % n]!;
        let mx = 0.5 * b.x + 0.25 * a.x + 0.25 * c.x;
        let my = 0.5 * b.y + 0.25 * a.y + 0.25 * c.y;
        const dx = mx - b.x;
        const dy = my - b.y;
        const maxStep = frac * (Math.hypot(b.x, b.y) || 1);
        const step = Math.hypot(dx, dy);
        if (step > maxStep) {
            mx = b.x + (dx * maxStep) / step;
            my = b.y + (dy * maxStep) / step;
        }
        const len = Math.hypot(mx, my) || 1;
        next[i] = { x: mx / len, y: my / len };
    }
    for (let i = 0; i < n; i++) dirs[i] = next[i]!;
}

export interface InnerRingPlacement {
    ring: PolyPoint[];
    dirs: Array<{ x: number; y: number }>;
    insets: number[];
    minEdgeMm: number;
    turning: number;
    minClearanceMm: number;
}

export function assertSimpleInnerRing(ring: PolyPoint[], outline: PolyPoint[]): InnerRingPlacement {
    const minE = minEdgeMm(ring);
    if (minE < I_MIN_EDGE_MM - 1e-9) {
        throw new Error(
            `[S1-I] min edge ${minE.toFixed(3)} < ${I_MIN_EDGE_MM} mm at station ${shortEdgeStation(ring)}`,
        );
    }
    const tn = turningNumber(ring);
    if (Math.abs(tn - 1) > 0.05) {
        throw new Error(`[S1-I] turning number ${tn.toFixed(3)} is not +1`);
    }
    const hits = ringIntersectsOutline(ring, outline);
    if (hits.length) {
        throw new Error(`[S1-I] self-intersect or outline cross at station ${hits[0]}`);
    }
    for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!;
        if (!pointInPoly(p.x, p.y, outline)) {
            throw new Error(`[S1-I] station ${i} is outside the outline`);
        }
    }
    const minC = minClearanceMm(ring, outline);
    if (minC < I_CLEARANCE_MM - 1e-6) {
        throw new Error(`[S1-I] clearance ${minC.toFixed(3)} < ${I_CLEARANCE_MM} mm`);
    }
    return {
        ring,
        dirs: [],
        insets: [],
        minEdgeMm: minE,
        turning: tn,
        minClearanceMm: minC,
    };
}

/**
 * Simple inner band ring I: offset each B along the outline inward by
 * max(r, 1.5). Crossing / folded stations shrink d (locally, then globally);
 * d is Laplacian-smoothed at most 10% per station. I stays ≥ 1.0 mm from the
 * outline; min edge ≥ 0.05 mm. Stations are not welded.
 */
export function placeSimpleInnerRing(stations: HermiteStation[]): InnerRingPlacement {
    const outline = stations.map((s) => s.outline);
    const n = outline.length;
    const dirs: Array<{ x: number; y: number }> = [];
    const insets: number[] = [];
    const initial: number[] = [];
    for (let i = 0; i < n; i++) {
        const st = stations[i]!;
        const { planLen } = headingOfStation(st);
        const r = estimateFilletRadius(st, planLen);
        dirs.push(outlineInward(i, outline));
        const d = Math.max(r, BAND_INSET_FLOOR_MM);
        insets.push(d);
        initial.push(d);
    }
    for (let i = 0; i < 8; i++) {
        smoothDirs(dirs);
        smoothInsets(insets);
    }
    for (let pass = 0; pass < 64; pass++) {
        const ring = bandFromInsets(outline, dirs, insets);
        const tn = turningNumber(ring);
        const folded = Math.abs(tn - 1) > 0.05;
        const bad = new Set<number>();
        const pushOut = new Set<number>();
        for (let i = 0; i < n; i++) {
            const p = ring[i]!;
            const inside = pointInPoly(p.x, p.y, outline);
            const clearance = minDistToLoopXY(p.x, p.y, outline);
            if (!inside) bad.add(i);
            else if (clearance < I_CLEARANCE_MM) pushOut.add(i);
        }
        for (const i of ringIntersectsOutline(ring, outline)) bad.add(i);
        if (bad.size === 0 && pushOut.size === 0 && !folded) {
            if (pass === 0 || pass % 4 === 3) break;
            smoothInsets(insets);
            continue;
        }
        let changed = false;
        if (folded || bad.size > 0) {
            if (folded && bad.size === 0) {
                for (let i = 0; i < n; i++) {
                    const next = Math.max(I_CLEARANCE_MM, insets[i]! * 0.92);
                    if (next < insets[i]! - 1e-6) {
                        insets[i] = next;
                        changed = true;
                    }
                }
            } else {
                for (const i of bad) {
                    const next = Math.max(I_CLEARANCE_MM, insets[i]! * 0.8);
                    if (next < insets[i]! - 1e-6) {
                        insets[i] = next;
                        changed = true;
                    }
                }
            }
        }
        for (const i of pushOut) {
            if (bad.has(i) || folded) continue;
            const cap = Math.max(initial[i]!, BAND_INSET_FLOOR_MM);
            const next = Math.min(cap, insets[i]! * 1.06);
            if (next > insets[i]! + 1e-6) {
                insets[i] = next;
                changed = true;
            }
        }
        if (!changed) {
            if (folded) {
                for (let i = 0; i < n; i++) insets[i] = I_CLEARANCE_MM;
            }
            break;
        }
        if (pass % 2 === 1) {
            smoothInsets(insets);
            smoothDirs(dirs);
        }
    }
    const ring = bandFromInsets(outline, dirs, insets);
    const shortAt = shortEdgeStation(ring);
    const win = [-2, -1, 0, 1, 2].map((k) => {
        const j = (shortAt + k + n) % n;
        const a = outline[j]!;
        const b = outline[(j + 1) % n]!;
        const ia = ring[j]!;
        const ib = ring[(j + 1) % n]!;
        return {
            j,
            outE: Number(Math.hypot(b.x - a.x, b.y - a.y).toFixed(3)),
            iE: Number(Math.hypot(ib.x - ia.x, ib.y - ia.y).toFixed(3)),
            d: Number(insets[j]!.toFixed(3)),
            m: Number(Math.hypot(dirs[j]!.x, dirs[j]!.y).toFixed(3)),
        };
    });
    console.log(
        "[S1-I-DIAG]",
        JSON.stringify({
            minI: Number(minEdgeMm(ring).toFixed(3)),
            minOut: Number(minEdgeMm(outline).toFixed(3)),
            turning: Number(turningNumber(ring).toFixed(3)),
            minC: Number(minClearanceMm(ring, outline).toFixed(3)),
            shortAt,
            around: win,
            inset: [Number(Math.min(...insets).toFixed(3)), Number(Math.max(...insets).toFixed(3))],
        }),
    );
    const checked = assertSimpleInnerRing(ring, outline);
    return { ...checked, ring, dirs, insets };
}

/** @deprecated v15 band-as-CDT-constraint; v16 uses placeSimpleInnerRing. */
export function placeStructuredBandRing(stations: HermiteStation[]): PolyPoint[] {
    return placeSimpleInnerRing(stations).ring;
}

export function buildQuadGrid(input: BuildQuadGridInput): QuadGrid {
    const stations = input.stations;
    const nS = stations.length;
    const nWall = Math.max(
        26,
        input.nWall ?? 2 + TOP_ROUND_MIN_ROWS + WALL_MID_ROWS + 12,
        2 + TOP_ROUND_MIN_ROWS + WALL_MID_ROWS + 12,
    );
    let nJ = nWall;
    let outlineRow = nJ - 1;
    let innerRow = outlineRow;

    const sampler = makePlantarSampler(
        stations.map((s) => s.outline),
        input.flatPlantar ? null : input.dish,
        input.flatPlantar ? undefined : input.plantarField,
        input.zDelta,
        { flat: true },
    );
    for (let i = 0; i < nS; i++) {
        const p = stations[i]!.outline;
        p.z = sampler.z(p.x, p.y, p.z);
    }
    console.log(
        "[S1-ORDER]",
        JSON.stringify({ fieldsBeforeBF: true, lift: Number(sampler.lift.toFixed(4)) }),
    );

    const outlineB = stations.map((s) => ({ ...s.outline }));
    const plantar = buildGeneratedPlantar({
        boundary: outlineB,
        dish: null,
        field: undefined,
        zDelta: input.zDelta,
        refineGrind: input.refineGrind,
        marginMm: PLANTAR_MARGIN_MM,
        sampler,
        flat: true,
    });
    let fieldLift = plantar.extraLift;
    let soleZ = (x: number, y: number, fallback = 0): number => sampler.z(x, y, fallback) + fieldLift;
    for (let i = 0; i < nS; i++) {
        const B = plantar.points[i]!;
        const st = stations[i]!.outline;
        if (Math.hypot(B.x - st.x, B.y - st.y) > 1e-6) {
            throw new Error(
                `[S1-B] CDT boundary != B at station ${i}: ` +
                    `B=(${st.x.toFixed(3)},${st.y.toFixed(3)}) ` +
                    `cdt=(${B.x.toFixed(3)},${B.y.toFixed(3)})`,
            );
        }
        st.z = soleZ(st.x, st.y, st.z);
        outlineB[i]!.x = st.x;
        outlineB[i]!.y = st.y;
        outlineB[i]!.z = st.z;
        B.x = st.x;
        B.y = st.y;
        B.z = st.z;
    }
    for (let i = nS; i < plantar.points.length; i++) {
        const p = plantar.points[i]!;
        p.z = soleZ(p.x, p.y, p.z);
    }
    console.log(
        "[S1-B]",
        JSON.stringify({
            n: nS,
            extraLift: Number(fieldLift.toFixed(4)),
            openEdges: plantar.openEdges,
            missingBoundary: plantar.missingBoundary,
            sliverMaxAspect: Number(plantar.sliverMaxAspect.toFixed(2)),
            usedSliverFallback: plantar.usedSliverFallback,
            steiner: plantar.steinerCount,
        }),
    );

    const nGAt = (P: (x: number, y: number) => number) =>
        stations.map((st) => plantarNormalAt(st.outline.x, st.outline.y, P));
    const slopeAt = (normals: { x: number; y: number; z: number }[]) =>
        stations.map((st, i) => {
            const dx = st.outline.x - st.rim.x;
            const dy = st.outline.y - st.rim.y;
            const len = Math.hypot(dx, dy);
            const hx = len < 1e-4 ? st.n.x : dx / len;
            const hy = len < 1e-4 ? st.n.y : dy / len;
            const n = normals[i]!;
            return Math.atan2(n.x * hx + n.y * hy, n.z);
        });
    let nPlantars = nGAt((x, y) => soleZ(x, y, 0));
    let plantarSlopeRad = slopeAt(nPlantars);
    const buildCols = (
        slopes: number[],
        normals: { x: number; y: number; z: number }[],
    ): ReturnType<typeof buildBezierColumns> =>
        buildBezierColumns(
            stations,
            input.junctions,
            input.defaults,
            input.rimLoop,
            input.topZ,
            nWall,
            slopes,
            S1_MIN_WALL_MM,
            normals,
            input.liveSheet === true,
        );
    let built = buildCols(plantarSlopeRad, nPlantars);
    const extra = new Array(nS).fill(0);
    for (const f of built.minWallClamps) {
        if (f.postingHeightClamp && f.droppedMm > 1e-9) {
            extra[f.station] = Math.max(extra[f.station]!, f.droppedMm);
        }
    }
    for (let i = 0; i < nS; i++) {
        const B = stations[i]!.outline;
        const R = stations[i]!.rim;
        const top = input.topZ(R.x, R.y) ?? R.z;
        const P = soleZ(B.x, B.y, B.z);
        const need = S1_MIN_WALL_MM - (top - P);
        if (need > 1e-9) extra[i] = Math.max(extra[i]!, need);
    }
    const heightFlags = extra
        .map((droppedMm, station) => ({ station, droppedMm, postingHeightClamp: droppedMm > 1e-9 }))
        .filter((c) => c.postingHeightClamp);
    if (heightFlags.length) {
        const z2 = (x: number, y: number): number => {
            const z = input.zDelta(x, y);
            let best = 0;
            let bestD = Number.POSITIVE_INFINITY;
            for (let i = 0; i < nS; i++) {
                const p = stations[i]!.outline;
                const d = (p.x - x) ** 2 + (p.y - y) ** 2;
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
            const e = extra[best]!;
            return e > 1e-9 && z > 0 ? Math.max(0, z - e) : z;
        };
        const sampler2 = makePlantarSampler(
            stations.map((s) => s.outline),
            input.flatPlantar ? null : input.dish,
            input.flatPlantar ? undefined : input.plantarField,
            z2,
            { flat: true },
        );
        fieldLift = 0;
        soleZ = (x, y, fallback = 0) => sampler2.z(x, y, fallback);
        for (let i = 0; i < nS; i++) {
            const p = stations[i]!.outline;
            p.z = soleZ(p.x, p.y, p.z);
            outlineB[i]!.z = p.z;
            if (plantar.points[i]) {
                plantar.points[i]!.x = p.x;
                plantar.points[i]!.y = p.y;
                plantar.points[i]!.z = p.z;
            }
        }
        for (let i = nS; i < plantar.points.length; i++) {
            const p = plantar.points[i]!;
            p.z = soleZ(p.x, p.y, p.z);
        }
        nPlantars = nGAt((x, y) => soleZ(x, y, 0));
        plantarSlopeRad = slopeAt(nPlantars);
        built = buildCols(plantarSlopeRad, nPlantars);
    }
    console.log(
        "[S1-MIN-WALL]",
        JSON.stringify({
            n: built.minWallClamps.length,
            sample: built.minWallClamps.slice(0, 8),
            postingHeightFlags: heightFlags.length,
        }),
    );

    const columns: PolyPoint[][] = built.xyz.map((col) => col.map((p) => ({ ...p })));
    nJ = columns[0]?.length ?? nWall;
    outlineRow = nJ - 1;
    innerRow = outlineRow;
    applyLateralFlange(
        columns,
        stations,
        outlineRow,
        input.flangeHeightMm ?? 0,
        input.flangeLengthMm ?? 40,
        input.flangeAngleDeg ?? 10,
        input.footLengthMm ?? 250,
        input.defaults.medialYSign ?? 1,
    );
    for (let i = 0; i < nS; i++) {
        const last = columns[i]![outlineRow]!;
        const B = plantar.points[i]!;
        if (Math.hypot(last.x - B.x, last.y - B.y) > 1e-3) {
            throw new Error(
                `[S1-B] last wall row != B at station ${i}: ` +
                    `row=(${last.x.toFixed(3)},${last.y.toFixed(3)}) ` +
                    `B=(${B.x.toFixed(3)},${B.y.toFixed(3)})`,
            );
        }
        last.x = B.x;
        last.y = B.y;
        last.z = B.z;
        built.frames[i]!.bandZ = B.z;
        built.frames[i]!.bandInsetMm = 0;
    }

    const implied = built.impliedSeamDeg;
    const flare = built.flareDeg;
    const report = built.flareCapReport;
    const outlineRing = columns.map((col) => ({ ...col[outlineRow]! }));

    let maxBPlantarDeltaMm = 0;
    let wallBelowPlantar = 0;
    for (let i = 0; i < nS; i++) {
        const B = outlineRing[i]!;
        const pz = soleZ(B.x, B.y, B.z);
        maxBPlantarDeltaMm = Math.max(maxBPlantarDeltaMm, Math.abs(B.z - pz));
        const col = columns[i]!;
        for (let j = 1; j < col.length; j++) {
            const p = col[j]!;
            const sole = soleZ(p.x, p.y, p.z);
            if (p.z < sole - 1e-6) wallBelowPlantar++;
        }
    }
    if (maxBPlantarDeltaMm > 1e-6) {
        throw new Error(`[S1-B] |B.z - plantarZ| ${maxBPlantarDeltaMm.toFixed(6)} > 1e-6`);
    }
    if (wallBelowPlantar) {
        throw new Error(`[S1-B] ${wallBelowPlantar} wall vertices below the plantar`);
    }

    const body = new Float32Array(nS * (nJ - 1) * 3);
    for (let j = 1; j < nJ; j++) {
        for (let i = 0; i < nS; i++) {
            const p = columns[i]![j]!;
            const o = ((j - 1) * nS + i) * 3;
            body[o] = p.x;
            body[o + 1] = p.y;
            body[o + 2] = p.z;
        }
    }
    return {
        nS,
        nJ,
        body,
        plantar,
        outlineRow,
        innerRow,
        innerRing: outlineB.map((p) => ({ ...p })),
        usedSliverFallback: plantar.usedSliverFallback,
        fieldsBeforeBF: true,
        impliedSeamDeg: implied,
        flareDeg: flare,
        flareCapReport: report,
        planReversals: built.planReversals,
        maxFrameAngleDeg: built.maxFrameAngleDeg,
        maxOffPlaneMm: built.maxOffPlaneMm,
        maxSidewaysMm: built.maxSidewaysMm,
        frames: built.frames,
        chordCrossings: 0,
        bandTiltDegMax: 0,
        outlineRing,
        minWallClamps: built.minWallClamps,
        quality: built.quality,
        maxBPlantarDeltaMm,
        wallBelowPlantar,
    };
}
