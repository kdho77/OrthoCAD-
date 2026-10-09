// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CUP_BOWL, FILLET_BOUNDS } from "./defaults";

export interface NZ {
    n: number;
    z: number;
}

/** Cubic Hermite in the local (n, z) frame. t ∈ [0, 1]. */
/** Circular bowl through P0→P1 with horizontal start (C1 to a flat floor). */
export function evalCircularBowl(P0: NZ, P1: NZ, t: number): NZ {
    const tt = Math.max(0, Math.min(1, t));
    const H = P1.z - P0.z;
    const N = P1.n - P0.n;
    const Hh = Math.max(H, 1e-3);
    const R = Math.max((N * N + Hh * Hh) / (2 * Hh), Hh * 0.5);
    const cosEnd = Math.max(-1, Math.min(1, 1 - Hh / R));
    const theta = Math.acos(cosEnd);
    const th = theta * tt;
    return {
        n: P0.n + R * Math.sin(th),
        z: P0.z + R * (1 - Math.cos(th)),
    };
}

export function evalWallProfile(P0: NZ, T0: NZ, P1: NZ, T1: NZ, t: number, bowlMix: number): NZ {
    const hermite = evalCubicHermite(P0, T0, P1, T1, t);
    if (bowlMix <= 1e-6) return hermite;
    const bowl = evalCircularBowl(P0, P1, t);
    const w = Math.max(0, Math.min(1, bowlMix));
    return { n: hermite.n * (1 - w) + bowl.n * w, z: hermite.z * (1 - w) + bowl.z * w };
}

export function evalCubicHermite(P0: NZ, T0: NZ, P1: NZ, T1: NZ, t: number): NZ {
    const tt = Math.max(0, Math.min(1, t));
    const t2 = tt * tt;
    const t3 = t2 * tt;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + tt;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return {
        n: h00 * P0.n + h10 * T0.n + h01 * P1.n + h11 * T1.n,
        z: h00 * P0.z + h10 * T0.z + h01 * P1.z + h11 * T1.z,
    };
}

export function evalCubicHermiteTangent(P0: NZ, T0: NZ, P1: NZ, T1: NZ, t: number): NZ {
    const tt = Math.max(0, Math.min(1, t));
    const t2 = tt * tt;
    const d00 = 6 * t2 - 6 * tt;
    const d10 = 3 * t2 - 4 * tt + 1;
    const d01 = -6 * t2 + 6 * tt;
    const d11 = 3 * t2 - 2 * tt;
    return {
        n: d00 * P0.n + d10 * T0.n + d01 * P1.n + d11 * T1.n,
        z: d00 * P0.z + d10 * T0.z + d01 * P1.z + d11 * T1.z,
    };
}

export interface WallTangentInput {
    heightMm: number;
    flareDeg: number;
    filletTopMm: number;
    filletBottomMm: number;
    bowlMix: number;
    bowlFactor: number;
    /** 0 = linear chord; >0 bows the profile toward the stock curved wall. */
    flareCurvature?: number;
}

export const MIN_FILLET_RING_SPACING_MM = 0.3;
export const MAX_FILLET_ASPECT = 20;
export const FILLET_RING_TARGET = 4;

export function unitNZ(t: NZ): NZ {
    const l = Math.hypot(t.n, t.z) || 1;
    return { n: t.n / l, z: t.z / l };
}

/** Wall direction from the plantar plane: 90° − flare (not horizontal). */
export function wallDirectionNZ(flareDeg: number): NZ {
    const alpha = (flareDeg * Math.PI) / 180;
    return { n: Math.sin(alpha), z: Math.max(0, Math.cos(alpha)) };
}

export function angleBetweenNZ(a: NZ, b: NZ): number {
    const ua = unitNZ(a);
    const ub = unitNZ(b);
    return Math.acos(Math.max(-1, Math.min(1, ua.n * ub.n + ua.z * ub.z)));
}

/** Fillet-implied seam dihedral (deg) between sheet slope and first ring. */
export function filletImpliedSeamDeg(sheetT: NZ, firstRingT: NZ): number {
    return (angleBetweenNZ(sheetT, firstRingT) * 180) / Math.PI;
}

/**
 * Explicit 3–4 ring circular fillet in (n, z). Starts along `Tstart` (sheet
 * boundary-face slope) and turns toward `Tend` (wall direction). First ring
 * is at least r(1−cos θ) off the start plane. Rings closer than 0.3 mm or
 * with triangle aspect > 20 are dropped.
 */
export function sampleFilletArc(P0: NZ, Tstart: NZ, Tend: NZ, radiusMm: number, circMm: number): NZ[] {
    const ts = unitNZ(Tstart);
    const te = unitNZ(Tend);
    const theta = angleBetweenNZ(ts, te);
    const r = Math.max(0, radiusMm);
    const cross = ts.n * te.z - ts.z * te.n;
    const n0 = cross >= 0 ? { n: -ts.z, z: ts.n } : { n: ts.z, z: -ts.n };
    const minOff = r > 1e-8 ? r * (1 - Math.cos(Math.max(theta / FILLET_RING_TARGET, 1e-4))) : 0;

    const emit = (p: NZ, prev: NZ, rings: NZ[]): boolean => {
        const dist = Math.hypot(p.n - prev.n, p.z - prev.z);
        if (rings.length && dist < MIN_FILLET_RING_SPACING_MM) return false;
        const radial = Math.max(dist, 1e-6);
        const aspect = circMm > 1e-6 ? Math.max(circMm, radial) / Math.min(circMm, radial) : 1;
        if (aspect > MAX_FILLET_ASPECT) return false;
        rings.push(p);
        return true;
    };

    if (r < 1e-4 || theta < 1e-3) {
        const step = Math.max(MIN_FILLET_RING_SPACING_MM, minOff);
        const p = { n: P0.n + ts.n * step, z: P0.z + ts.z * step };
        return [p];
    }

    const nWant = Math.min(
        FILLET_RING_TARGET,
        Math.max(3, Math.floor((r * theta) / MIN_FILLET_RING_SPACING_MM)),
    );
    const rings: NZ[] = [];
    for (let i = 1; i <= nWant; i++) {
        const phi = (theta * i) / nWant;
        const p = {
            n: P0.n + n0.n * r * (1 - Math.cos(phi)) + ts.n * r * Math.sin(phi),
            z: P0.z + n0.z * r * (1 - Math.cos(phi)) + ts.z * r * Math.sin(phi),
        };
        if (rings.length === 0) {
            const off = (p.n - P0.n) * n0.n + (p.z - P0.z) * n0.z;
            if (off < minOff) {
                const phi0 = Math.acos(Math.max(-1, Math.min(1, 1 - minOff / r)));
                p.n = P0.n + n0.n * r * (1 - Math.cos(phi0)) + ts.n * r * Math.sin(phi0);
                p.z = P0.z + n0.z * r * (1 - Math.cos(phi0)) + ts.z * r * Math.sin(phi0);
            }
        }
        emit(p, rings.length ? rings[rings.length - 1]! : P0, rings);
    }
    if (!rings.length) {
        const step = Math.max(MIN_FILLET_RING_SPACING_MM, minOff);
        rings.push({ n: P0.n + ts.n * step, z: P0.z + ts.z * step });
    }
    return rings;
}

/**
 * End tangents. T0 follows the wall direction (90° − flare from the plantar
 * plane), never horizontal. Fillet blending lives in the explicit ring sampler.
 * Flare-curvature adds outward bow when the stock profile is curved.
 */
export function wallEndTangents(input: WallTangentInput): { T0: NZ; T1: NZ } {
    const H = Math.max(input.heightMm, 1e-3);
    const alpha = (input.flareDeg * Math.PI) / 180;
    const nChord = Math.max(0.05, H * Math.tan(Math.abs(alpha)));
    const kappa = Math.max(0, input.flareCurvature ?? 0);
    const dir = wallDirectionNZ(input.flareDeg);
    const T0 = { n: dir.n * H + kappa * nChord, z: dir.z * H };
    const rTop = Math.max(0, input.filletTopMm);
    const topW = Math.min(0.35, rTop / Math.max(H * 0.2, 1e-3));
    const T1 = {
        n: dir.n * H * (1 - topW) + rTop * topW,
        z: Math.max(0.15, dir.z) * H * (1 - topW),
    };
    return { T0, T1 };
}

/**
 * Cluster t-samples at the fillets so the first/last chords stay within the
 * seam-dihedral budget (fillet-implied ≈ 0, +2°).
 */
export function clusteredWallT(
    i: number,
    nT: number,
    filletBotMm: number,
    filletTopMm: number,
    heightMm: number,
): number {
    if (nT <= 2) return i / Math.max(1, nT - 1);
    if (filletBotMm < 0.2 && filletTopMm < 0.6) {
        return i / Math.max(1, nT - 1);
    }
    const H = Math.max(heightMm, 1e-3);
    const botFrac = Math.max(filletBotMm < 0.2 ? 0.05 : 0.12, Math.min(0.4, (filletBotMm + 0.15) / H));
    const topFrac = Math.max(0.08, Math.min(0.35, (filletTopMm + 0.15) / H));
    const nBot = Math.max(4, Math.round((nT - 1) * 0.35));
    const nTop = Math.max(4, Math.round((nT - 1) * 0.3));
    const nMid = nT - 1 - nBot - nTop;
    if (i <= nBot) {
        const u = i / nBot;
        return botFrac * (u * u);
    }
    if (i >= nT - 1 - nTop) {
        const k = i - (nT - 1 - nTop);
        const u = k / nTop;
        return 1 - topFrac * (1 - u) * (1 - u);
    }
    const u = (i - nBot) / Math.max(1, nMid);
    return botFrac + (1 - botFrac - topFrac) * u;
}

export interface HeelCupGateResult {
    heightMm: number;
    maxVerticalRunMm: number;
    curvatureBreaks: number;
    maxCupDropMm: number;
    ok: boolean;
}

/**
 * Synthetic heel-cup profile gate: at cup 12/15/18, no vertical segment over
 * 3 mm and no curvature break (G1). Also records the post-fillet cup drop.
 */
export function evaluateHeelCupGate(
    heightMm: number,
    flareDeg = 23.9,
    filletTopMm = 0.5,
    filletBottomMm = 0,
    bowlFactor = 0.5,
    samples = 96,
): HeelCupGateResult {
    const P0 = { n: 0, z: 0 };
    const P1 = { n: heightMm * Math.tan((flareDeg * Math.PI) / 180), z: heightMm };
    const { T0, T1 } = wallEndTangents({
        heightMm,
        flareDeg,
        filletTopMm,
        filletBottomMm,
        bowlMix: 1,
        bowlFactor,
    });
    const pts: NZ[] = [];
    const tans: NZ[] = [];
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        pts.push(evalWallProfile(P0, T0, P1, T1, t, 1));
        const t0 = evalWallProfile(P0, T0, P1, T1, Math.max(0, t - 1e-3), 1);
        const t1 = evalWallProfile(P0, T0, P1, T1, Math.min(1, t + 1e-3), 1);
        tans.push({ n: t1.n - t0.n, z: t1.z - t0.z });
    }
    let maxVert = 0;
    let run = 0;
    for (let i = 1; i < pts.length; i++) {
        const dn = pts[i]!.n - pts[i - 1]!.n;
        const dz = pts[i]!.z - pts[i - 1]!.z;
        const fromVert = (Math.atan2(Math.abs(dn), Math.max(dz, 1e-9)) * 180) / Math.PI;
        if (fromVert < 8 && dz > 0) {
            run += dz;
            if (run > maxVert) maxVert = run;
        } else {
            run = 0;
        }
    }
    let breaks = 0;
    for (let i = 1; i < tans.length; i++) {
        const a = tans[i - 1]!;
        const b = tans[i]!;
        const la = Math.hypot(a.n, a.z) || 1;
        const lb = Math.hypot(b.n, b.z) || 1;
        const dot = (a.n * b.n + a.z * b.z) / (la * lb);
        const deg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
        if (deg > 25) breaks++;
    }
    let maxZ = 0;
    for (const p of pts) if (p.z > maxZ) maxZ = p.z;
    const drop = Math.max(0, heightMm - maxZ);
    const ok =
        maxVert <= CUP_BOWL.maxVerticalSegmentMm && breaks === 0 && drop <= FILLET_BOUNDS.maxCupHeightDropMm;
    return { heightMm, maxVerticalRunMm: maxVert, curvatureBreaks: breaks, maxCupDropMm: drop, ok };
}

function segmentsIntersect2D(a0: NZ, a1: NZ, b0: NZ, b1: NZ): boolean {
    const dax = a1.n - a0.n;
    const daz = a1.z - a0.z;
    const dbx = b1.n - b0.n;
    const dbz = b1.z - b0.z;
    const den = dax * dbz - daz * dbx;
    if (Math.abs(den) < 1e-12) return false;
    const dx = b0.n - a0.n;
    const dz = b0.z - a0.z;
    const t = (dx * dbz - dz * dbx) / den;
    const u = (dx * daz - dz * dax) / den;
    return t > 1e-4 && t < 1 - 1e-4 && u > 1e-4 && u < 1 - 1e-4;
}

/** Per-station 2D profile must stay single-valued in z and not self-cross. */
export function assertNoStationSelfIntersection(profile: NZ[]): boolean {
    for (let i = 1; i < profile.length; i++) {
        if (profile[i]!.z + 1e-4 < profile[i - 1]!.z) return false;
    }
    for (let i = 0; i < profile.length - 1; i++) {
        for (let j = i + 2; j < profile.length - 1; j++) {
            if (i === 0 && j === profile.length - 2) continue;
            if (segmentsIntersect2D(profile[i]!, profile[i + 1]!, profile[j]!, profile[j + 1]!)) {
                return false;
            }
        }
    }
    return true;
}

/** Adjacent station columns must not cross inside the planform envelope. */
export function adjacentStationsCross(
    a: Array<{ x: number; y: number; z: number }>,
    b: Array<{ x: number; y: number; z: number }>,
): boolean {
    const n = Math.min(a.length, b.length);
    if (n < 2) return false;
    const segHit = (
        p0: { x: number; y: number },
        p1: { x: number; y: number },
        q0: { x: number; y: number },
        q1: { x: number; y: number },
    ): boolean => {
        const dax = p1.x - p0.x;
        const day = p1.y - p0.y;
        const dbx = q1.x - q0.x;
        const dby = q1.y - q0.y;
        const den = dax * dby - day * dbx;
        if (Math.abs(den) < 1e-12) return false;
        const dx = q0.x - p0.x;
        const dy = q0.y - p0.y;
        const t = (dx * dby - dy * dbx) / den;
        const u = (dx * day - dy * dax) / den;
        return t > 1e-4 && t < 1 - 1e-4 && u > 1e-4 && u < 1 - 1e-4;
    };
    for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < n - 1; j++) {
            if (i === j) continue;
            if (segHit(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return true;
        }
    }
    return false;
}
