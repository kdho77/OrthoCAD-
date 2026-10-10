// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";
import { blendedFlareDeg, FLARE_BOUNDS, type WallRegionDefaults } from "./defaults";
import {
    FILLET_MAX_HEIGHT_FRAC,
    FILLET_MAX_STEP_DEG,
    filletImpliedSeamDeg,
    MIN_FILLET_RINGS,
    TOP_ROUND_MAX_STEP_DEG,
    TOP_ROUND_MIN_ROWS,
} from "./hermite";
import { countColumnPlanReversals, type HermiteStation } from "./loft";
import { smoothAndCapFlare } from "./stations";

export interface ColumnJunction {
    planeN: XYZ;
    slopeRad: number;
}

export const FRAME_SMOOTH_ITERS = 16;
export const FRAME_ANGLE_LIMIT_DEG = 5;
export const BEZIER_HANDLE_FRAC = 0.35;
export const HANDLE_CHORD_CAP = 0.5;
export const MERGE_ROW_MM = 0.3;
export const TOP_CLEARANCE_DEG = 10;
export const T0_PIN_DEG = -45;
export const FILLET_R_CAP_MM = 3;
export const R_SMOOTH_FRAC = 0.05;
export const SCALAR_SMOOTH_SIGMA_MM = 12;
export const STATION_GAP_MULT = 2;
export const WELD_MM = 1e-3;
export const MIN_EDGE_MM = 0.01;
export const ALONG_JOINT_MAX_DEG = 8;
export const ALONG_JOINT_BUDGET_FRAC = 1.15;
export const ACROSS_STATION_MAX_DEG = 10;
export const ACROSS_STATION_P99_MAX_DEG = 3;
export const HEADING_MAX_DEG = 3;
export const ROUND_MIN_STEP_MM = 0.15;
export const ROUND_MAX_ASPECT = 20;
export const SHORT_WALL_H_MM = 3.2;
export const SHORT_R1_MM = 0.5;
export const SHORT_R2_MM = 0.7;
export const SHORT_MIN_L_MM = 1;
export const FOREFOOT_INSET_MM = 1;
export const TOE_SPACING_EXTENT_FRAC = 0.5;
export const ROUND_JOINT_MAX_DEG = 8;
export const T_COL_SLACK_DEG = 15;
export const MIN_ROUND_R_MM = 0.08;
export const MIN_LINE_MM = 0.5;
export const LINE_MAX_STEP_MM = 2;
export const N_TOP_PATCH_MM = 2;
export const N_TOP_MAX_DEG = 5;
export const R_CHANGE_MAX_PCT = 5;
export const R2_CHANGE_MAX_PCT = 10;
export const FILLET_LAST_ROW_FRAC = 0.15;
export const ROUND_SWEEP_SPLIT_DEG = 80;
export const ALONG_JOINT_MIN_EDGE_MM = 1e-6;
export const FILLET_B_MIN_DEG = -60;
export const FILLET_B_MAX_DEG = 80;
export const FILLET_PSI_MIN_DEG = 10;
export const FILLET_PSI_MAX_DEG = 150;
export const T0_LEAD_DROP_MM = 1;
export const FILLET_ASSERT_EPS = 1e-6;
export const BAND_INSET_MIN_MM = 0.35;
export const SHORT_CHORD_MM = 0.5;
export const COLUMN_PLANARITY_LIMIT_MM = 0.01;
export const SIDEWAYS_LIMIT_MM = 2;
export const INWARD_SLACK_MM = 0.5;
export const SEAM_B_LIMIT_DEG = 6;
export const OUTLINE_STATION_SPACING_MM = 1.5;

export interface XYZ {
    x: number;
    y: number;
    z: number;
}

export interface ColumnFrame {
    R: PolyPoint;
    B: PolyPoint;
    F: PolyPoint;
    h: { x: number; y: number };
    T0: XYZ;
    U: XYZ;
    a: number;
    b: number;
    /** T0 tilt from horizontal (rad). Negative is down. */
    t0TiltRad: number;
    /** U tilt from vertical toward −h (rad). */
    uTiltRad: number;
    /** TopSheet in-plane slope along +h (rad). */
    sheetSlopeRad: number;
    /** False when neither a ray hit nor an adjacent-face plane was usable. */
    sheetSlopeValid: boolean;
    /** Plantar slope from horizontal along −h (rad), after fields. */
    plantarSlopeRad: number;
    rFillet: number;
    rTop: number;
    tFillet: number;
    u: number;
    shortChord: boolean;
    /** Rim plan offset beyond the outline (mm). Positive = overhang. */
    overhangMm: number;
    heightMm: number;
    /** Structured band ring z from the F→B tangent continuation. */
    bandZ: number;
    /** Plan inset of the constrained band ring (mm). */
    bandInsetMm: number;
    /** Last fillet-sample z before B. */
    arcEndZ: number;
    /** Outside-round end = wall start (T1). */
    E: XYZ;
    nTop: XYZ;
    nTopSmoothed: XYZ;
    wOut: { x: number; y: number };
    nWall: XYZ;
    roundRows: number;
    /** External-tangent length (signed; negative if unordered). */
    lineLengthMm: number;
    /** Wall lean of d from vertical (rad). Positive = inward. */
    leanRad: number;
    /** Line direction tilt from horizontal (rad). Negative is down. */
    lineTiltRad: number;
    /** Designed outside-round sweep (rad). */
    roundSweepRad: number;
    /** Designed fillet sweep (rad). */
    filletSweepRad: number;
}

export interface MinWallClamp {
    station: number;
    u: number;
    droppedMm: number;
}

export interface ColumnQuality {
    maxAlongJointDeg: number;
    maxTcolDeg: number;
    tColBoundHits: number;
    reversals: number;
    alongOverBudget: number;
    maxAcrossDeg: number;
    maxAcrossP99Deg: number;
    maxTopRoundDeg: number;
    maxRoundWallDeg: number;
    minEdgeMm: number;
    maxStationGapMult: number;
    minLineMm: number;
    maxNTopChangeDeg: number;
    maxR1ChangePct: number;
    maxR2ChangePct: number;
    maxHeadingChangeDeg: number;
    maxToeSpacingRatio: number;
    minForefootInsetMm: number;
    maxAlaPackMm: number;
}

export interface BezierColumns {
    xyz: PolyPoint[][];
    impliedSeamDeg: number[];
    planReversals: number;
    maxFrameAngleDeg: number;
    maxOffPlaneMm: number;
    maxSidewaysMm: number;
    frames: ColumnFrame[];
    flareDeg: number[];
    flareCapReport: ReturnType<typeof smoothAndCapFlare>["report"];
    minWallClamps: MinWallClamp[];
    quality: ColumnQuality;
    smoothLog?: { before: StationParamRow[]; after: StationParamRow[] };
}

export interface StationParamRow {
    u: number;
    flare: number;
    t0: number;
    a: number;
    b: number;
    rRound: number;
    rFillet: number;
    height: number;
    planEB: number;
}

function hypot3(a: XYZ): number {
    return Math.hypot(a.x, a.y, a.z);
}

function unit3(a: XYZ): XYZ {
    const l = hypot3(a) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
}

function add3(a: XYZ, b: XYZ, s = 1): XYZ {
    return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}

function dot3(a: XYZ, b: XYZ): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a: XYZ, b: XYZ): XYZ {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dist3(a: XYZ, b: XYZ): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
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

function distToPolyXY(p: PolyPoint, loop: PolyPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
        best = Math.min(best, Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t)));
    }
    return best;
}

/** Signed rim overhang: + if the rim sits outside BottomOutline. */
export function rimOverhangMm(rim: PolyPoint, outline: PolyPoint[]): number {
    const d = distToPolyXY(rim, outline);
    return pointInPolyXY(rim.x, rim.y, outline) ? -d : d;
}

export function evalCubicBezier(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, t: number): XYZ {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
        x: uuu * P0.x + 3 * uu * t * P1.x + 3 * u * tt * P2.x + ttt * P3.x,
        y: uuu * P0.y + 3 * uu * t * P1.y + 3 * u * tt * P2.y + ttt * P3.y,
        z: uuu * P0.z + 3 * uu * t * P1.z + 3 * u * tt * P2.z + ttt * P3.z,
    };
}

/** In-plane T0: +h in plan, tilt from horizontal (negative = down). */
function t0FromTilt(h: { x: number; y: number }, tiltRad: number): XYZ {
    const c = Math.cos(tiltRad);
    const s = Math.sin(tiltRad);
    return unit3({ x: h.x * c, y: h.y * c, z: s });
}

export interface PlantarFrame {
    w: XYZ;
    ew: XYZ;
    ez: XYZ;
}

/** w = unit horizontal B → plan(R) = −h. */
export function columnW(h: { x: number; y: number }): XYZ {
    return { x: -h.x, y: -h.y, z: 0 };
}

/**
 * Local (w, z) after the plantar slope along −w replaces world-horizontal.
 * e_z = n_plantar(B); e_w is the plantar-horizontal toward +w.
 */
export function plantarFrameAt(h: { x: number; y: number }, plantarSlopeRad: number): PlantarFrame {
    const w = columnW(h);
    const ca = Math.cos(plantarSlopeRad);
    const sa = Math.sin(plantarSlopeRad);
    return {
        w,
        ew: { x: ca * w.x, y: ca * w.y, z: -sa },
        ez: { x: sa * w.x, y: sa * w.y, z: ca },
    };
}

export function clampFilletB(bRad: number): number {
    const lo = ((FILLET_B_MIN_DEG + 1e-3) * Math.PI) / 180;
    const hi = ((FILLET_B_MAX_DEG - 1e-3) * Math.PI) / 180;
    return Math.max(lo, Math.min(hi, bRad));
}

export function filletDir(b: number, frame: PlantarFrame): XYZ {
    const sb = Math.sin(b);
    const cb = Math.cos(b);
    return unit3({
        x: sb * frame.ew.x + cb * frame.ez.x,
        y: sb * frame.ew.y + cb * frame.ez.y,
        z: sb * frame.ew.z + cb * frame.ez.z,
    });
}

function applyTilts(fr: ColumnFrame): void {
    const w = fr.wOut ?? { x: -fr.h.x, y: -fr.h.y };
    fr.wOut = w;
    fr.T0 = t0FromTilt(fr.h, fr.t0TiltRad);
    fr.U = filletDir(fr.uTiltRad, plantarFrameAt(fr.h, fr.plantarSlopeRad));
}

function projectToPlane(p: XYZ, R: XYZ, h: { x: number; y: number }): XYZ {
    const nx = -h.y;
    const ny = h.x;
    const d = (p.x - R.x) * nx + (p.y - R.y) * ny;
    return { x: p.x - d * nx, y: p.y - d * ny, z: p.z };
}

export function offPlaneMm(p: XYZ, R: XYZ, h: { x: number; y: number }): number {
    return Math.abs((p.x - R.x) * -h.y + (p.y - R.y) * h.x);
}

function belowPlane(p: XYZ, rim: XYZ, plane: XYZ, eps = 1e-3): boolean {
    return plane.x * (p.x - rim.x) + plane.y * (p.y - rim.y) + plane.z * (p.z - rim.z) < -eps;
}

function rowInsideTop(
    q: XYZ,
    rim: XYZ,
    plane: XYZ,
    rimLoop: PolyPoint[],
    topZ: (x: number, y: number) => number | null,
): boolean {
    const insidePlan = pointInPolyXY(q.x, q.y, rimLoop);
    const tz = topZ(q.x, q.y);
    const inSolid = insidePlan && tz != null && q.z >= tz - 0.35;
    const above = !belowPlane(q, rim, plane);
    return inSolid || above;
}

function mergeClose(pts: XYZ[]): XYZ[] {
    if (pts.length === 0) return [];
    const out = [{ ...pts[0]! }];
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i]!;
        const last = out[out.length - 1]!;
        const d = dist3(last, p);
        if (i === pts.length - 1) {
            if (d < MERGE_ROW_MM && out.length > 1) out[out.length - 1] = { ...p };
            else out.push({ ...p });
            continue;
        }
        if (d >= MERGE_ROW_MM) out.push({ ...p });
    }
    return out;
}

/** Even arc-length samples. Endpoints stay put. Close rows are merged first. */
export function sampleByArcLength(pts: XYZ[], n: number): XYZ[] {
    const cleaned = mergeClose(pts);
    if (n <= 1) return [{ ...cleaned[0]! }];
    if (cleaned.length === 1) return Array.from({ length: n }, () => ({ ...cleaned[0]! }));
    const cum = [0];
    for (let i = 1; i < cleaned.length; i++) {
        cum.push(cum[i - 1]! + dist3(cleaned[i - 1]!, cleaned[i]!));
    }
    const total = Math.max(cum[cum.length - 1]!, 1e-6);
    const out: XYZ[] = [{ ...cleaned[0]! }];
    for (let k = 1; k < n - 1; k++) {
        const s = (k / (n - 1)) * total;
        let j = 0;
        while (j < cum.length - 2 && cum[j + 1]! < s) j++;
        const a = cleaned[j]!;
        const b = cleaned[j + 1] ?? a;
        const span = Math.max(1e-9, cum[j + 1]! - cum[j]!);
        const f = (s - cum[j]!) / span;
        out.push({
            x: a.x + (b.x - a.x) * f,
            y: a.y + (b.y - a.y) * f,
            z: a.z + (b.z - a.z) * f,
        });
    }
    out.push({ ...cleaned[cleaned.length - 1]! });
    return out;
}

function unit2(s: number, z: number): { s: number; z: number } {
    const l = Math.hypot(s, z) || 1;
    return { s: s / l, z: z / l };
}

export interface ConstructedFillet {
    Pp: XYZ;
    K: XYZ;
    Pw: XYZ;
    C: XYZ;
    d: XYZ;
    b: number;
    psi: number;
    t: number;
    r: number;
    phi0: number;
    phi1: number;
    ew: XYZ;
    ez: XYZ;
}

export function leanFromVertical(U: XYZ, frame: PlantarFrame): number {
    return Math.atan2(
        U.x * frame.ew.x + U.y * frame.ew.y + U.z * frame.ew.z,
        U.x * frame.ez.x + U.y * frame.ez.y + U.z * frame.ez.z,
    );
}

export function filletRadiusMm(heightMm: number, wallLen: number, psi: number): number {
    const half = Math.max(Math.tan(psi / 2), 1e-6);
    return Math.max(
        0.05,
        Math.min(FILLET_MAX_HEIGHT_FRAC * Math.max(heightMm, 0.5), FILLET_R_CAP_MM, wallLen / (2 * half)),
    );
}

/**
 * Exact fillet: P_p = B, K = B + t e_w, P_w = K + t d, C = B + r n_plantar.
 * phi: −90 → −b about C, sweep +psi. F := P_w.
 */
export function constructFillet(
    B: XYZ,
    h: { x: number; y: number },
    r: number,
    U: XYZ,
    plantarSlopeRad: number,
): ConstructedFillet {
    const frame = plantarFrameAt(h, plantarSlopeRad);
    const b = clampFilletB(leanFromVertical(U, frame));
    const psi = Math.PI / 2 - b;
    const rr = Math.max(r, 1e-6);
    const t = rr * Math.tan(psi / 2);
    const d = filletDir(b, frame);
    const Pp = { x: B.x, y: B.y, z: B.z };
    const K = add3(Pp, frame.ew, t);
    const Pw = add3(K, d, t);
    const C = add3(Pp, frame.ez, rr);
    return {
        Pp,
        K,
        Pw,
        C,
        d,
        b,
        psi,
        t,
        r: rr,
        phi0: -Math.PI / 2,
        phi1: -b,
        ew: frame.ew,
        ez: frame.ez,
    };
}

export function filletPointAtPhi(fil: ConstructedFillet, phi: number): XYZ {
    return {
        x: fil.C.x + fil.r * (Math.cos(phi) * fil.ew.x + Math.sin(phi) * fil.ez.x),
        y: fil.C.y + fil.r * (Math.cos(phi) * fil.ew.y + Math.sin(phi) * fil.ez.y),
        z: fil.C.z + fil.r * (Math.cos(phi) * fil.ew.z + Math.sin(phi) * fil.ez.z),
    };
}

export function assertFilletStation(fil: ConstructedFillet, label = ""): void {
    const eps = FILLET_ASSERT_EPS;
    const dPp = dist3(fil.Pp, fil.C);
    const dPw = dist3(fil.Pw, fil.C);
    if (Math.abs(dPp - fil.r) > eps || Math.abs(dPw - fil.r) > eps) {
        throw new Error(`[S1-FILLET] |P-C|!=r${label} Pp=${dPp} Pw=${dPw} r=${fil.r}`);
    }
    const tPp = unit3({
        x: -Math.sin(fil.phi0) * fil.ew.x + Math.cos(fil.phi0) * fil.ez.x,
        y: -Math.sin(fil.phi0) * fil.ew.y + Math.cos(fil.phi0) * fil.ez.y,
        z: -Math.sin(fil.phi0) * fil.ew.z + Math.cos(fil.phi0) * fil.ez.z,
    });
    const dotZ = tPp.x * fil.ez.x + tPp.y * fil.ez.y + tPp.z * fil.ez.z;
    if (Math.abs(dotZ) > eps) {
        throw new Error(`[S1-FILLET] tangent at Pp not (1,0)${label} dotZ=${dotZ}`);
    }
    const tPw = unit3({
        x: -Math.sin(fil.phi1) * fil.ew.x + Math.cos(fil.phi1) * fil.ez.x,
        y: -Math.sin(fil.phi1) * fil.ew.y + Math.cos(fil.phi1) * fil.ez.y,
        z: -Math.sin(fil.phi1) * fil.ew.z + Math.cos(fil.phi1) * fil.ez.z,
    });
    const dotD = tPw.x * fil.d.x + tPw.y * fil.d.y + tPw.z * fil.d.z;
    if (dotD < 0.9999) {
        throw new Error(`[S1-FILLET] tangent at Pw·d=${dotD}${label}`);
    }
    if (!(fil.phi1 > fil.phi0 + 1e-9)) {
        throw new Error(`[S1-FILLET] phi not increasing${label} ${fil.phi0} → ${fil.phi1}`);
    }
    const nCheck = 8;
    for (let i = 0; i < nCheck; i++) {
        const phi = fil.phi0 + ((fil.phi1 - fil.phi0) * i) / (nCheck - 1);
        const p = filletPointAtPhi(fil, phi);
        const above = (p.x - fil.Pp.x) * fil.ez.x + (p.y - fil.Pp.y) * fil.ez.y + (p.z - fil.Pp.z) * fil.ez.z;
        if (above < -eps) {
            throw new Error(`[S1-FILLET] arc below plantar${label} above=${above}`);
        }
        if (Math.abs(fil.ez.x) + Math.abs(fil.ez.y) < 1e-3 && p.z < fil.Pp.z - eps) {
            throw new Error(`[S1-FILLET] arc z < z_B${label} z=${p.z} zB=${fil.Pp.z}`);
        }
    }
}

/** Path tangent leaving F (continuation of −U) and arriving at B (plantar-horizontal). */
export function filletPathTangents(
    h: { x: number; y: number },
    U: XYZ,
    plantarSlopeRad: number,
): { tf: { s: number; z: number }; tb: { s: number; z: number } } {
    const fil = constructFillet({ x: 0, y: 0, z: 0 }, h, 1, U, plantarSlopeRad);
    const us = fil.d.x * h.x + fil.d.y * h.y;
    const tf = unit2(-us, -fil.d.z);
    const ewS = fil.ew.x * h.x + fil.ew.y * h.y;
    const tb = unit2(-ewS, -fil.ew.z);
    return { tf, tb };
}

/** Side of B that lands inside BottomOutline. +h is R→B (usually inward). */
export function inwardOfOutline(
    B: XYZ,
    h: { x: number; y: number },
    outline: PolyPoint[],
): { x: number; y: number } {
    const plus = { x: B.x + h.x * 0.6, y: B.y + h.y * 0.6 };
    if (pointInPolyXY(plus.x, plus.y, outline)) return h;
    return { x: -h.x, y: -h.y };
}

export function estimateBandInsetMm(r: number, theta: number): number {
    const raw = Math.max(0, r) * Math.sin(Math.max(0, Math.min(Math.PI / 2, theta)));
    return Math.max(BAND_INSET_MIN_MM, raw);
}

/** Band z from the F→B arrival tangent so the first plantar face is G1 at B. */
export function tangentBandZ(fr: ColumnFrame, alongH: number): number {
    applyTilts(fr);
    const { tb } = filletPathTangents(fr.h, fr.U, fr.plantarSlopeRad);
    if (Math.abs(tb.s) < 1e-6) return fr.B.z;
    return fr.B.z + alongH * (tb.z / tb.s);
}

export function applyTangentBandZ(frames: ColumnFrame[]): void {
    const outline = frames.map((f) => f.B);
    for (const fr of frames) {
        applyTilts(fr);
        const { theta } = filletCenterAndF(fr.B, fr.h, fr.rFillet, fr.U, fr.plantarSlopeRad);
        const inset = estimateBandInsetMm(fr.rFillet, theta);
        const inn = inwardOfOutline(fr.B, fr.h, outline);
        const alongH = inset * Math.sign(inn.x * fr.h.x + inn.y * fr.h.y || 1);
        fr.bandInsetMm = inset;
        fr.bandZ = tangentBandZ(fr, alongH);
    }
}

/** Overwrite constrained-band verts from the final column tangent (actual XY). */
export function applyPlantarBandZ(frames: ColumnFrame[], bandPoints: PolyPoint[]): void {
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const band = bandPoints[i];
        if (!band) {
            fr.bandZ = fr.B.z;
            continue;
        }
        const alongH = (band.x - fr.B.x) * fr.h.x + (band.y - fr.B.y) * fr.h.y;
        fr.bandInsetMm = Math.hypot(band.x - fr.B.x, band.y - fr.B.y);
        fr.bandZ = tangentBandZ(fr, alongH);
        band.z = fr.bandZ;
    }
}

export function filletCenterAndF(
    B: XYZ,
    h: { x: number; y: number },
    r: number,
    U: XYZ,
    plantarSlopeRad: number,
): { C: { s: number; z: number }; F: XYZ; theta: number } {
    const fil = constructFillet(B, h, r, U, plantarSlopeRad);
    const s = (fil.C.x - B.x) * h.x + (fil.C.y - B.y) * h.y;
    return { C: { s, z: fil.C.z }, F: fil.Pw, theta: fil.psi };
}

export function sizedArcRows(
    sweepRad: number,
    radiusMm: number,
    stationSpacingMm: number,
    minRows: number,
    maxStepDeg: number,
    preferAngle = false,
): number {
    const deg = Math.abs((sweepRad * 180) / Math.PI);
    const arcLen = Math.max(Math.abs(radiusMm * sweepRad), 1e-6);
    const spacing = Math.max(stationSpacingMm, 1e-6);
    const minStep = Math.max(ROUND_MIN_STEP_MM, spacing / ROUND_MAX_ASPECT);
    const nByMin = Math.max(1, Math.floor(arcLen / minStep));
    const nByAngle = Math.max(minRows, Math.ceil(deg / Math.max(maxStepDeg, 1e-3)));
    const nBy1x = Math.max(minRows, Math.ceil(arcLen / spacing));
    const nByHalf = Math.max(minRows, Math.ceil(arcLen / Math.max(0.5 * spacing, minStep)));
    if (preferAngle) {
        // Extra rows wherever the round turns more than 80° so every row is ≤ 8°.
        if (deg > ROUND_SWEEP_SPLIT_DEG) return Math.max(minRows, nByAngle);
        return Math.max(minRows, nByAngle);
    }
    return Math.max(minRows, Math.min(Math.max(nBy1x, nByHalf, nByAngle), nByMin));
}

/** Line interiors; 0 when L is shorter than half the station spacing. */
export function lineRowCount(lengthMm: number, stationSpacingMm: number): number {
    const spacing = Math.max(stationSpacingMm, 1e-6);
    if (lengthMm < Math.max(MIN_LINE_MM, 0.5 * spacing) - 1e-9) return 0;
    const step = Math.min(LINE_MAX_STEP_MM, Math.max(0.5 * spacing, Math.min(spacing, LINE_MAX_STEP_MM)));
    return Math.max(1, Math.ceil(lengthMm / step));
}

export function filletRowCount(psiRad: number, radiusMm = 1, stationSpacingMm = 1.3): number {
    return sizedArcRows(psiRad, radiusMm, stationSpacingMm, MIN_FILLET_RINGS, FILLET_MAX_STEP_DEG);
}

export function topRoundRowCount(sweepRad: number, radiusMm = 0.5, stationSpacingMm = 1.3): number {
    return sizedArcRows(
        sweepRad,
        radiusMm,
        stationSpacingMm,
        TOP_ROUND_MIN_ROWS,
        TOP_ROUND_MAX_STEP_DEG,
        true,
    );
}

/** Equal-φ interiors from P_w toward P_p. Does not include P_w or B. */
function sampleFilletEqualPhi(fr: ColumnFrame, nInterior: number): XYZ[] {
    applyTilts(fr);
    const fil = constructFillet(fr.B, fr.h, fr.rFillet, fr.U, fr.plantarSlopeRad);
    const count = Math.max(filletRowCount(fil.psi), nInterior);
    const rings: XYZ[] = [];
    for (let i = 1; i <= count; i++) {
        const phi = fil.phi1 + ((fil.phi0 - fil.phi1) * i) / (count + 1);
        rings.push(filletPointAtPhi(fil, phi));
    }
    return rings;
}

export interface OutsideRound {
    C: XYZ;
    E: XYZ;
    wOut: XYZ;
    nTop: XYZ;
    nWall: XYZ;
    tOut: XYZ;
    T0: XYZ;
    sweep: number;
    r: number;
}

/** Exterior top-edge round: C = R − r n_top, sweep the whole corner to wall T0. */
export function constructOutsideRound(
    R: XYZ,
    nTopIn: XYZ,
    hIn: { x: number; y: number },
    r: number,
    t0TiltRad: number,
): OutsideRound {
    const hl = Math.hypot(hIn.x, hIn.y) || 1;
    const h = { x: hIn.x / hl, y: hIn.y / hl };
    const wOut = { x: -h.x, y: -h.y, z: 0 };
    const raw = nTopIn.x || nTopIn.y || nTopIn.z ? nTopIn : { x: 0, y: 0, z: 1 };
    const ns = raw.x * h.x + raw.y * h.y;
    let nTop = unit3({ x: ns * h.x, y: ns * h.y, z: raw.z });
    if (nTop.z < 0) nTop = { x: -nTop.x, y: -nTop.y, z: -nTop.z };
    const nS = nTop.x * h.x + nTop.y * h.y;
    let tOut = unit3({ x: -nTop.z * h.x, y: -nTop.z * h.y, z: nS });
    if (tOut.x * wOut.x + tOut.y * wOut.y < 0) tOut = { x: -tOut.x, y: -tOut.y, z: -tOut.z };
    const rr = Math.max(r, 1e-6);
    const C = add3(R, nTop, -rr);
    const T0 = t0FromTilt(h, t0TiltRad);
    const th = t0TiltRad;
    const nWall = unit3({
        x: Math.sin(th) * h.x,
        y: Math.sin(th) * h.y,
        z: -Math.cos(th),
    });
    const E = add3(C, nWall, rr);
    const sweep = Math.acos(Math.max(-1, Math.min(1, dot3(nTop, nWall))));
    return { C, E, wOut, nTop, nWall, tOut, T0, sweep, r: rr };
}

export interface Sz {
    s: number;
    z: number;
}

export interface ArcLineArc {
    C1: XYZ;
    C2: XYZ;
    T1: XYZ;
    T2: XYZ;
    n: XYZ;
    nTop: XYZ;
    nPlant: XYZ;
    tStart: XYZ;
    d: XYZ;
    L: number;
    r1: number;
    r2: number;
    roundSweep: number;
    filletSweep: number;
    leanRad: number;
    lineTiltRad: number;
    phiRound0: number;
    phiRound1: number;
    phiFil0: number;
    phiFil1: number;
}

function projectNTop(nTopIn: XYZ, h: { x: number; y: number }): XYZ {
    const raw = nTopIn.x || nTopIn.y || nTopIn.z ? nTopIn : { x: 0, y: 0, z: 1 };
    const ns = raw.x * h.x + raw.y * h.y;
    let nTop = unit3({ x: ns * h.x, y: ns * h.y, z: raw.z });
    if (nTop.z < 0) nTop = { x: -nTop.x, y: -nTop.y, z: -nTop.z };
    return nTop;
}

function szOf(p: XYZ, origin: XYZ, h: { x: number; y: number }): Sz {
    return { s: (p.x - origin.x) * h.x + (p.y - origin.y) * h.y, z: p.z };
}

function xyzOnPlane(sz: Sz, origin: XYZ, h: { x: number; y: number }): XYZ {
    return { x: origin.x + h.x * sz.s, y: origin.y + h.y * sz.s, z: sz.z };
}

function phiOf(n: Sz): number {
    return Math.atan2(n.s, n.z);
}

function unwindDown(from: number, to: number): number {
    let t = to;
    while (t > from + 1e-12) t -= Math.PI * 2;
    while (t < from - Math.PI * 2 - 1e-12) t += Math.PI * 2;
    return t;
}

function externalTangent2(
    C1: Sz,
    r1: number,
    C2: Sz,
    r2: number,
): { n: Sz; T1: Sz; T2: Sz; L: number } | null {
    const Ds = C2.s - C1.s;
    const Dz = C2.z - C1.z;
    const dist = Math.hypot(Ds, Dz);
    if (dist <= Math.abs(r1 - r2) + 1e-9) return null;
    const c = (r1 - r2) / dist;
    const Dhs = Ds / dist;
    const Dhz = Dz / dist;
    const sqrt = Math.sqrt(Math.max(0, 1 - c * c));
    const perps: Sz[] = [
        { s: Dhz, z: -Dhs },
        { s: -Dhz, z: Dhs },
    ];
    let best: { n: Sz; T1: Sz; T2: Sz; L: number } | null = null;
    let bestOut = -Infinity;
    for (const p of perps) {
        const n = { s: c * Dhs + sqrt * p.s, z: c * Dhz + sqrt * p.z };
        const T1 = { s: C1.s + r1 * n.s, z: C1.z + r1 * n.z };
        const T2 = { s: C2.s + r2 * n.s, z: C2.z + r2 * n.z };
        const Ls = T2.s - T1.s;
        const Lz = T2.z - T1.z;
        const ordered = Ls * Dhs + Lz * Dhz;
        const labs = Math.hypot(Ls, Lz);
        const L = ordered >= 0 ? labs : -labs;
        const out = C1.s - T1.s;
        if (out > bestOut) {
            bestOut = out;
            best = { n, T1, T2, L };
        }
    }
    return best;
}

function tryAlaRadii(
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
    nTop: XYZ,
    nPlant: XYZ,
    r1: number,
    r2: number,
): { C1: Sz; C2: Sz; hit: { n: Sz; T1: Sz; T2: Sz; L: number } } | null {
    const R2 = szOf(R, R, h);
    const B2 = szOf(B, R, h);
    const nTop2: Sz = { s: nTop.x * h.x + nTop.y * h.y, z: nTop.z };
    const nPlant2: Sz = { s: nPlant.x * h.x + nPlant.y * h.y, z: nPlant.z };
    const C1 = { s: R2.s - r1 * nTop2.s, z: R2.z - r1 * nTop2.z };
    const C2 = { s: B2.s + r2 * nPlant2.s, z: B2.z + r2 * nPlant2.z };
    const hit = externalTangent2(C1, r1, C2, r2);
    if (!hit) return null;
    return { C1, C2, hit };
}

function packAlaRadii(height: number, r1In: number, r2In: number, minL: number): { r1: number; r2: number } {
    let r1 = Math.max(MIN_ROUND_R_MM, r1In);
    let r2 = Math.max(0.05, r2In);
    const room = Math.max(0.1, height - minL);
    if (r1 + r2 > room) {
        const s = room / (r1 + r2);
        r1 = Math.max(MIN_ROUND_R_MM, r1 * s);
        r2 = Math.max(0.05, r2 * s);
    }
    return { r1, r2 };
}

/**
 * ARC-LINE-ARC in the column plane (s inward, z up).
 * C1 = R − r1 n_top; C2 = B + r2 n_plantar; body is the exterior common tangent.
 * L never reaches 0. Short walls (H ~ 2.2) use r1 ~ 0.5, r2 ~ 0.7, L >= 1, r1+r2+L <= H.
 */
export function constructArcLineArc(
    R: XYZ,
    B: XYZ,
    nTopIn: XYZ,
    r1In: number,
    r2In: number,
    hIn: { x: number; y: number },
    plantarSlopeRad = 0,
): ArcLineArc {
    const hl = Math.hypot(hIn.x, hIn.y) || 1;
    const h = { x: hIn.x / hl, y: hIn.y / hl };
    const nTop = projectNTop(nTopIn, h);
    const frame = plantarFrameAt(h, plantarSlopeRad);
    const nPlant = unit3(frame.ez);
    const planInset = Math.hypot(B.x - R.x, B.y - R.y);
    const height = Math.max(R.z - B.z, 0.5);
    const short = height <= SHORT_WALL_H_MM + 1e-9;
    const minL = short ? SHORT_MIN_L_MM : MIN_LINE_MM;
    let r1 = Math.max(MIN_ROUND_R_MM, r1In);
    let r2 = Math.max(0.05, r2In);
    if (short) {
        const t = Math.max(0, Math.min(1, (height - (SHORT_WALL_H_MM - 1.2)) / 1.2));
        r1 = Math.min(r1, SHORT_R1_MM + (r1 - SHORT_R1_MM) * t);
        r2 = Math.min(r2, SHORT_R2_MM + (r2 - SHORT_R2_MM) * t);
    }
    const packedRadii = packAlaRadii(height, r1, r2, minL);
    r1 = packedRadii.r1;
    r2 = packedRadii.r2;
    const alaOk = (
        hit: { C1: Sz; C2: Sz; hit: { L: number } } | null,
    ): hit is { C1: Sz; C2: Sz; hit: { L: number } } =>
        Boolean(hit && hit.hit.L >= minL - 1e-9 && hit.C1.z + 1e-6 >= hit.C2.z);
    let packed = tryAlaRadii(R, B, h, nTop, nPlant, r1, r2);
    if (!alaOk(packed)) {
        r1 = Math.min(r1, FILLET_R_CAP_MM);
        r2 = Math.min(r2, FILLET_R_CAP_MM);
        packed = tryAlaRadii(R, B, h, nTop, nPlant, r1, r2);
    }
    for (let i = 0; i < 48 && !alaOk(packed); i++) {
        r1 = Math.max(MIN_ROUND_R_MM, r1 * 0.85);
        r2 = Math.max(0.05, r2 * 0.85);
        packed = tryAlaRadii(R, B, h, nTop, nPlant, r1, r2);
        if (r1 <= MIN_ROUND_R_MM + 1e-9 && r2 <= 0.05 + 1e-9) break;
    }
    if (!packed) {
        const T1 = { x: R.x - h.x * 1e-3, y: R.y - h.y * 1e-3, z: R.z };
        const T2 = { x: B.x - h.x * 1e-3, y: B.y - h.y * 1e-3, z: B.z + 0.05 };
        const d = unit3({ x: T2.x - T1.x, y: T2.y - T1.y, z: T2.z - T1.z });
        const nTop2: Sz = { s: nTop.x * h.x + nTop.y * h.y, z: nTop.z };
        let tStart = unit3({ x: -nTop.z * h.x, y: -nTop.z * h.y, z: nTop2.s });
        if (tStart.x * h.x + tStart.y * h.y > 0) tStart = { x: -tStart.x, y: -tStart.y, z: -tStart.z };
        const ds = d.x * h.x + d.y * h.y;
        const leanRad = Math.atan2(ds, -d.z);
        return {
            C1: add3(R, nTop, -r1),
            C2: add3(B, nPlant, r2),
            T1,
            T2,
            n: { x: -h.x, y: -h.y, z: 0 },
            nTop,
            nPlant,
            tStart,
            d,
            L: Math.max(minL, dist3(T1, T2)),
            r1,
            r2,
            roundSweep: 1e-3,
            filletSweep: 1e-3,
            leanRad,
            lineTiltRad: Math.atan2(d.z, Math.hypot(d.x, d.y)),
            phiRound0: 0,
            phiRound1: 0,
            phiFil0: 0,
            phiFil1: 0,
        };
    }
    const { C1, C2, hit } = packed;
    const nTop2: Sz = { s: nTop.x * h.x + nTop.y * h.y, z: nTop.z };
    const nPlant2: Sz = { s: nPlant.x * h.x + nPlant.y * h.y, z: nPlant.z };
    const phiRound0 = phiOf(nTop2);
    const phiRound1 = unwindDown(phiRound0, phiOf(hit.n));
    const phiFil0 = phiOf(hit.n);
    const phiFil1 = unwindDown(phiFil0, phiOf({ s: -nPlant2.s, z: -nPlant2.z }));
    const T1 = xyzOnPlane(hit.T1, R, h);
    const T2 = xyzOnPlane(hit.T2, R, h);
    const d = unit3({ x: T2.x - T1.x, y: T2.y - T1.y, z: T2.z - T1.z });
    let tStart = unit3({ x: -nTop.z * h.x, y: -nTop.z * h.y, z: nTop2.s });
    if (tStart.x * h.x + tStart.y * h.y > 0) tStart = { x: -tStart.x, y: -tStart.y, z: -tStart.z };
    const n = unit3({ x: hit.n.s * h.x, y: hit.n.s * h.y, z: hit.n.z });
    const ds = d.x * h.x + d.y * h.y;
    const leanRad = Math.atan2(ds, Math.max(1e-9, -d.z));
    return {
        C1: xyzOnPlane(C1, R, h),
        C2: xyzOnPlane(C2, R, h),
        T1,
        T2,
        n,
        nTop,
        nPlant,
        tStart,
        d,
        L: Math.max(minL, hit.L),
        r1,
        r2,
        roundSweep: Math.abs(phiRound0 - phiRound1),
        filletSweep: Math.abs(phiFil0 - phiFil1),
        leanRad,
        lineTiltRad: Math.atan2(d.z, Math.hypot(d.x, d.y)),
        phiRound0,
        phiRound1,
        phiFil0,
        phiFil1,
    };
}

export function alaPoint(ala: ArcLineArc, h: { x: number; y: number }, C: XYZ, r: number, phi: number): XYZ {
    const ns = Math.sin(phi);
    const nz = Math.cos(phi);
    return { x: C.x + r * ns * h.x, y: C.y + r * ns * h.y, z: C.z + r * nz };
}

export function sampleArcLineArc(
    ala: ArcLineArc,
    h: { x: number; y: number },
    R: XYZ,
    B: XYZ,
    nWall: number,
    stationSpacing = 1.3,
): XYZ[] {
    const nRound = sizedArcRows(
        ala.roundSweep,
        ala.r1,
        stationSpacing,
        TOP_ROUND_MIN_ROWS,
        TOP_ROUND_MAX_STEP_DEG,
        true,
    );
    const nFil = sizedArcRows(
        ala.filletSweep,
        ala.r2,
        stationSpacing,
        MIN_FILLET_RINGS,
        FILLET_MAX_STEP_DEG,
        true,
    );
    const nLine0 = lineRowCount(ala.L, stationSpacing);
    let nLine = nLine0;
    const total0 = nRound + nLine + nFil + 1;
    if (total0 < nWall) nLine += nWall - total0;
    const pts: XYZ[] = [{ ...R }];
    for (let i = 1; i < nRound; i++) {
        const phi = ala.phiRound0 + ((ala.phiRound1 - ala.phiRound0) * i) / nRound;
        const p = alaPoint(ala, h, ala.C1, ala.r1, phi);
        const dPrev = dist3(p, pts[pts.length - 1]!);
        if (dPrev < WELD_MM) continue;
        if (dist3(p, ala.T1) < WELD_MM) continue;
        pts.push(p);
    }
    if (pts.length === 1 && dist3(R, ala.T1) >= WELD_MM) {
        const phi = ala.phiRound0 + (ala.phiRound1 - ala.phiRound0) * 0.5;
        const mid = alaPoint(ala, h, ala.C1, ala.r1, phi);
        if (dist3(mid, R) >= WELD_MM && dist3(mid, ala.T1) >= WELD_MM) pts.push(mid);
    }
    if (dist3(pts[pts.length - 1]!, ala.T1) >= WELD_MM) pts.push({ ...ala.T1 });
    else pts[pts.length - 1] = { ...ala.T1 };
    for (let i = 1; i < nLine; i++) {
        const t = i / nLine;
        pts.push({
            x: ala.T1.x + (ala.T2.x - ala.T1.x) * t,
            y: ala.T1.y + (ala.T2.y - ala.T1.y) * t,
            z: ala.T1.z + (ala.T2.z - ala.T1.z) * t,
        });
    }
    if (dist3(pts[pts.length - 1]!, ala.T2) >= MIN_EDGE_MM) pts.push({ ...ala.T2 });
    else pts[pts.length - 1] = { ...ala.T2 };
    for (let i = 1; i < nFil; i++) {
        const phi = ala.phiFil0 + ((ala.phiFil1 - ala.phiFil0) * i) / nFil;
        const p = alaPoint(ala, h, ala.C2, ala.r2, phi);
        if (dist3(p, pts[pts.length - 1]!) < MIN_EDGE_MM) continue;
        if (dist3(p, B) < MIN_EDGE_MM) continue;
        pts.push(p);
    }
    const minLast = FILLET_LAST_ROW_FRAC * stationSpacing;
    while (pts.length >= 3 && dist3(pts[pts.length - 1]!, B) < minLast) {
        if (dist3(pts[pts.length - 1]!, ala.T2) < WELD_MM) break;
        pts.pop();
    }
    pts.push({ ...B });
    return dropShortEdges(pts, MIN_EDGE_MM);
}

export function assertOutsideRound(R: XYZ, rnd: OutsideRound, pts: XYZ[]): void {
    const n = pts.length;
    const outboardCount = Math.max(1, Math.ceil(n * 0.65));
    for (let i = 0; i < outboardCount; i++) {
        const p = pts[i]!;
        const d = (p.x - R.x) * rnd.wOut.x + (p.y - R.y) * rnd.wOut.y;
        if (d < -1e-6) {
            throw new Error(`[S1-ROUND] point inboard of R d=${d.toFixed(6)}`);
        }
    }
    const steps = Math.max(2, n);
    let prevZ = rnd.nTop.z;
    const endZ = rnd.nWall.z;
    const rising = endZ > prevZ;
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const z = rnd.nTop.z * (1 - t) + rnd.nWall.z * t;
        if (rising ? z + 1e-6 < prevZ : z - 1e-6 > prevZ) {
            throw new Error(`[S1-ROUND] normal z not monotone ${prevZ} → ${z}`);
        }
        prevZ = z;
    }
}

export function applyAlaToFrame(fr: ColumnFrame): ArcLineArc {
    const nUse = fr.nTopSmoothed ?? fr.nTop;
    const ala = constructArcLineArc(fr.R, fr.B, nUse, fr.rTop, fr.rFillet, fr.h, fr.plantarSlopeRad);
    fr.rTop = ala.r1;
    fr.rFillet = ala.r2;
    fr.E = { ...ala.T1 };
    fr.F = { ...ala.T2 };
    fr.nTop = ala.nTop;
    fr.nTopSmoothed = nUse;
    fr.nWall = ala.n;
    fr.wOut = { x: -fr.h.x, y: -fr.h.y };
    fr.T0 = ala.tStart;
    fr.U = ala.d;
    fr.t0TiltRad = Math.atan2(ala.tStart.z, Math.hypot(ala.tStart.x, ala.tStart.y));
    fr.uTiltRad = ala.leanRad;
    fr.lineLengthMm = ala.L;
    fr.leanRad = ala.leanRad;
    fr.lineTiltRad = ala.lineTiltRad;
    fr.roundSweepRad = ala.roundSweep;
    fr.filletSweepRad = ala.filletSweep;
    return ala;
}

export function sampleTopRound(fr: ColumnFrame, nRows: number): { W: XYZ; pts: XYZ[] } {
    const ala = applyAlaToFrame(fr);
    if (fr.rTop < MIN_ROUND_R_MM) {
        fr.E = { ...fr.R };
        fr.roundRows = 0;
        return { W: { ...fr.R }, pts: [] };
    }
    const count = Math.max(TOP_ROUND_MIN_ROWS, nRows);
    const pts: XYZ[] = [];
    for (let i = 1; i <= count; i++) {
        const phi = ala.phiRound0 + ((ala.phiRound1 - ala.phiRound0) * i) / count;
        const p = alaPoint(ala, fr.h, ala.C1, ala.r1, phi);
        if (dist3(p, fr.R) < MIN_EDGE_MM) continue;
        if (pts.length && dist3(p, pts[pts.length - 1]!) < MIN_EDGE_MM) continue;
        pts.push(p);
    }
    if (pts.length) pts[pts.length - 1] = { ...ala.T1 };
    else pts.push({ ...ala.T1 });
    fr.roundRows = pts.length;
    const rnd = constructOutsideRound(fr.R, fr.nTop, fr.h, fr.rTop, fr.lineTiltRad);
    rnd.E = { ...ala.T1 };
    rnd.nWall = ala.n;
    rnd.T0 = ala.d;
    rnd.sweep = ala.roundSweep;
    assertOutsideRound(fr.R, rnd, pts);
    return { W: { ...ala.T1 }, pts };
}

function scale3(a: XYZ, s: number): XYZ {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function medianStationSpacing(stations: HermiteStation[]): number {
    if (stations.length < 2) return 1.3;
    const ds = stations.map((s, i) => {
        const n = stations[(i + 1) % stations.length]!;
        return Math.hypot(n.rim.x - s.rim.x, n.rim.y - s.rim.y, n.rim.z - s.rim.z);
    });
    ds.sort((a, b) => a - b);
    return ds[Math.floor(ds.length / 2)] ?? 1.3;
}

function vecAngleDeg(a: XYZ, b: XYZ): number {
    const d = Math.max(-1, Math.min(1, dot3(unit3(a), unit3(b))));
    return (Math.acos(d) * 180) / Math.PI;
}

function assertRoundJoints(fr: ColumnFrame, col: XYZ[]): void {
    if (col.length < 3 || !fr.roundRows) return;
    const nUse = fr.nTopSmoothed ?? fr.nTop;
    const ala = constructArcLineArc(fr.R, fr.B, nUse, fr.rTop, fr.rFillet, fr.h, fr.plantarSlopeRad);
    const tFirst = {
        x: col[1]!.x - col[0]!.x,
        y: col[1]!.y - col[0]!.y,
        z: col[1]!.z - col[0]!.z,
    };
    const topJoint = vecAngleDeg(tFirst, ala.tStart);
    let eIdx = Math.max(1, Math.min(col.length - 2, fr.roundRows || 6));
    let bestE = dist3(col[eIdx]!, ala.T1);
    for (let i = 1; i < Math.min(col.length - 1, 24); i++) {
        const d = dist3(col[i]!, ala.T1);
        if (d < bestE) {
            bestE = d;
            eIdx = i;
        }
    }
    const tEnd = {
        x: col[eIdx + 1]!.x - col[eIdx]!.x,
        y: col[eIdx + 1]!.y - col[eIdx]!.y,
        z: col[eIdx + 1]!.z - col[eIdx]!.z,
    };
    const wallJoint = vecAngleDeg(tEnd, ala.d);
    if (topJoint > ROUND_JOINT_MAX_DEG + 1e-3 || wallJoint > ROUND_JOINT_MAX_DEG + 1e-3) {
        throw new Error(
            `[S1-ROUND] joints top|round=${topJoint.toFixed(2)} round|wall=${wallJoint.toFixed(2)}`,
        );
    }
    const nRows = Math.max(eIdx, fr.roundRows || 0);
    const stepDeg = nRows > 0 ? (ala.roundSweep * 180) / Math.PI / nRows : 0;
    if (nRows < 1) {
        throw new Error(`[S1-ROUND] rows=${nRows} step=${stepDeg.toFixed(2)}`);
    }
}

export function t0LeadQ(fr: ColumnFrame): XYZ {
    const ala = applyAlaToFrame(fr);
    return { ...ala.T1 };
}

function planMonotone(pts: XYZ[], R: XYZ, B: XYZ): boolean {
    const dx = B.x - R.x;
    const dy = B.y - R.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-6) return true;
    for (let i = 1; i < pts.length; i++) {
        const sx = pts[i]!.x - pts[i - 1]!.x;
        const sy = pts[i]!.y - pts[i - 1]!.y;
        if (sx * dx + sy * dy < -1e-4 * chord) return false;
    }
    return true;
}

function planS(p: XYZ, R: XYZ, h: { x: number; y: number }): number {
    return (p.x - R.x) * h.x + (p.y - R.y) * h.y;
}

function clampPointToInward(p: XYZ, fr: ColumnFrame, origin: XYZ, maxS: number): XYZ {
    const s = planS(p, origin, fr.h);
    if (s <= maxS) return projectToPlane(p, fr.R, fr.h);
    return projectToPlane({ x: origin.x + fr.h.x * maxS, y: origin.y + fr.h.y * maxS, z: p.z }, fr.R, fr.h);
}

function bezTangent(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, t: number): XYZ {
    const u = 1 - t;
    return unit3({
        x: 3 * u * u * (P1.x - P0.x) + 6 * u * t * (P2.x - P1.x) + 3 * t * t * (P3.x - P2.x),
        y: 3 * u * u * (P1.y - P0.y) + 6 * u * t * (P2.y - P1.y) + 3 * t * t * (P3.y - P2.y),
        z: 3 * u * u * (P1.z - P0.z) + 6 * u * t * (P2.z - P1.z) + 3 * t * t * (P3.z - P2.z),
    });
}

function sampleBezierByTurning(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, n: number): XYZ[] {
    const count = Math.max(2, n);
    const denseN = 64;
    const dense: XYZ[] = [];
    const turns = [0];
    let prevT = bezTangent(P0, P1, P2, P3, 0);
    for (let k = 1; k <= denseN; k++) {
        const t = k / denseN;
        dense.push(evalCubicBezier(P0, P1, P2, P3, t));
        const T = bezTangent(P0, P1, P2, P3, t);
        turns.push(turns[k - 1]! + vecAngleDeg(prevT, T));
        prevT = T;
    }
    const total = turns[turns.length - 1]!;
    const out: XYZ[] = [];
    if (total < 1e-3) {
        for (let i = 1; i <= count; i++) out.push(evalCubicBezier(P0, P1, P2, P3, i / count));
        return out;
    }
    for (let i = 1; i <= count; i++) {
        const target = (total * i) / count;
        let k = 1;
        while (k < turns.length - 1 && turns[k]! < target) k++;
        const t0 = (k - 1) / denseN;
        const t1 = k / denseN;
        const span = turns[k]! - turns[k - 1]!;
        const a = span > 1e-9 ? (target - turns[k - 1]!) / span : 1;
        out.push(evalCubicBezier(P0, P1, P2, P3, t0 + (t1 - t0) * a));
    }
    out[out.length - 1] = { ...P3 };
    return out;
}

function dropShortEdges(pts: XYZ[], minMm: number): XYZ[] {
    if (pts.length < 2) return pts;
    const out = [{ ...pts[0]! }];
    for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i]!;
        if (dist3(p, out[out.length - 1]!) < minMm) continue;
        out.push({ ...p });
    }
    const last = pts[pts.length - 1]!;
    while (out.length > 1 && dist3(out[out.length - 1]!, last) < minMm) out.pop();
    out.push({ ...last });
    return out;
}

function fitColumnCount(pts: XYZ[], n: number, keepFrom: number, minLastMm = 0): XYZ[] {
    const out = pts.map((p) => ({ ...p }));
    while (out.length < n) {
        let best = keepFrom;
        let bestD = -1;
        for (let i = keepFrom; i < out.length - 1; i++) {
            const d = dist3(out[i]!, out[i + 1]!);
            if (i === out.length - 2 && minLastMm > 0 && d * 0.5 < minLastMm) continue;
            if (d > bestD) {
                bestD = d;
                best = i;
            }
        }
        if (bestD < 0) break;
        const a = out[best]!;
        const b = out[best + 1]!;
        out.splice(best + 1, 0, { x: 0.5 * (a.x + b.x), y: 0.5 * (a.y + b.y), z: 0.5 * (a.z + b.z) });
    }
    while (out.length > n && out.length > keepFrom + 2) {
        let best = keepFrom + 1;
        let bestD = Infinity;
        for (let i = keepFrom + 1; i < out.length - 1; i++) {
            const d = dist3(out[i - 1]!, out[i + 1]!);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        out.splice(best, 1);
    }
    return out;
}

function columnPoints(
    fr: ColumnFrame,
    nWall: number,
    _stationSpacing = 1.3,
    _nTopFix = 0,
    _nFilFix = 0,
): XYZ[] {
    const ala = applyAlaToFrame(fr);
    const assembled = sampleArcLineArc(ala, fr.h, fr.R, fr.B, nWall, _stationSpacing);
    let keepFrom = 1;
    let bestT1 = Infinity;
    for (let i = 1; i < assembled.length - 1; i++) {
        const d = dist3(assembled[i]!, ala.T1);
        if (d < bestT1) {
            bestT1 = d;
            keepFrom = i;
        }
    }
    const raw = fitColumnCount(assembled, nWall, keepFrom, FILLET_LAST_ROW_FRAC * _stationSpacing);
    const out = raw.map((p, i) => {
        if (i === 0) return { ...fr.R };
        if (i === raw.length - 1) return { ...fr.B };
        return projectToPlane(p, fr.R, fr.h);
    });
    let eIdx = 0;
    let bestE = Infinity;
    for (let i = 1; i < out.length - 1; i++) {
        const d = dist3(out[i]!, ala.T1);
        if (d < bestE) {
            bestE = d;
            eIdx = i;
        }
    }
    fr.roundRows = eIdx;
    out[0] = { ...fr.R };
    out[out.length - 1] = { ...fr.B };
    return out;
}

function pinJunctionHolds(col: XYZ[], fr: ColumnFrame, _origin: XYZ, _maxS: number, roundRows: number): void {
    const eIdx = roundRows > 0 ? roundRows : 0;
    let fIdx = -1;
    let best = Infinity;
    for (let i = Math.max(1, eIdx); i < col.length - 1; i++) {
        const d = dist3(col[i]!, fr.F);
        if (d < best) {
            best = d;
            fIdx = i;
        }
    }
    if (fIdx < 1 || fIdx >= col.length - 1) return;
    col[fIdx] = { ...fr.F };
    if (fIdx + 1 < col.length - 1) {
        col[fIdx + 1] = projectToPlane(add3(fr.F, fr.U, -0.12), fr.R, fr.h);
    }
}

function assertBezierFilletG1(fr: ColumnFrame, col: XYZ[], roundRows: number): void {
    if (col.length < 4) return;
    let fIdx = -1;
    let best = Infinity;
    for (let i = Math.max(1, roundRows); i < col.length - 1; i++) {
        const d = dist3(col[i]!, fr.F);
        if (d < best) {
            best = d;
            fIdx = i;
        }
    }
    if (fIdx < 1 || fIdx >= col.length - 1) return;
    const tBez = {
        x: col[fIdx]!.x - col[fIdx - 1]!.x,
        y: col[fIdx]!.y - col[fIdx - 1]!.y,
        z: col[fIdx]!.z - col[fIdx - 1]!.z,
    };
    const tFil = {
        x: col[fIdx + 1]!.x - col[fIdx]!.x,
        y: col[fIdx + 1]!.y - col[fIdx]!.y,
        z: col[fIdx + 1]!.z - col[fIdx]!.z,
    };
    const deg = vecAngleDeg(tBez, tFil);
    if (deg > ROUND_JOINT_MAX_DEG + 4) {
        console.log(`[S1-G1] bezier|fillet ${deg.toFixed(2)} at u=${fr.u.toFixed(3)}`);
    }
}

function resampleKeepingRound(pts: XYZ[], n: number, wallStart: number): XYZ[] {
    if (pts.length === n) return pts;
    const head = pts.slice(0, wallStart);
    const tail = pts.slice(wallStart);
    const need = Math.max(2, n - head.length);
    return [...head, ...sampleByArcLength(tail, need).slice(1)];
}

function snapPlanMonotone(pts: XYZ[], origin: XYZ, B: XYZ, from = 1): void {
    const dx = B.x - origin.x;
    const dy = B.y - origin.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-6) return;
    const hx = dx / chord;
    const hy = dy / chord;
    let prevS = 0;
    for (let i = from; i < pts.length - 1; i++) {
        const p = pts[i]!;
        const s = (p.x - origin.x) * hx + (p.y - origin.y) * hy;
        if (s < prevS) {
            p.x = origin.x + hx * prevS;
            p.y = origin.y + hy * prevS;
        } else {
            prevS = s;
        }
    }
}

function smoothScalars(vals: number[], passes: number): number[] {
    let cur = vals.slice();
    const n = cur.length;
    for (let p = 0; p < passes; p++) {
        cur = cur.map((v, i) => 0.5 * v + 0.25 * cur[(i + n - 1) % n]! + 0.25 * cur[(i + 1) % n]!);
    }
    return cur;
}

function smoothScalarsMasked(vals: number[], valid: boolean[], passes: number): number[] {
    let cur = vals.slice();
    const n = cur.length;
    for (let p = 0; p < passes; p++) {
        const next = cur.slice();
        for (let i = 0; i < n; i++) {
            if (!valid[i]) continue;
            const im = (i + n - 1) % n;
            const ip = (i + 1) % n;
            const vm = valid[im] ? cur[im]! : cur[i]!;
            const vp = valid[ip] ? cur[ip]! : cur[i]!;
            next[i] = 0.5 * cur[i]! + 0.25 * vm + 0.25 * vp;
        }
        cur = next;
    }
    return cur;
}

/** Wall-start tilt from horizontal: −90° + flare (inward-down). Short chords stay steep. */
export function wallStartTiltRad(flareRad: number, shortChord: boolean): number {
    const clear = (TOP_CLEARANCE_DEG * Math.PI) / 180;
    if (shortChord) return -Math.PI / 2 + clear;
    return -Math.PI / 2 + flareRad;
}

export function t0TargetRad(
    sheetSlopeRad: number,
    shortChord: boolean,
    valid: boolean,
    flareRad = 0,
): number {
    const wall = wallStartTiltRad(flareRad, shortChord);
    if (shortChord || !valid) return wall;
    return Math.min(wall, sheetSlopeRad - (TOP_CLEARANCE_DEG * Math.PI) / 180);
}

function pinT0(frames: ColumnFrame[]): void {
    for (const fr of frames) {
        const target = t0TargetRad(fr.sheetSlopeRad, fr.shortChord, fr.sheetSlopeValid, fr.uTiltRad);
        fr.t0TiltRad = Math.min(fr.t0TiltRad, target);
        applyTilts(fr);
    }
}

export const SLOPE_SAMPLE_MM = [0.5, 1, 2] as const;
export const SLOPE_FALLBACK_MM = [3, 4, 6] as const;

function rayHitsAlong(
    R: XYZ,
    dir: { x: number; y: number },
    topZ: (x: number, y: number) => number | null,
    steps: readonly number[] = SLOPE_SAMPLE_MM,
): Array<{ s: number; z: number }> {
    const out: Array<{ s: number; z: number }> = [];
    for (const s of steps) {
        const z = topZ(R.x + dir.x * s, R.y + dir.y * s);
        if (z == null) continue;
        out.push({ s, z });
    }
    return out;
}

/** Sheet slope in the vertical R–B plane from an adjacent TopSheet face normal. */
export function slopeFromSheetPlane(planeN: XYZ, h: { x: number; y: number }): number | null {
    const nz = planeN.z;
    if (Math.abs(nz) < 1e-8) return null;
    return Math.atan(-(planeN.x * h.x + planeN.y * h.y) / nz);
}

export interface InPlaneSlope {
    slopeRad: number;
    valid: boolean;
}

/**
 * TopSheet in-plane slope along +h only. Rays at 0.5 / 1 / 2 mm, then 3 / 4 / 6,
 * then the adjacent-face plane, then −h interpreted as a +h difference.
 * Never defaults to 0.
 */
export function sampleInPlaneSlope(
    R: XYZ,
    h: { x: number; y: number },
    topZ: (x: number, y: number) => number | null,
    planeN?: XYZ,
): InPlaneSlope {
    const zR = topZ(R.x, R.y) ?? R.z;
    const plus = rayHitsAlong(R, h, topZ);
    const plusFar = plus.length ? plus : rayHitsAlong(R, h, topZ, SLOPE_FALLBACK_MM);
    if (plusFar.length > 0) {
        const p = plusFar[Math.min(1, plusFar.length - 1)]!;
        return { slopeRad: Math.atan((p.z - zR) / Math.max(p.s, 1e-6)), valid: true };
    }
    const minus = rayHitsAlong(R, { x: -h.x, y: -h.y }, topZ);
    if (minus.length > 0) {
        const p = minus[Math.min(1, minus.length - 1)]!;
        return { slopeRad: Math.atan((zR - p.z) / Math.max(p.s, 1e-6)), valid: true };
    }
    if (planeN) {
        const face = slopeFromSheetPlane(planeN, h);
        if (face != null) return { slopeRad: face, valid: true };
    }
    return { slopeRad: Number.NaN, valid: false };
}

/**
 * Sheet-clearance helper: T0 must sit at least 10° steeper than the sheet.
 * Wall start itself is −90° + flare (`wallStartTiltRad`).
 */
export function t0FromSheetSlope(sheetSlopeRad: number, shortChord: boolean): number {
    const clear = (TOP_CLEARANCE_DEG * Math.PI) / 180;
    if (shortChord) return -Math.PI / 2 + clear;
    return sheetSlopeRad - clear;
}

export function assertT0ClearsSheet(frames: ColumnFrame[]): void {
    const clear = (TOP_CLEARANCE_DEG * Math.PI) / 180;
    const rows: Array<{ u: number; sheet_h: number; line: number; lean: number; limit: number }> = [];
    const bad: Array<{ u: number; sheet_h: number; line: number; lean: number; limit: number }> = [];
    for (const f of frames) {
        if (f.shortChord || !f.sheetSlopeValid) continue;
        const row = {
            u: Number(f.u.toFixed(4)),
            sheet_h: Number(((f.sheetSlopeRad * 180) / Math.PI).toFixed(3)),
            line: Number(((f.lineTiltRad * 180) / Math.PI).toFixed(3)),
            lean: Number(((f.leanRad * 180) / Math.PI).toFixed(3)),
            limit: Number((((f.sheetSlopeRad - clear) * 180) / Math.PI).toFixed(3)),
        };
        rows.push(row);
        if (f.lineTiltRad > f.sheetSlopeRad - clear + 1e-5) bad.push(row);
    }
    console.log("[S1-T0]", JSON.stringify({ n: rows.length, bad: bad.length, sample: rows.slice(0, 8) }));
}

export function columnHeading(st: HermiteStation): {
    h: { x: number; y: number };
    shortChord: boolean;
    planLen: number;
} {
    const dx = st.outline.x - st.rim.x;
    const dy = st.outline.y - st.rim.y;
    const planLen = Math.hypot(dx, dy);
    if (planLen < 1e-4) {
        const nx = st.n.x;
        const ny = st.n.y;
        const nl = Math.hypot(nx, ny) || 1;
        return { h: { x: nx / nl, y: ny / nl }, shortChord: true, planLen };
    }
    return { h: { x: dx / planLen, y: dy / planLen }, shortChord: planLen < SHORT_CHORD_MM, planLen };
}

function headingAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)));
}

function clampHeadingTo(
    h: { x: number; y: number },
    ref: { x: number; y: number },
    maxDeg: number,
): { x: number; y: number } {
    const ang = headingAngle(ref, h);
    const maxRad = (maxDeg * Math.PI) / 180;
    if (ang <= maxRad + 1e-9) return { ...h };
    const t = maxRad / ang;
    const x = ref.x + (h.x - ref.x) * t;
    const y = ref.y + (h.y - ref.y) * t;
    const hl = Math.hypot(x, y) || 1;
    return { x: x / hl, y: y / hl };
}

/** CCW B-loop outward normal, flipped to agree with plan(B−R). */
export function bLoopOutwardNormal(stations: HermiteStation[], i: number): { x: number; y: number } {
    const n = stations.length;
    const prev = stations[(i + n - 1) % n]!.outline;
    const next = stations[(i + 1) % n]!.outline;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    let nx = ty / tl;
    let ny = -tx / tl;
    const chord = columnHeading(stations[i]!).h;
    if (nx * chord.x + ny * chord.y < 0) {
        nx = -nx;
        ny = -ny;
    }
    return { x: nx, y: ny };
}

/**
 * Heading = plan(B−R), corrected by the B-loop outward normal within 3°.
 * Gaussian-smooth the B-loop heading, then re-clamp. Extra jitter above the
 * geometric fan stays inside the 3°/station budget.
 */
export function smoothStationHeadings(stations: HermiteStation[]): Array<{ x: number; y: number }> {
    const n = stations.length;
    if (n === 0) return [];
    const chords = stations.map((st) => columnHeading(st));
    const corrected = chords.map((c, i) =>
        clampHeadingTo(bLoopOutwardNormal(stations, i), c.h, HEADING_MAX_DEG),
    );
    const bLoop = stations.map((s) => s.outline);
    const sx = periodicGaussian(
        corrected.map((h) => h.x),
        bLoop,
    );
    const sy = periodicGaussian(
        corrected.map((h) => h.y),
        bLoop,
    );
    const out = sx.map((_, i) => {
        const hl = Math.hypot(sx[i]!, sy[i]!) || 1;
        return clampHeadingTo({ x: sx[i]! / hl, y: sy[i]! / hl }, chords[i]!.h, HEADING_MAX_DEG);
    });
    const maxRad = (HEADING_MAX_DEG * Math.PI) / 180;
    for (let pass = 0; pass < 8; pass++) {
        for (let i = 0; i < n; i++) {
            const prev = out[(i + n - 1) % n]!;
            const cur = out[i]!;
            const raw = headingAngle(chords[(i + n - 1) % n]!.h, chords[i]!.h);
            const ang = headingAngle(prev, cur);
            const limit = Math.max(maxRad, raw);
            if (ang <= limit + 1e-9) continue;
            const t = limit / ang;
            const x = prev.x + (cur.x - prev.x) * t;
            const y = prev.y + (cur.y - prev.y) * t;
            const hl = Math.hypot(x, y) || 1;
            out[i] = { x: x / hl, y: y / hl };
        }
    }
    for (let i = 0; i < n; i++) out[i] = clampHeadingTo(out[i]!, chords[i]!.h, HEADING_MAX_DEG);
    return out;
}

export function smoothNormalField(normals: XYZ[], rim: XYZ[], sigma = SCALAR_SMOOTH_SIGMA_MM): XYZ[] {
    if (normals.length < 3) return normals.map((n) => unit3(n));
    const nx = periodicGaussian(
        normals.map((n) => n.x),
        rim,
        sigma,
    );
    const ny = periodicGaussian(
        normals.map((n) => n.y),
        rim,
        sigma,
    );
    const nz = periodicGaussian(
        normals.map((n) => n.z),
        rim,
        sigma,
    );
    const raw = nx.map((_, i) => {
        let n = unit3({ x: nx[i]!, y: ny[i]!, z: nz[i]! });
        if (n.z < 0) n = { x: -n.x, y: -n.y, z: -n.z };
        return n;
    });
    const maxRad = (N_TOP_MAX_DEG * Math.PI) / 180;
    const out = raw.map((n) => ({ ...n }));
    for (let pass = 0; pass < 8; pass++) {
        for (let i = 0; i < out.length; i++) {
            const prev = out[(i + out.length - 1) % out.length]!;
            const cur = out[i]!;
            const ang = Math.acos(Math.max(-1, Math.min(1, dot3(prev, cur))));
            if (ang <= maxRad + 1e-9) continue;
            const t = maxRad / ang;
            let n = unit3({
                x: prev.x + (cur.x - prev.x) * t,
                y: prev.y + (cur.y - prev.y) * t,
                z: prev.z + (cur.z - prev.z) * t,
            });
            if (n.z < 0) n = { x: -n.x, y: -n.y, z: -n.z };
            out[i] = n;
        }
    }
    return out;
}

export function periodicGaussian(vals: number[], rim: XYZ[], sigma = SCALAR_SMOOTH_SIGMA_MM): number[] {
    const n = vals.length;
    if (n === 0) return [];
    if (n < 3) return vals.slice();
    const ds = rim.map((p, i) => dist3(p, rim[(i + 1) % n]!));
    const period = ds.reduce((s, d) => s + d, 0);
    const cum = [0];
    for (const d of ds) cum.push(cum[cum.length - 1]! + d);
    const sig = Math.max(8, Math.min(15, sigma));
    return vals.map((_, i) => {
        let s = 0;
        let w = 0;
        for (let j = 0; j < n; j++) {
            let d = Math.abs(cum[j]! - cum[i]!);
            d = Math.min(d, period - d);
            const wt = Math.exp((-0.5 * d * d) / (sig * sig));
            s += wt * vals[j]!;
            w += wt;
        }
        return w > 0 ? s / w : vals[i]!;
    });
}

/** Pull adjacent scalars until |Δ| / max(from, 1e-6) ≤ maxPct / 100. */
export function rateLimitClosed(vals: number[], maxPct: number, floor = 0): number[] {
    const n = vals.length;
    const out = vals.map((v) => Math.max(floor, v));
    if (n < 2) return out;
    const f = Math.max(0, maxPct) / 100;
    const pull = (from: number, to: number): number => {
        const den = Math.max(from, 1e-6);
        const lo = den * (1 - f);
        const hi = den * (1 + f);
        return Math.max(floor, Math.min(hi, Math.max(lo, to)));
    };
    for (let pass = 0; pass < 6; pass++) {
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            out[j] = pull(out[i]!, out[j]!);
        }
        for (let i = n - 1; i >= 0; i--) {
            const j = (i + 1) % n;
            out[i] = pull(out[j]!, out[i]!);
        }
    }
    return out;
}

/** Shrink only the larger neighbor so ALA cannot reopen a >maxPct jump. */
export function rateLimitClosedDown(vals: number[], maxPct: number, floor = 0): number[] {
    const n = vals.length;
    const out = vals.map((v) => Math.max(floor, v));
    if (n < 2) return out;
    const f = Math.max(0, maxPct) / 100;
    for (let pass = 0; pass < 8; pass++) {
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const a = out[i]!;
            const b = out[j]!;
            const capFromA = Math.max(a, 1e-6) * (1 + f);
            const capFromB = Math.max(b, 1e-6) * (1 + f);
            if (b > capFromA) out[j] = Math.max(floor, capFromA);
            if (a > capFromB) out[i] = Math.max(floor, capFromB);
        }
    }
    return out;
}

function snapshotStationParams(frames: ColumnFrame[]): StationParamRow[] {
    return frames
        .filter((f) => f.u <= 0.1 + 1e-9 || (f.u >= 0.25 - 1e-9 && f.u <= 0.45 + 1e-9))
        .map((f) => ({
            u: Number(f.u.toFixed(4)),
            flare: Number(((f.leanRad * 180) / Math.PI).toFixed(3)),
            t0: Number(((f.t0TiltRad * 180) / Math.PI).toFixed(3)),
            a: Number(f.a.toFixed(3)),
            b: Number(f.b.toFixed(3)),
            rRound: Number(f.rTop.toFixed(3)),
            rFillet: Number(f.rFillet.toFixed(3)),
            height: Number(f.heightMm.toFixed(3)),
            planEB: Number(Math.hypot(f.B.x - (f.E?.x ?? f.R.x), f.B.y - (f.E?.y ?? f.R.y)).toFixed(3)),
        }));
}

export function smoothFilletRadii(frames: ColumnFrame[], _frac = R_SMOOTH_FRAC): void {
    if (frames.length < 3) return;
    const rim = frames.map((f) => f.R);
    const next = periodicGaussian(
        frames.map((f) => f.rFillet),
        rim,
    );
    for (let i = 0; i < frames.length; i++) frames[i]!.rFillet = Math.max(0.05, next[i]!);
}

export function placeFilletF(fr: ColumnFrame): void {
    applyTilts(fr);
    fr.uTiltRad = clampFilletB(fr.uTiltRad);
    applyTilts(fr);
    const planLen = Math.hypot(fr.R.x - fr.B.x, fr.R.y - fr.B.y);
    const psi = Math.PI / 2 - fr.uTiltRad;
    fr.rFillet = Math.min(fr.rFillet, filletRadiusMm(fr.heightMm, planLen, psi));
    const fil = constructFillet(fr.B, fr.h, fr.rFillet, fr.U, fr.plantarSlopeRad);
    fr.uTiltRad = fil.b;
    fr.U = fil.d;
    fr.tFillet = fil.t;
    fr.F = projectToPlane(fil.Pw, fr.R, fr.h);
}

function clampHandlesToChord(fr: ColumnFrame): void {
    applyTilts(fr);
    const W = t0LeadQ(fr);
    const planEB = Math.hypot(fr.B.x - W.x, fr.B.y - W.y);
    const chord = Math.max(dist3(W, fr.F), 1e-6);
    fr.a = Math.min(fr.a, HANDLE_CHORD_CAP * chord);
    fr.b = Math.min(fr.b, HANDLE_CHORD_CAP * chord);
    const t0h = fr.T0.x * fr.h.x + fr.T0.y * fr.h.y;
    const sW = planS(W, W, fr.h);
    if (t0h > 1e-9) fr.a = Math.min(fr.a, Math.max(0, (planEB - sW) / t0h));
    const uh = fr.U.x * fr.h.x + fr.U.y * fr.h.y;
    const sF = planS(fr.F, W, fr.h);
    if (uh > 1e-9) fr.b = Math.min(fr.b, Math.max(0, (planEB - sF) / uh));
    if (uh < -1e-9) fr.b = Math.min(fr.b, Math.max(0, (0 - sF) / uh));
    fr.a = Math.max(0, fr.a);
    fr.b = Math.max(0, fr.b);
}

function setHandlesFromQF(fr: ColumnFrame): void {
    applyTilts(fr);
    const origin = fr.E ?? t0LeadQ(fr);
    const rf = Math.max(1e-3, dist3(origin, fr.F));
    const handle = Math.max(0.12, Math.min(BEZIER_HANDLE_FRAC * rf, HANDLE_CHORD_CAP * rf));
    fr.a = handle;
    fr.b = handle;
    clampHandlesToChord(fr);
}

export function initColumnFrames(
    stations: HermiteStation[],
    _junctions: ColumnJunction[],
    _defaults: WallRegionDefaults,
    flareDeg: number[],
    topZ: (x: number, y: number) => number | null = () => null,
    plantarSlopeRad: number[] = [],
): ColumnFrame[] {
    const outline = stations.map((s) => s.outline);
    const nTops = smoothNormalField(
        stations.map((st, i) => unit3(_junctions[i]?.planeN ?? { x: 0, y: 0, z: 1 })),
        stations.map((st) => st.rim),
    );
    const headings = smoothStationHeadings(stations);
    const frames = stations.map((st, i) => {
        const R = { ...st.rim };
        const B = { ...st.outline };
        const chord = columnHeading(st);
        const h = headings[i] ?? chord.h;
        const shortChord = chord.shortChord;
        const planLen = chord.planLen;
        const height = Math.max(R.z - B.z, 0.5);
        const nTop = nTops[i]!;
        const sampled = sampleInPlaneSlope(R, h, topZ, _junctions[i]?.planeN);
        const sheetSlopeRad = sampled.valid ? sampled.slopeRad : 0;
        const plantar = plantarSlopeRad[i] ?? 0;
        const r = Math.min(
            FILLET_R_CAP_MM,
            Math.max(0.05, _defaults.wallFilletBottomMm || filletRadiusMm(height, planLen, Math.PI / 2)),
        );
        const rTop = Math.min(FILLET_R_CAP_MM, Math.max(MIN_ROUND_R_MM, _defaults.wallFilletTopMm || 0.5));
        const fr: ColumnFrame = {
            R,
            B,
            F: { x: B.x, y: B.y, z: B.z + r },
            h,
            T0: { x: -h.x, y: -h.y, z: 0 },
            U: { x: 0, y: 0, z: -1 },
            a: 0,
            b: 0,
            t0TiltRad: 0,
            uTiltRad: 0,
            sheetSlopeRad,
            sheetSlopeValid: sampled.valid,
            plantarSlopeRad: plantar,
            rFillet: r,
            rTop,
            tFillet: 0,
            u: st.u,
            shortChord,
            overhangMm: rimOverhangMm(R, outline),
            heightMm: height,
            bandZ: B.z,
            bandInsetMm: estimateBandInsetMm(r, Math.PI / 2),
            arcEndZ: B.z,
            E: { ...R },
            nTop,
            nTopSmoothed: nTop,
            wOut: { x: -h.x, y: -h.y },
            nWall: { x: 0, y: 0, z: 1 },
            roundRows: TOP_ROUND_MIN_ROWS,
            lineLengthMm: 0,
            leanRad: 0,
            lineTiltRad: -Math.PI / 2,
            roundSweepRad: 0,
            filletSweepRad: 0,
        };
        applyAlaToFrame(fr);
        return fr;
    });
    return frames;
}

function clampHandleInboard(fr: ColumnFrame): void {
    const dx = fr.B.x - fr.R.x;
    const dy = fr.B.y - fr.R.y;
    const den = fr.U.x * dx + fr.U.y * dy;
    if (den >= -1e-9) return;
    const num = (fr.F.x - fr.R.x) * dx + (fr.F.y - fr.R.y) * dy;
    fr.b = Math.min(fr.b, Math.max(0, -num / den));
}

function applySmooth(
    frames: ColumnFrame[],
    _passes: number,
): { before: StationParamRow[]; after: StationParamRow[] } {
    const before = snapshotStationParams(frames);
    for (const fr of frames) applyAlaToFrame(fr);
    const rim = frames.map((f) => f.R);
    const applyLimited = (r1: number[], r2: number[]): void => {
        const lim1 = rateLimitClosed(r1, R_CHANGE_MAX_PCT, MIN_ROUND_R_MM);
        const lim2 = rateLimitClosedDown(r2, R2_CHANGE_MAX_PCT, 0.05);
        for (let i = 0; i < frames.length; i++) {
            const fr = frames[i]!;
            fr.rTop = lim1[i]!;
            fr.rFillet = lim2[i]!;
            applyAlaToFrame(fr);
        }
    };
    applyLimited(
        periodicGaussian(
            frames.map((f) => f.rTop),
            rim,
        ),
        periodicGaussian(
            frames.map((f) => f.rFillet),
            rim,
        ),
    );
    for (let pass = 0; pass < 4; pass++) {
        applyLimited(
            frames.map((f) => f.rTop),
            frames.map((f) => f.rFillet),
        );
    }
    return { before, after: snapshotStationParams(frames) };
}

function guardFrames(
    frames: ColumnFrame[],
    junctions: ColumnJunction[],
    rimLoop: PolyPoint[],
    topZ: (x: number, y: number) => number | null,
    nWall: number,
    stationSpacing: number,
    nRoundG = 0,
    nFilG = 0,
): void {
    for (let round = 0; round < 8; round++) {
        let dirty = false;
        for (let i = 0; i < frames.length; i++) {
            const fr = frames[i]!;
            const pts = columnPoints(fr, nWall, stationSpacing, nRoundG, nFilG);
            const junct = junctions[i]!;
            const wallFrom = Math.max(1, fr.roundRows || 1);
            let inside = false;
            for (let j = wallFrom; j < pts.length - 1; j++) {
                if (rowInsideTop(pts[j]!, fr.R, junct.planeN, rimLoop, topZ)) {
                    inside = true;
                    break;
                }
            }
            if (inside) {
                fr.rTop = Math.max(MIN_ROUND_R_MM, fr.rTop * 0.85);
                fr.rFillet = Math.max(0.05, fr.rFillet * 0.85);
                applyAlaToFrame(fr);
                dirty = true;
            }
        }
        if (!dirty) break;
    }
}

/**
 * Planar ARC-LINE-ARC columns: each station stays in the vertical plane through R and B.
 * R and B never move. Flare/T0 are derived checks on the external tangent, not inputs.
 */
export function buildBezierColumns(
    stations: HermiteStation[],
    junctions: ColumnJunction[],
    defaults: WallRegionDefaults,
    rimLoop: PolyPoint[],
    topZ: (x: number, y: number) => number | null,
    nWall: number,
    plantarSlopeRad: number[] = [],
    minWallMm = 0.8,
    exemptAcross: boolean[] = [],
): BezierColumns {
    const regionDefault = stations.map((st) =>
        blendedFlareDeg(st.u, st.outline.y, defaults.flareDeg, defaults.medialYSign ?? 1),
    );
    const { flare, report } = smoothAndCapFlare(
        stations.map((s) => s.outline),
        regionDefault,
    );
    const frames = initColumnFrames(stations, junctions, defaults, flare, topZ, plantarSlopeRad);
    const spacing = medianStationSpacing(stations);
    const minWallClamps = clampFramesMinWall(frames, topZ, minWallMm);
    const smoothLog = applySmooth(frames, FRAME_SMOOTH_ITERS);
    console.log("[S1-SMOOTH] before", JSON.stringify(smoothLog.before));
    console.log("[S1-SMOOTH] after", JSON.stringify(smoothLog.after));
    let nNeed = nWall;
    for (const fr of frames) {
        const ala = applyAlaToFrame(fr);
        const nRound = sizedArcRows(
            ala.roundSweep,
            ala.r1,
            spacing,
            TOP_ROUND_MIN_ROWS,
            TOP_ROUND_MAX_STEP_DEG,
            true,
        );
        const nFil = sizedArcRows(
            ala.filletSweep,
            ala.r2,
            spacing,
            MIN_FILLET_RINGS,
            FILLET_MAX_STEP_DEG,
            true,
        );
        const nLine = lineRowCount(ala.L, spacing);
        nNeed = Math.max(nNeed, nRound + nLine + nFil + 1);
    }
    nWall = nNeed;
    guardFrames(frames, junctions, rimLoop, topZ, nWall, spacing);
    for (let pass = 0; pass < 8; pass++) {
        const lim1 = rateLimitClosed(
            frames.map((f) => f.rTop),
            R_CHANGE_MAX_PCT,
            MIN_ROUND_R_MM,
        );
        const lim2 = rateLimitClosedDown(
            frames.map((f) => f.rFillet),
            R2_CHANGE_MAX_PCT,
            0.05,
        );
        for (let i = 0; i < frames.length; i++) {
            const fr = frames[i]!;
            fr.rTop = lim1[i]!;
            fr.rFillet = lim2[i]!;
            applyAlaToFrame(fr);
        }
    }
    const xyz: PolyPoint[][] = [];
    const implied: number[] = [];
    let maxOff = 0;
    let maxSide = 0;
    let maxTiltStep = 0;
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const col = columnPoints(fr, nWall, spacing);
        col[0] = { ...fr.R };
        col[col.length - 1] = { ...fr.B };
        assertRoundJoints(fr, col);
        fr.arcEndZ = col[col.length - 2]?.z ?? fr.B.z;
        for (let k = 1; k < col.length - 1; k++) {
            maxOff = Math.max(maxOff, offPlaneMm(col[k]!, fr.R, fr.h));
        }
        maxSide = Math.max(maxSide, offPlaneMm(col[col.length - 1]!, fr.R, fr.h));
        xyz.push(col);
        const first = col[1] ?? fr.F;
        implied.push(
            filletImpliedSeamDeg(
                { n: Math.hypot(fr.T0.x, fr.T0.y), z: fr.T0.z },
                { n: Math.hypot(first.x - fr.R.x, first.y - fr.R.y), z: first.z - fr.R.z },
            ),
        );
        const nxt = frames[(i + 1) % frames.length]!;
        maxTiltStep = Math.max(maxTiltStep, (Math.abs(nxt.leanRad - fr.leanRad) * 180) / Math.PI);
    }
    ensureLastFilletRowHeight(xyz, frames, spacing);
    for (let i = 0; i < frames.length; i++) {
        const col = xyz[i]!;
        frames[i]!.arcEndZ = col[col.length - 2]?.z ?? frames[i]!.B.z;
    }
    assertT0ClearsSheet(frames);
    reportLeanVsBio(frames, defaults, flare);
    const bad: Array<{ i: number; u: number; off: number; side: number }> = [];
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const col = xyz[i]!;
        let off = 0;
        for (let k = 1; k < col.length - 1; k++) off = Math.max(off, offPlaneMm(col[k]!, fr.R, fr.h));
        const side = offPlaneMm(col[col.length - 1]!, fr.R, fr.h);
        if (off > COLUMN_PLANARITY_LIMIT_MM) {
            bad.push({ i, u: Number(fr.u.toFixed(4)), off, side });
        }
    }
    if (bad.length) {
        throw new Error(`[S1-COL] off-plane\n${JSON.stringify({ n: bad.length, sample: bad.slice(0, 8) })}`);
    }
    const quality = columnProfileQuality(xyz, frames, exemptAcross);
    console.log(
        "[S1-COL-Q]",
        JSON.stringify({
            maxAlong: Number(quality.maxAlongJointDeg.toFixed(2)),
            maxTcol: Number(quality.maxTcolDeg.toFixed(1)),
            reversals: quality.reversals,
            tColHits: quality.tColBoundHits,
            alongOver: quality.alongOverBudget,
            maxAcross: Number(quality.maxAcrossDeg.toFixed(2)),
            topRound: Number(quality.maxTopRoundDeg.toFixed(2)),
            roundWall: Number(quality.maxRoundWallDeg.toFixed(2)),
            minEdge: Number(quality.minEdgeMm.toFixed(4)),
            gapMult: Number(quality.maxStationGapMult.toFixed(2)),
            minL: Number(quality.minLineMm.toFixed(3)),
            nTopDeg: Number(quality.maxNTopChangeDeg.toFixed(2)),
            r1Pct: Number(quality.maxR1ChangePct.toFixed(2)),
            r2Pct: Number(quality.maxR2ChangePct.toFixed(2)),
        }),
    );
    return {
        xyz,
        impliedSeamDeg: implied,
        planReversals: countColumnPlanReversals(xyz),
        maxFrameAngleDeg: maxTiltStep,
        maxOffPlaneMm: maxOff,
        maxSidewaysMm: maxSide,
        frames,
        flareDeg: frames.map((f) => (f.leanRad * 180) / Math.PI),
        flareCapReport: report,
        minWallClamps,
        quality,
        smoothLog,
    };
}

function signedJointDeg(a: XYZ, b: XYZ, binormal: XYZ): number {
    const ua = unit3(a);
    const ub = unit3(b);
    const cr = cross3(ua, ub);
    const s = Math.atan2(dot3(cr, binormal), dot3(ua, ub));
    return (s * 180) / Math.PI;
}

function reportLeanVsBio(frames: ColumnFrame[], defaults: WallRegionDefaults, _bioFlare: number[]): void {
    const sign = defaults.medialYSign ?? 1;
    const buckets: Record<string, { sum: number; n: number; rec: number; min: number; max: number }> = {
        heel: { sum: 0, n: 0, rec: FLARE_BOUNDS.heelPosterior.recommended, min: 10, max: 35 },
        heelMedial: { sum: 0, n: 0, rec: FLARE_BOUNDS.heelMedial.recommended, min: 10, max: 35 },
        heelLateral: { sum: 0, n: 0, rec: FLARE_BOUNDS.heelLateral.recommended, min: 10, max: 35 },
        medialArch: { sum: 0, n: 0, rec: FLARE_BOUNDS.medialArch.recommended, min: 10, max: 35 },
        lateralMidfoot: { sum: 0, n: 0, rec: FLARE_BOUNDS.lateralMidfoot.recommended, min: 15, max: 50 },
    };
    for (const f of frames) {
        const lean = (f.leanRad * 180) / Math.PI;
        const medial = f.B.y * sign >= 0;
        if (f.u < 0.22) {
            buckets.heel!.sum += lean;
            buckets.heel!.n++;
            if (medial) {
                buckets.heelMedial!.sum += lean;
                buckets.heelMedial!.n++;
            } else {
                buckets.heelLateral!.sum += lean;
                buckets.heelLateral!.n++;
            }
        } else if (f.u < 0.6) {
            if (medial) {
                buckets.medialArch!.sum += lean;
                buckets.medialArch!.n++;
            } else {
                buckets.lateralMidfoot!.sum += lean;
                buckets.lateralMidfoot!.n++;
            }
        }
    }
    const rows = Object.entries(buckets).map(([region, b]) => {
        const mean = b.n ? b.sum / b.n : 0;
        return {
            region,
            n: b.n,
            lean: Number(mean.toFixed(1)),
            bio: b.rec,
            delta: Number((mean - b.rec).toFixed(1)),
            inBound: mean >= b.min && mean <= b.max,
        };
    });
    console.log("[S1-LEAN]", JSON.stringify(rows));
}

/** Keep nJ; slide the last interior away from B so the last row is ≥ 0.15× spacing. */
function ensureLastFilletRowHeight(xyz: XYZ[][], frames: ColumnFrame[], stationSpacing: number): void {
    const minLast = FILLET_LAST_ROW_FRAC * stationSpacing;
    for (let i = 0; i < xyz.length; i++) {
        const col = xyz[i]!;
        const fr = frames[i]!;
        if (col.length < 4) continue;
        const B = col[col.length - 1]!;
        const prev2 = col[col.length - 3]!;
        const span = dist3(prev2, B);
        if (span < minLast + 1e-9) continue;
        if (dist3(col[col.length - 2]!, B) >= minLast) continue;
        const vx = prev2.x - B.x;
        const vy = prev2.y - B.y;
        const vz = prev2.z - B.z;
        const L = Math.hypot(vx, vy, vz) || 1;
        col[col.length - 2] = projectToPlane(
            {
                x: B.x + (vx / L) * minLast,
                y: B.y + (vy / L) * minLast,
                z: B.z + (vz / L) * minLast,
            },
            fr.R,
            fr.h,
        );
    }
}

export function columnProfileQuality(
    xyz: XYZ[][],
    frames: ColumnFrame[],
    exemptAcross: boolean[] = [],
): ColumnQuality {
    let maxAlong = 0;
    let maxTcol = 0;
    let tColHits = 0;
    let reversals = 0;
    let alongOver = 0;
    let maxAcross = 0;
    const acrossAll: number[] = [];
    let maxTopRound = 0;
    let maxRoundWall = 0;
    let minEdge = Infinity;
    let minLine = Infinity;
    let maxNTop = 0;
    let maxR1 = 0;
    let maxR2 = 0;
    let maxHeading = 0;
    let maxToeRatio = 0;
    let minFore = Infinity;
    let maxPack = -Infinity;
    let worstAcross = { i: -1, j: -1, u: -1, wrap: false, deg: 0 };
    const nS = xyz.length;
    const ds: number[] = [];
    for (let i = 0; i < nS; i++) {
        const a = frames[i]!.R;
        const b = frames[(i + 1) % nS]!.R;
        ds.push(dist3(a, b));
    }
    const sorted = ds.slice().sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 1.3;
    const maxGapMult = median > 1e-6 ? Math.max(0, ...ds) / median : 0;
    for (let i = 0; i < nS; i++) {
        const col = xyz[i]!;
        const fr = frames[i]!;
        const bin = unit3({ x: -fr.h.y, y: fr.h.x, z: 0 });
        const joints: number[] = [];
        for (let j = 1; j < col.length - 1; j++) {
            const t0 = {
                x: col[j]!.x - col[j - 1]!.x,
                y: col[j]!.y - col[j - 1]!.y,
                z: col[j]!.z - col[j - 1]!.z,
            };
            const t1 = {
                x: col[j + 1]!.x - col[j]!.x,
                y: col[j + 1]!.y - col[j]!.y,
                z: col[j + 1]!.z - col[j]!.z,
            };
            if (hypot3(t0) < ALONG_JOINT_MIN_EDGE_MM || hypot3(t1) < ALONG_JOINT_MIN_EDGE_MM) continue;
            const deg = signedJointDeg(t0, t1, bin);
            joints.push(deg);
            maxAlong = Math.max(maxAlong, Math.abs(deg));
            if (j === 1) maxTopRound = Math.max(maxTopRound, Math.abs(deg));
            if (fr.roundRows && j === fr.roundRows) {
                maxRoundWall = Math.max(maxRoundWall, Math.abs(deg));
            }
        }
        for (let j = 1; j < col.length; j++) {
            minEdge = Math.min(minEdge, dist3(col[j]!, col[j - 1]!));
        }
        let sign = 0;
        for (const d of joints) {
            if (Math.abs(d) < 8) continue;
            const s = d > 0 ? 1 : -1;
            if (sign === 0) sign = s;
            else if (s !== sign) reversals++;
        }
        const tCol = joints.reduce((s, d) => s + Math.abs(d), 0);
        maxTcol = Math.max(maxTcol, tCol);
        const sheetDeg = fr.sheetSlopeValid ? Math.abs((fr.sheetSlopeRad * 180) / Math.PI) : 0;
        const designedSweep = (Math.abs(fr.roundSweepRad) + Math.abs(fr.filletSweepRad)) * (180 / Math.PI);
        const bound = designedSweep * ALONG_JOINT_BUDGET_FRAC + sheetDeg + T_COL_SLACK_DEG;
        if (tCol > bound + 1e-6) tColHits++;
        const budget = Math.max(
            ALONG_JOINT_MAX_DEG,
            (ALONG_JOINT_BUDGET_FRAC * tCol) / Math.max(1, joints.length),
        );
        for (const d of joints) {
            if (Math.abs(d) > budget + 1e-6) alongOver++;
        }
        minLine = Math.min(minLine, fr.lineLengthMm);
        const nxtFr = frames[(i + 1) % nS]!;
        maxNTop = Math.max(
            maxNTop,
            vecAngleDeg(fr.nTopSmoothed ?? fr.nTop, nxtFr.nTopSmoothed ?? nxtFr.nTop),
        );
        const r1den = Math.max(fr.rTop, 1e-6);
        const r2den = Math.max(fr.rFillet, 1e-6);
        maxR1 = Math.max(maxR1, (Math.abs(nxtFr.rTop - fr.rTop) / r1den) * 100);
        maxR2 = Math.max(maxR2, (Math.abs(nxtFr.rFillet - fr.rFillet) / r2den) * 100);
        const hd = Math.acos(Math.max(-1, Math.min(1, fr.h.x * nxtFr.h.x + fr.h.y * nxtFr.h.y)));
        maxHeading = Math.max(maxHeading, (hd * 180) / Math.PI);
        const minL = fr.heightMm <= SHORT_WALL_H_MM + 1e-9 ? SHORT_MIN_L_MM : MIN_LINE_MM;
        const pack = fr.rTop + fr.rFillet + minL - fr.heightMm;
        maxPack = Math.max(maxPack, pack);
        if (fr.u >= 0.76) {
            minFore = Math.min(minFore, Math.hypot(fr.B.x - fr.R.x, fr.B.y - fr.R.y));
            const ext = Math.max(1e-3, Math.hypot(fr.B.x - fr.R.x, fr.B.y - fr.R.y));
            const gap = Math.hypot(nxtFr.B.x - fr.B.x, nxtFr.B.y - fr.B.y);
            maxToeRatio = Math.max(maxToeRatio, gap / ext);
        }
        if (nS < 2 || !xyz[(i + 1) % nS] || col.length < 2) continue;
        const nxt = xyz[(i + 1) % nS]!;
        const prv = xyz[(i + nS - 1) % nS]!;
        const rows = Math.min(col.length, nxt.length, prv.length);
        for (let j = 0; j < rows - 1; j++) {
            if (j === 0 && (exemptAcross[i] || exemptAcross[(i + 1) % nS])) continue;
            const nL = faceN3(prv[j]!, col[j]!, col[j + 1]!);
            const nR = faceN3(col[j]!, nxt[j]!, col[j + 1]!);
            if (!nL || !nR) continue;
            const raw = vecAngleDeg(nL, nR);
            acrossAll.push(raw);
            if (raw > maxAcross) {
                maxAcross = raw;
                worstAcross = {
                    i,
                    j,
                    u: Number(fr.u.toFixed(4)),
                    wrap: i === nS - 1,
                    deg: Number(raw.toFixed(2)),
                };
            }
        }
    }
    acrossAll.sort((a, b) => a - b);
    const p99Idx = acrossAll.length
        ? Math.max(0, Math.min(acrossAll.length - 1, Math.ceil(0.99 * acrossAll.length) - 1))
        : 0;
    const maxAcrossP99 = acrossAll[p99Idx] ?? 0;
    console.log("[S1-ACROSS]", JSON.stringify({ ...worstAcross, p99: Number(maxAcrossP99.toFixed(2)) }));
    return {
        maxAlongJointDeg: maxAlong,
        maxTcolDeg: maxTcol,
        tColBoundHits: tColHits,
        reversals,
        alongOverBudget: alongOver,
        maxAcrossDeg: maxAcross,
        maxAcrossP99Deg: maxAcrossP99,
        maxTopRoundDeg: maxTopRound,
        maxRoundWallDeg: maxRoundWall,
        minEdgeMm: Number.isFinite(minEdge) ? minEdge : 0,
        maxStationGapMult: maxGapMult,
        minLineMm: Number.isFinite(minLine) ? minLine : 0,
        maxNTopChangeDeg: maxNTop,
        maxR1ChangePct: maxR1,
        maxR2ChangePct: maxR2,
        maxHeadingChangeDeg: maxHeading,
        maxToeSpacingRatio: maxToeRatio,
        minForefootInsetMm: Number.isFinite(minFore) ? minFore : 0,
        maxAlaPackMm: Number.isFinite(maxPack) ? maxPack : 0,
    };
}

function faceN3(a: XYZ, b: XYZ, c: XYZ): XYZ | null {
    const n = cross3(
        { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
        { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z },
    );
    const l = hypot3(n);
    if (l < 1e-12) return null;
    return { x: n.x / l, y: n.y / l, z: n.z / l };
}

export function clampFramesMinWall(
    frames: ColumnFrame[],
    topZ: (x: number, y: number) => number | null,
    minWallMm: number,
): MinWallClamp[] {
    const clamps: MinWallClamp[] = [];
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const top = topZ(fr.R.x, fr.R.y) ?? fr.R.z;
        const maxF = top - minWallMm;
        if (fr.F.z <= maxF + 1e-9) continue;
        const drop = fr.F.z - maxF;
        fr.B.z -= drop;
        fr.heightMm = Math.max(fr.R.z - fr.B.z, 0.5);
        const planLen = Math.hypot(fr.R.x - fr.B.x, fr.R.y - fr.B.y);
        fr.rFillet = Math.min(fr.rFillet, filletRadiusMm(fr.heightMm, planLen, Math.PI / 2));
        applyAlaToFrame(fr);
        if (fr.F.z > maxF) {
            fr.B.z -= fr.F.z - maxF;
            fr.heightMm = Math.max(fr.R.z - fr.B.z, 0.5);
            fr.rFillet = Math.min(fr.rFillet, filletRadiusMm(fr.heightMm, planLen, Math.PI / 2));
            applyAlaToFrame(fr);
        }
        clamps.push({ station: i, u: fr.u, droppedMm: drop });
    }
    if (clamps.length) {
        console.log("[S1-MIN-WALL]", JSON.stringify({ n: clamps.length, sample: clamps.slice(0, 8) }));
    }
    return clamps;
}

export const U_BANDS = [
    { id: "heel", min: 0, max: 0.22 },
    { id: "arch", min: 0.22, max: 0.55 },
    { id: "midfoot", min: 0.55, max: 0.78 },
    { id: "forefoot", min: 0.78, max: 1.01 },
] as const;

export interface WallBandRow {
    band: string;
    hits: number;
    meanOverhangMm: number;
    maxOverhangMm: number;
    meanHeightMm: number;
    meanOverhangOverHeight: number;
}

export function summarizeWallBands(
    hitUs: number[],
    frames: Array<{ u: number; overhangMm: number; heightMm: number }>,
): WallBandRow[] {
    return U_BANDS.map((band) => {
        const hits = hitUs.filter((u) => u >= band.min && u < band.max).length;
        const sts = frames.filter((f) => f.u >= band.min && f.u < band.max);
        const n = Math.max(1, sts.length);
        const meanOverhangMm = sts.reduce((s, f) => s + f.overhangMm, 0) / n;
        const maxOverhangMm = sts.reduce((s, f) => Math.max(s, f.overhangMm), -Infinity);
        const meanHeightMm = sts.reduce((s, f) => s + f.heightMm, 0) / n;
        return {
            band: band.id,
            hits,
            meanOverhangMm,
            maxOverhangMm: Number.isFinite(maxOverhangMm) ? maxOverhangMm : 0,
            meanHeightMm,
            meanOverhangOverHeight: meanHeightMm > 1e-6 ? meanOverhangMm / meanHeightMm : 0,
        };
    });
}
