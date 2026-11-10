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
 * A thin triangle along the opening folds when its vertices take slightly
 * different offsets. Flip a reversed winding, and collapse an edge that is
 * already shorter than the dihedral gate looks at. Faces that used that edge
 * are dropped, which is a manifold collapse when the edge had two skin faces.
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
    const reached = new Map<number, number>();
    const stack = [...near];
    for (const id of stack) reached.set(id, 0);
    while (stack.length) {
        let best = 0;
        for (let k = 1; k < stack.length; k++) {
            if ((reached.get(stack[k]!) ?? 0) < (reached.get(stack[best]!) ?? 0)) best = k;
        }
        const u = stack.splice(best, 1)[0]!;
        const du = reached.get(u) ?? 0;
        for (const w of link.get(u) ?? []) {
            const nd = du + span(u, w);
            if (nd > 4) continue;
            const prev = reached.get(w);
            if (prev !== undefined && nd >= prev) continue;
            reached.set(w, nd);
            near.add(w);
            stack.push(w);
        }
    }
    for (let pass = 0; pass < 12; pass++) {
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
        let changed = false;
        for (let f = 0; f < faces.length; f++) {
            const face = faces[f]!;
            if (face.kind === 2 || !alive(face)) continue;
            const [a, b, c] = face.v;
            const onSkin =
                face.kind === 0
                    ? a < n && b < n && c < n
                    : a >= n && a < n * 2 && b >= n && b < n * 2 && c >= n && c < n * 2;
            if (!onSkin) continue;
            const area = areaOf(a, b, c);
            if (area < 1e-8) continue;
            const mine = unitN(a, b, c);
            let worst = 1;
            let agree = 0;
            let disagree = 0;
            for (const [u, v] of [
                [a, b],
                [b, c],
                [c, a],
            ] as const) {
                for (const nb of edge.get(key(u, v)) ?? []) {
                    if (nb === f || faces[nb]!.kind !== face.kind || !alive(faces[nb]!)) continue;
                    const nv = faces[nb]!.v;
                    const nn = unitN(nv[0], nv[1], nv[2]);
                    const dotN = mine.x * nn.x + mine.y * nn.y + mine.z * nn.z;
                    worst = Math.min(worst, dotN);
                    if (dotN < 0) disagree++;
                    else agree++;
                }
            }
            if (worst < -0.85 && area < 0.5) {
                const tmp = face.v[1];
                face.v[1] = face.v[2];
                face.v[2] = tmp;
                changed = true;
                continue;
            }
            if (worst < -0.5 && area < 1.2) {
                let smaller = true;
                for (let e = 0; e < 3 && smaller; e++) {
                    for (const nb of edge.get(key(face.v[e]!, face.v[(e + 1) % 3]!)) ?? []) {
                        if (nb === f || faces[nb]!.kind !== face.kind || !alive(faces[nb]!)) continue;
                        const nv = faces[nb]!.v;
                        const nn = unitN(nv[0], nv[1], nv[2]);
                        if (mine.x * nn.x + mine.y * nn.y + mine.z * nn.z >= -0.5) continue;
                        if (areaOf(nv[0], nv[1], nv[2]) + 1e-6 < area) smaller = false;
                    }
                }
                if (smaller) {
                    const tmp = face.v[1];
                    face.v[1] = face.v[2];
                    face.v[2] = tmp;
                    changed = true;
                    continue;
                }
            }
            if (disagree > 0 && agree === 0 && area < 2) {
                const tmp = face.v[1];
                face.v[1] = face.v[2];
                face.v[2] = tmp;
                changed = true;
                continue;
            }
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
            const onOpening = boundary.has(peak) || (peak >= n && boundary.has(peak - n));
            if (
                area < 0.3 &&
                altitude < 0.22 &&
                altitude > 1e-4 &&
                near.has(peak) &&
                !onOpening &&
                peak !== n * 2 - 1 &&
                !faces.some((other) => other.kind === 2 && other.v.includes(peak))
            ) {
                const pu = at(long[0]!);
                const pw = at(long[1]!);
                const po = at(peak);
                const ex = pw.x - pu.x;
                const ey = pw.y - pu.y;
                const ez = pw.z - pu.z;
                const el2 = ex * ex + ey * ey + ez * ez || 1;
                let t = ((po.x - pu.x) * ex + (po.y - pu.y) * ey + (po.z - pu.z) * ez) / el2;
                t = Math.min(1, Math.max(0, t));
                const endGap = Math.min(t, 1 - t) * longLen;
                if (endGap > 0.02) {
                    positions[peak * 3] = pu.x + ex * t;
                    positions[peak * 3 + 1] = pu.y + ey * t;
                    positions[peak * 3 + 2] = pu.z + ez * t;
                    changed = true;
                    continue;
                }
            }
            let short = pairs[0]!;
            let shortLen = Infinity;
            for (const pair of pairs) {
                const len = span(pair[0], pair[1]);
                if (len < shortLen) {
                    shortLen = len;
                    short = pair;
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
            if (faces.some((other) => other.kind === 2 && other.v.includes(from))) continue;
            const hosts = edge.get(key(short[0]!, short[1]!)) ?? [];
            if (hosts.length !== 2) continue;
            for (const other of faces) {
                for (let k = 0; k < 3; k++) if (other.v[k] === from) other.v[k] = to;
            }
            changed = true;
        }
        if (!changed) break;
    }
    const kept = faces.filter((face) => alive(face) && areaOf(face.v[0], face.v[1], face.v[2]) > 1e-8);
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
