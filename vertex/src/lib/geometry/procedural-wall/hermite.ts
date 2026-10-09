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

/**
 * End tangents. With a ~0 bottom fillet the wall starts along the natural
 * flare (not a horizontal C1), so the first ring is not coplanar with the
 * plantar sheet. A non-zero bottom fillet blends toward a horizontal start.
 * Flare-curvature adds outward bow when the stock profile is curved.
 */
export function wallEndTangents(input: WallTangentInput): { T0: NZ; T1: NZ } {
    const H = Math.max(input.heightMm, 1e-3);
    const alpha = (input.flareDeg * Math.PI) / 180;
    const nChord = Math.max(0.05, H * Math.tan(Math.abs(alpha)));
    const circleR = (nChord * nChord + H * H) / (2 * H);
    const bowlR = Math.max(
        CUP_BOWL.radiusMinFactor * H,
        Math.min(CUP_BOWL.radiusMaxFactor * H, input.bowlFactor * H, circleR),
    );
    const rBot = Math.max(0, input.filletBottomMm);
    const rTop = Math.max(0, input.filletTopMm);
    const kappa = Math.max(0, input.flareCurvature ?? 0);

    const cn = Math.sin(alpha);
    const cz = Math.max(0.15, Math.cos(alpha));
    let T0 = { n: cn * H + kappa * nChord, z: cz * H };

    if (rBot > 1e-4) {
        const w = Math.min(1, rBot / Math.max(H * 0.25, 1e-3));
        const rFloor = rBot * (1 - input.bowlMix) + bowlR * input.bowlMix;
        const cosEnd = Math.max(-1, Math.min(1, 1 - H / Math.max(rFloor, H * 0.51)));
        const theta = Math.acos(cosEnd);
        T0 = {
            n: T0.n * (1 - w) + rFloor * theta * w,
            z: T0.z * (1 - w),
        };
    }

    const topW = Math.min(0.35, rTop / Math.max(H * 0.2, 1e-3));
    const T1 = {
        n: cn * H * (1 - topW) + rTop * topW,
        z: cz * H * (1 - topW),
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

export function assertNoStationSelfIntersection(profile: NZ[]): boolean {
    // A single column must not reverse in z (would fold onto itself).
    for (let i = 1; i < profile.length; i++) {
        if (profile[i]!.z + 1e-4 < profile[i - 1]!.z) return false;
    }
    return true;
}
