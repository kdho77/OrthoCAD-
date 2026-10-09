// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { evalOpenCubic } from "./profile";
import type { ColumnProfile, PlanformColumn } from "./types";
import { S1_LOFT_T_SAMPLES } from "./types";

export interface LoftGrid {
    nS: number;
    nT: number;
    /** Packed xyz, row-major t then s: index = (ti * nS + si) * 3 */
    positions: Float32Array;
}

/** Uniform cubic B-spline basis (C2). */
function bsplineBasis(u: number): [number, number, number, number] {
    const u2 = u * u;
    const u3 = u2 * u;
    return [
        (1 - 3 * u + 3 * u2 - u3) / 6,
        (4 - 6 * u2 + 3 * u3) / 6,
        (1 + 3 * u + 3 * u2 - 3 * u3) / 6,
        u3 / 6,
    ];
}

function solveTridiagonal(a: number, bb: number[], c: number, rhs: number[]): number[] {
    const n = rhs.length;
    const cp = new Array<number>(n);
    const dp = new Array<number>(n);
    const out = new Array<number>(n);
    cp[0] = c / bb[0]!;
    dp[0] = rhs[0]! / bb[0]!;
    for (let i = 1; i < n; i++) {
        const inv = 1 / (bb[i]! - a * cp[i - 1]!);
        cp[i] = i < n - 1 ? c * inv : 0;
        dp[i] = (rhs[i]! - a * dp[i - 1]!) * inv;
    }
    out[n - 1] = dp[n - 1]!;
    for (let i = n - 2; i >= 0; i--) out[i] = dp[i]! - cp[i]! * out[i + 1]!;
    return out;
}

function solvePeriodicCubic(rhs: number[]): number[] {
    const n = rhs.length;
    if (n === 0) return [];
    if (n === 1) return [rhs[0]!];
    const a = 1 / 6;
    const b = 2 / 3;
    const c = 1 / 6;
    const bb = new Array<number>(n).fill(b);
    const v = new Array<number>(n).fill(0);
    const u = new Array<number>(n).fill(0);
    u[0] = c;
    v[0] = a;
    u[n - 1] = a;
    v[n - 1] = c;
    bb[0]! -= c;
    bb[n - 1]! -= a;
    const y = solveTridiagonal(a, bb, c, rhs);
    const q = solveTridiagonal(a, bb, c, v);
    const vy = v[0]! * y[0]! + v[n - 1]! * y[n - 1]!;
    const vq = v[0]! * q[0]! + v[n - 1]! * q[n - 1]!;
    const factor = Math.abs(1 + vq) > 1e-12 ? vy / (1 + vq) : 0;
    return y.map((yi, i) => yi - factor * q[i]!);
}

function samplePeriodic(ctrl: Array<{ x: number; y: number; z: number }>, s: number) {
    const n = ctrl.length;
    const t = (((s % 1) + 1) % 1) * n;
    const i = Math.floor(t) % n;
    const u = t - Math.floor(t);
    const [b0, b1, b2, b3] = bsplineBasis(u);
    const p0 = ctrl[(i - 1 + n) % n]!;
    const p1 = ctrl[i]!;
    const p2 = ctrl[(i + 1) % n]!;
    const p3 = ctrl[(i + 2) % n]!;
    return {
        x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
        y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
        z: b0 * p0.z + b1 * p1.z + b2 * p2.z + b3 * p3.z,
    };
}

/**
 * C2 B-spline loft across s (periodic interpolant of the per-column cubics).
 * Viewer-side equivalent of OCCT ThruSections / GeomFill.
 */
export function loftWallGrid(
    columns: PlanformColumn[],
    profiles: ColumnProfile[],
    nT = S1_LOFT_T_SAMPLES,
): LoftGrid {
    const nS = columns.length;
    const raw: Array<Array<{ x: number; y: number; z: number }>> = [];
    for (let ti = 0; ti < nT; ti++) {
        const t = ti / (nT - 1);
        const row: Array<{ x: number; y: number; z: number }> = [];
        for (let si = 0; si < nS; si++) {
            const col = columns[si]!;
            const prof = profiles[si] ?? profiles[0]!;
            const nz = evalOpenCubic(prof.poles, t);
            row.push({
                x: col.outline.x + col.n.x * nz.n,
                y: col.outline.y + col.n.y * nz.n,
                z: nz.z,
            });
        }
        const cx = solvePeriodicCubic(row.map((p) => p.x));
        const cy = solvePeriodicCubic(row.map((p) => p.y));
        const cz = solvePeriodicCubic(row.map((p) => p.z));
        const ctrl = row.map((_, i) => ({ x: cx[i]!, y: cy[i]!, z: cz[i]! }));
        const smooth: Array<{ x: number; y: number; z: number }> = [];
        for (let si = 0; si < nS; si++) smooth.push(samplePeriodic(ctrl, si / nS));
        raw.push(smooth);
    }

    const positions = new Float32Array(nS * nT * 3);
    for (let ti = 0; ti < nT; ti++) {
        for (let si = 0; si < nS; si++) {
            const o = (ti * nS + si) * 3;
            const p = raw[ti]![si]!;
            positions[o] = p.x;
            positions[o + 1] = p.y;
            positions[o + 2] = p.z;
        }
    }
    // Force endpoints onto the column plantar / rim so the sole and top weld exactly.
    for (let si = 0; si < nS; si++) {
        const col = columns[si]!;
        const p0 = si * 3;
        positions[p0] = col.outline.x;
        positions[p0 + 1] = col.outline.y;
        positions[p0 + 2] = col.outline.z;
        const rim = profiles[si]?.rim ?? {
            n: (col.rim.x - col.outline.x) * col.n.x + (col.rim.y - col.outline.y) * col.n.y,
            z: col.rim.z,
        };
        const p1 = ((nT - 1) * nS + si) * 3;
        positions[p1] = col.outline.x + col.n.x * rim.n;
        positions[p1 + 1] = col.outline.y + col.n.y * rim.n;
        positions[p1 + 2] = rim.z;
    }
    return { nS, nT, positions };
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
