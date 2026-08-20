// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Pt } from "./slicer";

/**
 * Endpoint weld for belt-plane slices. Same magnitude as the planar stitcher EPS
 * (1e-4 mm). Default.glb coordinates are millimetres at ~90 mm extent; float32
 * ulp at that scale is ~1e-5 mm. 1e-4 mm welds coincident splits without merging
 * distinct triangle vertices (typical edge 0.3–1 mm). Not tuned to a test.
 */
export const BELT_WELD_EPS_MM = 1e-4;

const BELT_ON_EPS = 1e-6;

export interface BeltStitchResult {
    closed: Pt[][];
    open: Pt[][];
}

export interface BeltClassifiedRing {
    loop: Pt[];
    kind: "outer" | "hole";
    depth: number;
}

export function stitchBeltLoops(
    segs: [Pt, Pt][],
    opts: { weldEps?: number; beltY?: number } = {},
): BeltStitchResult {
    const eps = opts.weldEps ?? BELT_WELD_EPS_MM;
    const beltY = opts.beltY;
    const clean = splitTJunctions(dropDuplicates(dropZeroLength(segs, eps), eps), eps);
    const used = new Array(clean.length).fill(false);
    const closed: Pt[][] = [];
    const open: Pt[][] = [];

    const degree = endpointDegrees(clean, eps);
    const startOrder = startSegmentOrder(clean, degree);

    for (const i of startOrder) {
        if (used[i]) continue;
        const peel = Math.min(degree[i * 2], degree[i * 2 + 1]) <= 1;
        const chain = walkChain(clean, used, i, eps, peel);
        if (chain.length < 3) continue;
        if (shouldClose(chain, eps, beltY)) closed.push(chain);
        else open.push(chain);
    }
    for (let i = 0; i < clean.length; i++) {
        if (used[i]) continue;
        const chain = walkChain(clean, used, i, eps, false);
        if (chain.length < 3) continue;
        if (shouldClose(chain, eps, beltY)) closed.push(chain);
        else open.push(chain);
    }
    return { closed, open };
}

/** Even depth = outer, odd = hole. Outers forced CCW, holes CW. */
export function classifyBeltRings(loops: Pt[][]): BeltClassifiedRing[] {
    const depths = loops.map((loop, i) => {
        let depth = 0;
        for (let j = 0; j < loops.length; j++) {
            if (i === j) continue;
            if (ringContainedIn(loop, loops[j])) depth++;
        }
        return depth;
    });
    return loops.map((loop, i) => {
        const depth = depths[i];
        const kind: "outer" | "hole" = depth % 2 === 0 ? "outer" : "hole";
        const area = signedArea(loop);
        const wound =
            kind === "outer" ? (area >= 0 ? loop : reverseRing(loop)) : area < 0 ? loop : reverseRing(loop);
        return { loop: wound, kind, depth };
    });
}

export function signedArea(loop: Pt[]): number {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
        const p = loop[i];
        const q = loop[(i + 1) % loop.length];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
}

export function pointInPoly(loop: Pt[], p: Pt): boolean {
    let inside = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i];
        const b = loop[j];
        const hit =
            a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
        if (hit) inside = !inside;
    }
    return inside;
}

function dropZeroLength(segs: [Pt, Pt][], eps: number): [Pt, Pt][] {
    return segs.filter(([a, b]) => hypot(a, b) >= eps);
}

function dropDuplicates(segs: [Pt, Pt][], eps: number): [Pt, Pt][] {
    const out: [Pt, Pt][] = [];
    for (const s of segs) {
        const dup = out.some(
            (t) =>
                (near(s[0], t[0], eps) && near(s[1], t[1], eps)) ||
                (near(s[0], t[1], eps) && near(s[1], t[0], eps)),
        );
        if (!dup) out.push(s);
    }
    return out;
}

function splitTJunctions(segs: [Pt, Pt][], eps: number): [Pt, Pt][] {
    let cur = segs;
    for (let pass = 0; pass < 4; pass++) {
        const pts: Pt[] = [];
        for (const [a, b] of cur) {
            pts.push(a, b);
        }
        const next: [Pt, Pt][] = [];
        let split = false;
        for (const [a, b] of cur) {
            const hits: { t: number; p: Pt }[] = [];
            for (const p of pts) {
                if (near(p, a, eps) || near(p, b, eps)) continue;
                const t = projectT(a, b, p);
                if (t <= eps || t >= 1 - eps) continue;
                const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
                if (hypot(p, q) < eps) hits.push({ t, p: [p[0], p[1]] });
            }
            if (hits.length === 0) {
                next.push([a, b]);
                continue;
            }
            split = true;
            hits.sort((u, v) => u.t - v.t);
            const uniq: { t: number; p: Pt }[] = [];
            for (const h of hits) {
                const last = uniq[uniq.length - 1];
                if (!last || hypot(last.p, h.p) >= eps) uniq.push(h);
            }
            let prev = a;
            for (const h of uniq) {
                if (hypot(prev, h.p) >= eps) next.push([prev, h.p]);
                prev = h.p;
            }
            if (hypot(prev, b) >= eps) next.push([prev, b]);
        }
        cur = next;
        if (!split) break;
    }
    return cur;
}

function endpointDegrees(segs: [Pt, Pt][], eps: number): number[] {
    const deg = new Array(segs.length * 2).fill(0);
    for (let i = 0; i < segs.length; i++) {
        for (let e = 0; e < 2; e++) {
            const p = segs[i][e];
            for (let j = 0; j < segs.length; j++) {
                if (j === i) continue;
                if (near(p, segs[j][0], eps) || near(p, segs[j][1], eps)) {
                    deg[i * 2 + e]++;
                    break;
                }
            }
        }
    }
    return deg;
}

function startSegmentOrder(segs: [Pt, Pt][], degree: number[]): number[] {
    const idx = segs.map((_, i) => i);
    idx.sort((a, b) => {
        const da = Math.min(degree[a * 2], degree[a * 2 + 1]);
        const db = Math.min(degree[b * 2], degree[b * 2 + 1]);
        return da - db || a - b;
    });
    return idx;
}

function walkChain(
    segs: [Pt, Pt][],
    used: boolean[],
    start: number,
    eps: number,
    stopAtJunction: boolean,
): Pt[] {
    used[start] = true;
    const pts: Pt[] = [segs[start][0], segs[start][1]];
    let grew = true;
    while (grew) {
        grew = false;
        const tailHit = findJoin(segs, used, pts[pts.length - 1], eps, stopAtJunction);
        if (tailHit) {
            used[tailHit.j] = true;
            pts.push(tailHit.other);
            grew = true;
        }
        const headHit = findJoin(segs, used, pts[0], eps, stopAtJunction);
        if (headHit) {
            used[headHit.j] = true;
            pts.unshift(headHit.other);
            grew = true;
        }
    }
    return pts;
}

function findJoin(
    segs: [Pt, Pt][],
    used: boolean[],
    pt: Pt,
    eps: number,
    stopAtJunction: boolean,
): { j: number; other: Pt } | null {
    const hits: { j: number; other: Pt; d: number }[] = [];
    for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const d0 = hypot(pt, segs[j][0]);
        const d1 = hypot(pt, segs[j][1]);
        if (d0 <= eps) hits.push({ j, other: segs[j][1], d: d0 });
        if (d1 <= eps) hits.push({ j, other: segs[j][0], d: d1 });
    }
    if (hits.length === 0) return null;
    if (stopAtJunction && hits.length > 1) return null;
    hits.sort((a, b) => a.d - b.d || a.j - b.j);
    return hits[0];
}

function shouldClose(chain: Pt[], eps: number, beltY: number | undefined): boolean {
    const a = chain[0];
    const b = chain[chain.length - 1];
    if (hypot(a, b) <= eps) return true;
    if (beltY === undefined) return false;
    if (Math.abs(a[1] - beltY) > BELT_ON_EPS || Math.abs(b[1] - beltY) > BELT_ON_EPS) return false;
    return chain.some((p) => Math.abs(p[1] - beltY) > BELT_ON_EPS);
}

function ringContainedIn(inner: Pt[], outer: Pt[]): boolean {
    if (inner.length === 0) return false;
    let hits = 0;
    for (const p of inner) {
        if (pointInPoly(outer, p)) hits++;
    }
    return hits > inner.length / 2;
}

function reverseRing(loop: Pt[]): Pt[] {
    const out = loop.slice();
    out.reverse();
    return out;
}

function projectT(a: Pt, b: Pt, p: Pt): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const den = dx * dx + dy * dy;
    if (den < 1e-24) return 0;
    return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den;
}

function near(a: Pt, b: Pt, eps: number): boolean {
    return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
}

function hypot(a: Pt, b: Pt): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
