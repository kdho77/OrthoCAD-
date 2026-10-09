// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";
import { blendedFlareDeg, type WallRegionDefaults } from "./defaults";
import {
    FILLET_MAX_HEIGHT_FRAC,
    filletImpliedSeamDeg,
    MIN_FILLET_RING_SPACING_MM,
    MIN_FILLET_RINGS,
} from "./hermite";
import { countColumnPlanReversals, type HermiteStation, MIN_REAL_BOTTOM_FILLET_MM } from "./loft";
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
export const TOP_CLEARANCE_DEG = 5;

export interface XYZ {
    x: number;
    y: number;
    z: number;
}

export interface ColumnFrame {
    R: PolyPoint;
    B: PolyPoint;
    F: PolyPoint;
    T0: XYZ;
    U: XYZ;
    a: number;
    b: number;
    rFillet: number;
    u: number;
    /** Rim plan offset beyond the outline (mm). Positive = overhang. */
    overhangMm: number;
    heightMm: number;
}

export interface BezierColumns {
    xyz: PolyPoint[][];
    impliedSeamDeg: number[];
    planReversals: number;
    maxFrameAngleDeg: number;
    frames: ColumnFrame[];
    flareDeg: number[];
    flareCapReport: ReturnType<typeof smoothAndCapFlare>["report"];
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

function angleDeg(a: XYZ, b: XYZ): number {
    const ua = unit3(a);
    const ub = unit3(b);
    return (Math.acos(Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y + ua.z * ub.z))) * 180) / Math.PI;
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

function rotateDown(outward: { x: number; y: number }, tiltRad: number): XYZ {
    const c = Math.cos(tiltRad);
    const s = Math.sin(tiltRad);
    return unit3({ x: outward.x * c, y: outward.y * c, z: -s });
}

function tiltT0Down(T0: XYZ, extraDeg: number): XYZ {
    const horiz = Math.hypot(T0.x, T0.y);
    const cur = Math.atan2(-T0.z, Math.max(horiz, 1e-9));
    const next = Math.min(Math.PI * 0.48, cur + (extraDeg * Math.PI) / 180);
    const ox = horiz > 1e-9 ? T0.x / horiz : 1;
    const oy = horiz > 1e-9 ? T0.y / horiz : 0;
    return rotateDown({ x: ox, y: oy }, next);
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

function sampleFilletFB(F: XYZ, B: XYZ, nInterior: number): XYZ[] {
    const C = { x: B.x, y: B.y, z: F.z };
    const rings: XYZ[] = [];
    const count = Math.max(MIN_FILLET_RINGS, nInterior);
    for (let i = 1; i <= count; i++) {
        const phi = ((Math.PI / 2) * i) / (count + 1);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        rings.push({
            x: C.x + (F.x - C.x) * c + (B.x - C.x) * s,
            y: C.y + (F.y - C.y) * c + (B.y - C.y) * s,
            z: C.z + (F.z - C.z) * c + (B.z - C.z) * s,
        });
    }
    return rings;
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

function columnPoints(fr: ColumnFrame, nWall: number): XYZ[] {
    const P0 = fr.R;
    const P3 = fr.F;
    const P1 = add3(P0, fr.T0, fr.a);
    const P2 = add3(P3, fr.U, fr.b);
    const dense: XYZ[] = [];
    for (let k = 0; k <= 32; k++) dense.push(evalCubicBezier(P0, P1, P2, P3, k / 32));
    const nFil = MIN_FILLET_RINGS;
    const nBez = Math.max(4, nWall - 2 - nFil);
    const bez = sampleByArcLength(dense, nBez + 1);
    const fil = sampleFilletFB(fr.F, fr.B, nFil);
    const col = [...bez, ...fil, { ...fr.B }];
    if (col.length === nWall) return col;
    return sampleByArcLength(col, nWall);
}

function smoothScalars(vals: number[], passes: number): number[] {
    let cur = vals.slice();
    const n = cur.length;
    for (let p = 0; p < passes; p++) {
        cur = cur.map((v, i) => 0.5 * v + 0.25 * cur[(i + n - 1) % n]! + 0.25 * cur[(i + 1) % n]!);
    }
    return cur;
}

function smoothUnits(vs: XYZ[], passes: number): XYZ[] {
    let cur = vs.map((v) => unit3(v));
    const n = cur.length;
    for (let p = 0; p < passes; p++) {
        cur = cur.map((v, i) =>
            unit3({
                x: v.x * 0.5 + (cur[(i + n - 1) % n]!.x + cur[(i + 1) % n]!.x) * 0.25,
                y: v.y * 0.5 + (cur[(i + n - 1) % n]!.y + cur[(i + 1) % n]!.y) * 0.25,
                z: v.z * 0.5 + (cur[(i + n - 1) % n]!.z + cur[(i + 1) % n]!.z) * 0.25,
            }),
        );
    }
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (angleDeg(cur[i]!, cur[j]!) <= FRAME_ANGLE_LIMIT_DEG) continue;
        const m = unit3(add3(cur[i]!, cur[j]!));
        cur[i] = unit3(add3(cur[i]!, m));
        cur[j] = unit3(add3(cur[j]!, m));
    }
    return cur.map(unit3);
}

function clampAdjacentAngles(vs: XYZ[], preferDown: boolean): XYZ[] {
    const cur = vs.map(unit3);
    const n = cur.length;
    for (let pass = 0; pass < 20; pass++) {
        let dirty = false;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            if (angleDeg(cur[i]!, cur[j]!) <= FRAME_ANGLE_LIMIT_DEG) continue;
            dirty = true;
            const m = unit3(add3(cur[i]!, cur[j]!));
            cur[i] = unit3(add3(cur[i]!, m));
            cur[j] = unit3(add3(cur[j]!, m));
        }
        if (!dirty) break;
    }
    return cur.map((v) => {
        if (preferDown && v.z > 0) return unit3({ x: v.x, y: v.y, z: -Math.abs(v.z) });
        if (!preferDown && v.z < 0) return unit3({ x: v.x, y: v.y, z: Math.abs(v.z) });
        return unit3(v);
    });
}

function maxAdjacentAngle(vs: XYZ[]): number {
    let max = 0;
    for (let i = 0; i < vs.length; i++) {
        max = Math.max(max, angleDeg(vs[i]!, vs[(i + 1) % vs.length]!));
    }
    return max;
}

export function initColumnFrames(
    stations: HermiteStation[],
    junctions: ColumnJunction[],
    defaults: WallRegionDefaults,
    flareDeg: number[],
): ColumnFrame[] {
    const outline = stations.map((s) => s.outline);
    return stations.map((st, i) => {
        const R = { ...st.rim };
        const B = { ...st.outline };
        const height = Math.max(R.z - B.z, 0.5);
        const rFillet = Math.min(
            FILLET_MAX_HEIGHT_FRAC * height,
            Math.max(defaults.wallFilletBottomMm, MIN_REAL_BOTTOM_FILLET_MM),
        );
        const toR = { x: R.x - B.x, y: R.y - B.y };
        const toRLen = Math.hypot(toR.x, toR.y);
        const tx = toRLen > 1e-6 ? toR.x / toRLen : -(st.n.x || 1);
        const ty = toRLen > 1e-6 ? toR.y / toRLen : -(st.n.y || 0);
        const r = Math.min(rFillet, Math.max(0.4, toRLen * 0.35));
        const F = { x: B.x + tx * r, y: B.y + ty * r, z: B.z + r };
        const junct = junctions[i]!;
        const tilt = Math.max(junct.slopeRad + (TOP_CLEARANCE_DEG * Math.PI) / 180, (5 * Math.PI) / 180);
        const T0 = rotateDown(st.n, tilt);
        const flare = ((flareDeg[i] ?? 0) * Math.PI) / 180;
        const U = unit3({
            x: tx * Math.sin(Math.abs(flare)),
            y: ty * Math.sin(Math.abs(flare)),
            z: Math.cos(Math.abs(flare)),
        });
        const rf = dist3(R, F);
        const handle = Math.min(BEZIER_HANDLE_FRAC * rf, HANDLE_CHORD_CAP * rf);
        return {
            R,
            B,
            F,
            T0,
            U: U.z < 0 ? { x: U.x, y: U.y, z: -U.z } : U,
            a: handle,
            b: handle,
            rFillet: r,
            u: st.u,
            overhangMm: rimOverhangMm(R, outline),
            heightMm: height,
        };
    });
}

/** Keep P2 from going outboard of R along R→B (plan). */
function clampHandleInboard(fr: ColumnFrame): void {
    const dx = fr.B.x - fr.R.x;
    const dy = fr.B.y - fr.R.y;
    const den = fr.U.x * dx + fr.U.y * dy;
    if (den >= -1e-9) return;
    const num = (fr.F.x - fr.R.x) * dx + (fr.F.y - fr.R.y) * dy;
    const maxB = Math.max(0, -num / den);
    fr.b = Math.min(fr.b, maxB);
}

function applySmooth(frames: ColumnFrame[], passes: number): void {
    const T0 = clampAdjacentAngles(
        smoothUnits(
            frames.map((f) => f.T0),
            passes,
        ),
        true,
    );
    const U = clampAdjacentAngles(
        smoothUnits(
            frames.map((f) => f.U),
            passes,
        ),
        false,
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
        fr.T0 = T0[i]!.z > 0 ? tiltT0Down(T0[i]!, 8) : unit3(T0[i]!);
        fr.U = U[i]!.z < 0 ? unit3({ x: U[i]!.x, y: U[i]!.y, z: Math.abs(U[i]!.z) }) : unit3(U[i]!);
        const cap = HANDLE_CHORD_CAP * dist3(fr.R, fr.F);
        fr.a = Math.min(cap, Math.max(0, a[i]!));
        fr.b = Math.min(cap, Math.max(0, b[i]!));
        clampHandleInboard(fr);
    }
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
                fr.T0 = tiltT0Down(fr.T0, 3);
                dirty = true;
            }
        }
        if (!dirty) break;
        applySmooth(frames, 3);
    }
}

/**
 * Pairing-outward Bezier columns R→F plus fillet F→B. R and B never move.
 */
export function buildBezierColumns(
    stations: HermiteStation[],
    junctions: ColumnJunction[],
    defaults: WallRegionDefaults,
    rimLoop: PolyPoint[],
    topZ: (x: number, y: number) => number | null,
    nWall: number,
): BezierColumns {
    const regionDefault = stations.map((st) => blendedFlareDeg(st.u, st.outline.y, defaults.flareDeg));
    const { flare, report } = smoothAndCapFlare(
        stations.map((s) => s.outline),
        regionDefault,
    );
    const frames = initColumnFrames(stations, junctions, defaults, flare);
    applySmooth(frames, FRAME_SMOOTH_ITERS);
    guardFrames(frames, junctions, rimLoop, topZ, nWall);
    const T0 = clampAdjacentAngles(
        frames.map((f) => f.T0),
        true,
    );
    const U = clampAdjacentAngles(
        frames.map((f) => f.U),
        false,
    );
    for (let i = 0; i < frames.length; i++) {
        frames[i]!.T0 = T0[i]!;
        frames[i]!.U = U[i]!;
    }
    for (let round = 0; round < 20; round++) {
        let dirty = false;
        for (const fr of frames) {
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
    for (let i = 0; i < frames.length; i++) {
        const fr = frames[i]!;
        const col = columnPoints(fr, nWall);
        col[0] = { ...fr.R };
        col[col.length - 1] = { ...fr.B };
        xyz.push(col);
        const first = col[1] ?? fr.F;
        implied.push(
            filletImpliedSeamDeg(
                { n: Math.hypot(fr.T0.x, fr.T0.y), z: fr.T0.z },
                { n: Math.hypot(first.x - fr.R.x, first.y - fr.R.y), z: first.z - fr.R.z },
            ),
        );
    }
    return {
        xyz,
        impliedSeamDeg: implied,
        planReversals: countColumnPlanReversals(xyz),
        maxFrameAngleDeg: Math.max(
            maxAdjacentAngle(frames.map((f) => f.T0)),
            maxAdjacentAngle(frames.map((f) => f.U)),
        ),
        frames,
        flareDeg: flare,
        flareCapReport: report,
    };
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
