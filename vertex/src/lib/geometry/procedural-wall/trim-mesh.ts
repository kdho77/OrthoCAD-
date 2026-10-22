// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type BufferAttribute, BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from "three";
import { pointInPoly } from "./cdt-band";
import { libraryCdtInterior } from "./cdt-lib";
import type { PolyPoint } from "./curves";
import {
    type CutSample,
    closestOnCut,
    cutPolyline,
    footprintFrameFromRim,
    TRIM_BAND_MM,
    TRIM_CHORD_MM,
    type TrimKind,
    type Uv,
} from "./trim-curve";

const WELD_Q = 1e5;

interface Welded {
    pos: Float32Array;
    idx: Uint32Array;
}

/** Collapse coincident vertices. Surviving positions are exact copies of the first. */
export function weldExact(posIn: Float32Array, idxIn: Uint32Array): Welded {
    const map = new Map<string, number>();
    const remap = new Int32Array(posIn.length / 3);
    const coords: number[] = [];
    for (let i = 0; i < posIn.length; i += 3) {
        const x = posIn[i]!;
        const y = posIn[i + 1]!;
        const z = posIn[i + 2]!;
        const k = `${Math.round(x * WELD_Q)},${Math.round(y * WELD_Q)},${Math.round(z * WELD_Q)}`;
        let id = map.get(k);
        if (id === undefined) {
            id = coords.length / 3;
            map.set(k, id);
            coords.push(x, y, z);
        }
        remap[i / 3] = id;
    }
    const idx: number[] = [];
    for (let t = 0; t < idxIn.length; t += 3) {
        const a = remap[idxIn[t]!]!;
        const b = remap[idxIn[t + 1]!]!;
        const c = remap[idxIn[t + 2]!]!;
        if (a === b || b === c || c === a) continue;
        idx.push(a, b, c);
    }
    return { pos: Float32Array.from(coords), idx: Uint32Array.from(idx) };
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a},${b}` : `${b},${a}`;
}

function boundaryLoops(idx: Uint32Array): { loops: number[][]; boundary: Set<string> } {
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
    const boundary = new Set<string>();
    for (const [k, n] of count) {
        if (n !== 1) continue;
        boundary.add(k);
        const [a, b] = k.split(",").map(Number) as [number, number];
        const la = adj.get(a) ?? [];
        la.push(b);
        adj.set(a, la);
        const lb = adj.get(b) ?? [];
        lb.push(a);
        adj.set(b, lb);
    }
    const seen = new Set<number>();
    const loops: number[][] = [];
    for (const start of adj.keys()) {
        if (seen.has(start)) continue;
        const loop = [start];
        seen.add(start);
        let prev = -1;
        let cur = start;
        while (loop.length <= boundary.size + 2) {
            const nxt = (adj.get(cur) ?? []).find((n) => n !== prev && !seen.has(n));
            if (nxt === undefined) break;
            loop.push(nxt);
            seen.add(nxt);
            prev = cur;
            cur = nxt;
        }
        if (loop.length >= 3) loops.push(loop);
    }
    loops.sort((a, b) => b.length - a.length);
    return { loops, boundary };
}

export function sampleMeshHeight(
    pos: Float32Array,
    idx: Uint32Array,
): (x: number, y: number) => number | null {
    return heightSampler(pos, idx);
}

function heightSampler(pos: Float32Array, idx: Uint32Array): (x: number, y: number) => number | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!;
        const y = pos[i + 1]!;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    const cell = 4;
    const nx = Math.max(1, Math.ceil((maxX - minX) / cell));
    const ny = Math.max(1, Math.ceil((maxY - minY) / cell));
    const bins: number[][] = Array.from({ length: nx * ny }, () => []);
    const triCount = idx.length / 3;
    for (let t = 0; t < triCount; t++) {
        const a = idx[t * 3]!;
        const b = idx[t * 3 + 1]!;
        const c = idx[t * 3 + 2]!;
        const xs = [pos[a * 3]!, pos[b * 3]!, pos[c * 3]!];
        const ys = [pos[a * 3 + 1]!, pos[b * 3 + 1]!, pos[c * 3 + 1]!];
        const x0 = Math.max(0, Math.floor((Math.min(...xs) - minX) / cell));
        const x1 = Math.min(nx - 1, Math.floor((Math.max(...xs) - minX) / cell));
        const y0 = Math.max(0, Math.floor((Math.min(...ys) - minY) / cell));
        const y1 = Math.min(ny - 1, Math.floor((Math.max(...ys) - minY) / cell));
        for (let ix = x0; ix <= x1; ix++) {
            for (let iy = y0; iy <= y1; iy++) bins[iy * nx + ix]!.push(t);
        }
    }
    return (x, y) => {
        const ix = Math.max(0, Math.min(nx - 1, Math.floor((x - minX) / cell)));
        const iy = Math.max(0, Math.min(ny - 1, Math.floor((y - minY) / cell)));
        let best: number | null = null;
        let bestD = 0.04;
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const cx = ix + ox;
                const cy = iy + oy;
                if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) continue;
                for (const t of bins[cy * nx + cx]!) {
                    const ia = idx[t * 3]!;
                    const ib = idx[t * 3 + 1]!;
                    const ic = idx[t * 3 + 2]!;
                    const ax = pos[ia * 3]!;
                    const ay = pos[ia * 3 + 1]!;
                    const az = pos[ia * 3 + 2]!;
                    const bx = pos[ib * 3]!;
                    const by = pos[ib * 3 + 1]!;
                    const bz = pos[ib * 3 + 2]!;
                    const cxp = pos[ic * 3]!;
                    const cyp = pos[ic * 3 + 1]!;
                    const cz = pos[ic * 3 + 2]!;
                    const d00 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
                    const d01 = (bx - ax) * (cxp - ax) + (by - ay) * (cyp - ay);
                    const d11 = (cxp - ax) * (cxp - ax) + (cyp - ay) * (cyp - ay);
                    const d20 = (x - ax) * (bx - ax) + (y - ay) * (by - ay);
                    const d21 = (x - ax) * (cxp - ax) + (y - ay) * (cyp - ay);
                    const den = d00 * d11 - d01 * d01;
                    if (Math.abs(den) < 1e-12) continue;
                    const v = (d11 * d20 - d01 * d21) / den;
                    const w = (d00 * d21 - d01 * d20) / den;
                    const u = 1 - v - w;
                    const err = Math.max(0, -u, -v, -w);
                    if (err < bestD) {
                        bestD = err;
                        best = u * az + v * bz + w * cz;
                        if (err === 0) return best;
                    }
                }
            }
        }
        return best;
    };
}

function chainFromEdges(edges: Array<[number, number]>): number[] {
    const adj = new Map<number, number[]>();
    for (const [a, b] of edges) {
        const la = adj.get(a) ?? [];
        la.push(b);
        adj.set(a, la);
        const lb = adj.get(b) ?? [];
        lb.push(a);
        adj.set(b, lb);
    }
    let end = -1;
    for (const [v, ns] of adj) {
        if (ns.length === 1) {
            end = v;
            break;
        }
    }
    if (end < 0) return [];
    const chain = [end];
    let prev = -1;
    let cur = end;
    while (chain.length <= edges.length + 2) {
        const nxt = (adj.get(cur) ?? []).find((n) => n !== prev);
        if (nxt === undefined) break;
        chain.push(nxt);
        prev = cur;
        cur = nxt;
        if ((adj.get(cur)?.length ?? 0) === 1 && cur !== end) break;
    }
    return chain;
}

function orientLoop(pts: PolyPoint[]): PolyPoint[] {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        const q = pts[(i + 1) % pts.length]!;
        a += p.x * q.y - q.x * p.y;
    }
    return a < 0 ? pts.slice().reverse() : pts;
}

/**
 * Trim a footprint-frame top sheet along the cut. Vertices more than
 * {@link TRIM_BAND_MM} proximal of the cut keep their exact positions.
 * Only the band is re-triangulated, with the cut as a constrained edge.
 */
export function trimTopToCut(
    footprint: BufferGeometry,
    kind: TrimKind,
    controls: readonly Uv[],
): BufferGeometry {
    const src = footprint.getAttribute("position");
    const srcIdx = footprint.getIndex();
    if (!src || !srcIdx) throw new Error("trim: indexed position mesh required");
    const welded = weldExact(src.array as Float32Array, srcIdx.array as Uint32Array);
    const { pos, idx } = welded;
    const { loops, boundary } = boundaryLoops(idx);
    const rimLoop = loops[0];
    if (!rimLoop || rimLoop.length < 8) throw new Error("trim: top sheet has no boundary loop");
    const rimPts: PolyPoint[] = rimLoop.map((i) => ({
        x: pos[i * 3]!,
        y: pos[i * 3 + 1]!,
        z: pos[i * 3 + 2]!,
    }));
    const frame = footprintFrameFromRim(rimPts);
    const cut = cutPolyline(frame, controls, 2, TRIM_CHORD_MM);
    const nV = pos.length / 3;
    const signed = new Float64Array(nV);
    for (let i = 0; i < nV; i++) {
        signed[i] = closestOnCut(pos[i * 3]!, pos[i * 3 + 1]!, cut).signed;
    }
    const kept: number[] = [];
    const keptEdge = new Map<string, number>();
    const triCount = idx.length / 3;
    for (let t = 0; t < triCount; t++) {
        const a = idx[t * 3]!;
        const b = idx[t * 3 + 1]!;
        const c = idx[t * 3 + 2]!;
        if (signed[a]! >= TRIM_BAND_MM && signed[b]! >= TRIM_BAND_MM && signed[c]! >= TRIM_BAND_MM) {
            kept.push(a, b, c);
            for (const [p, q] of [
                [a, b],
                [b, c],
                [c, a],
            ] as const) {
                const k = edgeKey(p, q);
                keptEdge.set(k, (keptEdge.get(k) ?? 0) + 1);
            }
        }
    }
    const chainEdges: Array<[number, number]> = [];
    for (const [k, n] of keptEdge) {
        if (n !== 1 || boundary.has(k)) continue;
        const [a, b] = k.split(",").map(Number) as [number, number];
        chainEdges.push([a, b]);
    }
    const chain = chainFromEdges(chainEdges);
    if (chain.length < 2) {
        const deg = new Map<number, number>();
        for (const [a, b] of chainEdges) {
            deg.set(a, (deg.get(a) ?? 0) + 1);
            deg.set(b, (deg.get(b) ?? 0) + 1);
        }
        let ends = 0;
        let branches = 0;
        for (const d of deg.values()) {
            if (d === 1) ends++;
            else if (d !== 2) branches++;
        }
        throw new Error(
            `trim: band chain is empty (edges ${chainEdges.length}, ends ${ends}, branches ${branches})`,
        );
    }

    const rimIndex = new Map<number, number>();
    rimLoop.forEach((v, i) => rimIndex.set(v, i));
    let slot0 = rimIndex.get(chain[0]!);
    let slot1 = rimIndex.get(chain[chain.length - 1]!);
    if (slot0 === undefined || slot1 === undefined) throw new Error("trim: band chain does not meet the rim");

    const height = heightSampler(pos, idx);
    const insideRim = (x: number, y: number) => pointInPoly(x, y, rimPts) || minRimDist(x, y, rimPts) < 0.05;
    const cutEdge: Array<{ x: number; y: number; z: number }> = [];
    for (const p of cut) {
        if (!insideRim(p.x, p.y)) continue;
        const z = height(p.x, p.y);
        if (z == null) continue;
        const prev = cutEdge[cutEdge.length - 1];
        if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < TRIM_CHORD_MM * 0.45) continue;
        cutEdge.push({ x: p.x, y: p.y, z });
    }
    if (cutEdge.length < 2) throw new Error("trim: cut does not cross the top sheet");

    const distToCut = (x: number, y: number) => closestOnCut(x, y, cut).dist;
    const exitWalk = (fromSlot: number): number[] => {
        const forward = walkUntilCut(rimLoop, pos, fromSlot, 1, distToCut);
        const back = walkUntilCut(rimLoop, pos, fromSlot, -1, distToCut);
        if (forward.length === 0) return back;
        if (back.length === 0) return forward;
        return forward.length <= back.length ? forward : back;
    };
    let sideA = exitWalk(slot0);
    let sideB = exitWalk(slot1);
    if (sideA.length < 1 || sideB.length < 1) throw new Error("trim: cut does not meet the rim band");

    const endOf = (walk: number[]) => walk[walk.length - 1]!;
    const xy = (v: number) => ({ x: pos[v * 3]!, y: pos[v * 3 + 1]! });
    const nearCut = (v: number) => {
        let best = 0;
        let bestD = Infinity;
        const p = xy(v);
        for (let i = 0; i < cutEdge.length; i++) {
            const d = Math.hypot(cutEdge[i]!.x - p.x, cutEdge[i]!.y - p.y);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        return best;
    };
    let ordered = chain.slice();
    let cutLo = nearCut(endOf(sideA));
    let cutHi = nearCut(endOf(sideB));
    if (cutLo > cutHi) {
        ordered = ordered.slice().reverse();
        slot0 = rimIndex.get(ordered[0]!)!;
        slot1 = rimIndex.get(ordered[ordered.length - 1]!)!;
        sideA = exitWalk(slot0);
        sideB = exitWalk(slot1);
        cutLo = nearCut(endOf(sideA));
        cutHi = nearCut(endOf(sideB));
    }
    if (cutHi - cutLo < 2) throw new Error("trim: cut exits collapsed onto one side");

    const ringPts: PolyPoint[] = [];
    const pushPt = (p: PolyPoint) => {
        const prev = ringPts[ringPts.length - 1];
        if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 1e-5) return;
        ringPts.push(p);
    };
    const pushVert = (v: number) => pushPt({ x: pos[v * 3]!, y: pos[v * 3 + 1]!, z: pos[v * 3 + 2]! });
    for (const v of ordered) pushVert(v);
    for (const v of sideB.slice(1)) pushVert(v);
    for (let i = cutHi; i >= cutLo; i--) pushPt(cutEdge[i]!);
    for (let i = sideA.length - 2; i >= 1; i--) pushVert(sideA[i]!);
    if (ringPts.length > 2) {
        const a = ringPts[0]!;
        const b = ringPts[ringPts.length - 1]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-4) ringPts.pop();
    }
    const outer = orientLoop(ringPts);
    const side0 = sideA;
    const side1 = sideB;
    const outerN = outer.length;
    const used = new Set<number>();
    for (const i of chain) used.add(i);
    for (const i of side0) used.add(i);
    for (const i of side1) used.add(i);
    const interior: PolyPoint[] = [];
    for (let i = 0; i < nV; i++) {
        if (used.has(i)) continue;
        if (signed[i]! < -1e-4 || signed[i]! >= TRIM_BAND_MM) continue;
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        if (!pointInPoly(x, y, outer)) continue;
        if (minRimDist(x, y, outer) < 0.08) continue;
        interior.push({ x, y, z: pos[i * 3 + 2]! });
    }
    const points = outer.concat(interior);
    let faces: Array<[number, number, number]> = [];
    try {
        faces = libraryCdtInterior(points, outerN);
    } catch (err) {
        throw new Error(`trim: band CDT failed (${String(err)})`);
    }
    if (faces.length < 1) throw new Error("trim: band CDT produced no triangles");

    const outPos: number[] = [];
    const outMap = new Map<number, number>();
    const addPos = (x: number, y: number, z: number): number => {
        const id = outPos.length / 3;
        outPos.push(x, y, z);
        return id;
    };
    const mapOrig = (i: number): number => {
        const hit = outMap.get(i);
        if (hit !== undefined) return hit;
        const id = addPos(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
        outMap.set(i, id);
        return id;
    };
    const outIdx: number[] = [];
    for (let t = 0; t < kept.length; t += 3) {
        outIdx.push(mapOrig(kept[t]!), mapOrig(kept[t + 1]!), mapOrig(kept[t + 2]!));
    }
    const pointIndex = points.map((p) => addPos(p.x, p.y, p.z));
    for (const [a, b, c] of faces) {
        outIdx.push(pointIndex[a]!, pointIndex[b]!, pointIndex[c]!);
    }

    const weldedOut = weldExact(Float32Array.from(outPos), Uint32Array.from(outIdx));
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(weldedOut.pos, 3));
    geo.setIndex(new Uint32BufferAttribute(weldedOut.idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData = { trimKind: kind, topOnly: true };
    return geo;
}

function minRimDist(x: number, y: number, rim: PolyPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < rim.length; i++) {
        const a = rim[i]!;
        const b = rim[(i + 1) % rim.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        const dx = x - (a.x + ex * t);
        const dy = y - (a.y + ey * t);
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
    }
    return Math.sqrt(best);
}

/** Rim arc from the band chain out to the first vertex that meets the cut. */
function walkUntilCut(
    rim: number[],
    pos: Float32Array,
    fromSlot: number,
    dir: 1 | -1,
    distToCut: (x: number, y: number) => number,
): number[] {
    const n = rim.length;
    let best = Infinity;
    let bestStep = -1;
    const limit = Math.min(n - 1, 90);
    for (let step = 0; step < limit; step++) {
        const slot = (fromSlot + dir * step + n * 8) % n;
        const v = rim[slot]!;
        const d = distToCut(pos[v * 3]!, pos[v * 3 + 1]!);
        if (d < best) {
            best = d;
            bestStep = step;
        }
        if (d < 1.25) {
            bestStep = step;
            break;
        }
        if (step > 6 && d > best + 5) break;
    }
    if (bestStep < 0 || best > 2.5) return [];
    const path: number[] = [];
    for (let step = 0; step <= bestStep; step++) {
        path.push(rim[(fromSlot + dir * step + n * 8) % n]!);
    }
    return path;
}

export function geometryPositions(geo: BufferGeometry): { pos: Float32Array; idx: Uint32Array } {
    const attr = geo.getAttribute("position") as BufferAttribute;
    const index = geo.getIndex();
    if (!index) throw new Error("expected an index");
    return { pos: attr.array as Float32Array, idx: index.array as Uint32Array };
}
