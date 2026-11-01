// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { BufferAttribute, type BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { extractOrderedBoundaryLoopWithIndices } from "@/lib/geometry/mesh-close";
import {
    clampMortonsAmount,
    type MortonsSampleContext,
    mortonsQuery,
    mortonsSpecV,
} from "@/lib/geometry/mortons";

/**
 * Split until the Morton's delta across an edge is under the 0.05 mm gate.
 * 0.04 leaves margin for the endpoint samples the height write uses.
 */
const DISCONTINUITY_MM = 0.04;
const MIN_EDGE_MM = 0.05;
const MAX_PASSES = 14;
const MAX_NEW_VERTS = 48000;

export interface MortonsRefineFrame {
    ctx: MortonsSampleContext;
    lengthAxis: number;
    widthAxis: number;
    thickAxis: number;
    lenMin: number;
    lenSize: number;
    widCenter: number;
    widSize: number;
    widthSign: number;
    isMultiMesh: boolean;
    topVertexCount: number;
}

interface Sample {
    u: number;
    vSigned: number;
    specV: number;
    weight: number;
}

/**
 * Split top-sheet edges so the Morton's delta across an edge stays under the
 * gate. The medial perimeter is included: that ring is the wall crown, and the
 * raised surface has to meet it without a stair. New vertices are edge
 * midpoints, so each child triangle stays on the parent and the lip winding
 * does not flip. Morton's height is applied by the caller after this
 * returns. Inactive callers must not call it: the off-path mesh stays
 * byte-identical.
 *
 * Returns the top-vertex count to use after the insert (0 when the mesh is not
 * a multi-mesh base).
 */
export function refineMortonsTopMesh(geometry: BufferGeometry, frame: MortonsRefineFrame): number {
    if (!frame.isMultiMesh && geometry.getIndex()) {
        for (const name of Object.keys(geometry.attributes)) {
            if (name !== "position") geometry.deleteAttribute(name);
        }
        const welded = mergeVertices(geometry, 1e-4);
        if (welded !== geometry) {
            const p = welded.getAttribute("position");
            const ix = welded.getIndex();
            if (p && ix) {
                geometry.setAttribute("position", p.clone());
                geometry.setIndex(ix.clone());
                for (const name of Object.keys(geometry.attributes)) {
                    if (name === "position") continue;
                    const attr = geometry.getAttribute(name);
                    if (attr && attr.count !== p.count) geometry.deleteAttribute(name);
                }
                if (geometry.groups.length === 1) geometry.groups[0]!.count = ix.count;
            }
            welded.dispose();
        }
    }
    const index = geometry.getIndex();
    const posAttr = geometry.getAttribute("position");
    if (!index || !posAttr || index.count < 3) return frame.topVertexCount;

    const amount = clampMortonsAmount(frame.ctx.mortons.mode, frame.ctx.mortons.amountMm);
    if (!(amount > 0)) return frame.topVertexCount;

    const src = posAttr.array as Float32Array;
    let positions = Array.from(src);
    let indices = Array.from(index.array as ArrayLike<number>);
    let topCount = frame.isMultiMesh && frame.topVertexCount > 0 ? frame.topVertexCount : positions.length / 3;
    const multi = frame.isMultiMesh && frame.topVertexCount > 0;
    let added = 0;
    const rimMids: { i: number; a: number; b: number }[] = [];
    const patternRim = extractOrderedBoundaryLoopWithIndices(geometry).positions.map((p) => ({
        x: p.x,
        y: p.y,
    }));

    const sampleCache: Sample[] = [];
    const sampleAt = (arr: number[], i: number): Sample => {
        const hit = sampleCache[i];
        if (hit) return hit;
        const lenCoord = arr[i * 3 + frame.lengthAxis]!;
        const widCoord = arr[i * 3 + frame.widthAxis]!;
        const u = Math.max(0, Math.min(1, (lenCoord - frame.lenMin) / (frame.lenSize || 1)));
        const vSigned = Math.max(
            -1,
            Math.min(1, (frame.widthSign * (widCoord - frame.widCenter)) / ((frame.widSize || 1) / 2)),
        );
        const q = mortonsQuery(u, vSigned, frame.ctx);
        const sample = { u, vSigned, specV: mortonsSpecV(vSigned, frame.ctx.side), weight: q.weight };
        sampleCache[i] = sample;
        return sample;
    };

    const edgeKey = (a: number, b: number): number => (a < b ? a * 1000003 + b : b * 1000003 + a);

    for (let pass = 0; pass < MAX_PASSES && added < MAX_NEW_VERTS; pass++) {
        const triCount = indices.length / 3;
        const faces: number[][] = [];
        for (let t = 0; t < triCount; t++) {
            const a = indices[t * 3]!;
            const b = indices[t * 3 + 1]!;
            const c = indices[t * 3 + 2]!;
            if (multi && (a >= topCount || b >= topCount || c >= topCount)) continue;
            faces.push([a, b, c]);
        }
        if (faces.length === 0) break;

        interface FaceEdge {
            face: number;
            a: number;
            b: number;
            c: number;
        }
        const edges = new Map<number, FaceEdge[]>();
        const pushEdge = (face: number, a: number, b: number, c: number) => {
            if (a === b) return;
            const k = edgeKey(a, b);
            const list = edges.get(k);
            const rec = { face, a, b, c };
            if (list) list.push(rec);
            else edges.set(k, [rec]);
        };
        for (let f = 0; f < faces.length; f++) {
            const [a, b, c] = faces[f]!;
            pushEdge(f, a, b, c);
            pushEdge(f, b, c, a);
            pushEdge(f, c, a, b);
        }

        interface Split {
            score: number;
            mid: [number, number, number];
            faces: FaceEdge[];
            rim: boolean;
        }
        const posUse = new Map<string, number>();
        const quant = (i: number) => {
            const s = 1e4;
            return `${Math.round(positions[i * 3]! * s)},${Math.round(positions[i * 3 + 1]! * s)},${Math.round(positions[i * 3 + 2]! * s)}`;
        };
        const posEdgeKey = (a: number, b: number) => {
            const ka = quant(a);
            const kb = quant(b);
            return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        };
        for (const recs of edges.values()) {
            if (recs.length === 0) continue;
            const k = posEdgeKey(recs[0]!.a, recs[0]!.b);
            posUse.set(k, (posUse.get(k) ?? 0) + recs.length);
        }
        const rimEdge = (recs: FaceEdge[]) =>
            recs.length === 1 || (posUse.get(posEdgeKey(recs[0]!.a, recs[0]!.b)) ?? 0) === 1;
        const boundaryFace = new Set<number>();
        for (const recs of edges.values()) {
            if (!rimEdge(recs)) continue;
            for (const r of recs) boundaryFace.add(r.face);
        }
        const splits: Split[] = [];
        for (const recs of edges.values()) {
            if (recs.length === 0 || recs.length > 2) continue;
            const a = recs[0]!.a;
            const b = recs[0]!.b;
            const ax = positions[a * 3]!;
            const ay = positions[a * 3 + 1]!;
            const az = positions[a * 3 + 2]!;
            const bx = positions[b * 3]!;
            const by = positions[b * 3 + 1]!;
            const bz = positions[b * 3 + 2]!;
            const len = Math.hypot(bx - ax, by - ay, bz - az);
            if (len < MIN_EDGE_MM) continue;
            const sa = sampleAt(positions, a);
            const sb = sampleAt(positions, b);
            const dH = Math.abs(sa.weight - sb.weight) * amount;
            const boundary = rimEdge(recs);
            const midU = (sa.u + sb.u) * 0.5;
            const midSpec = (sa.specV + sb.specV) * 0.5;
            // The curved toe rim is the wall's tightest station turn. Densifying
            // it fans the columns. The medial blend is the edge that has to
            // follow the height.
            if (boundary && midU > 0.85) continue;
            // Stay at or under 0.3 mm so even-split does not densify the
            // whole outline. The curved toe stays at its original spacing.
            if (boundary && len <= 0.28) continue;
            // Radial edges of a rim face stay put. Replacing that triangle
            // flips the lip tangent (ang 180). The rim edge itself still splits.
            if (!boundary && recs.some((r) => boundaryFace.has(r.face))) continue;
            // Lateral 3 mm taper: keep steps from getting coarse, without
            // refining that steeper band down to the medial gate. The medial
            // rim uses the tight gate so the wall crown follows the raise.
            const lateral = !boundary && midSpec > 0.28 && midU > 0.7;
            const gate = lateral ? 0.12 : DISCONTINUITY_MM;
            const minLen = lateral ? 0.8 : MIN_EDGE_MM;
            if (len <= minLen) continue;
            if (dH <= gate) continue;
            splits.push({
                score: dH,
                mid: [(ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5],
                faces: recs,
                rim: boundary,
            });
        }
        if (splits.length === 0) break;
        splits.sort((p, q) => q.score - p.score);
        const chosen = splits.slice(0, Math.max(0, MAX_NEW_VERTS - added));
        if (chosen.length === 0) break;

        const midOf = new Map<number, number>();
        if (multi) {
            const oldTop = topCount;
            const bottom = positions.slice(oldTop * 3);
            const next = positions.slice(0, oldTop * 3);
            for (const sp of chosen) {
                const m = next.length / 3;
                next.push(sp.mid[0], sp.mid[1], sp.mid[2]);
                midOf.set(edgeKey(sp.faces[0]!.a, sp.faces[0]!.b), m);
                if (sp.rim) rimMids.push({ i: m, a: sp.faces[0]!.a, b: sp.faces[0]!.b });
            }
            const newCount = chosen.length;
            positions = next.concat(bottom);
            const remap = (i: number) => (i >= oldTop ? i + newCount : i);
            indices = indices.map(remap);
            topCount = oldTop + newCount;
            added += newCount;
        } else {
            for (const sp of chosen) {
                const m = positions.length / 3;
                positions.push(sp.mid[0], sp.mid[1], sp.mid[2]);
                midOf.set(edgeKey(sp.faces[0]!.a, sp.faces[0]!.b), m);
                if (sp.rim) rimMids.push({ i: m, a: sp.faces[0]!.a, b: sp.faces[0]!.b });
            }
            added += chosen.length;
            topCount = positions.length / 3;
        }
        const faceReplace = new Map<number, [number, number, number][]>();
        for (const sp of chosen) {
            for (const f of sp.faces) {
                if (faceReplace.has(f.face)) continue;
                const tri = faces[f.face]!;
                faceReplace.set(f.face, retessellate(tri[0]!, tri[1]!, tri[2]!, midOf));
            }
        }

        const nextIdx: number[] = [];
        const triTotal = indices.length / 3;
        let local = 0;
        for (let t = 0; t < triTotal; t++) {
            const a = indices[t * 3]!;
            const b = indices[t * 3 + 1]!;
            const c = indices[t * 3 + 2]!;
            const inTop = !multi || (a < topCount && b < topCount && c < topCount);
            if (!inTop) {
                nextIdx.push(a, b, c);
                continue;
            }
            const repl = faceReplace.get(local);
            local++;
            if (!repl) {
                nextIdx.push(a, b, c);
                continue;
            }
            for (const tri of repl) nextIdx.push(tri[0], tri[1], tri[2]);
        }
        indices = nextIdx;
    }

    if (added === 0) return frame.topVertexCount;
    if (rimMids.length) {
        (geometry.userData as { mortonsRimMids?: { i: number; a: number; b: number }[] }).mortonsRimMids =
            rimMids;
    }
    if (patternRim.length >= 8) {
        (geometry.userData as { mortonsPatternRim?: { x: number; y: number }[] }).mortonsPatternRim = patternRim;
    }

    const posArr = new Float32Array(positions);
    geometry.setAttribute("position", new BufferAttribute(posArr, 3));
    geometry.setIndex(indices);
    for (const name of Object.keys(geometry.attributes)) {
        if (name === "position") continue;
        const attr = geometry.getAttribute(name);
        if (attr && attr.count !== posArr.length / 3) geometry.deleteAttribute(name);
    }
    if (geometry.groups.length === 1) {
        geometry.groups[0]!.count = indices.length;
    }
    if (multi) {
        (geometry.userData as { topVertexCount?: number }).topVertexCount = topCount;
    }
    return multi ? topCount : frame.topVertexCount;
}

function retessellate(
    i0: number,
    i1: number,
    i2: number,
    midOf: Map<number, number>,
): [number, number, number][] {
    const m01 = midOf.get(i0 < i1 ? i0 * 1000003 + i1 : i1 * 1000003 + i0);
    const m12 = midOf.get(i1 < i2 ? i1 * 1000003 + i2 : i2 * 1000003 + i1);
    const m20 = midOf.get(i2 < i0 ? i2 * 1000003 + i0 : i0 * 1000003 + i2);
    if (m01 == null && m12 == null && m20 == null) return [[i0, i1, i2]];
    if (m01 != null && m12 != null && m20 != null) {
        return [
            [i0, m01, m20],
            [m01, i1, m12],
            [m20, m12, i2],
            [m01, m12, m20],
        ];
    }
    if (m01 != null && m12 == null && m20 == null) return [[i0, m01, i2], [m01, i1, i2]];
    if (m12 != null && m01 == null && m20 == null) return [[i0, i1, m12], [i0, m12, i2]];
    if (m20 != null && m01 == null && m12 == null) return [[i0, i1, m20], [m20, i1, i2]];
    if (m01 != null && m12 != null) return [[i0, m01, i2], [m01, i1, m12], [m01, m12, i2]];
    if (m12 != null && m20 != null) return [[i0, i1, m12], [i0, m12, m20], [m12, i2, m20]];
    return [[i0, m01!, m20!], [m01!, i1, i2], [m01!, i2, m20!]];
}
