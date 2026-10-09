// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    applyPlantarBandZ,
    BAND_INSET_MIN_MM,
    buildBezierColumns,
    type ColumnFrame,
    estimateBandInsetMm,
    FILLET_R_CAP_MM,
    filletCenterAndF,
    inwardOfOutline,
    type MinWallClamp,
    SHORT_CHORD_MM,
    TOP_CLEARANCE_DEG as T0_CLEARANCE_DEG,
} from "./bezier-column";
import { pointInPoly } from "./cdt-band";
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
import {
    buildGeneratedPlantar,
    type GeneratedPlantar,
    PLANTAR_MARGIN_MM,
    samplePlantarSlopeAlongMinusH,
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

/** One structured ring at B − r·sin(θ) inward, constrained in the plantar CDT. */
export function placeStructuredBandRing(stations: HermiteStation[]): PolyPoint[] {
    const outline = stations.map((s) => s.outline);
    return stations.map((st) => {
        const { h, planLen } = headingOfStation(st);
        const r = estimateFilletRadius(st, planLen);
        const placed = filletCenterAndF(st.outline, h, r, { x: 0, y: 0, z: 1 }, 0);
        const inset = Math.min(
            estimateBandInsetMm(r, placed.theta),
            Math.max(BAND_INSET_MIN_MM, planLen * 0.45),
        );
        const inn = inwardOfOutline(st.outline, h, outline);
        const p = {
            x: st.outline.x + inn.x * inset,
            y: st.outline.y + inn.y * inset,
            z: st.outline.z,
        };
        if (!pointInPoly(p.x, p.y, outline)) {
            return {
                x: st.outline.x + inn.x * BAND_INSET_MIN_MM,
                y: st.outline.y + inn.y * BAND_INSET_MIN_MM,
                z: st.outline.z,
            };
        }
        return p;
    });
}

export function buildQuadGrid(input: BuildQuadGridInput): QuadGrid {
    const stations = input.stations;
    const nS = stations.length;
    const nWall = Math.max(10, input.nWall ?? 1 + MIN_FILLET_RINGS + WALL_MID_ROWS + MIN_FILLET_RINGS);
    const nJ = nWall;
    const outlineRow = nWall - 1;
    const innerRing = placeStructuredBandRing(stations);
    const plantar = buildGeneratedPlantar({
        boundary: stations.map((s) => s.outline),
        dish: input.dish,
        field: input.plantarField,
        zDelta: input.zDelta,
        refineGrind: input.refineGrind,
        marginMm: PLANTAR_MARGIN_MM,
        innerRing,
    });
    for (let i = 0; i < nS; i++) {
        const z = plantar.points[i]?.z;
        if (z != null) stations[i]!.outline.z = z;
    }
    const headingOf = (i: number) => {
        const st = stations[i]!;
        const dx = st.outline.x - st.rim.x;
        const dy = st.outline.y - st.rim.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-4) {
            const nl = Math.hypot(st.n.x, st.n.y) || 1;
            return { x: st.n.x / nl, y: st.n.y / nl };
        }
        return { x: dx / len, y: dy / len };
    };
    const outlineLoop = stations.map((s) => s.outline);
    const plantarSlopeRad = stations.map((st, i) =>
        samplePlantarSlopeAlongMinusH(plantar.points, plantar.faces, st.outline, headingOf(i), outlineLoop),
    );
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
    for (let i = 0; i < nS; i++) {
        const z = built.frames[i]!.B.z;
        stations[i]!.outline.z = z;
        if (plantar.points[i]) plantar.points[i]!.z = z;
    }
    if (plantar.bandCount >= nS) {
        applyPlantarBandZ(built.frames, plantar.points.slice(nS, nS + nS));
    }
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
    const implied = built.impliedSeamDeg;
    const flare = built.flareDeg;
    const report = built.flareCapReport;

    const outlineRing = columns.map((col) => ({ ...col[outlineRow]! }));
    for (let i = 0; i < nS; i++) {
        const ring = outlineRing[i]!;
        const b = plantar.points[i]!;
        if (Math.hypot(ring.x - b.x, ring.y - b.y, ring.z - b.z) > 1e-6) {
            throw new Error(
                `[S1-CDT] column bottom ring != plantar boundary at ${i}: ` +
                    `ring=(${ring.x.toFixed(3)},${ring.y.toFixed(3)},${ring.z.toFixed(3)}) ` +
                    `B=(${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)})`,
            );
        }
    }
    let bandTiltDegMax = 0;
    for (const f of plantar.faces) {
        const ids = [f[0]!, f[1]!, f[2]!];
        if (ids.filter((i) => i < nS).length < 2) continue;
        bandTiltDegMax = Math.max(
            bandTiltDegMax,
            tiltFromHorizontal(plantar.points[f[0]!]!, plantar.points[f[1]!]!, plantar.points[f[2]!]!),
        );
    }

    const planReversals = built.planReversals;

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
        impliedSeamDeg: implied,
        flareDeg: flare,
        flareCapReport: report,
        planReversals,
        maxFrameAngleDeg: built.maxFrameAngleDeg,
        maxOffPlaneMm: built.maxOffPlaneMm,
        frames: built.frames,
        chordCrossings: 0,
        bandTiltDegMax,
        outlineRing,
        minWallClamps: built.minWallClamps,
    };
}
