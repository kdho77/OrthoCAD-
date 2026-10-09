// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";
import {
    blendedFlareCurvature,
    blendedFlareDeg,
    lateralFlangeEnvelope,
    type WallRegionDefaults,
    wallHeightScale,
} from "./defaults";
import { sampleUvField } from "./extract";
import { type DishZIndex, sampleDishZVertical } from "./height-xy";
import {
    evalWallProfile,
    FILLET_MAX_HEIGHT_FRAC,
    filletImpliedSeamDeg,
    MAX_FILLET_ASPECT,
    MIN_FILLET_RING_SPACING_MM,
    MIN_FILLET_RINGS,
    type NZ,
    unitNZ,
    wallDirectionNZ,
} from "./hermite";
import { countColumnPlanReversals, type HermiteStation, MIN_REAL_BOTTOM_FILLET_MM } from "./loft";
import { type FlareCapReport, smoothAndCapFlare } from "./stations";
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
    chordCrossings: number;
}

export interface RimJunction {
    /** Upward TopSheet plane normal at the rim vertex. */
    planeN: { x: number; y: number; z: number };
    /** Rim slope from horizontal in the outboard direction (rad). */
    slopeRad: number;
    /** Start tangent in (outboard n, z): rotated down by slope+5°. */
    tStart: NZ;
}

function clampTangentMag(t: NZ, maxMag: number): NZ {
    const m = Math.hypot(t.n, t.z);
    if (m <= maxMag || m < 1e-12) return t;
    return { n: (t.n / m) * maxMag, z: (t.z / m) * maxMag };
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

function belowPlane(
    p: PolyPoint,
    rim: PolyPoint,
    plane: { x: number; y: number; z: number },
    eps = 1e-3,
): boolean {
    return plane.x * (p.x - rim.x) + plane.y * (p.y - rim.y) + plane.z * (p.z - rim.z) < -eps;
}

/** Circular fillet that may descend (z not clamped to P0). */
function sampleFilletSigned(P0: NZ, Tstart: NZ, Tend: NZ, radiusMm: number, circMm: number): NZ[] {
    const ts = unitNZ(Tstart);
    const te = unitNZ(Tend);
    const dot = Math.max(-1, Math.min(1, ts.n * te.n + ts.z * te.z));
    const theta = Math.acos(dot);
    const r = Math.max(0, radiusMm);
    const cross = ts.n * te.z - ts.z * te.n;
    const n0 = cross >= 0 ? { n: -ts.z, z: ts.n } : { n: ts.z, z: -ts.n };
    const nWant = Math.max(
        MIN_FILLET_RINGS,
        Math.min(
            4,
            r > 1e-8 && theta > 1e-4
                ? Math.floor((r * theta) / MIN_FILLET_RING_SPACING_MM)
                : MIN_FILLET_RINGS,
        ),
    );
    const rings: NZ[] = [];
    const emit = (p: NZ) => {
        const prev = rings.length ? rings[rings.length - 1]! : P0;
        const dist = Math.hypot(p.n - prev.n, p.z - prev.z);
        const force = rings.length < MIN_FILLET_RINGS;
        if (rings.length && dist < MIN_FILLET_RING_SPACING_MM && !force) return;
        const radial = Math.max(dist, 1e-6);
        const aspect = circMm > 1e-6 ? Math.max(circMm, radial) / Math.min(circMm, radial) : 1;
        if (aspect > MAX_FILLET_ASPECT && !force) return;
        rings.push(p);
    };
    if (r < 1e-4 || theta < 1e-3) {
        const step = MIN_FILLET_RING_SPACING_MM;
        for (let i = 1; i <= MIN_FILLET_RINGS; i++) {
            emit({ n: P0.n + te.n * step * i, z: P0.z + te.z * step * i });
        }
        return rings;
    }
    for (let i = 1; i <= nWant; i++) {
        const phi = (theta * i) / nWant;
        emit({
            n: P0.n + n0.n * r * (1 - Math.cos(phi)) + ts.n * r * Math.sin(phi),
            z: P0.z + n0.z * r * (1 - Math.cos(phi)) + ts.z * r * Math.sin(phi),
        });
    }
    if (rings.length < MIN_FILLET_RINGS) {
        const step = MIN_FILLET_RING_SPACING_MM;
        for (let i = rings.length + 1; i <= MIN_FILLET_RINGS; i++) {
            rings.push({ n: P0.n + te.n * step * i, z: P0.z + te.z * step * i });
        }
    }
    return rings;
}

function resampleTo(column: NZ[], n: number): NZ[] {
    if (column.length === n) return column.map((p) => ({ ...p }));
    if (column.length === 0) return Array.from({ length: n }, () => ({ n: 0, z: 0 }));
    const out: NZ[] = [{ ...column[0]! }];
    for (let i = 1; i < n - 1; i++) {
        const t = (i / (n - 1)) * (column.length - 1);
        const j = Math.min(column.length - 2, Math.max(0, Math.floor(t)));
        const f = t - j;
        const a = column[j]!;
        const b = column[j + 1] ?? a;
        out.push({ n: a.n + (b.n - a.n) * f, z: a.z + (b.z - a.z) * f });
    }
    out.push({ ...column[column.length - 1]! });
    return out;
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

function toXyz(rim: PolyPoint, nxy: { x: number; y: number }, p: NZ): PolyPoint {
    return { x: rim.x + nxy.x * p.n, y: rim.y + nxy.y * p.n, z: p.z };
}

function shortenOutsideTop(
    p: PolyPoint,
    rim: PolyPoint,
    nxy: { x: number; y: number },
    junct: RimJunction,
    rimLoop: PolyPoint[],
    topZ: (x: number, y: number) => number | null,
    chordN: number,
): PolyPoint {
    let n = (p.x - rim.x) * nxy.x + (p.y - rim.y) * nxy.y;
    let z = p.z;
    for (let k = 0; k < 12; k++) {
        const q = { x: rim.x + nxy.x * n, y: rim.y + nxy.y * n, z };
        const insidePlan = pointInPolyXY(q.x, q.y, rimLoop);
        const tz = topZ(q.x, q.y);
        const inSolid = insidePlan && tz != null && q.z >= tz - 0.35;
        const above = !belowPlane(q, rim, junct.planeN);
        if (!inSolid && !above && n >= -1e-4) return q;
        n = Math.min(Math.max(n, 0.05) + 0.15, Math.max(chordN, 0.15) + 2);
        if (above) z = Math.min(z, rim.z - 0.15 * (k + 1));
    }
    return { x: rim.x + nxy.x * n, y: rim.y + nxy.y * n, z: Math.min(z, rim.z - 0.2) };
}

function buildWallColumn(
    st: HermiteStation,
    junct: RimJunction,
    flareDeg: number,
    defaults: WallRegionDefaults,
    circMm: number,
    nWall: number,
    rimLoop: PolyPoint[],
    topZ: (x: number, y: number) => number | null,
    flangeH: number,
    flangeLen: number,
    flangeAng: number,
    footLengthMm: number,
): { xyz: PolyPoint[]; implied: number } {
    const R = st.rim;
    const O = st.outline;
    const chordN = (O.x - R.x) * st.n.x + (O.y - R.y) * st.n.y;
    const height = R.z - O.z;
    const localH = Math.max(height, 0.5);
    const maxR = FILLET_MAX_HEIGHT_FRAC * localH;
    const rBot = Math.min(maxR, Math.max(defaults.wallFilletBottomMm, MIN_REAL_BOTTOM_FILLET_MM));
    const rTop = Math.min(maxR, Math.max(defaults.wallFilletTopMm, 0.5));
    const Tw = wallDirectionNZ(flareDeg);
    const Tdown = unitNZ({ n: Math.abs(Tw.n), z: -Math.max(Tw.z, 0.2) });
    const Tstart = unitNZ(junct.tStart);
    const Tbot = unitNZ({ n: -1, z: 0 });
    const P0 = { n: 0, z: R.z };
    const P1 = { n: Math.max(chordN, 0.05), z: O.z };
    const startRings = sampleFilletSigned(P0, Tstart, Tdown, rTop, circMm);
    const botRings = sampleFilletSigned(P1, Tbot, unitNZ({ n: -Tdown.n, z: -Tdown.z }), rBot, circMm);
    const hermiteEnd = botRings[botRings.length - 1] ?? P1;
    const hermiteStart = startRings[startRings.length - 1] ?? {
        n: Tstart.n * 0.4,
        z: R.z + Tstart.z * 0.4,
    };
    const midLen = Math.max(1e-3, Math.hypot(hermiteEnd.n - hermiteStart.n, hermiteEnd.z - hermiteStart.z));
    const chord = Math.max(1e-3, Math.hypot(P1.n, height));
    const maxT = 0.5 * chord;
    const curvature = blendedFlareCurvature(st.u, O.y, defaults.flareCurvature);
    const nChord = Math.max(0.05, localH * Math.tan(Math.abs((flareDeg * Math.PI) / 180)));
    const T0 = clampTangentMag({ n: Tdown.n * midLen + curvature * nChord, z: Tdown.z * midLen }, maxT);
    const T1 = clampTangentMag({ n: Tdown.n * midLen, z: Tdown.z * midLen }, maxT);
    const hScale = wallHeightScale(st.u);
    const nMid = Math.max(3, nWall - 2 - startRings.length - botRings.length);
    const col: NZ[] = [P0];
    for (const p of startRings) col.push(p);
    for (let i = 1; i < nMid; i++) {
        const t = i / nMid;
        let p = evalWallProfile(hermiteStart, T0, hermiteEnd, T1, t, 0);
        if (hScale < 0.999 && t > 0 && t < 1) {
            p = {
                n: p.n * hScale + P1.n * t * (1 - hScale),
                z: R.z + (p.z - R.z) * hScale + (O.z - R.z) * t * (1 - hScale),
            };
        }
        if (flangeH > 0 && t > 0 && t < 1) {
            const env = lateralFlangeEnvelope(st.u, st.outline.y, flangeLen, footLengthMm);
            if (env > 0) {
                p = {
                    n: p.n + env * flangeH * Math.tan((flangeAng * Math.PI) / 180) * Math.sin(Math.PI * t),
                    z: p.z,
                };
            }
        }
        col.push(p);
    }
    for (let i = botRings.length - 2; i >= 0; i--) col.push(botRings[i]!);
    col.push(P1);
    const wall = resampleTo(col, nWall);
    wall[0] = P0;
    wall[nWall - 1] = { n: P1.n, z: O.z };
    const first = startRings[0] ?? { n: Tstart.n * 0.3, z: R.z + Tstart.z * 0.3 };
    const implied = filletImpliedSeamDeg(Tstart, { n: first.n - P0.n, z: first.z - P0.z });
    const xyz: PolyPoint[] = [];
    for (let j = 0; j < nWall; j++) {
        const raw = toXyz(R, st.n, wall[j]!);
        if (j === 0) {
            xyz.push({ ...R });
            continue;
        }
        if (j === nWall - 1) {
            xyz.push({ ...O });
            continue;
        }
        xyz.push(shortenOutsideTop(raw, R, st.n, junct, rimLoop, topZ, P1.n));
    }
    return { xyz, implied };
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
    const circMm =
        nS > 0
            ? stations.reduce((s, st, i) => {
                  const b = stations[(i + 1) % nS]!.outline;
                  return s + Math.hypot(b.x - st.outline.x, b.y - st.outline.y);
              }, 0) / nS
            : 1;
    const regionDefault = stations.map((st) => blendedFlareDeg(st.u, st.outline.y, input.defaults.flareDeg));
    const { flare, report } = smoothAndCapFlare(
        stations.map((s) => s.outline),
        regionDefault,
    );
    const columns: PolyPoint[][] = [];
    const implied: number[] = [];
    for (let i = 0; i < nS; i++) {
        const built = buildWallColumn(
            stations[i]!,
            input.junctions[i]!,
            flare[i]!,
            input.defaults,
            circMm,
            nWall,
            input.rimLoop,
            input.topZ,
            input.flangeHeightMm ?? 0,
            input.flangeLengthMm ?? input.defaults.lateralFlangeLengthMm,
            input.flangeAngleDeg ?? input.defaults.lateralFlangeAngleDeg,
            input.footLengthMm ?? 250,
        );
        implied.push(built.implied);
        columns.push(built.xyz);
    }

    let cx = 0;
    let cy = 0;
    for (const st of stations) {
        cx += st.outline.x;
        cy += st.outline.y;
    }
    cx /= Math.max(1, nS);
    cy /= Math.max(1, nS);
    const innerR = INNER_CAP_MM;
    for (let i = 0; i < nS; i++) {
        const o = stations[i]!.outline;
        const nx = stations[i]!.n.x;
        const ny = stations[i]!.n.y;
        const span = Math.max(innerR, Math.hypot(o.x - cx, o.y - cy) - innerR);
        for (let k = 1; k <= nPlantar; k++) {
            const t = k / nPlantar;
            const d = span * t;
            const x = o.x - nx * d;
            const y = o.y - ny * d;
            const z = sampleGeneratedZ(x, y, input.dish, input.plantarField, o.z, input.zDelta);
            columns[i]!.push({ x, y, z });
        }
    }
    const cz = sampleGeneratedZ(cx, cy, input.dish, input.plantarField, 0, input.zDelta);
    const center = { x: cx, y: cy, z: cz };

    const wallXyz = columns.map((col) => col.slice(0, nWall));
    const planReversals = countColumnPlanReversals(wallXyz);

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
        chordCrossings: 0,
    };
}
