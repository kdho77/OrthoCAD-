// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";
import { blendedFlareDeg, type WallRegionDefaults } from "./defaults";
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
}

export interface MinWallClamp {
    station: number;
    u: number;
    droppedMm: number;
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

export function filletRowCount(psiRad: number): number {
    const deg = Math.abs((psiRad * 180) / Math.PI);
    return Math.max(MIN_FILLET_RINGS, Math.ceil(deg / FILLET_MAX_STEP_DEG));
}

export function topRoundRowCount(sweepRad: number): number {
    const deg = Math.abs((sweepRad * 180) / Math.PI);
    return Math.max(TOP_ROUND_MIN_ROWS, Math.ceil(deg / TOP_ROUND_MAX_STEP_DEG));
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

function hzPoint(R: XYZ, h: { x: number; y: number }, sh: number, sz: number): XYZ {
    return { x: R.x + h.x * sh, y: R.y + h.y * sh, z: R.z + sz };
}

export function sampleTopRound(fr: ColumnFrame, nRows: number): { W: XYZ; pts: XYZ[] } {
    applyTilts(fr);
    const r = Math.max(fr.rTop, 1e-6);
    const alpha = fr.sheetSlopeValid ? fr.sheetSlopeRad : 0;
    const theta = Math.min(fr.t0TiltRad, alpha - (TOP_CLEARANCE_DEG * Math.PI) / 180);
    const Ch = r * Math.sin(alpha);
    const Cz = -r * Math.cos(alpha);
    const Wh = Ch - r * Math.sin(theta);
    const Wz = Cz + r * Math.cos(theta);
    const planLen = Math.hypot(fr.B.x - fr.R.x, fr.B.y - fr.R.y);
    const sF = (fr.F.x - fr.R.x) * fr.h.x + (fr.F.y - fr.R.y) * fr.h.y;
    const sW = Math.max(0, Math.min(Wh, planLen, Math.max(0, sF - 0.05)));
    const zW = Math.min(fr.R.z + Wz, fr.R.z - 0.05);
    if (zW <= fr.F.z + 0.1) {
        return { W: { ...fr.R }, pts: [] };
    }
    const W = projectToPlane(hzPoint(fr.R, fr.h, sW, zW - fr.R.z), fr.R, fr.h);
    const start = Math.atan2(Math.cos(alpha), -Math.sin(alpha));
    let end = Math.atan2(Math.cos(theta), -Math.sin(theta));
    const twoPi = Math.PI * 2;
    while (end > start) end -= twoPi;
    const count = Math.max(TOP_ROUND_MIN_ROWS, nRows);
    const pts: XYZ[] = [];
    for (let i = 1; i <= count; i++) {
        const phi = start + ((end - start) * i) / count;
        pts.push(
            projectToPlane(hzPoint(fr.R, fr.h, Ch + r * Math.cos(phi), Cz + r * Math.sin(phi)), fr.R, fr.h),
        );
    }
    if (pts.length) pts[pts.length - 1] = { ...W };
    return { W, pts };
}

export function t0LeadQ(fr: ColumnFrame): XYZ {
    const { W, pts } = sampleTopRound(fr, topRoundRowCount(Math.abs(fr.t0TiltRad - fr.sheetSlopeRad)));
    return pts.length ? W : { ...fr.R };
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

function clampPointToInward(p: XYZ, fr: ColumnFrame, maxS: number): XYZ {
    const s = planS(p, fr.R, fr.h);
    if (s <= maxS) return projectToPlane(p, fr.R, fr.h);
    return projectToPlane({ x: fr.R.x + fr.h.x * maxS, y: fr.R.y + fr.h.y * maxS, z: p.z }, fr.R, fr.h);
}

function columnPoints(fr: ColumnFrame, nWall: number): XYZ[] {
    applyTilts(fr);
    const sweep = Math.abs(fr.t0TiltRad - (fr.sheetSlopeValid ? fr.sheetSlopeRad : 0));
    const nTop = topRoundRowCount(sweep);
    const fil = constructFillet(fr.B, fr.h, fr.rFillet, fr.U, fr.plantarSlopeRad);
    const nFil = filletRowCount(fil.psi);
    const top = sampleTopRound(fr, nTop);
    const P0 = top.pts.length ? top.W : fr.R;
    const P3 = fr.F;
    const P1 = add3(P0, fr.T0, fr.a);
    const P2 = add3(P3, fr.U, fr.b);
    const planLen = Math.hypot(fr.B.x - fr.R.x, fr.B.y - fr.R.y);
    const maxS = planLen + fr.tFillet + INWARD_SLACK_MM;
    const dense: XYZ[] = [];
    for (let k = 0; k <= 32; k++) {
        dense.push(clampPointToInward(evalCubicBezier(P0, P1, P2, P3, k / 32), fr, maxS));
    }
    const nBezInc = Math.max(2, nWall - 2 - top.pts.length - nFil);
    const bez = sampleByArcLength(dense, nBezInc).map((p) => clampPointToInward(p, fr, maxS));
    const bot = sampleFilletEqualPhi(fr, nFil).map((p) => clampPointToInward(p, fr, maxS));
    const col = top.pts.length
        ? [{ ...fr.R }, ...top.pts, ...bez, ...bot, { ...fr.B }]
        : [...bez, ...bot, { ...fr.B }];
    const raw = col.length === nWall ? col : sampleByArcLength(col, nWall);
    const out = raw.map((p, i) => {
        if (i === 0) return { ...fr.R };
        if (i === raw.length - 1) return { ...fr.B };
        return clampPointToInward(p, fr, maxS);
    });
    snapPlanMonotone(out, fr.R, fr.B);
    return out;
}

function snapPlanMonotone(pts: XYZ[], R: XYZ, B: XYZ): void {
    const dx = B.x - R.x;
    const dy = B.y - R.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-6) return;
    const hx = dx / chord;
    const hy = dy / chord;
    let prevS = 0;
    for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i]!;
        const s = (p.x - R.x) * hx + (p.y - R.y) * hy;
        if (s < prevS) {
            p.x = R.x + hx * prevS;
            p.y = R.y + hy * prevS;
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

export function t0TargetRad(sheetSlopeRad: number, shortChord: boolean, valid: boolean): number {
    if (shortChord) return t0FromSheetSlope(sheetSlopeRad, true);
    if (!valid) return (T0_PIN_DEG * Math.PI) / 180;
    return t0FromSheetSlope(sheetSlopeRad, false);
}

function pinT0(frames: ColumnFrame[]): void {
    for (const fr of frames) {
        const target = t0TargetRad(fr.sheetSlopeRad, fr.shortChord, fr.sheetSlopeValid);
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
 * T0 is the rim-row start tangent only: min(sheet_h − 10°, −45°).
 * Later Bezier samples lay the wall out toward B. Long medial-arch
 * overhang is intended and is not a failure. Short chords stay nearly vertical.
 */
export function t0FromSheetSlope(sheetSlopeRad: number, shortChord: boolean): number {
    const clear = (TOP_CLEARANCE_DEG * Math.PI) / 180;
    const pin = (T0_PIN_DEG * Math.PI) / 180;
    if (shortChord) return -Math.PI / 2 + clear;
    return Math.min(sheetSlopeRad - clear, pin);
}

export function assertT0ClearsSheet(frames: ColumnFrame[]): void {
    const clear = (TOP_CLEARANCE_DEG * Math.PI) / 180;
    const rows: Array<{ u: number; sheet_h: number; T0: number; limit: number }> = [];
    const bad: Array<{ u: number; sheet_h: number; T0: number; limit: number }> = [];
    for (const f of frames) {
        if (f.shortChord || !f.sheetSlopeValid) continue;
        const row = {
            u: Number(f.u.toFixed(4)),
            sheet_h: Number(((f.sheetSlopeRad * 180) / Math.PI).toFixed(3)),
            T0: Number(((f.t0TiltRad * 180) / Math.PI).toFixed(3)),
            limit: Number((((f.sheetSlopeRad - clear) * 180) / Math.PI).toFixed(3)),
        };
        rows.push(row);
        if (f.t0TiltRad > f.sheetSlopeRad - clear + 1e-5) bad.push(row);
    }
    console.log("[S1-T0]", JSON.stringify({ n: rows.length, bad: bad.length, sample: rows.slice(0, 8) }));
    if (bad.length) {
        throw new Error(
            `[S1-T0] T0 must be <= sheet_h - ${TOP_CLEARANCE_DEG}deg at every station.\n` +
                JSON.stringify(bad.slice(0, 12), null, 2),
        );
    }
}

function columnHeading(st: HermiteStation): {
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

export function smoothFilletRadii(frames: ColumnFrame[], frac = R_SMOOTH_FRAC): void {
    const n = frames.length;
    if (n < 3) return;
    for (let pass = 0; pass < 8; pass++) {
        const next = frames.map((f) => f.rFillet);
        for (let i = 0; i < n; i++) {
            const a = frames[(i + n - 1) % n]!.rFillet;
            const b = frames[i]!.rFillet;
            const c = frames[(i + 1) % n]!.rFillet;
            const blended = 0.5 * b + 0.25 * a + 0.25 * c;
            const lo = b * (1 - frac);
            const hi = b * (1 + frac);
            next[i] = Math.min(hi, Math.max(lo, blended));
        }
        for (let i = 0; i < n; i++) frames[i]!.rFillet = Math.max(0.05, next[i]!);
    }
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
    const planLen = Math.hypot(fr.B.x - fr.R.x, fr.B.y - fr.R.y);
    const chord = Math.max(dist3(W, fr.F), 1e-6);
    fr.a = Math.min(fr.a, HANDLE_CHORD_CAP * chord);
    fr.b = Math.min(fr.b, HANDLE_CHORD_CAP * chord);
    const t0h = fr.T0.x * fr.h.x + fr.T0.y * fr.h.y;
    const sW = planS(W, fr.R, fr.h);
    if (t0h > 1e-9) fr.a = Math.min(fr.a, Math.max(0, (planLen - sW) / t0h));
    if (t0h < -1e-9) fr.a = Math.min(fr.a, Math.max(0, (0 - sW) / t0h));
    const uh = fr.U.x * fr.h.x + fr.U.y * fr.h.y;
    const sF = planS(fr.F, fr.R, fr.h);
    if (uh > 1e-9) fr.b = Math.min(fr.b, Math.max(0, (planLen - sF) / uh));
    if (uh < -1e-9) fr.b = Math.min(fr.b, Math.max(0, (0 - sF) / uh));
    fr.a = Math.max(0, fr.a);
    fr.b = Math.max(0, fr.b);
}

function setHandlesFromQF(fr: ColumnFrame): void {
    const Q = t0LeadQ(fr);
    const rf = dist3(Q, fr.F);
    const handle = Math.min(BEZIER_HANDLE_FRAC * rf, HANDLE_CHORD_CAP * rf);
    fr.a = handle;
    fr.b = handle;
    applyTilts(fr);
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
    const frames = stations.map((st, i) => {
        const R = { ...st.rim };
        const B = { ...st.outline };
        const { h, shortChord, planLen } = columnHeading(st);
        const height = Math.max(R.z - B.z, 0.5);
        const sampled = sampleInPlaneSlope(R, h, topZ, _junctions[i]?.planeN);
        const sheetSlopeRad = sampled.valid ? sampled.slopeRad : 0;
        const t0TiltRad = t0TargetRad(sheetSlopeRad, shortChord, sampled.valid);
        const flare = clampFilletB(((flareDeg[i] ?? 0) * Math.PI) / 180);
        const plantar = plantarSlopeRad[i] ?? 0;
        const psi = Math.PI / 2 - flare;
        const r = filletRadiusMm(height, planLen, psi);
        const fr: ColumnFrame = {
            R,
            B,
            F: { x: B.x, y: B.y, z: B.z + r },
            h,
            T0: t0FromTilt(h, t0TiltRad),
            U: filletDir(flare, plantarFrameAt(h, plantar)),
            a: 0,
            b: 0,
            t0TiltRad,
            uTiltRad: flare,
            sheetSlopeRad,
            sheetSlopeValid: sampled.valid,
            plantarSlopeRad: plantar,
            rFillet: r,
            rTop: Math.min(FILLET_R_CAP_MM, Math.max(0, _defaults.wallFilletTopMm || 0.5)),
            tFillet: 0,
            u: st.u,
            shortChord,
            overhangMm: rimOverhangMm(R, outline),
            heightMm: height,
            bandZ: B.z,
            bandInsetMm: estimateBandInsetMm(r, Math.PI / 2),
            arcEndZ: B.z,
        };
        return fr;
    });
    smoothFilletRadii(frames);
    for (const fr of frames) {
        placeFilletF(fr);
        setHandlesFromQF(fr);
    }
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

function applySmooth(frames: ColumnFrame[], passes: number): void {
    const targets = frames.map((f) => t0TargetRad(f.sheetSlopeRad, f.shortChord, f.sheetSlopeValid));
    const excess = frames.map((f, i) => f.t0TiltRad - targets[i]!);
    const sm = smoothScalarsMasked(
        excess,
        frames.map((f) => f.sheetSlopeValid),
        passes,
    );
    const ut = smoothScalars(
        frames.map((f) => f.uTiltRad),
        passes,
    );
    const a = smoothScalars(
        frames.map((f) => f.a),
        passes,
    );
    const b = smoothScalars(
        frames.map((f) => f.b),
        passes,
    );
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        if (fr.sheetSlopeValid) fr.t0TiltRad = targets[i]! + Math.min(0, sm[i]!);
        else fr.t0TiltRad = targets[i]!;
        fr.uTiltRad = ut[i]!;
        const cap = HANDLE_CHORD_CAP * dist3(t0LeadQ(fr), fr.F);
        fr.a = Math.min(cap, Math.max(0, a[i]!));
        fr.b = Math.min(cap, Math.max(0, b[i]!));
        clampHandleInboard(fr);
        clampHandlesToChord(fr);
    }
    pinT0(frames);
    for (const fr of frames) clampHandleInboard(fr);
}

function guardFrames(
    frames: ColumnFrame[],
    junctions: ColumnJunction[],
    rimLoop: PolyPoint[],
    topZ: (x: number, y: number) => number | null,
    nWall: number,
): void {
    for (let round = 0; round < 16; round++) {
        let dirty = false;
        for (let i = 0; i < frames.length; i++) {
            const fr = frames[i]!;
            applyTilts(fr);
            const pts = columnPoints(fr, nWall);
            if (!planMonotone(pts, fr.R, fr.B)) {
                fr.a = Math.max(0, fr.a * 0.7);
                if (fr.a < 0.05) fr.b = Math.max(0, fr.b * 0.7);
                clampHandleInboard(fr);
                dirty = true;
            }
            const junct = junctions[i]!;
            let inside = false;
            for (let j = 1; j < pts.length - 1; j++) {
                if (rowInsideTop(pts[j]!, fr.R, junct.planeN, rimLoop, topZ)) {
                    inside = true;
                    break;
                }
            }
            if (inside) {
                fr.a = Math.max(0, fr.a * 0.7);
                fr.t0TiltRad = Math.max(-Math.PI * 0.48, fr.t0TiltRad - (3 * Math.PI) / 180);
                applyTilts(fr);
                clampHandlesToChord(fr);
                dirty = true;
            }
        }
        if (!dirty) break;
        applySmooth(frames, 3);
    }
}

/**
 * Planar Bezier columns: each station stays in the vertical plane through R and B.
 * R and B never move. Vector-frame smoothing is not used.
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
): BezierColumns {
    const regionDefault = stations.map((st) => blendedFlareDeg(st.u, st.outline.y, defaults.flareDeg));
    const { flare, report } = smoothAndCapFlare(
        stations.map((s) => s.outline),
        regionDefault,
    );
    const frames = initColumnFrames(stations, junctions, defaults, flare, topZ, plantarSlopeRad);
    let nNeed = nWall;
    for (const fr of frames) {
        applyTilts(fr);
        const sweep = Math.abs(fr.t0TiltRad - (fr.sheetSlopeValid ? fr.sheetSlopeRad : 0));
        const fil = constructFillet(fr.B, fr.h, fr.rFillet, fr.U, fr.plantarSlopeRad);
        nNeed = Math.max(nNeed, 2 + topRoundRowCount(sweep) + 4 + filletRowCount(fil.psi));
    }
    nWall = nNeed;
    const minWallClamps = clampFramesMinWall(frames, topZ, minWallMm);
    applySmooth(frames, FRAME_SMOOTH_ITERS);
    for (const fr of frames) placeFilletF(fr);
    guardFrames(frames, junctions, rimLoop, topZ, nWall);
    for (const fr of frames) placeFilletF(fr);
    for (let round = 0; round < 20; round++) {
        let dirty = false;
        for (const fr of frames) {
            applyTilts(fr);
            if (planMonotone(columnPoints(fr, nWall), fr.R, fr.B)) continue;
            fr.a = Math.max(0, fr.a * 0.5);
            fr.b = Math.max(0, fr.b * 0.5);
            clampHandleInboard(fr);
            dirty = true;
        }
        if (!dirty) break;
    }
    const xyz: PolyPoint[][] = [];
    const implied: number[] = [];
    let maxOff = 0;
    let maxTiltStep = 0;
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        applyTilts(fr);
        const col = columnPoints(fr, nWall);
        col[0] = { ...fr.R };
        col[col.length - 1] = { ...fr.B };
        fr.arcEndZ = col[col.length - 2]?.z ?? fr.B.z;
        for (const p of col) maxOff = Math.max(maxOff, offPlaneMm(p, fr.R, fr.h));
        xyz.push(col);
        const first = col[1] ?? fr.F;
        implied.push(
            filletImpliedSeamDeg(
                { n: Math.hypot(fr.T0.x, fr.T0.y), z: fr.T0.z },
                { n: Math.hypot(first.x - fr.R.x, first.y - fr.R.y), z: first.z - fr.R.z },
            ),
        );
        const nxt = frames[(i + 1) % frames.length]!;
        maxTiltStep = Math.max(maxTiltStep, (Math.abs(nxt.t0TiltRad - fr.t0TiltRad) * 180) / Math.PI);
    }
    pinT0(frames);
    assertT0ClearsSheet(frames);
    const bad: Array<{ i: number; u: number; off: number; side: number }> = [];
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        applyTilts(fr);
        assertFilletStation(
            constructFillet(fr.B, fr.h, fr.rFillet, fr.U, fr.plantarSlopeRad),
            ` i=${i} u=${fr.u.toFixed(3)}`,
        );
        const col = xyz[i]!;
        let off = 0;
        for (const p of col) off = Math.max(off, offPlaneMm(p, fr.R, fr.h));
        if (off > COLUMN_PLANARITY_LIMIT_MM || off > SIDEWAYS_LIMIT_MM) {
            bad.push({ i, u: Number(fr.u.toFixed(4)), off, side: off });
        }
    }
    if (bad.length) {
        throw new Error(
            `[S1-COL] off-plane/sideways\n${JSON.stringify({ n: bad.length, sample: bad.slice(0, 8) })}`,
        );
    }
    return {
        xyz,
        impliedSeamDeg: implied,
        planReversals: countColumnPlanReversals(xyz),
        maxFrameAngleDeg: maxTiltStep,
        maxOffPlaneMm: maxOff,
        maxSidewaysMm: maxOff,
        frames,
        flareDeg: flare,
        flareCapReport: report,
        minWallClamps,
    };
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
        fr.rFillet = filletRadiusMm(fr.heightMm, planLen, Math.PI / 2 - clampFilletB(fr.uTiltRad));
        placeFilletF(fr);
        if (fr.F.z > maxF) {
            fr.B.z -= fr.F.z - maxF;
            fr.heightMm = Math.max(fr.R.z - fr.B.z, 0.5);
            fr.rFillet = filletRadiusMm(fr.heightMm, planLen, Math.PI / 2 - clampFilletB(fr.uTiltRad));
            placeFilletF(fr);
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
