// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    buildBezierColumns,
    type ColumnFrame,
    FILLET_R_CAP_MM,
    type MinWallClamp,
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
} from "./hermite";
import type { HermiteStation } from "./loft";
import { segIntersect } from "./outline-clean";
import {
    buildGeneratedPlantar,
    type GeneratedPlantar,
    makePlantarSampler,
    PLANTAR_MARGIN_MM,
    type PlantarSampler,
} from "./plantar-cdt";
import type { FlareCapReport } from "./stations";
import { S1_MIN_WALL_MM, type UvHeightField } from "./types";

export const BAND_ROWS = 3;
export const BAND_INSET_FLOOR_MM = 1.5;
export const I_CLEARANCE_MM = 1.0;
export const I_MIN_EDGE_MM = 0.3;
export const I_SMOOTH_FRAC = 0.1;

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
    fieldsBeforeBF: boolean;
    impliedSeamDeg: number[];
    flareDeg: number[];
    flareCapReport?: FlareCapReport;
    planReversals: number;
    maxFrameAngleDeg: number;
    maxOffPlaneMm: number;
    frames: ColumnFrame[];
    chordCrossings: number;
    /** Max tilt (deg from horizontal) of the first plantar ring off BottomOutline. */
    bandTiltDegMax: number;
    /** Outline-row vertices, exactly BottomOutline station samples. */
    outlineRing: PolyPoint[];
    minWallClamps: MinWallClamp[];
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
    return rim.map((vi, si) => {
        let nx = 0;
        let ny = 0;
        let nz = 0;
        for (const f of vfaces.get(vi) ?? []) {
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
            if (fz < 0) {
                nx -= fx;
                ny -= fy;
                nz -= fz;
            } else {
                nx += fx;
                ny += fy;
                nz += fz;
            }
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        if (nz < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
        }
        const ox = outboard[si]?.x ?? 1;
        const oy = outboard[si]?.y ?? 0;
        const dzdn = Math.abs(nz) > 1e-6 ? -(nx * ox + ny * oy) / nz : 0;
        const slopeRad = Math.atan(Math.abs(dzdn));
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

function tiltFromHorizontal(a: PolyPoint, b: PolyPoint, c: PolyPoint): number {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return 0;
    return (Math.acos(Math.max(-1, Math.min(1, Math.abs(nz / len)))) * 180) / Math.PI;
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
): void {
    if (flangeH <= 0) return;
    const tan = Math.tan((flangeAng * Math.PI) / 180);
    for (let i = 0; i < columns.length; i++) {
        const st = stations[i]!;
        const env = lateralFlangeEnvelope(st.u, st.outline.y, flangeLen, footLengthMm);
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

function maxInsetKeepingMinEdge(
    a: PolyPoint,
    dirA: { x: number; y: number },
    b: PolyPoint,
    dirB: { x: number; y: number },
    minE = I_MIN_EDGE_MM,
): number {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = dirB.x - dirA.x;
    const vy = dirB.y - dirA.y;
    const uu = ux * ux + uy * uy;
    const vv = vx * vx + vy * vy;
    const uv = ux * vx + uy * vy;
    if (uu <= minE * minE) return 0;
    if (vv < 1e-12) return Number.POSITIVE_INFINITY;
    if (uv >= 0) return Number.POSITIVE_INFINITY;
    const disc = uv * uv - vv * (uu - minE * minE);
    if (disc < 0) return Number.POSITIVE_INFINITY;
    const root = (-uv - Math.sqrt(disc)) / vv;
    return root > 1e-6 ? root : 0;
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
    if (Math.abs(Math.abs(tn) - 1) > 0.05) {
        throw new Error(`[S1-I] turning number ${tn.toFixed(3)} is not ±1`);
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
 * Simple inner band ring I: offset each B along inward ±h by max(r, 1.5).
 * Crossing stations at the tight heel shrink d; d is Laplacian-smoothed at
 * most 10% per station. I stays ≥ 1.0 mm from the outline.
 */
export function placeSimpleInnerRing(stations: HermiteStation[]): InnerRingPlacement {
    const outline = stations.map((s) => s.outline);
    const n = outline.length;
    const dirs: Array<{ x: number; y: number }> = [];
    const insets: number[] = [];
    for (let i = 0; i < n; i++) {
        const st = stations[i]!;
        const { h, planLen } = headingOfStation(st);
        const r = estimateFilletRadius(st, planLen);
        const inn = outlineInward(i, outline);
        const alongH = inn.x * h.x + inn.y * h.y;
        dirs.push(alongH >= 0 ? h : { x: -h.x, y: -h.y });
        insets.push(Math.max(r, BAND_INSET_FLOOR_MM));
    }
    for (let i = 0; i < n; i++) {
        const prev = (i + n - 1) % n;
        const next = (i + 1) % n;
        const cap = Math.min(
            maxInsetKeepingMinEdge(outline[prev]!, dirs[prev]!, outline[i]!, dirs[i]!),
            maxInsetKeepingMinEdge(outline[i]!, dirs[i]!, outline[next]!, dirs[next]!),
        );
        if (Number.isFinite(cap)) insets[i] = Math.min(insets[i]!, Math.max(0.35, cap * 0.95));
    }
    for (let pass = 0; pass < 48; pass++) {
        const ring = bandFromInsets(outline, dirs, insets);
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
        for (let i = 0; i < n; i++) {
            const a = ring[i]!;
            const b = ring[(i + 1) % n]!;
            if (Math.hypot(b.x - a.x, b.y - a.y) < I_MIN_EDGE_MM) {
                bad.add(i);
                bad.add((i + 1) % n);
            }
        }
        if (bad.size === 0 && pushOut.size === 0) {
            if (pass === 0 || pass % 4 === 3) break;
            smoothInsets(insets);
            continue;
        }
        let changed = false;
        for (const i of bad) {
            const next = Math.max(0.35, insets[i]! * 0.8);
            if (next < insets[i]! - 1e-6) {
                insets[i] = next;
                changed = true;
            }
        }
        for (const i of pushOut) {
            if (bad.has(i)) continue;
            const cap = Math.max(insets[i]!, BAND_INSET_FLOOR_MM) * 1.15;
            const next = Math.min(cap, insets[i]! * 1.08);
            if (next > insets[i]! + 1e-6) {
                insets[i] = next;
                changed = true;
            }
        }
        if (!changed) break;
        if (pass % 3 === 2) smoothInsets(insets);
    }
    const ring = bandFromInsets(outline, dirs, insets);
    const checked = assertSimpleInnerRing(ring, outline);
    return { ...checked, ring, dirs, insets };
}

/** @deprecated v15 band-as-CDT-constraint; v16 uses placeSimpleInnerRing. */
export function placeStructuredBandRing(stations: HermiteStation[]): PolyPoint[] {
    return placeSimpleInnerRing(stations).ring;
}

function sampleBandZ(sampler: PlantarSampler, x: number, y: number, extraLift: number): number {
    return sampler.z(x, y, 0) + extraLift;
}

export function buildQuadGrid(input: BuildQuadGridInput): QuadGrid {
    const stations = input.stations;
    const nS = stations.length;
    const nWall = Math.max(10, input.nWall ?? 1 + MIN_FILLET_RINGS + WALL_MID_ROWS + MIN_FILLET_RINGS);
    const nJ = nWall + BAND_ROWS;
    const outlineRow = nWall - 1;
    const innerRow = nJ - 1;

    const sampler = makePlantarSampler(
        stations.map((s) => s.outline),
        input.dish,
        input.plantarField,
        input.zDelta,
    );
    for (let i = 0; i < nS; i++) {
        const p = stations[i]!.outline;
        p.z = sampler.z(p.x, p.y, p.z);
    }
    console.log(
        "[S1-ORDER]",
        JSON.stringify({ fieldsBeforeBF: true, lift: Number(sampler.lift.toFixed(4)) }),
    );

    const placed = placeSimpleInnerRing(stations);
    const innerRing = placed.ring.map((p) => ({
        ...p,
        z: sampler.z(p.x, p.y, 0),
    }));
    const plantar = buildGeneratedPlantar({
        boundary: innerRing,
        dish: input.dish,
        field: input.plantarField,
        zDelta: input.zDelta,
        refineGrind: input.refineGrind,
        marginMm: PLANTAR_MARGIN_MM,
        sampler,
    });
    if (plantar.extraLift) {
        for (let i = 0; i < nS; i++) stations[i]!.outline.z += plantar.extraLift;
        for (const p of innerRing) p.z += plantar.extraLift;
    }
    console.log(
        "[S1-I]",
        JSON.stringify({
            simple: true,
            minEdgeMm: Number(placed.minEdgeMm.toFixed(3)),
            turning: Number(placed.turning.toFixed(3)),
            minClearanceMm: Number(placed.minClearanceMm.toFixed(3)),
            extraLift: Number(plantar.extraLift.toFixed(4)),
            openEdges: plantar.openEdges,
            missingBoundary: plantar.missingBoundary,
        }),
    );

    const plantarSlopeRad = stations.map(() => 0);
    const built = buildBezierColumns(
        stations,
        input.junctions,
        input.defaults,
        input.rimLoop,
        input.topZ,
        nWall,
        plantarSlopeRad,
        S1_MIN_WALL_MM,
    );
    console.log(
        "[S1-MIN-WALL]",
        JSON.stringify({
            n: built.minWallClamps.length,
            sample: built.minWallClamps.slice(0, 8),
        }),
    );

    const columns: PolyPoint[][] = built.xyz.map((col) => col.map((p) => ({ ...p })));
    applyLateralFlange(
        columns,
        stations,
        outlineRow,
        input.flangeHeightMm ?? 0,
        input.flangeLengthMm ?? 40,
        input.flangeAngleDeg ?? 10,
        input.footLengthMm ?? 250,
    );
    for (let i = 0; i < nS; i++) {
        const B = columns[i]![outlineRow]!;
        const dir = placed.dirs[i]!;
        const dI = placed.insets[i]!;
        built.frames[i]!.bandInsetMm = dI;
        for (let k = 1; k <= BAND_ROWS; k++) {
            const d = (dI * k) / BAND_ROWS;
            const x = B.x + dir.x * d;
            const y = B.y + dir.y * d;
            const z = sampleBandZ(sampler, x, y, plantar.extraLift);
            columns[i]!.push({ x, y, z });
        }
        const last = columns[i]![innerRow]!;
        built.frames[i]!.bandZ = columns[i]![outlineRow + 1]?.z ?? last.z;
        const I = plantar.points[i]!;
        if (Math.hypot(last.x - I.x, last.y - I.y) > 1e-3) {
            throw new Error(
                `[S1-I] last band row != I at station ${i}: ` +
                    `row=(${last.x.toFixed(3)},${last.y.toFixed(3)}) ` +
                    `I=(${I.x.toFixed(3)},${I.y.toFixed(3)})`,
            );
        }
        last.z = I.z;
    }

    const implied = built.impliedSeamDeg;
    const flare = built.flareDeg;
    const report = built.flareCapReport;
    const outlineRing = columns.map((col) => ({ ...col[outlineRow]! }));

    let bandTiltDegMax = 0;
    for (let i = 0; i < nS; i++) {
        const a = columns[i]![outlineRow]!;
        const b = columns[(i + 1) % nS]![outlineRow]!;
        const c = columns[i]![outlineRow + 1]!;
        const d = columns[(i + 1) % nS]![outlineRow + 1]!;
        bandTiltDegMax = Math.max(bandTiltDegMax, tiltFromHorizontal(a, b, c), tiltFromHorizontal(a, c, d));
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
        innerRing: innerRing.map((p) => ({ ...p })),
        fieldsBeforeBF: true,
        impliedSeamDeg: implied,
        flareDeg: flare,
        flareCapReport: report,
        planReversals: built.planReversals,
        maxFrameAngleDeg: built.maxFrameAngleDeg,
        maxOffPlaneMm: built.maxOffPlaneMm,
        frames: built.frames,
        chordCrossings: 0,
        bandTiltDegMax,
        outlineRing,
        minWallClamps: built.minWallClamps,
    };
}
