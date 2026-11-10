// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { AfoTriMesh, AfoVec3 } from "./types";

/** Quarter-turns of the opening. 180° / 4 = 45°, under the 60° dihedral cap. */
export const AFO_RIM_ARC_SEGMENTS = 4;

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
            const Oin = outward[i]!;
            const dirs: AfoVec3[] = [Oin];
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
        if (Math.hypot(nrm.x, nrm.y, nrm.z) < 1e-8) return;
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
        void expected;
        rim.push(a, b, c, a, c, d);
    };
    const expectedAt = (i: number, out: AfoVec3, t: number) => arcRadial(innerAt(i), outerAt(i), out, t);
    for (const e of input.edges) {
        const key = `${e.a}>${e.b}`;
        const ends = edgeEnds.get(key) ?? {
            start: makeCols(e.a, [hintOf(e.a)])[0]!,
            end: makeCols(e.b, [hintOf(e.b)])[0]!,
        };
        const pCol = ends.start;
        const vCol = ends.end;
        for (let r = 0; r < seg; r++) {
            const t = (r + 0.5) / seg;
            const expected = unit(add(expectedAt(e.a, pCol.out, t), expectedAt(e.b, vCol.out, t)), pCol.out);
            pushQuad(pCol.id[r]!, vCol.id[r]!, vCol.id[r + 1]!, pCol.id[r + 1]!, expected);
        }
    }
    for (const cols of fans) {
        if (cols.length < 2) continue;
        const i = cols[0]!.id[0]!;
        for (let j = 0; j < cols.length - 1; j++) {
            const left = cols[j]!;
            const right = cols[j + 1]!;
            for (let r = 0; r < seg; r++) {
                const t = (r + 0.5) / seg;
                const expected = unit(add(expectedAt(i, left.out, t), expectedAt(i, right.out, t)), left.out);
                pushQuad(left.id[r]!, right.id[r]!, right.id[r + 1]!, left.id[r + 1]!, expected);
            }
        }
    }
    const indices = new Uint32Array(input.innerIndices.length + input.outerIndices.length + rim.length);
    indices.set(input.innerIndices, 0);
    indices.set(input.outerIndices, input.innerIndices.length);
    indices.set(rim, input.innerIndices.length + input.outerIndices.length);
    return { positions: new Float32Array(positions), indices };
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

function arcPoint(I: AfoVec3, O: AfoVec3, Out: AfoVec3, t: number): AfoVec3 {
    // Ruled wall with a slight exterior bulge so a pinched vertex's two
    // loops do not land on the same point. The bulge is << 1 mm.
    const s = Math.sin(Math.PI * t) * 0.08;
    return {
        x: I.x + (O.x - I.x) * t + Out.x * s,
        y: I.y + (O.y - I.y) * t + Out.y * s,
        z: I.z + (O.z - I.z) * t + Out.z * s,
    };
}

function arcRadial(I: AfoVec3, O: AfoVec3, Out: AfoVec3, t: number): AfoVec3 {
    const M = { x: (I.x + O.x) * 0.5, y: (I.y + O.y) * 0.5, z: (I.z + O.z) * 0.5 };
    return sub(arcPoint(I, O, Out, t), M);
}

function triNormal(a: AfoVec3, b: AfoVec3, c: AfoVec3): AfoVec3 {
    return cross(sub(b, a), sub(c, a));
}

function add(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
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
    const L = Math.hypot(v.x, v.y, v.z);
    if (L < 1e-8) return fallback;
    return { x: v.x / L, y: v.y / L, z: v.z / L };
}
