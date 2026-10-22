// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";
import {
    type CutSample,
    closestOnCut,
    cutPolyline,
    footprintFrameFromRim,
    resolveSkiveLength,
    skiveFeather01,
    skiveThicknessMm,
    TRIM_SEED_CONTROLS,
    type TrimKind,
    type Uv,
} from "./trim-curve";
import { sampleMeshHeight } from "./trim-mesh";

/** Cut samples plus the solved skive length at each sample. */
export interface DistalSkiveField {
    kind: TrimKind;
    cut: CutSample[];
    /** S at each cut sample, millimetres. Absolute, not scaled with shoe size. */
    lengthMm: number[];
    t0Mm: number[];
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a},${b}` : `${b},${a}`;
}

function boundaryLoop(pos: Float32Array, idx: Uint32Array): number[] {
    const count = new Map<string, number>();
    for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!;
        const b = idx[t + 1]!;
        const c = idx[t + 2]!;
        for (const [p, q] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = edgeKey(p, q);
            count.set(k, (count.get(k) ?? 0) + 1);
        }
    }
    const adj = new Map<number, number[]>();
    for (const [k, n] of count) {
        if (n !== 1) continue;
        const [a, b] = k.split(",").map(Number) as [number, number];
        const la = adj.get(a) ?? [];
        la.push(b);
        adj.set(a, la);
        const lb = adj.get(b) ?? [];
        lb.push(a);
        adj.set(b, lb);
    }
    const start = adj.keys().next().value as number | undefined;
    if (start === undefined) return [];
    const loop = [start];
    let prev = -1;
    let cur = start;
    const guard = adj.size + 2;
    while (loop.length <= guard) {
        const nxt = (adj.get(cur) ?? []).find((n) => n !== prev && n !== start);
        if (nxt === undefined) break;
        loop.push(nxt);
        prev = cur;
        cur = nxt;
    }
    return loop;
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/**
 * The re-meshed cut is the run of short boundary edges. Shoe-size scale
 * multiplies every chord, so the test is relative to the median rim edge.
 * Normals point toward the heel side of the sheet.
 */
export function cutFromBoundary(rim: readonly PolyPoint[]): CutSample[] {
    const n = rim.length;
    if (n < 8) return [];
    const len: number[] = [];
    for (let i = 0; i < n; i++) {
        const a = rim[i]!;
        const b = rim[(i + 1) % n]!;
        len.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    const sorted = len.slice().sort((a, b) => a - b);
    const median = sorted[n >> 1] ?? 1;
    const cutLike = len.map((l) => l < median * 0.45 && l < median);
    let bestStart = -1;
    let bestLen = 0;
    let i = 0;
    while (i < n) {
        if (!cutLike[i]) {
            i++;
            continue;
        }
        let j = i;
        while (j < n && cutLike[j]) j++;
        if (j - i > bestLen) {
            bestLen = j - i;
            bestStart = i;
        }
        i = Math.max(j, i + 1);
    }
    if (cutLike[0] && cutLike[n - 1]) {
        let head = 0;
        while (head < n && cutLike[head]) head++;
        let tail = n - 1;
        while (tail >= 0 && cutLike[tail]) tail--;
        const wrap = head + (n - 1 - tail);
        if (wrap > bestLen && head + wrap <= n) {
            bestLen = wrap;
            bestStart = tail + 1;
        }
    }
    if (bestStart < 0 || bestLen < 8) return [];
    const pts: PolyPoint[] = [];
    for (let k = 0; k <= bestLen; k++) pts.push(rim[(bestStart + k) % n]!);
    let cx = 0;
    let cy = 0;
    for (const p of rim) {
        cx += p.x;
        cy += p.y;
    }
    cx /= n;
    cy /= n;
    const out: CutSample[] = [];
    for (let k = 0; k < pts.length; k++) {
        const p = pts[k]!;
        const prev = pts[Math.max(0, k - 1)]!;
        const next = pts[Math.min(pts.length - 1, k + 1)]!;
        let tx = next.x - prev.x;
        let ty = next.y - prev.y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        let nx = -ty;
        let ny = tx;
        if ((cx - p.x) * nx + (cy - p.y) * ny < 0) {
            nx = -nx;
            ny = -ny;
        }
        out.push({ x: p.x, y: p.y, tx, ty, nx, ny });
    }
    return out;
}

/** Highest rim point is the medial arch. Stable after the toe is cut off. */
export function medialSignFromArchPeak(rim: readonly PolyPoint[]): 1 | -1 {
    if (rim.length === 0) return -1;
    let yMid = 0;
    for (const p of rim) yMid += p.y;
    yMid /= rim.length;
    let bestZ = -Infinity;
    let bestY = 0;
    for (const p of rim) {
        if (p.z > bestZ) {
            bestZ = p.z;
            bestY = p.y;
        }
    }
    return bestY < yMid ? -1 : 1;
}

/** Solve S and t0 along the cut. t0 is the original thickness S mm proximal of the cut. */
export function distalSkiveField(
    rim: PolyPoint[],
    kind: TrimKind,
    controls: readonly Uv[],
): DistalSkiveField {
    const fromEdge = cutFromBoundary(rim);
    const frame = footprintFrameFromRim(rim);
    const cut = fromEdge.length >= 8 ? fromEdge : cutPolyline(frame, controls, 2, 0.5);
    const lengthMm = new Array<number>(cut.length);
    const t0Mm = new Array<number>(cut.length);
    return { kind, cut, lengthMm, t0Mm };
}

/**
 * Fill S and t0 using a height sampler on the unskived sheet.
 * The sampler is applied per cut sample; S is iterated from the thickness at that distance.
 */
export function solveSkiveField(
    field: DistalSkiveField,
    heightAt: (x: number, y: number) => number | null,
): DistalSkiveField {
    const { cut } = field;
    for (let i = 0; i < cut.length; i++) {
        const p = cut[i]!;
        const sample = (distanceMm: number) => {
            const z = heightAt(p.x + p.nx * distanceMm, p.y + p.ny * distanceMm);
            if (z != null && z > 0.2) return z;
            const onCut = heightAt(p.x, p.y);
            return onCut != null && onCut > 0.2 ? onCut : 2;
        };
        const solved = resolveSkiveLength(field.kind, sample);
        field.lengthMm[i] = solved.lengthMm;
        field.t0Mm[i] = solved.t0;
    }
    return field;
}

function fieldAt(
    field: DistalSkiveField,
    x: number,
    y: number,
): { signed: number; lengthMm: number; t0: number } {
    const hit = closestOnCut(x, y, field.cut);
    const i = Math.max(0, Math.min(field.cut.length - 2, hit.index));
    const a = field.cut[i]!;
    const b = field.cut[i + 1] ?? a;
    const ab = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.max(0, Math.min(1, Math.hypot(hit.x - a.x, hit.y - a.y) / ab));
    const lengthMm = lerp(
        field.lengthMm[i] ?? 10,
        field.lengthMm[Math.min(i + 1, field.lengthMm.length - 1)] ?? 10,
        t,
    );
    const t0 = lerp(field.t0Mm[i] ?? 2, field.t0Mm[Math.min(i + 1, field.t0Mm.length - 1)] ?? 2, t);
    return { signed: hit.signed, lengthMm, t0 };
}

/**
 * 0 at and distal of the skive start, smoothstep to 1 over the next 5 mm.
 * `leadMm` moves that zero line further proximal. Met pads use one feather
 * length so the taper does not start on the pad.
 */
export function skiveFeatherAt(field: DistalSkiveField, x: number, y: number, leadMm = 0): number {
    const at = fieldAt(field, x, y);
    return skiveFeather01(Math.max(0, at.signed - leadMm), at.lengthMm);
}

export interface SkivedSheet {
    pos: Float32Array;
    idx: Uint32Array;
    rimLocal: number[];
    field: DistalSkiveField;
}

/**
 * Lower only the top, from the original thickness at the skive start down to 0.5 mm
 * at the cut. Edges that cross the start are split so the surface stays continuous.
 */
export function applyDistalSkive(
    posIn: Float32Array,
    idxIn: Uint32Array,
    rimIn: number[],
    kind: TrimKind,
    controls: readonly Uv[] = TRIM_SEED_CONTROLS[kind],
): SkivedSheet {
    const rimPts: PolyPoint[] = rimIn.map((i) => ({
        x: posIn[i * 3]!,
        y: posIn[i * 3 + 1]!,
        z: posIn[i * 3 + 2]!,
    }));
    const field = solveSkiveField(distalSkiveField(rimPts, kind, controls), sampleMeshHeight(posIn, idxIn));
    const nV = posIn.length / 3;
    const signed = new Float64Array(nV);
    const length = new Float64Array(nV);
    const t0 = new Float64Array(nV);
    for (let i = 0; i < nV; i++) {
        const at = fieldAt(field, posIn[i * 3]!, posIn[i * 3 + 1]!);
        signed[i] = at.signed;
        length[i] = at.lengthMm;
        t0[i] = at.t0;
    }
    const fOf = (i: number) => signed[i]! - length[i]!;

    const outPos: number[] = [];
    for (let i = 0; i < posIn.length; i++) outPos.push(posIn[i]!);
    const outSigned: number[] = [];
    const outLen: number[] = [];
    const outT0: number[] = [];
    for (let i = 0; i < nV; i++) {
        outSigned.push(signed[i]!);
        outLen.push(length[i]!);
        outT0.push(t0[i]!);
    }
    const splits = new Map<string, number>();
    const splitEdge = (a: number, b: number): number => {
        const k = edgeKey(a, b);
        const hit = splits.get(k);
        if (hit !== undefined) return hit;
        const fa = fOf(a);
        const fb = fOf(b);
        const denom = fa - fb;
        const t = Math.abs(denom) < 1e-12 ? 0.5 : fa / denom;
        const id = outPos.length / 3;
        outPos.push(
            lerp(posIn[a * 3]!, posIn[b * 3]!, t),
            lerp(posIn[a * 3 + 1]!, posIn[b * 3 + 1]!, t),
            lerp(posIn[a * 3 + 2]!, posIn[b * 3 + 2]!, t),
        );
        outSigned.push(lerp(signed[a]!, signed[b]!, t));
        outLen.push(lerp(length[a]!, length[b]!, t));
        outT0.push(lerp(t0[a]!, t0[b]!, t));
        splits.set(k, id);
        return id;
    };
    const crosses = (a: number, b: number) => {
        const fa = fOf(a);
        const fb = fOf(b);
        if (Math.abs(fa) < 1e-5 || Math.abs(fb) < 1e-5) return false;
        return fa * fb < 0;
    };

    const outIdx: number[] = [];
    const pushTri = (a: number, b: number, c: number) => {
        if (a === b || b === c || c === a) return;
        outIdx.push(a, b, c);
    };
    for (let t = 0; t < idxIn.length; t += 3) {
        const ids = [idxIn[t]!, idxIn[t + 1]!, idxIn[t + 2]!];
        const crossed: number[] = [];
        for (let e = 0; e < 3; e++) {
            if (crosses(ids[e]!, ids[(e + 1) % 3]!)) crossed.push(e);
        }
        if (crossed.length === 0) {
            pushTri(ids[0]!, ids[1]!, ids[2]!);
            continue;
        }
        if (crossed.length === 1) {
            const e = crossed[0]!;
            const i = ids[e]!;
            const j = ids[(e + 1) % 3]!;
            const k = ids[(e + 2) % 3]!;
            const p = splitEdge(i, j);
            if (e === 0) {
                pushTri(p, j, k);
                pushTri(i, p, k);
            } else if (e === 1) {
                pushTri(i, p, k);
                pushTri(i, j, p);
            } else {
                pushTri(i, j, p);
                pushTri(p, j, k);
            }
            continue;
        }
        let unique = 0;
        for (let k = 0; k < 3; k++) {
            const prev = fOf(ids[(k + 2) % 3]!);
            const next = fOf(ids[(k + 1) % 3]!);
            if (fOf(ids[k]!) * prev < 0 && fOf(ids[k]!) * next < 0) unique = k;
        }
        const a = ids[unique]!;
        const b = ids[(unique + 1) % 3]!;
        const c = ids[(unique + 2) % 3]!;
        const pab = splitEdge(a, b);
        const pac = splitEdge(a, c);
        pushTri(a, pab, pac);
        pushTri(pab, b, c);
        pushTri(pab, c, pac);
    }

    for (let i = 0; i < outPos.length / 3; i++) {
        const sDist = outSigned[i] ?? 0;
        const sLen = outLen[i] ?? 0;
        const gap = sDist - sLen;
        if (gap >= -1e-4) continue;
        const s = Math.max(0, Math.min(sLen, sLen - sDist));
        outPos[i * 3 + 2] = skiveThicknessMm(outT0[i] ?? SKIVE_FALLBACK_T0, s, sLen);
    }

    const rimLocal: number[] = [];
    for (let i = 0; i < rimIn.length; i++) {
        const a = rimIn[i]!;
        const b = rimIn[(i + 1) % rimIn.length]!;
        rimLocal.push(a);
        const sp = splits.get(edgeKey(a, b));
        if (sp !== undefined) rimLocal.push(sp);
    }

    return {
        pos: Float32Array.from(outPos),
        idx: Uint32Array.from(outIdx),
        rimLocal,
        field,
    };
}

const SKIVE_FALLBACK_T0 = 2;

/** Field for a top sheet already in the footprint frame. */
export function distalSkiveFieldFromMesh(
    pos: Float32Array,
    idx: Uint32Array,
    kind: TrimKind,
    controls: readonly Uv[] = TRIM_SEED_CONTROLS[kind],
): DistalSkiveField {
    const loop = boundaryLoop(pos, idx);
    const rim = loop.map((i) => ({ x: pos[i * 3]!, y: pos[i * 3 + 1]!, z: pos[i * 3 + 2]! }));
    return solveSkiveField(distalSkiveField(rim, kind, controls), sampleMeshHeight(pos, idx));
}
