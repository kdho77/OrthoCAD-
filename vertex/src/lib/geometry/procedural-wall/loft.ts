// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";
import {
    blendedFlareCurvature,
    blendedFlareDeg,
    heelBowlMix,
    lateralFlangeEnvelope,
    type WallRegionDefaults,
    wallHeightScale,
} from "./defaults";
import {
    adjacentStationsCross,
    assertNoStationSelfIntersection,
    clusteredWallT,
    evalWallProfile,
    FILLET_MAX_HEIGHT_FRAC,
    filletImpliedSeamDeg,
    MIN_FILLET_RINGS,
    type NZ,
    sampleFilletArc,
    unitNZ,
    wallDirectionNZ,
} from "./hermite";
import { outwardNormal } from "./measure";
import {
    CROSSING_WINDOW,
    countPlanViewChordCrossings,
    type FlareCapReport,
    segmentsCrossXY,
    smoothAndCapFlare,
} from "./stations";

export interface LoftGrid {
    nS: number;
    nT: number;
    /** Packed xyz, row-major t then s: index = (ti * nS + si) * 3 */
    positions: Float32Array;
    flareDeg?: number[];
    flareCapReport?: FlareCapReport;
    chordCrossings?: number;
    windowCrossings?: number;
    planReversals?: number;
}

export interface HermiteStation {
    outline: PolyPoint;
    rim: PolyPoint;
    n: { x: number; y: number };
    u: number;
    /** Natural plantar-boundary tangent in (n, z), when known. */
    t0?: { n: number; z: number };
    /** Top-sheet boundary-face slope in (n, z), pointing down the wall. */
    t1?: { n: number; z: number };
    /** Fillet-implied seam dihedral at the plantar stitch (deg). */
    impliedSeamDeg?: number;
}

export interface HermiteLoftInput {
    stations: HermiteStation[];
    defaults: WallRegionDefaults;
    nT?: number;
    footLengthMm: number;
    /** When 0 the standard wall is unchanged (identity). */
    flangeHeightMm?: number;
    flangeLengthMm?: number;
    flangeAngleDeg?: number;
}

/** Minimum real bottom fillet so row 0 is tangent to the dish band. */
export const MIN_REAL_BOTTOM_FILLET_MM = 0.8;

function clampTangentMag(t: NZ, maxMag: number): NZ {
    const m = Math.hypot(t.n, t.z);
    if (m <= maxMag || m < 1e-12) return t;
    return { n: (t.n / m) * maxMag, z: (t.z / m) * maxMag };
}

/** Band tangent: at most 30° from horizontal. Default is inward along the dish. */
function clampToBandTangent(t0?: NZ): NZ {
    if (!t0) return { n: -1, z: 0 };
    const u = unitNZ(t0);
    const n = u.n;
    const z = Math.max(0, u.z);
    const tilt = Math.atan2(z, Math.abs(n) || 1e-9);
    if (tilt > Math.PI / 6) {
        const s = n >= 0 ? 1 : -1;
        return { n: s * Math.cos(Math.PI / 6), z: Math.sin(Math.PI / 6) };
    }
    return unitNZ({ n: n === 0 ? -1 : n, z });
}

export function countColumnPlanReversals(xyz: Array<Array<{ x: number; y: number; z: number }>>): number {
    let hits = 0;
    for (const col of xyz) {
        if (!col || col.length < 2) continue;
        const R = col[0]!;
        const B = col[col.length - 1]!;
        const dx = B.x - R.x;
        const dy = B.y - R.y;
        const chord = Math.hypot(dx, dy);
        if (chord < 1e-6) continue;
        const hx = dx / chord;
        const hy = dy / chord;
        let minS = Infinity;
        let minI = 0;
        for (let i = 0; i < col.length; i++) {
            const s = (col[i]!.x - R.x) * hx + (col[i]!.y - R.y) * hy;
            if (s < minS) {
                minS = s;
                minI = i;
            }
        }
        let prev = minS;
        for (let i = minI + 1; i < col.length; i++) {
            const s = (col[i]!.x - R.x) * hx + (col[i]!.y - R.y) * hy;
            if (s < prev - 1e-4 * chord) hits++;
            if (s > prev) prev = s;
        }
    }
    return hits;
}

function centroidOf(pts: PolyPoint[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const p of pts) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(1, pts.length);
    return { x: x / n, y: y / n };
}

function smoothNormals(ns: Array<{ x: number; y: number }>, passes = 3): Array<{ x: number; y: number }> {
    let cur = ns.map((n) => ({ ...n }));
    for (let p = 0; p < passes; p++) {
        const next = cur.map((n, i) => {
            const a = cur[(i + cur.length - 1) % cur.length]!;
            const c = cur[(i + 1) % cur.length]!;
            const x = n.x * 0.5 + (a.x + c.x) * 0.25;
            const y = n.y * 0.5 + (a.y + c.y) * 0.25;
            const len = Math.hypot(x, y) || 1;
            return { x: x / len, y: y / len };
        });
        cur = next;
    }
    return cur;
}

/** Build outward-normal Hermite stations from matched rim / outline polylines. */
export function buildHermiteStations(
    outline: PolyPoint[],
    rim: PolyPoint[],
    bounds: { minX: number; maxX: number },
): HermiteStation[] {
    const n = Math.min(outline.length, rim.length);
    const c = centroidOf(outline);
    const raw: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < n; i++) raw.push(outwardNormal(outline, i, c));
    const ns = smoothNormals(raw);
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const stations: HermiteStation[] = [];
    for (let i = 0; i < n; i++) {
        stations.push({
            outline: outline[i]!,
            rim: rim[i]!,
            n: ns[i]!,
            u: Math.max(0, Math.min(1, (outline[i]!.x - bounds.minX) / length)),
        });
    }
    return stations;
}

function polylineCircMm(pts: PolyPoint[]): number {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        s += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return pts.length ? s / pts.length : 1;
}

function applyFlangeAndScale(
    p: { n: number; z: number },
    t: number,
    st: HermiteStation,
    chordN: number,
    hScale: number,
    flangeH: number,
    flangeLen: number,
    flangeAng: number,
    footLengthMm: number,
    medialYSign: 1 | -1 = 1,
): { n: number; z: number } {
    let out = p;
    if (hScale < 0.999 && t > 0 && t < 1) {
        out = {
            n: out.n * hScale + chordN * t * (1 - hScale),
            z: st.outline.z + (out.z - st.outline.z) * hScale + (st.rim.z - st.outline.z) * t * (1 - hScale),
        };
    }
    if (flangeH > 0) {
        const env = lateralFlangeEnvelope(st.u, st.outline.y, flangeLen, footLengthMm, medialYSign);
        if (env > 0 && t > 0 && t < 1) {
            const extra = env * flangeH * Math.tan((flangeAng * Math.PI) / 180) * Math.sin(Math.PI * t);
            out = { n: out.n + extra, z: out.z };
        }
    }
    return out;
}

function buildStationColumn(
    st: HermiteStation,
    flareDeg: number,
    defaults: WallRegionDefaults,
    nT: number,
    circMm: number,
    flangeH: number,
    flangeLen: number,
    flangeAng: number,
    footLengthMm: number,
): { column: Array<{ n: number; z: number }>; impliedSeamDeg: number } {
    const o = st.outline;
    const r = st.rim;
    const height = r.z - o.z;
    const chordN = (r.x - o.x) * st.n.x + (r.y - o.y) * st.n.y;
    const hScale = wallHeightScale(st.u);
    const curvature = blendedFlareCurvature(st.u, o.y, defaults.flareCurvature, defaults.medialYSign ?? 1);
    const localH = Math.max(height, 0.5);
    const maxR = FILLET_MAX_HEIGHT_FRAC * localH;
    /** Real bottom fillet so row 0 starts tangent to the dish band (not r=0). */
    const filletBot = Math.min(maxR, Math.max(defaults.wallFilletBottomMm, MIN_REAL_BOTTOM_FILLET_MM));
    const filletTop = Math.min(defaults.wallFilletTopMm, maxR);
    const bowl = filletBot < 0.2 ? 0 : heelBowlMix(st.u);
    const Tw = wallDirectionNZ(flareDeg);
    const towardTop = chordN === 0 ? -1 : Math.sign(chordN);
    const Twall = unitNZ({ n: towardTop * Math.abs(Tw.n), z: Tw.z });
    const Tsheet = clampToBandTangent(st.t0);
    /** In-plane, toward the wall from the rim (not a tilted TopSheet face). */
    const Ttop = unitNZ({ n: -towardTop, z: 0 });
    const P0 = { n: 0, z: o.z };
    const P1 = { n: chordN, z: r.z };
    const botRings = sampleFilletArc(P0, Tsheet, Twall, filletBot, circMm);
    const topFromRim = sampleFilletArc(P1, Ttop, { n: -Twall.n, z: -Twall.z }, filletTop, circMm);
    const first = botRings[0] ?? { n: P0.n + Tsheet.n * 0.3, z: P0.z + Tsheet.z * 0.3 };
    const implied = filletImpliedSeamDeg(Tsheet, {
        n: first.n - P0.n,
        z: first.z - P0.z,
    });
    const hermiteStart = botRings[botRings.length - 1] ?? P0;
    const hermiteEnd = topFromRim[topFromRim.length - 1] ?? P1;
    const midLen = Math.max(1e-3, Math.hypot(hermiteEnd.n - hermiteStart.n, hermiteEnd.z - hermiteStart.z));
    const nChord = Math.max(0.05, Math.max(height, 0.5) * Math.tan(Math.abs((flareDeg * Math.PI) / 180)));
    const chord = Math.max(1e-3, Math.hypot(chordN, height));
    const maxT = 0.5 * chord;
    const T0 = clampTangentMag({ n: Twall.n * midLen + curvature * nChord, z: Twall.z * midLen }, maxT);
    const T1 = clampTangentMag({ n: Twall.n * midLen, z: Twall.z * midLen }, maxT);
    const nMid = Math.max(3, nT - 2 - botRings.length - topFromRim.length);
    const column: Array<{ n: number; z: number }> = [P0];
    for (const p of botRings) column.push({ n: p.n, z: Math.max(p.z, P0.z, 0) });
    for (let i = 1; i < nMid; i++) {
        const t = clusteredWallT(i, nMid, filletBot, filletTop, Math.max(height, 1));
        let p = evalWallProfile(hermiteStart, T0, hermiteEnd, T1, t, bowl);
        p = applyFlangeAndScale(
            p,
            t,
            st,
            chordN,
            hScale,
            flangeH,
            flangeLen,
            flangeAng,
            footLengthMm,
            defaults.medialYSign ?? 1,
        );
        p = {
            n: p.n,
            z: Math.max(hermiteStart.z, Math.min(hermiteEnd.z, p.z)),
        };
        column.push(p);
    }
    for (let i = topFromRim.length - 2; i >= 0; i--) column.push(topFromRim[i]!);
    column.push(P1);
    for (let i = 1; i < column.length; i++) {
        if (column[i]!.z < column[i - 1]!.z) column[i]!.z = column[i - 1]!.z;
    }
    enforcePlanMonotonic(column, chordN);
    return { column, impliedSeamDeg: implied };
}

/** Keep n monotonic toward the rim so a column cannot reverse in plan. */
function enforcePlanMonotonic(column: Array<{ n: number; z: number }>, chordN: number): void {
    if (column.length < 2) return;
    const dir = chordN === 0 ? 0 : Math.sign(chordN);
    const inwardLimit = Math.min(0, chordN);
    const outwardLimit = Math.max(0, chordN);
    for (let i = 1; i < column.length - 1; i++) {
        const p = column[i]!;
        if (dir < 0) p.n = Math.max(inwardLimit, Math.min(outwardLimit + 2, p.n));
        else if (dir > 0) p.n = Math.min(outwardLimit, Math.max(inwardLimit - 2, p.n));
        const prev = column[i - 1]!.n;
        if (dir !== 0 && (p.n - prev) * dir < -1e-6) p.n = prev;
    }
    column[column.length - 1]!.n = chordN;
}

function resampleColumnKeepFirstStep(
    column: Array<{ n: number; z: number }>,
    nT: number,
    keepPrefix = 1 + MIN_FILLET_RINGS,
): Array<{ n: number; z: number }> {
    if (column.length === 0) return Array.from({ length: nT }, () => ({ n: 0, z: 0 }));
    if (column.length === nT) return column;
    const out: Array<{ n: number; z: number }> = [];
    const prefix = Math.max(1, Math.min(keepPrefix, column.length, nT));
    for (let i = 0; i < prefix; i++) out.push(column[i]!);
    if (nT === out.length) return out;
    if (column.length === 1) {
        for (let i = 1; i < nT; i++) out.push(column[0]!);
        return out;
    }
    const tail = column.slice(Math.max(0, prefix - 1));
    for (let i = prefix; i < nT; i++) {
        const t = ((i - (prefix - 1)) / Math.max(1, nT - prefix)) * (tail.length - 1);
        const j = Math.min(tail.length - 2, Math.max(0, Math.floor(t)));
        const f = t - j;
        const a = tail[j]!;
        const b = tail[j + 1] ?? tail[j]!;
        out.push({ n: a.n + (b.n - a.n) * f, z: a.z + (b.z - a.z) * f });
    }
    out[nT - 1] = column[column.length - 1]!;
    return out;
}

function writeColumn(
    st: HermiteStation,
    column: Array<{ n: number; z: number }>,
    nS: number,
    nT: number,
    si: number,
    positions: Float32Array,
    xyz: Array<Array<{ x: number; y: number; z: number }>>,
): void {
    const row: Array<{ x: number; y: number; z: number }> = [];
    for (let ti = 0; ti < nT; ti++) {
        const p = column[ti]!;
        const x = st.outline.x + st.n.x * p.n;
        const y = st.outline.y + st.n.y * p.n;
        const z = Math.max(p.z, st.outline.z, 0);
        row.push({ x, y, z });
        const idx = (ti * nS + si) * 3;
        positions[idx] = x;
        positions[idx + 1] = y;
        positions[idx + 2] = z;
    }
    xyz[si] = row;
}

function columnsCrossInWindow(
    xyz: Array<Array<{ x: number; y: number; z: number }>>,
    si: number,
    window = CROSSING_WINDOW,
): boolean {
    const nS = xyz.length;
    const a = xyz[si]!;
    for (let k = 1; k <= window; k++) {
        const b = xyz[(si + k) % nS]!;
        if (adjacentStationsCross(a, b)) return true;
        if (a.length && b.length && segmentsCrossXY(a[0]!, a[a.length - 1]!, b[0]!, b[b.length - 1]!)) {
            return true;
        }
    }
    return false;
}

/**
 * Cubic Hermite wall in the local (outward n, z) frame with explicit 3–4
 * ring fillet arcs at both ends. T0 is the wall direction (90° − flare).
 */
export function loftHermiteWall(input: HermiteLoftInput): LoftGrid {
    const nS = input.stations.length;
    const nT = Math.max(10, input.nT ?? 16);
    const positions = new Float32Array(nS * nT * 3);
    const flangeH = input.flangeHeightMm ?? 0;
    const flangeLen = input.flangeLengthMm ?? input.defaults.lateralFlangeLengthMm;
    const flangeAng = input.flangeAngleDeg ?? input.defaults.lateralFlangeAngleDeg;
    const circMm = polylineCircMm(input.stations.map((s) => s.outline));
    const xyz: Array<Array<{ x: number; y: number; z: number }>> = new Array(nS);
    const regionDefault = input.stations.map((st) =>
        blendedFlareDeg(st.u, st.outline.y, input.defaults.flareDeg, input.defaults.medialYSign ?? 1),
    );
    const { flare: flareAlong, report: flareCapReport } = smoothAndCapFlare(
        input.stations.map((s) => s.outline),
        regionDefault,
    );

    const buildAt = (si: number, flare: number) => {
        const st = input.stations[si]!;
        const built = buildStationColumn(
            st,
            flare,
            input.defaults,
            nT,
            circMm,
            flangeH,
            flangeLen,
            flangeAng,
            input.footLengthMm,
        );
        let column = resampleColumnKeepFirstStep(built.column, nT);
        enforcePlanMonotonic(column, (st.rim.x - st.outline.x) * st.n.x + (st.rim.y - st.outline.y) * st.n.y);
        let guard = 0;
        let f = flare;
        while (!assertNoStationSelfIntersection(column) && guard++ < 8) {
            if (f < 0) f = 0;
            else f = regionDefault[si]! + (f - regionDefault[si]!) * 0.5;
            const again = buildStationColumn(
                st,
                f,
                input.defaults,
                nT,
                circMm,
                flangeH,
                flangeLen,
                flangeAng,
                input.footLengthMm,
            );
            column = resampleColumnKeepFirstStep(again.column, nT);
            enforcePlanMonotonic(
                column,
                (st.rim.x - st.outline.x) * st.n.x + (st.rim.y - st.outline.y) * st.n.y,
            );
            built.impliedSeamDeg = again.impliedSeamDeg;
        }
        for (let i = 1; i < column.length; i++) {
            if (column[i]!.z < column[i - 1]!.z) column[i]!.z = column[i - 1]!.z;
        }
        st.impliedSeamDeg = built.impliedSeamDeg;
        writeColumn(st, column, nS, nT, si, positions, xyz);
        return f;
    };

    for (let si = 0; si < nS; si++) {
        flareAlong[si] = buildAt(si, flareAlong[si]!);
    }

    for (let si = 0; si < nS; si++) {
        if (!columnsCrossInWindow(xyz, si)) continue;
        const def = regionDefault[si]!;
        if (flareAlong[si]! < 0) {
            flareAlong[si] = 0;
            buildAt(si, 0);
        } else if (flareAlong[si]! !== def) {
            flareAlong[si] = def;
            buildAt(si, def);
        }
    }

    let windowCrossings = 0;
    for (let si = 0; si < nS; si++) {
        if (columnsCrossInWindow(xyz, si)) windowCrossings++;
    }
    const chordCrossings = countPlanViewChordCrossings(
        input.stations.map((s) => s.outline),
        input.stations.map((s) => s.rim),
    );
    return {
        nS,
        nT,
        positions,
        flareDeg: flareAlong,
        flareCapReport,
        chordCrossings,
        windowCrossings,
        planReversals: countColumnPlanReversals(xyz),
    };
}

export function wallTriangles(grid: LoftGrid): number[] {
    const { nS, nT } = grid;
    const idx: number[] = [];
    for (let ti = 0; ti < nT - 1; ti++) {
        for (let si = 0; si < nS; si++) {
            const a = ti * nS + si;
            const b = ti * nS + ((si + 1) % nS);
            const c = (ti + 1) * nS + ((si + 1) % nS);
            const d = (ti + 1) * nS + si;
            idx.push(a, b, c, a, c, d);
        }
    }
    return idx;
}

/** @deprecated Reverse-fit loft removed; kept so older call sites type-check during the pivot. */
export function loftWallGrid(): LoftGrid {
    return { nS: 0, nT: 0, positions: new Float32Array(0) };
}
