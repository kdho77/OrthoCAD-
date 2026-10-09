// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";
import { projectCurveOntoPlane } from "./planform";
import { evalOpenCubic } from "./profile";
import type { ColumnProfile, PlanformColumn } from "./types";
import { S1_LOFT_T_SAMPLES } from "./types";

export interface LoftGrid {
    nS: number;
    nT: number;
    /** Packed xyz, row-major t then s: index = (ti * nS + si) * 3 */
    positions: Float32Array;
}

export interface LoftCurves {
    outline?: PolyPoint[];
    rim?: PolyPoint[];
    /** Extra samples between each planform column (1 = columns only). */
    sMul?: number;
}

function lerp(a: number, b: number, f: number): number {
    return a + (b - a) * f;
}

function inwardFromTangent(
    t: { x: number; y: number },
    hint: { x: number; y: number },
): { x: number; y: number } {
    let n = { x: -t.y, y: t.x };
    if (n.x * hint.x + n.y * hint.y < 0) n = { x: -n.x, y: -n.y };
    const len = Math.hypot(n.x, n.y) || 1;
    return { x: n.x / len, y: n.y / len };
}

/**
 * C2 B-spline loft across s: periodic interpolation of the per-column cubics,
 * evaluated on a denser s-grid so the plantar/rim edges follow the source
 * curves (viewer-side ThruSections / GeomFill).
 */
export function loftWallGrid(
    columns: PlanformColumn[],
    profiles: ColumnProfile[],
    nT = S1_LOFT_T_SAMPLES,
    curves: LoftCurves = {},
): LoftGrid {
    const nCol = columns.length;
    const sMul = Math.max(1, Math.min(4, curves.sMul ?? 3));
    const nS = nCol * sMul;
    const positions = new Float32Array(nS * nT * 3);

    for (let si = 0; si < nS; si++) {
        const c0 = Math.floor(si / sMul) % nCol;
        const c1 = (c0 + 1) % nCol;
        const f = (si % sMul) / sMul;
        const colA = columns[c0]!;
        const colB = columns[c1]!;
        const profA = profiles[c0] ?? profiles[0]!;
        const profB = profiles[c1] ?? profiles[0]!;
        const tx = lerp(colA.tangent.x, colB.tangent.x, f);
        const ty = lerp(colA.tangent.y, colB.tangent.y, f);
        const tlen = Math.hypot(tx, ty) || 1;
        const tangent = { x: tx / tlen, y: ty / tlen };
        const origin = {
            x: lerp(colA.outline.x, colB.outline.x, f),
            y: lerp(colA.outline.y, colB.outline.y, f),
            z: lerp(colA.outline.z, colB.outline.z, f),
        };
        const nHint = { x: lerp(colA.n.x, colB.n.x, f), y: lerp(colA.n.y, colB.n.y, f) };
        const n = inwardFromTangent(tangent, nHint);
        const plantar = curves.outline ? projectCurveOntoPlane(origin, tangent, curves.outline) : origin;
        const rimHit = curves.rim
            ? projectCurveOntoPlane(origin, tangent, curves.rim)
            : {
                  x: lerp(colA.rim.x, colB.rim.x, f),
                  y: lerp(colA.rim.y, colB.rim.y, f),
                  z: lerp(colA.rim.z, colB.rim.z, f),
              };
        const rimN = (rimHit.x - plantar.x) * n.x + (rimHit.y - plantar.y) * n.y;

        for (let ti = 0; ti < nT; ti++) {
            const t = ti / (nT - 1);
            const a = evalOpenCubic(profA.poles, t);
            const b = evalOpenCubic(profB.poles, t);
            let off = lerp(a.n, b.n, f);
            let z = lerp(a.z, b.z, f);
            if (ti === 0) {
                off = 0;
                z = plantar.z;
            } else if (ti === nT - 1) {
                off = rimN;
                z = rimHit.z;
            }
            const o = (ti * nS + si) * 3;
            positions[o] = plantar.x + n.x * off;
            positions[o + 1] = plantar.y + n.y * off;
            positions[o + 2] = z;
        }
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
