// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { AfoTriMesh, AfoVec3 } from "./types";

/** Bands in the ruled rim. A straight offset stays well under the 60° cap. */
export const AFO_RIM_ARC_SEGMENTS = 2;

/**
 * Close an open shell with a ruled rim from the inner boundary to the outer
 * boundary. Offset steps that would twist a quad share one normal, and the
 * intermediate ring is smoothed without moving either boundary loop.
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
    const loops = boundaryLoops(input.edges);
    for (const loop of loops) clampConcaveOffset(positions, n, loop);
    const rim: number[] = [];
    const smoothRings: number[][][] = [];
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
        const nrm = triNormal(at(a), at(b), at(c));
        if (dot(nrm, expected) < 0) rim.push(a, d, c, a, c, b);
        else rim.push(a, b, c, a, c, d);
    };
    for (const loop of loops) {
        if (loop.length < 3) continue;
        const len = loop.length;
        const rings: number[][] = Array.from({ length: seg + 1 }, () => new Array<number>(len));
        for (let i = 0; i < len; i++) {
            const v = loop[i]!;
            const I = innerAt(v);
            const O = outerAt(v);
            const Out = hintOf(v);
            rings[0]![i] = v;
            rings[seg]![i] = n + v;
            for (let r = 1; r < seg; r++) rings[r]![i] = add(arcPoint(I, O, Out, r / seg));
        }
        for (let i = 0; i < len; i++) {
            const i1 = (i + 1) % len;
            const hint = hintOf(loop[i]!);
            const expected = wallNormal(at(rings[0]![i]!), at(rings[0]![i1]!), at(rings[seg]![i]!), hint);
            for (let r = 0; r < seg; r++) {
                pushQuad(rings[r]![i]!, rings[r]![i1]!, rings[r + 1]![i1]!, rings[r + 1]![i]!, expected);
            }
        }
        smoothRings.push(rings);
    }
    for (const rings of smoothRings) tangentialSmooth(positions, rings, 2);
    collapseRimSlivers(positions, rim, ((input.innerPositions.length / 3) | 0) * 2);
    const indices = new Uint32Array(input.innerIndices.length + input.outerIndices.length + rim.length);
    indices.set(input.innerIndices, 0);
    indices.set(input.outerIndices, input.innerIndices.length);
    indices.set(rim, input.innerIndices.length + input.outerIndices.length);
    const baked = new Float32Array(positions);
    const rimFaceStart = (input.innerIndices.length + input.outerIndices.length) / 3;
    fixReversedRimPairs(baked, indices, rimFaceStart);
    return {
        positions: baked,
        indices,
        rimFaceStart,
        outerVertex0: n,
    };
}

/**
 * Replace the long edge of a sliver with the diagonal to the neighbour across
 * it. Positions stay put, so the opening does not move, and both new faces
 * keep the old orientation.
 */
function flipLongEdge(
    faces: { v: [number, number, number]; kind: number }[],
    edge: Map<string, number[]>,
    face: { v: [number, number, number]; kind: number },
    longA: number,
    longB: number,
    peak: number,
    n: number,
    positions: Float32Array,
    key: (a: number, b: number) => string,
): boolean {
    const hosts = edge.get(key(longA, longB)) ?? [];
    if (hosts.length !== 2) return false;
    const self = hosts.find((f) => faces[f] === face);
    const otherIndex = hosts[0] === self ? hosts[1]! : hosts[0]!;
    const other = faces[otherIndex];
    if (!other || other.kind !== face.kind) return false;
    const opp = other.v.find((v) => v !== longA && v !== longB);
    if (opp == null || opp === peak) return false;
    if (edge.has(key(peak, opp))) return false;
    const skin = (v: number) => (face.kind === 0 ? v < n : v >= n && v < n * 2);
    if (!skin(opp) || !skin(peak)) return false;
    const at = (i: number) => ({
        x: positions[i * 3] ?? 0,
        y: positions[i * 3 + 1] ?? 0,
        z: positions[i * 3 + 2] ?? 0,
    });
    const nrm = (a: number, b: number, c: number) => triNormal(at(a), at(b), at(c));
    const oldA = nrm(face.v[0], face.v[1], face.v[2]);
    const oldB = nrm(other.v[0], other.v[1], other.v[2]);
    const ref = { x: oldA.x + oldB.x, y: oldA.y + oldB.y, z: oldA.z + oldB.z };
    const area = (v: AfoVec3) => Math.hypot(v.x, v.y, v.z) * 0.5;
    const agree = (v: AfoVec3) => v.x * ref.x + v.y * ref.y + v.z * ref.z > 0;
    const options: [number, number, number, number, number, number][] = [
        [longA, opp, peak, opp, longB, peak],
        [longA, peak, opp, peak, longB, opp],
    ];
    const sameDir = (u: number, v: number) => {
        for (const fi of edge.get(key(u, v)) ?? []) {
            const host = faces[fi];
            if (!host || host === face || host === other) continue;
            const vs = host.v;
            for (let e = 0; e < 3; e++) if (vs[e] === u && vs[(e + 1) % 3] === v) return true;
        }
        return false;
    };
    for (const c of options) {
        const na = nrm(c[0], c[1], c[2]);
        const nb = nrm(c[3], c[4], c[5]);
        if (area(na) < 1e-6 || area(nb) < 1e-6) continue;
        if (!agree(na) || !agree(nb)) continue;
        const lena = Math.hypot(na.x, na.y, na.z) || 1;
        const lenb = Math.hypot(nb.x, nb.y, nb.z) || 1;
        const dot = (na.x * nb.x + na.y * nb.y + na.z * nb.z) / (lena * lenb);
        if (dot < Math.cos((60 * Math.PI) / 180)) continue;
        const dirs: [number, number][] = [
            [c[0], c[1]],
            [c[1], c[2]],
            [c[2], c[0]],
            [c[3], c[4]],
            [c[4], c[5]],
            [c[5], c[3]],
        ];
        if (dirs.some(([u, v]) => sameDir(u, v))) continue;
        face.v = [c[0], c[1], c[2]];
        other.v = [c[3], c[4], c[5]];
        edge.delete(key(longA, longB));
        edge.set(key(peak, opp), [hosts[0]!, hosts[1]!]);
        return true;
    }
    return false;
}

/**
 * A thin triangle along the opening folds when its vertices take slightly
 * different offsets. Collapse a short edge at its midpoint, or flip the long
 * edge with its neighbour. Moving a vertex onto the long edge is not used:
 * that leaves a zero-area triangle.
 */
function repairOuterLipSlivers(
    positions: Float32Array,
    indices: Uint32Array,
    n: number,
    _rimFaceStart: number,
    boundary: Set<number>,
): { indices: Uint32Array; rimFaceStart: number } {
    type Kind = 0 | 1 | 2;
    const faces: { v: [number, number, number]; kind: Kind }[] = [];
    const triCount = (indices.length / 3) | 0;
    for (let f = 0; f < triCount; f++) {
        const v: [number, number, number] = [
            indices[f * 3] ?? 0,
            indices[f * 3 + 1] ?? 0,
            indices[f * 3 + 2] ?? 0,
        ];
        const onInner = v.every((id) => id < n);
        const onOuter = v.every((id) => id >= n && id < n * 2);
        const kind: Kind = onInner ? 0 : onOuter ? 1 : 2;
        faces.push({ v, kind });
    }
    const at = (i: number): AfoVec3 => ({
        x: positions[i * 3] ?? 0,
        y: positions[i * 3 + 1] ?? 0,
        z: positions[i * 3 + 2] ?? 0,
    });
    const span = (a: number, b: number) => {
        const p = at(a);
        const q = at(b);
        return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    };
    const areaOf = (a: number, b: number, c: number) => {
        const nrm = triNormal(at(a), at(b), at(c));
        return Math.hypot(nrm.x, nrm.y, nrm.z) * 0.5;
    };
    const unitN = (a: number, b: number, c: number): AfoVec3 => {
        const nrm = triNormal(at(a), at(b), at(c));
        const len = Math.hypot(nrm.x, nrm.y, nrm.z) || 1;
        return { x: nrm.x / len, y: nrm.y / len, z: nrm.z / len };
    };
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const cos60 = Math.cos((60 * Math.PI) / 180);
    const alive = (f: { v: [number, number, number] }) =>
        f.v[0] !== f.v[1] && f.v[1] !== f.v[2] && f.v[2] !== f.v[0];
    const near = new Set<number>();
    for (const id of boundary) {
        near.add(id);
        if (id < n) near.add(id + n);
    }
    const link = new Map<number, number[]>();
    const join = (u: number, v: number) => {
        const list = link.get(u) ?? [];
        list.push(v);
        link.set(u, list);
    };
    for (const face of faces) {
        if (!alive(face)) continue;
        join(face.v[0], face.v[1]);
        join(face.v[1], face.v[2]);
        join(face.v[2], face.v[0]);
    }
    const hops = new Map<number, number>();
    const queue = [...near];
    for (const id of queue) hops.set(id, 0);
    for (let q = 0; q < queue.length; q++) {
        const u = queue[q]!;
        const hu = hops.get(u) ?? 0;
        if (hu >= 8) continue;
        for (const w of link.get(u) ?? []) {
            if (hops.has(w)) continue;
            hops.set(w, hu + 1);
            near.add(w);
            queue.push(w);
        }
    }
    for (let pass = 0; pass < 1; pass++) {
        const edge = new Map<string, number[]>();
        for (let f = 0; f < faces.length; f++) {
            const face = faces[f]!;
            if (!alive(face)) continue;
            for (let e = 0; e < 3; e++) {
                const k = key(face.v[e]!, face.v[(e + 1) % 3]!);
                const list = edge.get(k);
                if (list) list.push(f);
                else edge.set(k, [f]);
            }
        }
        const rimVerts = new Set<number>();
        for (const face of faces) {
            if (face.kind !== 2 || !alive(face)) continue;
            rimVerts.add(face.v[0]);
            rimVerts.add(face.v[1]);
            rimVerts.add(face.v[2]);
        }
        let changed = false;
        for (let f = 0; f < faces.length; f++) {
            const face = faces[f]!;
            if (face.kind === 2 || !alive(face)) continue;
            const [a, b, c] = face.v;
            if (!near.has(a) && !near.has(b) && !near.has(c)) continue;
            const onSkin =
                face.kind === 0
                    ? a < n && b < n && c < n
                    : a >= n && a < n * 2 && b >= n && b < n * 2 && c >= n && c < n * 2;
            if (!onSkin) continue;
            const area = areaOf(a, b, c);
            if (area < 1e-8) continue;
            const mine = unitN(a, b, c);
            let worst = 1;
            for (const [u, v] of [
                [a, b],
                [b, c],
                [c, a],
            ] as const) {
                for (const nb of edge.get(key(u, v)) ?? []) {
                    if (nb === f || faces[nb]!.kind !== face.kind || !alive(faces[nb]!)) continue;
                    const nv = faces[nb]!.v;
                    const nn = unitN(nv[0], nv[1], nv[2]);
                    worst = Math.min(worst, mine.x * nn.x + mine.y * nn.y + mine.z * nn.z);
                }
            }
            // Never flip a face's winding. A reversed index hides the fold and
            // makes two triangles share a directed edge.
            if (area > 0.8 || worst >= cos60) continue;
            const pairs: [number, number, number][] = [
                [a, b, c],
                [b, c, a],
                [c, a, b],
            ];
            let long = pairs[0]!;
            let longLen = -1;
            for (const pair of pairs) {
                const len = span(pair[0], pair[1]);
                if (len > longLen) {
                    longLen = len;
                    long = pair;
                }
            }
            const altitude = longLen > 1e-6 ? (2 * area) / longLen : 0;
            const peak = long[2]!;
            const onOpening = (id: number) => boundary.has(id) || (id >= n && boundary.has(id - n));
            let short = pairs[0]!;
            let shortLen = Infinity;
            for (const pair of pairs) {
                const len = span(pair[0], pair[1]);
                if (len < shortLen) {
                    shortLen = len;
                    short = pair;
                }
            }
            // The old repair slid the peak onto the long edge and left a
            // zero-area triangle. Collapse a short edge, or flip the long
            // edge with its neighbour, and leave the surface where it is.
            if (
                area < 0.3 &&
                altitude < (onOpening(peak) ? 0.1 : 0.22) &&
                altitude > 1e-4 &&
                near.has(peak) &&
                peak !== n * 2 - 1 &&
                !rimVerts.has(peak)
            ) {
                const pu = at(long[0]!);
                const pw = at(long[1]!);
                const po = at(peak);
                const ex = pw.x - pu.x;
                const ey = pw.y - pu.y;
                const ez = pw.z - pu.z;
                const el2 = ex * ex + ey * ey + ez * ez || 1;
                const t = Math.min(
                    1,
                    Math.max(0, ((po.x - pu.x) * ex + (po.y - pu.y) * ey + (po.z - pu.z) * ez) / el2),
                );
                const endGap = Math.min(t, 1 - t) * longLen;
                let repaired = false;
                if (endGap > 0.02 && shortLen < 0.05 && shortLen > 1e-8) {
                    let from = short[0]!;
                    let to = short[1]!;
                    if (onOpening(from) && !onOpening(to)) {
                        const swap = from;
                        from = to;
                        to = swap;
                    }
                    const hosts = edge.get(key(short[0]!, short[1]!)) ?? [];
                    if (
                        hosts.length === 2 &&
                        !onOpening(from) &&
                        from !== n * 2 - 1 &&
                        to !== n * 2 - 1 &&
                        !rimVerts.has(from) &&
                        near.has(from)
                    ) {
                        if (!onOpening(to)) {
                            const mx = ((positions[from * 3] ?? 0) + (positions[to * 3] ?? 0)) * 0.5;
                            const my = ((positions[from * 3 + 1] ?? 0) + (positions[to * 3 + 1] ?? 0)) * 0.5;
                            const mz = ((positions[from * 3 + 2] ?? 0) + (positions[to * 3 + 2] ?? 0)) * 0.5;
                            positions[to * 3] = mx;
                            positions[to * 3 + 1] = my;
                            positions[to * 3 + 2] = mz;
                        }
                        for (const other of faces) {
                            for (let k = 0; k < 3; k++) if (other.v[k] === from) other.v[k] = to;
                        }
                        repaired = true;
                    }
                }
                if (
                    !repaired &&
                    endGap > 0.02 &&
                    flipLongEdge(faces, edge, face, long[0]!, long[1]!, peak, n, positions, key)
                ) {
                    repaired = true;
                }
                if (repaired) {
                    changed = true;
                    continue;
                }
            }
            if (shortLen > (area < 0.25 ? 0.6 : 0.15)) continue;
            let from = short[0]! < short[1]! ? short[1]! : short[0]!;
            let to = short[0]! < short[1]! ? short[0]! : short[1]!;
            if (boundary.has(from) && !boundary.has(to)) {
                const swap = from;
                from = to;
                to = swap;
            }
            if (boundary.has(from)) continue;
            // probeTaggedRim pairs i with n+i from the highest skin index.
            // Collapsing that last index would make (max+1)/2 not the pair count.
            if (from === n * 2 - 1 || to === n * 2 - 1) continue;
            if (!near.has(from)) continue;
            if (rimVerts.has(from)) continue;
            const hosts = edge.get(key(short[0]!, short[1]!)) ?? [];
            if (hosts.length !== 2) continue;
            for (const other of faces) {
                for (let k = 0; k < 3; k++) if (other.v[k] === from) other.v[k] = to;
            }
            changed = true;
        }
        if (!changed) break;
    }
    const kept = faces.filter((face) => alive(face));
    kept.sort((p, q) => p.kind - q.kind);
    const out = new Uint32Array(kept.length * 3);
    let rimAt = kept.length;
    for (let i = 0; i < kept.length; i++) {
        const face = kept[i]!;
        if (face.kind === 2 && rimAt === kept.length) rimAt = i;
        out[i * 3] = face.v[0];
        out[i * 3 + 1] = face.v[1];
        out[i * 3 + 2] = face.v[2];
    }
    return { indices: out, rimFaceStart: rimAt };
}

/** Run the lip repair on a finished shell, after any later vertex moves. */
export function finishShellLip(shell: AfoTriMesh): void {
    const nv = shell.outerVertex0;
    const face0 = shell.rimFaceStart;
    if (nv == null || face0 == null) return;
    const boundary = new Set<number>();
    const seen = new Map<string, number>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (!vs.every((v) => v < nv)) continue;
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            seen.set(k, (seen.get(k) ?? 0) + 1);
        }
    }
    for (const [k, count] of seen) {
        if (count !== 1) continue;
        const [a, b] = k.split("|").map(Number);
        boundary.add(a!);
        boundary.add(b!);
    }
    const repaired = repairOuterLipSlivers(shell.positions, shell.indices, nv, face0, boundary);
    shell.indices = repaired.indices;
    shell.rimFaceStart = repaired.rimFaceStart;
}

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
                if (u === v || u < arc0 || v < arc0 || span(at(u), at(v)) >= 0.05) continue;
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
            if (span(at(opp), at(target)) > 0.05) continue;
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

/**
 * Shorten the outer offset where the heel is concave enough that a full
 * edge-thickness step would make adjacent offset segments cross.
 * The radius check is the circumradius of three consecutive rim points.
 */
function clampConcaveOffset(positions: number[], n: number, loop: number[]): void {
    const len = loop.length;
    if (len < 3) return;
    const at = (id: number): AfoVec3 => ({
        x: positions[id * 3] ?? 0,
        y: positions[id * 3 + 1] ?? 0,
        z: positions[id * 3 + 2] ?? 0,
    });
    const P = loop.map((id) => at(id));
    const target = loop.map((id, i) =>
        Math.hypot(
            (positions[(n + id) * 3] ?? 0) - P[i]!.x,
            (positions[(n + id) * 3 + 1] ?? 0) - P[i]!.y,
            (positions[(n + id) * 3 + 2] ?? 0) - P[i]!.z,
        ),
    );
    const N = loop.map((id, i) =>
        unit(
            {
                x: (positions[(n + id) * 3] ?? 0) - P[i]!.x,
                y: (positions[(n + id) * 3 + 1] ?? 0) - P[i]!.y,
                z: (positions[(n + id) * 3 + 2] ?? 0) - P[i]!.z,
            },
            { x: 0, y: 0, z: 1 },
        ),
    );
    const d = target.slice();
    const placed = () =>
        P.map((p, i) => ({
            x: p.x + N[i]!.x * d[i]!,
            y: p.y + N[i]!.y * d[i]!,
            z: p.z + N[i]!.z * d[i]!,
        }));
    // A short boundary step amplifies a small normal change into a twisted quad:
    // the outer edge is the inner edge plus the offset difference. Share one
    // offset wherever that difference is more than a fifth of the step.
    const shareTwistedSteps = () => {
        let changed = false;
        for (let i = 0; i < len; i++) {
            const i1 = (i + 1) % len;
            const edgeLen = Math.hypot(P[i1]!.x - P[i]!.x, P[i1]!.y - P[i]!.y, P[i1]!.z - P[i]!.z);
            const o0 = { x: N[i]!.x * d[i]!, y: N[i]!.y * d[i]!, z: N[i]!.z * d[i]! };
            const o1 = { x: N[i1]!.x * d[i1]!, y: N[i1]!.y * d[i1]!, z: N[i1]!.z * d[i1]! };
            const delta = Math.hypot(o0.x - o1.x, o0.y - o1.y, o0.z - o1.z);
            if (delta <= Math.max(edgeLen * 0.2, 1e-4)) continue;
            const avg = { x: (o0.x + o1.x) * 0.5, y: (o0.y + o1.y) * 0.5, z: (o0.z + o1.z) * 0.5 };
            const dir = unit(avg, N[i]!);
            const cap = Math.min(target[i] ?? 0, target[i1] ?? 0);
            const floor = Math.max(0, cap - 0.08);
            const sharedLen = Math.min(cap, Math.max(floor, Math.hypot(avg.x, avg.y, avg.z)));
            N[i] = { x: dir.x, y: dir.y, z: dir.z };
            N[i1] = { x: dir.x, y: dir.y, z: dir.z };
            d[i] = sharedLen;
            d[i1] = sharedLen;
            changed = true;
        }
        return changed;
    };
    for (let iter = 0; iter < 48; iter++) {
        if (!shareTwistedSteps()) break;
    }
    for (let iter = 0; iter < 8; iter++) {
        const Q = placed();
        let changed = false;
        for (let i = 0; i < len; i++) {
            const i0 = (i - 1 + len) % len;
            const i1 = (i + 1) % len;
            const edge = sub(P[i1]!, P[i]!);
            const offsetEdge = sub(Q[i1]!, Q[i]!);
            const radius = circumradius(P[i0]!, P[i]!, P[i1]!);
            const center = circumcenter(P[i0]!, P[i]!, P[i1]!);
            let concave = false;
            if (center && radius < 1e5 && radius > 1e-4) {
                const toward = unit(sub(center, P[i]!), N[i]!);
                concave = dot(N[i]!, toward) > 0;
                if (concave && d[i]! > radius * 0.85) {
                    d[i] = Math.max(target[i]! - 0.08, radius * 0.85);
                    changed = true;
                }
            }
            if (dot(edge, offsetEdge) < 0 || segmentsCross(P[i]!, Q[i]!, P[i1]!, Q[i1]!)) {
                const floor = Math.max(target[i]! - 0.08, 0);
                const floor1 = Math.max(target[i1]! - 0.08, 0);
                if (d[i]! > floor + 1e-4 || d[i1]! > floor1 + 1e-4) {
                    d[i] = Math.max(floor, d[i]! * 0.8);
                    d[i1] = Math.max(floor1, d[i1]! * 0.8);
                    changed = true;
                }
            }
        }
        if (!changed) break;
    }
    for (let iter = 0; iter < 48; iter++) {
        if (!shareTwistedSteps()) break;
    }
    for (let iter = 0; iter < 8; iter++) {
        const placedNow = placed();
        let changed = false;
        for (let i = 0; i < len; i++) {
            const i1 = (i + 1) % len;
            const crossed =
                segmentsCross(P[i]!, placedNow[i]!, P[i1]!, placedNow[i1]!, 0.02) ||
                segmentsCross(P[i]!, P[i1]!, placedNow[i]!, placedNow[i1]!, 0.02);
            if (!crossed) continue;
            const floor = Math.max((target[i] ?? 0) - 0.08, 0);
            const floor1 = Math.max((target[i1] ?? 0) - 0.08, 0);
            if ((d[i] ?? 0) <= floor + 1e-4 && (d[i1] ?? 0) <= floor1 + 1e-4) continue;
            d[i] = Math.max(floor, (d[i] ?? 0) * 0.85);
            d[i1] = Math.max(floor1, (d[i1] ?? 0) * 0.85);
            changed = true;
        }
        if (!changed) break;
    }
    const Q = placed();
    let twists = 0;
    let twistAt = "";
    for (let i = 0; i < len; i++) {
        const i1 = (i + 1) % len;
        // Rulings of one step, and the two boundary edges of that step, must not cross.
        const ruling = segmentsCross(P[i]!, Q[i]!, P[i1]!, Q[i1]!, 1e-3);
        const edges = segmentsCross(P[i]!, P[i1]!, Q[i]!, Q[i1]!, 1e-3);
        if (ruling || edges) {
            twists++;
            if (!twistAt) {
                twistAt = `(${P[i]!.x.toFixed(1)}, ${P[i]!.y.toFixed(1)}, ${P[i]!.z.toFixed(1)}) ${ruling ? "ruling" : "edges"}`;
            }
        }
    }
    if (twists > 0) throw new Error(`rim loop has ${twists} twisted rulings at ${twistAt}`);
    for (let i = 0; i < len; i++) {
        const id = n + loop[i]!;
        positions[id * 3] = Q[i]!.x;
        positions[id * 3 + 1] = Q[i]!.y;
        positions[id * 3 + 2] = Q[i]!.z;
    }
}

/** Move interior rim rings along the strip, leaving both boundary loops fixed so E does not change. */
function tangentialSmooth(positions: number[], rings: number[][], iterations: number): void {
    const bands = rings.length - 1;
    const len = rings[0]?.length ?? 0;
    if (bands < 2 || len < 3) return;
    const at = (id: number): AfoVec3 => ({
        x: positions[id * 3] ?? 0,
        y: positions[id * 3 + 1] ?? 0,
        z: positions[id * 3 + 2] ?? 0,
    });
    for (let iter = 0; iter < iterations; iter++) {
        const next = new Map<number, AfoVec3>();
        for (let r = 1; r < bands; r++) {
            for (let i = 0; i < len; i++) {
                const id = rings[r]![i]!;
                const nbrs = [
                    rings[r]![(i - 1 + len) % len]!,
                    rings[r]![(i + 1) % len]!,
                    rings[r - 1]![i]!,
                    rings[r + 1]![i]!,
                ];
                let ax = 0;
                let ay = 0;
                let az = 0;
                for (const nb of nbrs) {
                    const p = at(nb);
                    ax += p.x;
                    ay += p.y;
                    az += p.z;
                }
                ax /= nbrs.length;
                ay /= nbrs.length;
                az /= nbrs.length;
                const cur = at(id);
                let dx = ax - cur.x;
                let dy = ay - cur.y;
                let dz = az - cur.z;
                const axis = unit(sub(at(rings[bands]![i]!), at(rings[0]![i]!)), { x: 0, y: 0, z: 1 });
                const along = dx * axis.x + dy * axis.y + dz * axis.z;
                dx -= axis.x * along;
                dy -= axis.y * along;
                dz -= axis.z * along;
                next.set(id, { x: cur.x + dx * 0.35, y: cur.y + dy * 0.35, z: cur.z + dz * 0.35 });
            }
        }
        for (const [id, p] of next) {
            positions[id * 3] = p.x;
            positions[id * 3 + 1] = p.y;
            positions[id * 3 + 2] = p.z;
        }
    }
}

function circumradius(a: AfoVec3, b: AfoVec3, c: AfoVec3): number {
    const ab = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z);
    const n = triNormal(a, b, c);
    const area = Math.hypot(n.x, n.y, n.z) * 0.5;
    if (area < 1e-8) return Number.POSITIVE_INFINITY;
    return (ab * bc * ca) / (4 * area);
}

function circumcenter(a: AfoVec3, b: AfoVec3, c: AfoVec3): AfoVec3 | null {
    const ab = sub(b, a);
    const ac = sub(c, a);
    const n = cross(ab, ac);
    const n2 = dot(n, n);
    if (n2 < 1e-12) return null;
    const ab2 = dot(ab, ab);
    const ac2 = dot(ac, ac);
    const abn = cross(ab, n);
    const nac = cross(n, ac);
    return {
        x: a.x + (ac2 * abn.x + ab2 * nac.x) / (2 * n2),
        y: a.y + (ac2 * abn.y + ab2 * nac.y) / (2 * n2),
        z: a.z + (ac2 * abn.z + ab2 * nac.z) / (2 * n2),
    };
}

function segmentsCross(a: AfoVec3, b: AfoVec3, c: AfoVec3, d: AfoVec3, gapMm = 0.05): boolean {
    const u = sub(b, a);
    const v = sub(d, c);
    const w = sub(a, c);
    const uu = dot(u, u);
    const uv = dot(u, v);
    const vv = dot(v, v);
    const uw = dot(u, w);
    const vw = dot(v, w);
    const denom = uu * vv - uv * uv;
    let s = denom < 1e-12 ? 0 : (uv * vw - vv * uw) / denom;
    let t = denom < 1e-12 ? 0 : (uu * vw - uv * uw) / denom;
    s = Math.min(1, Math.max(0, s));
    t = Math.min(1, Math.max(0, t));
    const p = { x: a.x + u.x * s, y: a.y + u.y * s, z: a.z + u.z * s };
    const q = { x: c.x + v.x * t, y: c.y + v.y * t, z: c.z + v.z * t };
    const gap = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    return gap < gapMm && s > 0.08 && s < 0.92 && t > 0.08 && t < 0.92;
}

function wallNormal(p: AfoVec3, v: AfoVec3, up: AfoVec3, outHint: AfoVec3): AfoVec3 {
    const n = cross(sub(v, p), sub(up, p));
    if (dot(n, outHint) < 0) return unit({ x: -n.x, y: -n.y, z: -n.z }, outHint);
    return unit(n, outHint);
}

export function boundaryLoops(edges: { a: number; b: number }[]): number[][] {
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
function arcPoint(I: AfoVec3, O: AfoVec3, _out: AfoVec3, t: number): AfoVec3 {
    // Stay on the ruling. A lateral bulge on a sub-millimetre boundary step
    // twists the quad by tens of degrees.
    return {
        x: I.x + (O.x - I.x) * t,
        y: I.y + (O.y - I.y) * t,
        z: I.z + (O.z - I.z) * t,
    };
}

const COLLINEAR_TURN_RAD = (2 * Math.PI) / 180;
const COLLINEAR_CHORD_MM = 0.01;
const MIN_FACE_AREA_MM2 = 0.01;

/**
 * Drop a boundary vertex that already lies on the chord of its two neighbours,
 * and the matching outer and rim vertices, so the ruled pairing stays 1:1.
 * Interior needles flip the edge opposite a near-180° corner when that edge is interior.
 */
export function straightenFeatureLoops(shell: AfoTriMesh): void {
    const n = shell.outerVertex0;
    if (n == null) return;
    const protect = n * 2 - 1;
    for (let pass = 0; pass < 1; pass++) {
        if (!collapseOneCollinear(shell, n, protect)) break;
    }
    for (let pass = 0; pass < 8; pass++) {
        if (!flipInteriorNeedles(shell, n)) break;
    }
    repackSkinRim(shell);
}

/** An outer offset that points against its neighbours is put back on their average, then the ring is relaxed. */
export function repairFlippedOffsets(shell: AfoTriMesh): void {
    const n = shell.outerVertex0;
    const face0 = shell.rimFaceStart;
    if (n == null || face0 == null) return;
    const adj: number[][] = Array.from({ length: n }, () => []);
    const seen = new Set<string>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (!vs.every((v) => v >= n && v < n * 2)) continue;
        for (let e = 0; e < 3; e++) {
            const a = (vs[e] ?? 0) - n;
            const b = (vs[(e + 1) % 3] ?? 0) - n;
            const id = key(a, b);
            if (seen.has(id)) continue;
            seen.add(id);
            adj[a]!.push(b);
            adj[b]!.push(a);
        }
    }
    const offsetOf = (i: number) => ({
        x: (shell.positions[(n + i) * 3] ?? 0) - (shell.positions[i * 3] ?? 0),
        y: (shell.positions[(n + i) * 3 + 1] ?? 0) - (shell.positions[i * 3 + 1] ?? 0),
        z: (shell.positions[(n + i) * 3 + 2] ?? 0) - (shell.positions[i * 3 + 2] ?? 0),
    });
    const bad: number[] = [];
    for (let i = 0; i < n; i++) {
        if ((adj[i]?.length ?? 0) === 0) continue;
        const off = offsetOf(i);
        const ol = Math.hypot(off.x, off.y, off.z);
        if (ol < 1e-6) continue;
        let ax = 0;
        let ay = 0;
        let az = 0;
        for (const j of adj[i] ?? []) {
            const o = offsetOf(j);
            ax += o.x;
            ay += o.y;
            az += o.z;
        }
        const al = Math.hypot(ax, ay, az);
        if (al < 1e-6) continue;
        if ((off.x * ax + off.y * ay + off.z * az) / (ol * al) < 0) bad.push(i);
    }
    if (bad.length === 0) return;
    const ring = new Set<number>();
    for (const i of bad) {
        const off = offsetOf(i);
        const t = Math.hypot(off.x, off.y, off.z);
        let ax = 0;
        let ay = 0;
        let az = 0;
        for (const j of adj[i] ?? []) {
            const o = offsetOf(j);
            ax += o.x;
            ay += o.y;
            az += o.z;
        }
        const al = Math.hypot(ax, ay, az) || 1;
        shell.positions[(n + i) * 3] = (shell.positions[i * 3] ?? 0) + (ax / al) * t;
        shell.positions[(n + i) * 3 + 1] = (shell.positions[i * 3 + 1] ?? 0) + (ay / al) * t;
        shell.positions[(n + i) * 3 + 2] = (shell.positions[i * 3 + 2] ?? 0) + (az / al) * t;
        ring.add(i);
        for (const j of adj[i] ?? []) {
            ring.add(j);
            for (const k of adj[j] ?? []) ring.add(k);
        }
    }
    for (let iter = 0; iter < 2; iter++) {
        const next = new Map<number, AfoVec3>();
        for (const i of ring) {
            const nbrs = adj[i] ?? [];
            if (nbrs.length === 0) continue;
            let ax = 0;
            let ay = 0;
            let az = 0;
            for (const j of nbrs) {
                ax += shell.positions[(n + j) * 3] ?? 0;
                ay += shell.positions[(n + j) * 3 + 1] ?? 0;
                az += shell.positions[(n + j) * 3 + 2] ?? 0;
            }
            ax /= nbrs.length;
            ay /= nbrs.length;
            az /= nbrs.length;
            const px = shell.positions[(n + i) * 3] ?? 0;
            const py = shell.positions[(n + i) * 3 + 1] ?? 0;
            const pz = shell.positions[(n + i) * 3 + 2] ?? 0;
            const qx = px * 0.65 + ax * 0.35;
            const qy = py * 0.65 + ay * 0.35;
            const qz = pz * 0.65 + az * 0.35;
            const ix = shell.positions[i * 3] ?? 0;
            const iy = shell.positions[i * 3 + 1] ?? 0;
            const iz = shell.positions[i * 3 + 2] ?? 0;
            const t = Math.hypot(px - ix, py - iy, pz - iz) || 1;
            const dx = qx - ix;
            const dy = qy - iy;
            const dz = qz - iz;
            const dl = Math.hypot(dx, dy, dz) || 1;
            next.set(i, { x: ix + (dx / dl) * t, y: iy + (dy / dl) * t, z: iz + (dz / dl) * t });
        }
        for (const [i, p] of next) {
            shell.positions[(n + i) * 3] = p.x;
            shell.positions[(n + i) * 3 + 1] = p.y;
            shell.positions[(n + i) * 3 + 2] = p.z;
        }
    }
}

function boundaryPairs(
    shell: AfoTriMesh,
    n: number,
): { pairs: Map<number, number[]>; arcOf: Map<number, number> } {
    const use = new Map<number, number>();
    const arcsOfInner = new Map<number, number[]>();
    const arcsOfOuter = new Map<number, number[]>();
    const pack = (a: number, b: number) => (a < b ? a * 1000003 + b : b * 1000003 + a);
    const faceCount = (shell.indices.length / 3) | 0;
    const limit = n * 2;
    const remember = (map: Map<number, number[]>, key: number, arc: number) => {
        const list = map.get(key);
        if (list) {
            if (!list.includes(arc)) list.push(arc);
        } else map.set(key, [arc]);
    };
    for (let f = 0; f < faceCount; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        const inner = vs[0]! < n && vs[1]! < n && vs[2]! < n;
        const outer =
            vs[0]! >= n && vs[0]! < limit && vs[1]! >= n && vs[1]! < limit && vs[2]! >= n && vs[2]! < limit;
        if (inner || outer) {
            for (let e = 0; e < 3; e++) {
                const k = pack(vs[e]!, vs[(e + 1) % 3]!);
                use.set(k, (use.get(k) ?? 0) + 1);
            }
            continue;
        }
        for (let e = 0; e < 3; e++) {
            const a = vs[e]!;
            const b = vs[(e + 1) % 3]!;
            if (a >= limit && b < n) remember(arcsOfInner, b, a);
            else if (b >= limit && a < n) remember(arcsOfInner, a, b);
            else if (a >= limit && b >= n && b < limit) remember(arcsOfOuter, b - n, a);
            else if (b >= limit && a >= n && a < limit) remember(arcsOfOuter, a - n, b);
        }
    }
    const pairs = new Map<number, number[]>();
    const link = (a: number, b: number) => {
        const list = pairs.get(a);
        if (list) list.push(b);
        else pairs.set(a, [b]);
    };
    for (const [k, used] of use) {
        if (used !== 1) continue;
        const b = k % 1000003;
        const a = (k - b) / 1000003;
        link(a, b);
        link(b, a);
    }
    const arcOf = new Map<number, number>();
    for (const [v, arcs] of arcsOfInner) {
        const hit = arcs.filter((arc) => arcsOfOuter.get(v)?.includes(arc));
        if (hit.length === 1) arcOf.set(v, hit[0]!);
    }
    return { pairs, arcOf };
}

function collapseOneCollinear(shell: AfoTriMesh, n: number, protect: number): boolean {
    const { pairs: boundary, arcOf } = boundaryPairs(shell, n);
    const byVert = faceIndex(shell);
    const directed = directedEdges(shell);
    const maps: Map<number, number>[] = [];
    const used = new Set<number>();
    for (const [v, pair] of boundary) {
        if (v >= n || pair.length !== 2) continue;
        const left = pair[0]!;
        const right = pair[1]!;
        if (v === protect || n + v === protect) continue;
        if (!onChord(shell, left, v, right)) continue;
        const outer = n + v;
        const oNbr = boundary.get(outer);
        if (oNbr == null || oNbr.length !== 2 || !oNbr.includes(n + left) || !oNbr.includes(n + right))
            continue;
        if (!onChord(shell, n + left, outer, n + right)) continue;
        const arc = arcOf.get(v) ?? null;
        const arcLeft = arcOf.get(left) ?? null;
        const arcRight = arcOf.get(right) ?? null;
        if (arc != null && arcLeft != null && arcRight != null && !onChord(shell, arcLeft, arc, arcRight))
            continue;
        const ends: number[] = [];
        const leftOk = collapseKeepsFaces(
            shell,
            byVert,
            stationMap(n, v, left, arc, arcLeft),
            protect,
            directed,
        );
        const rightOk = collapseKeepsFaces(
            shell,
            byVert,
            stationMap(n, v, right, arc, arcRight),
            protect,
            directed,
        );
        if (leftOk) ends.push(left);
        if (rightOk) ends.push(right);
        if (ends.length === 0) continue;
        const end =
            ends.length === 1 ? ends[0]! : betterEnd(shell, byVert, arcOf, n, v, ends[0]!, ends[1]!, arc);
        const arcEnd = end === left ? arcLeft : arcRight;
        const map = stationMap(n, v, end, arc, arcEnd);
        const blocked = [v, end, n + v, n + end, left, right, n + left, n + right];
        if (arc != null) blocked.push(arc);
        if (arcEnd != null) blocked.push(arcEnd);
        if (blocked.some((id) => used.has(id))) continue;
        for (const id of blocked) used.add(id);
        maps.push(map);
    }
    if (maps.length === 0) return false;
    const combined = new Map<number, number>();
    for (const map of maps) for (const [from, to] of map) combined.set(from, to);
    applyCollapse(shell, combined);
    return true;
}

function stationMap(
    n: number,
    v: number,
    end: number,
    arc: number | null,
    arcEnd: number | null,
): Map<number, number> {
    const map = new Map<number, number>();
    map.set(v, end);
    map.set(n + v, n + end);
    if (arc != null && arcEnd != null && arc !== arcEnd) map.set(arc, arcEnd);
    return map;
}

function betterEnd(
    shell: AfoTriMesh,
    byVert: number[][],
    arcOf: Map<number, number>,
    n: number,
    v: number,
    a: number,
    b: number,
    arc: number | null,
): number {
    const score = (end: number) => {
        const arcEnd = arcOf.get(end) ?? null;
        const map = stationMap(n, v, end, arc, arcEnd);
        let minArea = Infinity;
        for (const f of facesTouching(byVert, [...map.keys()])) {
            const vs = remapped(shell, f, map);
            if (new Set(vs).size < 3) continue;
            minArea = Math.min(minArea, faceArea(shell, vs));
        }
        return minArea;
    };
    return score(a) >= score(b) ? a : b;
}

function onChord(shell: AfoTriMesh, left: number, v: number, right: number): boolean {
    if (left === v || v === right || left === right) return false;
    const a = atV(shell, left);
    const b = atV(shell, v);
    const c = atV(shell, right);
    const va = sub(a, b);
    const vc = sub(c, b);
    const la = Math.hypot(va.x, va.y, va.z);
    const lc = Math.hypot(vc.x, vc.y, vc.z);
    if (la < 1e-8 || lc < 1e-8) return true;
    const cos = Math.min(1, Math.max(-1, dot(va, vc) / (la * lc)));
    const turn = Math.PI - Math.acos(cos);
    if (turn > COLLINEAR_TURN_RAD) return false;
    const chord = sub(c, a);
    const ab2 = dot(chord, chord) || 1;
    const t = Math.min(1, Math.max(0, dot(sub(b, a), chord) / ab2));
    if (t <= 0.02 || t >= 0.98) return false;
    const foot = { x: a.x + chord.x * t, y: a.y + chord.y * t, z: a.z + chord.z * t };
    return Math.hypot(b.x - foot.x, b.y - foot.y, b.z - foot.z) <= COLLINEAR_CHORD_MM;
}

function collapseKeepsFaces(
    shell: AfoTriMesh,
    byVert: number[][],
    map: Map<number, number>,
    protect: number,
    directedIn?: Set<number>,
): boolean {
    const directed = directedIn ?? directedEdges(shell);
    for (const from of map.keys()) if (from === protect) return false;
    const affected = facesTouching(byVert, [...map.keys()]);
    const pack = (a: number, b: number) => a * 1000003 + b;
    const owned = new Set<number>();
    for (const f of affected) {
        const a = shell.indices[f * 3] ?? 0;
        const b = shell.indices[f * 3 + 1] ?? 0;
        const c = shell.indices[f * 3 + 2] ?? 0;
        if (a === b || b === c || a === c) continue;
        owned.add(pack(a, b));
        owned.add(pack(b, c));
        owned.add(pack(c, a));
    }
    const taken = new Set<number>();
    const pos = shell.positions;
    const cross = (a: number, b: number, c: number) => {
        const ax = pos[a * 3] ?? 0;
        const ay = pos[a * 3 + 1] ?? 0;
        const az = pos[a * 3 + 2] ?? 0;
        const bx = (pos[b * 3] ?? 0) - ax;
        const by = (pos[b * 3 + 1] ?? 0) - ay;
        const bz = (pos[b * 3 + 2] ?? 0) - az;
        const cx = (pos[c * 3] ?? 0) - ax;
        const cy = (pos[c * 3 + 1] ?? 0) - ay;
        const cz = (pos[c * 3 + 2] ?? 0) - az;
        return { x: by * cz - bz * cy, y: bz * cx - bx * cz, z: bx * cy - by * cx };
    };
    for (const f of affected) {
        const a0 = shell.indices[f * 3] ?? 0;
        const b0 = shell.indices[f * 3 + 1] ?? 0;
        const c0 = shell.indices[f * 3 + 2] ?? 0;
        const a = map.get(a0) ?? a0;
        const b = map.get(b0) ?? b0;
        const c = map.get(c0) ?? c0;
        if (a === b || b === c || a === c) continue;
        const oldN = cross(a0, b0, c0);
        const newN = cross(a, b, c);
        const area2 = newN.x * newN.x + newN.y * newN.y + newN.z * newN.z;
        if (area2 < MIN_FACE_AREA_MM2 * MIN_FACE_AREA_MM2 * 4) return false;
        if (oldN.x * newN.x + oldN.y * newN.y + oldN.z * newN.z <= 0) return false;
        const edges = [pack(a, b), pack(b, c), pack(c, a)];
        for (const d of edges) {
            if ((directed.has(d) && !owned.has(d)) || taken.has(d)) return false;
            taken.add(d);
        }
    }
    return affected.size > 0;
}

function directedEdges(shell: AfoTriMesh): Set<number> {
    const directed = new Set<number>();
    const faceCount = (shell.indices.length / 3) | 0;
    for (let f = 0; f < faceCount; f++) {
        const a = shell.indices[f * 3] ?? 0;
        const b = shell.indices[f * 3 + 1] ?? 0;
        const c = shell.indices[f * 3 + 2] ?? 0;
        if (a === b || b === c || a === c) continue;
        directed.add(a * 1000003 + b);
        directed.add(b * 1000003 + c);
        directed.add(c * 1000003 + a);
    }
    return directed;
}

function applyCollapse(shell: AfoTriMesh, map: Map<number, number>): void {
    for (let i = 0; i < shell.indices.length; i++) {
        const to = map.get(shell.indices[i] ?? 0);
        if (to != null) shell.indices[i] = to;
    }
    repackSkinRim(shell);
}

function flipInteriorNeedles(shell: AfoTriMesh, n: number): boolean {
    const face0 = shell.rimFaceStart ?? (shell.indices.length / 3) | 0;
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const boundary = new Set<string>();
    const edgeFaces = new Map<string, number[]>();
    const countSkin = (f: number, vs: number[]) => {
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = edgeFaces.get(k);
            if (list) list.push(f);
            else edgeFaces.set(k, [f]);
        }
    };
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (vs.some((v) => v >= n * 2)) continue;
        countSkin(f, vs);
    }
    for (const [k, faces] of edgeFaces) if (faces.length === 1) boundary.add(k);
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (new Set(vs).size < 3 || vs.some((v) => v >= n * 2)) continue;
        for (let c = 0; c < 3; c++) {
            const prev = vs[(c + 2) % 3]!;
            const v = vs[c]!;
            const next = vs[(c + 1) % 3]!;
            const angle = cornerAngle(shell, prev, v, next);
            if (angle < (175 * Math.PI) / 180) continue;
            const oppA = prev;
            const oppB = next;
            const k = key(oppA, oppB);
            if (boundary.has(k)) continue;
            const hosts = edgeFaces.get(k) ?? [];
            if (hosts.length !== 2) continue;
            const other = hosts[0] === f ? hosts[1]! : hosts[0]!;
            const ov = [
                shell.indices[other * 3] ?? 0,
                shell.indices[other * 3 + 1] ?? 0,
                shell.indices[other * 3 + 2] ?? 0,
            ];
            if (ov.some((p) => boundary.has(key(p, ov[(ov.indexOf(p) + 1) % 3]!)))) continue;
            const opp = ov.find((p) => p !== oppA && p !== oppB);
            if (opp == null || edgeFaces.has(key(v, opp))) continue;
            let u = oppA;
            let w = oppB;
            for (let e = 0; e < 3; e++) {
                const a = ov[e]!;
                const b = ov[(e + 1) % 3]!;
                if ((a === oppA && b === oppB) || (a === oppB && b === oppA)) {
                    u = a;
                    w = b;
                    break;
                }
            }
            const na0 = triNormal(atV(shell, u), atV(shell, w), atV(shell, v));
            const nb0 = triNormal(atV(shell, w), atV(shell, u), atV(shell, opp));
            const na1 = triNormal(atV(shell, u), atV(shell, opp), atV(shell, v));
            const nb1 = triNormal(atV(shell, opp), atV(shell, u), atV(shell, w));
            if (dot(na0, na1) <= 0 || dot(nb0, nb1) <= 0) continue;
            const areaA = Math.hypot(na1.x, na1.y, na1.z) * 0.5;
            const areaB = Math.hypot(nb1.x, nb1.y, nb1.z) * 0.5;
            if (areaA < MIN_FACE_AREA_MM2 || areaB < MIN_FACE_AREA_MM2) continue;
            shell.indices[f * 3] = u;
            shell.indices[f * 3 + 1] = opp;
            shell.indices[f * 3 + 2] = v;
            shell.indices[other * 3] = opp;
            shell.indices[other * 3 + 1] = u;
            shell.indices[other * 3 + 2] = w;
            return true;
        }
    }
    return false;
}

function faceIndex(shell: AfoTriMesh): number[][] {
    const by: number[][] = Array.from({ length: (shell.positions.length / 3) | 0 }, () => []);
    const faceCount = (shell.indices.length / 3) | 0;
    for (let f = 0; f < faceCount; f++) {
        for (let k = 0; k < 3; k++) by[shell.indices[f * 3 + k] ?? 0]?.push(f);
    }
    return by;
}

function facesTouching(byVert: number[][], verts: number[]): Set<number> {
    const faces = new Set<number>();
    for (const v of verts) for (const f of byVert[v] ?? []) faces.add(f);
    return faces;
}

function remapped(shell: AfoTriMesh, f: number, map: Map<number, number>): number[] {
    return [0, 1, 2].map((k) => map.get(shell.indices[f * 3 + k] ?? 0) ?? shell.indices[f * 3 + k] ?? 0);
}

function faceArea(shell: AfoTriMesh, vs: number[]): number {
    const n = triNormal(atV(shell, vs[0]!), atV(shell, vs[1]!), atV(shell, vs[2]!));
    return Math.hypot(n.x, n.y, n.z) * 0.5;
}

function cornerAngle(shell: AfoTriMesh, prev: number, v: number, next: number): number {
    const a = sub(atV(shell, prev), atV(shell, v));
    const b = sub(atV(shell, next), atV(shell, v));
    const la = Math.hypot(a.x, a.y, a.z);
    const lb = Math.hypot(b.x, b.y, b.z);
    if (la < 1e-8 || lb < 1e-8) return Math.PI;
    return Math.acos(Math.min(1, Math.max(-1, dot(a, b) / (la * lb))));
}

function atV(shell: AfoTriMesh, i: number): AfoVec3 {
    return {
        x: shell.positions[i * 3] ?? 0,
        y: shell.positions[i * 3 + 1] ?? 0,
        z: shell.positions[i * 3 + 2] ?? 0,
    };
}

function repackSkinRim(shell: AfoTriMesh): void {
    const n = shell.outerVertex0;
    const skin: number[] = [];
    const rim: number[] = [];
    const faceCount = (shell.indices.length / 3) | 0;
    for (let f = 0; f < faceCount; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (new Set(vs).size < 3) continue;
        const bucket = n != null && vs.some((v) => v >= n * 2) ? rim : skin;
        bucket.push(vs[0]!, vs[1]!, vs[2]!);
    }
    shell.indices = new Uint32Array(skin.concat(rim));
    if (n != null) shell.rimFaceStart = skin.length / 3;
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
