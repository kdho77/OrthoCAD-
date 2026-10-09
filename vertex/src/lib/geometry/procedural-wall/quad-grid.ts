// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { buildBezierColumns, type ColumnFrame } from "./bezier-column";
import type { PolyPoint } from "./curves";
import { lateralFlangeEnvelope, type WallRegionDefaults } from "./defaults";
import { sampleUvField } from "./extract";
import { type DishZIndex, sampleDishZVertical } from "./height-xy";
import { MAX_FILLET_ASPECT, MIN_FILLET_RING_SPACING_MM, MIN_FILLET_RINGS, type NZ } from "./hermite";
import type { HermiteStation } from "./loft";
import type { FlareCapReport } from "./stations";
import type { UvHeightField } from "./types";

export const PLANTAR_RINGS = 12;
export const WALL_MID_ROWS = 8;
export const INNER_CAP_MM = 4;
export const STATION_MERGE_MM = 0.2;
export const TOP_CLEARANCE_DEG = 5;

export interface QuadGrid {
    /** nS × nJ xyz, row-major j then i. Row 0 is the native rim (not stored). */
    nS: number;
    nJ: number;
    /** Packed xyz for rows j = 1 .. nJ-1 (row 0 lives on the TopSheet rim). */
    body: Float32Array;
    center: PolyPoint;
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
}

export interface RimJunction {
    /** Upward TopSheet plane normal at the rim vertex. */
    planeN: { x: number; y: number; z: number };
    /** Rim slope from horizontal in the outboard direction (rad). */
    slopeRad: number;
    /** Start tangent in (outboard n, z): rotated down by slope+5°. */
    tStart: NZ;
}

function pointInPolyXY(x: number, y: number, poly: PolyPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i]!.y;
        const yj = poly[j]!.y;
        const xi = poly[i]!.x;
        const xj = poly[j]!.x;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi) inside = !inside;
    }
    return inside;
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
    nPlantar?: number;
    flangeHeightMm?: number;
    flangeLengthMm?: number;
    flangeAngleDeg?: number;
    footLengthMm?: number;
}

export function buildQuadGrid(input: BuildQuadGridInput): QuadGrid {
    const stations = input.stations;
    const nS = stations.length;
    const nWall = Math.max(10, input.nWall ?? 1 + MIN_FILLET_RINGS + WALL_MID_ROWS + MIN_FILLET_RINGS);
    const nPlantar = Math.max(4, input.nPlantar ?? PLANTAR_RINGS);
    const nJ = nWall + nPlantar;
    const outlineRow = nWall - 1;
    const built = buildBezierColumns(
        stations,
        input.junctions,
        input.defaults,
        input.rimLoop,
        input.topZ,
        nWall,
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
    const implied = built.impliedSeamDeg;
    const flare = built.flareDeg;
    const report = built.flareCapReport;

    let cx = 0;
    let cy = 0;
    for (const st of stations) {
        cx += st.outline.x;
        cy += st.outline.y;
    }
    cx /= Math.max(1, nS);
    cy /= Math.max(1, nS);
    const outlineLoop = stations.map((st) => st.outline);
    for (let i = 0; i < nS; i++) {
        const o = stations[i]!.outline;
        const radial = Math.hypot(o.x - cx, o.y - cy);
        const inner = Math.min(INNER_CAP_MM, radial * 0.4);
        const span = Math.max(0, radial - inner);
        for (let k = 1; k <= nPlantar; k++) {
            const t = radial > 1e-6 ? ((k / nPlantar) * span) / radial : 0;
            const x = o.x + (cx - o.x) * t;
            const y = o.y + (cy - o.y) * t;
            const inside = pointInPolyXY(x, y, outlineLoop);
            const px = inside ? x : o.x + (cx - o.x) * Math.min(t, 0.92);
            const py = inside ? y : o.y + (cy - o.y) * Math.min(t, 0.92);
            const z = sampleGeneratedZ(px, py, input.dish, input.plantarField, o.z, input.zDelta);
            columns[i]!.push({ x: px, y: py, z });
        }
    }
    const cz = sampleGeneratedZ(cx, cy, input.dish, input.plantarField, 0, input.zDelta);
    const center = { x: cx, y: cy, z: cz };
    const outlineRing = columns.map((col) => ({ ...col[outlineRow]! }));
    let bandTiltDegMax = 0;
    if (nPlantar > 0) {
        for (let i = 0; i < nS; i++) {
            const a = columns[i]![outlineRow]!;
            const b = columns[(i + 1) % nS]![outlineRow]!;
            const c = columns[i]![outlineRow + 1]!;
            bandTiltDegMax = Math.max(bandTiltDegMax, tiltFromHorizontal(a, b, c));
        }
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
        center,
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
    };
}
