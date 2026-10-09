// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";
import {
    blendedFlareDeg,
    heelBowlMix,
    lateralFlangeEnvelope,
    type WallRegionDefaults,
    wallHeightScale,
} from "./defaults";
import { assertNoStationSelfIntersection, clusteredWallT, evalWallProfile, wallEndTangents } from "./hermite";
import { outwardNormal } from "./measure";

export interface LoftGrid {
    nS: number;
    nT: number;
    /** Packed xyz, row-major t then s: index = (ti * nS + si) * 3 */
    positions: Float32Array;
}

export interface HermiteStation {
    outline: PolyPoint;
    rim: PolyPoint;
    n: { x: number; y: number };
    u: number;
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

/**
 * Cubic Hermite wall in the local (outward n, z) frame. Endpoints are the
 * outline and trim points; tangents come from flare + fillets. Lateral flange
 * is an additive interior offset — height 0 does not change any sample.
 */
export function loftHermiteWall(input: HermiteLoftInput): LoftGrid {
    const nS = input.stations.length;
    const nT = Math.max(8, input.nT ?? 16);
    const positions = new Float32Array(nS * nT * 3);
    const flangeH = input.flangeHeightMm ?? 0;
    const flangeLen = input.flangeLengthMm ?? input.defaults.lateralFlangeLengthMm;
    const flangeAng = input.flangeAngleDeg ?? input.defaults.lateralFlangeAngleDeg;

    for (let si = 0; si < nS; si++) {
        const st = input.stations[si]!;
        const o = st.outline;
        const r = st.rim;
        const height = r.z - o.z;
        const chordN = (r.x - o.x) * st.n.x + (r.y - o.y) * st.n.y;
        const hScale = wallHeightScale(st.u);
        const flare = blendedFlareDeg(st.u, o.y, input.defaults.flareDeg);
        const bowl = heelBowlMix(st.u);
        const { T0, T1 } = wallEndTangents({
            heightMm: Math.max(height, 0.5),
            flareDeg: flare,
            filletTopMm: input.defaults.wallFilletTopMm,
            filletBottomMm: input.defaults.wallFilletBottomMm,
            bowlMix: bowl,
            bowlFactor: input.defaults.cupBowlFactor,
        });
        const P0 = { n: 0, z: o.z };
        const P1 = { n: chordN, z: r.z };
        const column: Array<{ n: number; z: number }> = [];
        for (let ti = 0; ti < nT; ti++) {
            const t = clusteredWallT(
                ti,
                nT,
                input.defaults.wallFilletBottomMm,
                input.defaults.wallFilletTopMm,
                Math.max(height, 1),
            );
            let p = evalWallProfile(P0, T0, P1, T1, t, bowl);
            if (ti === 0) p = { n: 0, z: o.z };
            if (ti === nT - 1) p = { n: chordN, z: r.z };
            if (hScale < 0.999 && ti > 0 && ti < nT - 1) {
                p = {
                    n: chordN * t + p.n * (1 - hScale) * 0 + p.n * hScale,
                    z: o.z + (r.z - o.z) * t * (1 - hScale) + (p.z - o.z) * hScale + o.z * 0,
                };
                p = {
                    n: p.n * hScale + chordN * t * (1 - hScale),
                    z: o.z + (p.z - o.z) * hScale + (r.z - o.z) * t * (1 - hScale),
                };
            }
            if (flangeH > 0) {
                const env = lateralFlangeEnvelope(st.u, o.y, flangeLen, input.footLengthMm);
                if (env > 0 && ti > 0 && ti < nT - 1) {
                    const extra =
                        env * flangeH * Math.tan((flangeAng * Math.PI) / 180) * Math.sin(Math.PI * t);
                    p = { n: p.n + extra, z: p.z };
                }
            }
            column.push(p);
            const idx = (ti * nS + si) * 3;
            positions[idx] = o.x + st.n.x * p.n;
            positions[idx + 1] = o.y + st.n.y * p.n;
            positions[idx + 2] = p.z;
        }
        if (!assertNoStationSelfIntersection(column)) {
            throw new Error(`procedural wall self-intersects at station ${si} (u=${st.u.toFixed(3)})`);
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

/** @deprecated Reverse-fit loft removed; kept so older call sites type-check during the pivot. */
export function loftWallGrid(): LoftGrid {
    return { nS: 0, nT: 0, positions: new Float32Array(0) };
}
