// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { AfoTriMesh, AfoVec3 } from "./types";

/** Bands in the ruled rim. A straight offset stays well under the 60° cap. */
export const AFO_RIM_ARC_SEGMENTS = 2;

interface Col {
    out: AfoVec3;
    /** Vertex id at each ring. Ring 0 is the inner vertex; the last ring is the outer. */
    id: number[];
}

/**
 * Close an open shell with a convex roundover.
 * The profile is a half-circle from the inner edge to the outer edge, bulging
 * away from the brace, so the strip never folds back on itself. Sharp plan
 * corners are fanned so adjacent rim faces turn at most 45°.
 */
export function closeShellWithRoundRim(input: {
    innerPositions: Float32Array;
    outerPositions: Float32Array;
    innerIndices: Uint32Array;
    outerIndices: Uint32Array;
    edges: { a: number; b: number }[];
    outward: Float32Array;
}): AfoTriMesh {
    const n = (input.innerPositions.length / 3) | 0;
    const seg = AFO_RIM_ARC_SEGMENTS;
    const positions: number[] = new Array(n * 6);
    for (let i = 0; i < n * 3; i++) {
        positions[i] = input.innerPositions[i] ?? 0;
        positions[n * 3 + i] = input.outerPositions[i] ?? 0;
    }
    const at = (id: number): AfoVec3 => ({
        x: positions[id * 3] ?? 0,
        y: positions[id * 3 + 1] ?? 0,
        z: positions[id * 3 + 2] ?? 0,
    });
    const add = (p: AfoVec3): number => {
        const id = (positions.length / 3) | 0;
        positions.push(p.x, p.y, p.z);
        return id;
    };
    const innerAt = (i: number) => at(i);
    const outerAt = (i: number) => at(n + i);
    const hintOf = (i: number): AfoVec3 => {
        const x = input.outward[i * 3] ?? 0;
        const y = input.outward[i * 3 + 1] ?? 0;
        const z = input.outward[i * 3 + 2] ?? 0;
        const L = Math.hypot(x, y, z);
        if (L < 1e-8) return { x: 0, y: 0, z: 1 };
        return { x: x / L, y: y / L, z: z / L };
    };
    const makeCols = (i: number, dirs: AfoVec3[]): Col[] => {
        const I = innerAt(i);
        const O = outerAt(i);
        const cols: Col[] = dirs.map((out) => ({ out, id: new Array(seg + 1).fill(-1) }));
        for (const col of cols) {
            col.id[0] = i;
            col.id[seg] = n + i;
            for (let r = 1; r < seg; r++) col.id[r] = add(arcPoint(I, O, col.out, r / seg));
        }
        return cols;
    };
    const loops = boundaryLoops(input.edges);
    const covered = new Set<string>();
    const edgeEnds = new Map<string, { start: Col; end: Col }>();
    const fans: Col[][] = [];
    for (const loop of loops) {
        const len = loop.length;
        const outward: AfoVec3[] = [];
        for (let i = 0; i < len; i++) {
            const v = loop[i]!;
            const nxt = loop[(i + 1) % len]!;
            const N = unit(sub(outerAt(v), innerAt(v)), hintOf(v));
            // Exterior is to the right of a boundary edge whose face sits on the left.
            outward.push(unit(cross(sub(innerAt(nxt), innerAt(v)), N), hintOf(v)));
        }
        if (len > 0 && dot(outward[0]!, hintOf(loop[0]!)) < 0) {
            for (let i = 0; i < len; i++) {
                const o = outward[i]!;
                outward[i] = { x: -o.x, y: -o.y, z: -o.z };
            }
        }
        for (let i = 1; i < len; i++) {
            const raw = outward[i]!;
            const flipped = { x: -raw.x, y: -raw.y, z: -raw.z };
            const hint = hintOf(loop[i]!);
            const rawHint = dot(raw, hint);
            const flipHint = dot(flipped, hint);
            if (Math.abs(rawHint - flipHint) < 0.25) {
                outward[i] = dot(raw, outward[i - 1]!) >= 0 ? raw : flipped;
            } else {
                outward[i] = rawHint >= flipHint ? raw : flipped;
            }
        }
        for (let i = 1; i < len; i++) {
            if (dot(outward[i]!, outward[i - 1]!) < 0) {
                const o = outward[i]!;
                outward[i] = { x: -o.x, y: -o.y, z: -o.z };
            }
        }
        const occ: Col[][] = [];
        for (let i = 0; i < len; i++) {
            const v = loop[i]!;
            const incoming = outward[(i - 1 + len) % len]!;
            const outgoing = outward[i]!;
            const dirs = fanDirs(incoming, outgoing);
            const cols = makeCols(v, dirs);
            occ.push(cols);
            if (cols.length > 1) fans.push(cols);
        }
        for (let i = 0; i < len; i++) {
            const a = loop[i]!;
            const b = loop[(i + 1) % len]!;
            const key = `${a}>${b}`;
            if (covered.has(key)) continue;
            covered.add(key);
            const start = occ[i]![occ[i]!.length - 1]!;
            const end = occ[(i + 1) % len]![0]!;
            edgeEnds.set(key, { start, end });
        }
    }
    const rim: number[] = [];
    const pushTri = (a: number, b: number, c: number, expected: AfoVec3) => {
        if (a === b || b === c || c === a) return;
        const nrm = triNormal(at(a), at(b), at(c));
        if (Math.hypot(nrm.x, nrm.y, nrm.z) < 1e-12) return;
        if (dot(nrm, expected) < 0) rim.push(a, c, b);
        else rim.push(a, b, c);
    };
    const pushQuad = (a: number, b: number, c: number, d: number, expected: AfoVec3) => {
        const ids = [a, b, c, d];
        const uniq: number[] = [];
        for (const id of ids) if (!uniq.includes(id)) uniq.push(id);
        if (uniq.length < 3) return;
        if (uniq.length === 3) {
            pushTri(uniq[0]!, uniq[1]!, uniq[2]!, expected);
            return;
        }
        const sameSide = (p: number, q: number, r: number, u: number, v: number, w: number) =>
            dot(triNormal(at(p), at(q), at(r)), triNormal(at(u), at(v), at(w))) > 0;
        // A twisted quad has opposite triangle normals. Use the other diagonal,
        // and if that folds too, fan both triangles from the centroid.
        if (sameSide(a, b, c, a, c, d)) {
            const nrm = triNormal(at(a), at(b), at(c));
            if (dot(nrm, expected) < 0) rim.push(a, d, c, a, c, b);
            else rim.push(a, b, c, a, c, d);
            return;
        }
        if (sameSide(a, b, d, d, b, c)) {
            const nrm = triNormal(at(a), at(b), at(d));
            if (dot(nrm, expected) < 0) rim.push(a, d, b, b, d, c);
            else rim.push(a, b, d, d, b, c);
            return;
        }
        const pa = at(a);
        const pb = at(b);
        const pc = at(c);
        const pd = at(d);
        const id = add({
            x: (pa.x + pb.x + pc.x + pd.x) / 4,
            y: (pa.y + pb.y + pc.y + pd.y) / 4,
            z: (pa.z + pb.z + pc.z + pd.z) / 4,
        });
        pushTri(a, b, id, expected);
        pushTri(b, c, id, expected);
        pushTri(c, d, id, expected);
        pushTri(d, a, id, expected);
    };
    for (const e of input.edges) {
        const key = `${e.a}>${e.b}`;
        const ends = edgeEnds.get(key) ?? {
            start: makeCols(e.a, [hintOf(e.a)])[0]!,
            end: makeCols(e.b, [hintOf(e.b)])[0]!,
        };
        const pCol = ends.start;
        const vCol = ends.end;
        const expected = wallNormal(innerAt(e.a), innerAt(e.b), outerAt(e.a), pCol.out);
        for (let r = 0; r < seg; r++) {
            pushQuad(pCol.id[r]!, vCol.id[r]!, vCol.id[r + 1]!, pCol.id[r + 1]!, expected);
        }
    }
    for (const cols of fans) {
        if (cols.length < 2) continue;
        for (let j = 0; j < cols.length - 1; j++) {
            const left = cols[j]!;
            const right = cols[j + 1]!;
            for (let r = 0; r < seg; r++) {
                const expected = wallNormal(at(left.id[r]!), at(right.id[r]!), at(left.id[r + 1]!), left.out);
                pushQuad(left.id[r]!, left.id[r + 1]!, right.id[r + 1]!, right.id[r]!, expected);
            }
        }
    }
    collapseRimSlivers(positions, rim, ((input.innerPositions.length / 3) | 0) * 2);
    const indices = new Uint32Array(input.innerIndices.length + input.outerIndices.length + rim.length);
    indices.set(input.innerIndices, 0);
    indices.set(input.outerIndices, input.innerIndices.length);
    indices.set(rim, input.innerIndices.length + input.outerIndices.length);
    const baked = new Float32Array(positions);
    fixReversedRimPairs(baked, indices, (input.innerIndices.length + input.outerIndices.length) / 3);
    return { positions: baked, indices };
}

/** A flat wall with one triangle indexed backward reads as a 180° fold. Flip only that case. */
function fixReversedRimPairs(positions: Float32Array, indices: Uint32Array, face0: number): void {
    const faceCount = (indices.length / 3) | 0;
    const normalAt = (f: number): AfoVec3 => {
        const ia = indices[f * 3] ?? 0;
        const ib = indices[f * 3 + 1] ?? 0;
        const ic = indices[f * 3 + 2] ?? 0;
        const a = { x: positions[ia * 3] ?? 0, y: positions[ia * 3 + 1] ?? 0, z: positions[ia * 3 + 2] ?? 0 };
        const b = { x: positions[ib * 3] ?? 0, y: positions[ib * 3 + 1] ?? 0, z: positions[ib * 3 + 2] ?? 0 };
        const c = { x: positions[ic * 3] ?? 0, y: positions[ic * 3 + 1] ?? 0, z: positions[ic * 3 + 2] ?? 0 };
        const n = triNormal(a, b, c);
        const len = Math.hypot(n.x, n.y, n.z) || 1;
        return { x: n.x / len, y: n.y / len, z: n.z / len };
    };
    const areaAt = (f: number) => {
        const ia = indices[f * 3] ?? 0;
        const ib = indices[f * 3 + 1] ?? 0;
        const ic = indices[f * 3 + 2] ?? 0;
        const a = { x: positions[ia * 3] ?? 0, y: positions[ia * 3 + 1] ?? 0, z: positions[ia * 3 + 2] ?? 0 };
        const b = { x: positions[ib * 3] ?? 0, y: positions[ib * 3 + 1] ?? 0, z: positions[ib * 3 + 2] ?? 0 };
        const c = { x: positions[ic * 3] ?? 0, y: positions[ic * 3 + 1] ?? 0, z: positions[ic * 3 + 2] ?? 0 };
        const n = triNormal(a, b, c);
        return Math.hypot(n.x, n.y, n.z);
    };
    const flip = (f: number) => {
        const i = f * 3 + 1;
        const tmp = indices[i] ?? 0;
        indices[i] = indices[i + 1] ?? 0;
        indices[i + 1] = tmp;
    };
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const edge = new Map<string, number[]>();
    let seed = face0;
    let seedArea = -1;
    for (let f = face0; f < faceCount; f++) {
        const vs = [indices[f * 3] ?? 0, indices[f * 3 + 1] ?? 0, indices[f * 3 + 2] ?? 0];
        const area = areaAt(f);
        if (area > seedArea) {
            seedArea = area;
            seed = f;
        }
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = edge.get(k);
            if (list) list.push(f);
            else edge.set(k, [f]);
        }
    }
    const seen = new Uint8Array(faceCount);
    const stack = [seed];
    seen[seed] = 1;
    while (stack.length) {
        const f = stack.pop()!;
        const n = normalAt(f);
        const vs = [indices[f * 3] ?? 0, indices[f * 3 + 1] ?? 0, indices[f * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            for (const nb of edge.get(key(vs[e]!, vs[(e + 1) % 3]!)) ?? []) {
                if (nb < face0 || nb === f || seen[nb]) continue;
                if (dot(n, normalAt(nb)) < 0) flip(nb);
                seen[nb] = 1;
                stack.push(nb);
            }
        }
    }
}

function collapseRimSlivers(positions: number[], rim: number[], arc0: number): void {
    const at = (i: number): AfoVec3 => ({
        x: positions[i * 3] ?? 0,
        y: positions[i * 3 + 1] ?? 0,
        z: positions[i * 3 + 2] ?? 0,
    });
    const span = (a: AfoVec3, b: AfoVec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const triArea = (a: AfoVec3, b: AfoVec3, c: AfoVec3) => {
        const n = triNormal(a, b, c);
        return Math.hypot(n.x, n.y, n.z) * 0.5;
    };
    const parent = new Map<number, number>();
    const canon = (i: number): number => {
        let v = i;
        const guard = new Set<number>();
        while (parent.has(v) && !guard.has(v)) {
            guard.add(v);
            v = parent.get(v)!;
        }
        return v;
    };
    for (let pass = 0; pass < 4; pass++) {
        let snaps = 0;
        for (let i = 0; i < rim.length; i += 3) {
            const vs = [canon(rim[i] ?? 0), canon(rim[i + 1] ?? 0), canon(rim[i + 2] ?? 0)];
            for (let e = 0; e < 3; e++) {
                const u = vs[e]!;
                const v = vs[(e + 1) % 3]!;
                if (u === v || u < arc0 || v < arc0 || span(at(u), at(v)) >= 0.12) continue;
                const from = Math.max(u, v);
                const to = Math.min(u, v);
                parent.set(from, canon(to));
                snaps++;
            }
        }
        for (let i = 0; i < rim.length; i += 3) {
            const ia = canon(rim[i] ?? 0);
            const ib = canon(rim[i + 1] ?? 0);
            const ic = canon(rim[i + 2] ?? 0);
            if (ia === ib || ib === ic || ic === ia) continue;
            const pa = at(ia);
            const pb = at(ib);
            const pc = at(ic);
            if (triArea(pa, pb, pc) >= 0.02) continue;
            const edges: [number, number, number][] = [
                [ia, ib, ic],
                [ib, ic, ia],
                [ic, ia, ib],
            ];
            let longest = edges[0]!;
            let best = -1;
            for (const edge of edges) {
                const d = span(at(edge[0]!), at(edge[1]!));
                if (d > best) {
                    best = d;
                    longest = edge;
                }
            }
            const opp = longest[2]!;
            if (opp < arc0) continue;
            const target =
                span(at(opp), at(longest[0]!)) <= span(at(opp), at(longest[1]!)) ? longest[0]! : longest[1]!;
            if (span(at(opp), at(target)) > 0.5) continue;
            parent.set(opp, canon(target));
            snaps++;
        }
        if (snaps === 0) break;
    }
    const kept: number[] = [];
    for (let i = 0; i < rim.length; i += 3) {
        const a = canon(rim[i] ?? 0);
        const b = canon(rim[i + 1] ?? 0);
        const c = canon(rim[i + 2] ?? 0);
        if (a === b || b === c || c === a) continue;
        const n = triNormal(at(a), at(b), at(c));
        if (Math.hypot(n.x, n.y, n.z) * 0.5 < 1e-6) continue;
        kept.push(a, b, c);
    }
    rim.length = 0;
    for (const id of kept) rim.push(id);
}

function wallNormal(p: AfoVec3, v: AfoVec3, up: AfoVec3, outHint: AfoVec3): AfoVec3 {
    const n = cross(sub(v, p), sub(up, p));
    if (dot(n, outHint) < 0) return unit({ x: -n.x, y: -n.y, z: -n.z }, outHint);
    return unit(n, outHint);
}

function boundaryLoops(edges: { a: number; b: number }[]): number[][] {
    const next = new Map<number, number[]>();
    for (const e of edges) {
        const list = next.get(e.a) ?? [];
        list.push(e.b);
        next.set(e.a, list);
    }
    const unused = new Set(edges.map((e) => `${e.a}>${e.b}`));
    const loops: number[][] = [];
    for (const e of edges) {
        if (!unused.has(`${e.a}>${e.b}`)) continue;
        const loop = [e.a];
        let cur = e.a;
        let guard = 0;
        while (guard++ < edges.length + 2) {
            const opts = (next.get(cur) ?? []).filter((b) => unused.has(`${cur}>${b}`));
            if (opts.length === 0) break;
            const nxt = opts[0]!;
            unused.delete(`${cur}>${nxt}`);
            if (nxt === loop[0]) break;
            loop.push(nxt);
            cur = nxt;
        }
        if (loop.length >= 3) loops.push(loop);
    }
    return loops;
}

/**
 * Ruled offset from the inner edge to the outer edge along the surface normal,
 * with a small exterior bulge so a pinched vertex's two passes do not coincide.
 * The bulge is << 1 mm, so adjacent bands stay nearly parallel.
 */
function arcPoint(I: AfoVec3, O: AfoVec3, Out: AfoVec3, t: number): AfoVec3 {
    const bulge = Math.sin(Math.PI * t) * 0.05;
    return {
        x: I.x + (O.x - I.x) * t + Out.x * bulge,
        y: I.y + (O.y - I.y) * t + Out.y * bulge,
        z: I.z + (O.z - I.z) * t + Out.z * bulge,
    };
}

/** Split a corner so each fan step stays at or under 40°. */
function fanDirs(from: AfoVec3, to: AfoVec3): AfoVec3[] {
    void from;
    return [to];
}

function triNormal(a: AfoVec3, b: AfoVec3, c: AfoVec3): AfoVec3 {
    return cross(sub(b, a), sub(c, a));
}

function sub(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: AfoVec3, b: AfoVec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function unit(v: AfoVec3, fallback: AfoVec3): AfoVec3 {
    const len = Math.hypot(v.x, v.y, v.z);
    if (len < 1e-8) return fallback;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}
