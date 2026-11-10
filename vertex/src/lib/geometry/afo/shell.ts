// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    AFO_EDGE_MM,
    AFO_FLARE_MM,
    AFO_FOOTPLATE_FLARE_CAP_MM,
    AFO_RIM_BAND_MM,
    AFO_THICKNESS_MM,
} from "./defaults";
import { geodesicVertexPath } from "./geodesic";
import { cloneMesh, computeVertexNormals, meshProjector, nearestVertex, vertexCount } from "./mesh-ops";
import { offsetMeshAlongNormals } from "./sdf-offset";
import { embedTrimPolyline } from "./shell-cut";
import { boundaryLoops, closeShellWithRoundRim, finishShellLip } from "./shell-rim";
import type { AfoShellOptions, AfoTriMesh, AfoVec3 } from "./types";

/**
 * Build a watertight AFO shell from a closed positive and a closed vertex loop.
 *
 * Keep region = connected faces whose centroids sit on the "brace" side of the
 * trim (below the mean loop z, or the larger region if that is empty).
 * Thicken along vertex normals by `thicknessMm`, blend over `edgeMm` of the
 * rim, and lift the skin-side rim by `flareMm` across the ramp band. The trim
 * curve is the inner edge. Inner + outer + rim strip form a closed solid.
 */
export function buildAfoShell(
    mesh: AfoTriMesh,
    trimVertexIndices: number[],
    options: AfoShellOptions = {
        thicknessMm: AFO_THICKNESS_MM,
        edgeMm: AFO_EDGE_MM,
        flareMm: AFO_FLARE_MM,
    },
): AfoTriMesh {
    options.onProgress?.(0.05, "keep-region");
    const embedded =
        options.trimPolygon && options.trimPolygon.length >= 3
            ? embedTrimPolyline(mesh, options.trimPolygon)
            : null;
    const surface = embedded && embedded.loop.length >= 3 ? embedded.mesh : mesh;
    const loop =
        embedded && embedded.loop.length >= 3 ? embedded.loop : resolveShellTrimLoop(mesh, trimVertexIndices);
    // A projected trim is already a chain of mesh edges. Geodesic fill is only
    // for a vertex-id loop that was never split into the surface.
    const keep = snapBoundaryToCurve(
        cleanupBoundary(
            extractKeepRegion(surface, loop, options.heelSeed, !(embedded && embedded.loop.length >= 3)),
        ),
        options.trimPolygon,
    );
    options.onProgress?.(0.25, "thicken");
    const shell = thickenOpenSurface(keep, options.thicknessMm, options.edgeMm, options.flareMm);
    restoreFarWall(shell, options.thicknessMm);
    tightenBoundaryToCurve(shell, options.trimPolygon);
    finishShellLip(shell);
    options.onProgress?.(1, "done");
    return shell;
}

/** Nudge an opening vertex that the lip repair pulled off the trim back toward it. */
function tightenBoundaryToCurve(shell: AfoTriMesh, curve: AfoVec3[] | undefined): void {
    const n = shell.outerVertex0;
    const face0 = shell.rimFaceStart;
    if (!curve || curve.length < 3 || n == null || face0 == null) return;
    const count = new Map<string, { a: number; b: number; n: number }>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (!vs.every((v) => v < n)) continue;
        for (let e = 0; e < 3; e++) {
            const a = vs[e]!;
            const b = vs[(e + 1) % 3]!;
            const k = key(a, b);
            const prev = count.get(k);
            if (prev) prev.n += 1;
            else count.set(k, { a, b, n: 1 });
        }
    }
    const boundary = new Set<number>();
    for (const e of count.values()) {
        if (e.n !== 1) continue;
        boundary.add(e.a);
        boundary.add(e.b);
    }
    for (const i of boundary) {
        const px = shell.positions[i * 3] ?? 0;
        const py = shell.positions[i * 3 + 1] ?? 0;
        const pz = shell.positions[i * 3 + 2] ?? 0;
        let best = Infinity;
        let bx = px;
        let by = py;
        let bz = pz;
        for (let k = 0; k < curve.length; k++) {
            const a = curve[k]!;
            const b = curve[(k + 1) % curve.length]!;
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const abz = b.z - a.z;
            const ab2 = abx * abx + aby * aby + abz * abz || 1;
            const t = Math.min(
                1,
                Math.max(0, ((px - a.x) * abx + (py - a.y) * aby + (pz - a.z) * abz) / ab2),
            );
            const qx = a.x + abx * t;
            const qy = a.y + aby * t;
            const qz = a.z + abz * t;
            const d = Math.hypot(px - qx, py - qy, pz - qz);
            if (d < best) {
                best = d;
                bx = qx;
                by = qy;
                bz = qz;
            }
        }
        if (best <= 0.05 || best > 0.8) continue;
        const pull = best - 0.04;
        const s = pull / best;
        shell.positions[i * 3] = px + (bx - px) * s;
        shell.positions[i * 3 + 1] = py + (by - py) * s;
        shell.positions[i * 3 + 2] = pz + (bz - pz) * s;
    }
}

interface OpenSurface {
    positions: Float32Array;
    indices: Uint32Array;
    /** Boundary vertex indices in the compact mesh, ordered around the rim. */
    boundary: number[];
    /** Unique-use edges of the keep region (oriented as in the owning triangle). */
    boundaryEdges: { a: number; b: number }[];
}

/** Closed on-surface trim passed into the shell as the inner boundary. */
export function trimPolygonForShell(curve: AfoVec3[], closed: boolean): AfoVec3[] | null {
    if (!closed || curve.length < 3) return null;
    return curve.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

/**
 * Nearest-vertex ids for a polygon, with no decimation cap. The shell cut does
 * not use this snap: `buildAfoShell` embeds the polyline and splits every
 * triangle the curve crosses. This remains for callers that only need a
 * vertex-id loop on the original mesh.
 */
export function resolveShellTrimLoop(mesh: AfoTriMesh, fallback: number[], polygon?: AfoVec3[]): number[] {
    if (!polygon || polygon.length < 3) return fallback;
    const ids: number[] = [];
    for (const p of polygon) {
        const idx = nearestVertex(mesh, p).index;
        if (ids[ids.length - 1] !== idx) ids.push(idx);
    }
    if (ids.length >= 2 && ids[0] === ids[ids.length - 1]) ids.pop();
    return ids.length >= 3 ? ids : fallback;
}

function extractKeepRegion(
    mesh: AfoTriMesh,
    loop: number[],
    heelSeed: AfoVec3 | undefined,
    allowGeodesic: boolean,
): OpenSurface {
    const expanded = expandLoop(mesh, loop, allowGeodesic);
    const cut = new Set<string>();
    const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < expanded.length; i++) {
        cut.add(edgeKey(expanded[i]!, expanded[(i + 1) % expanded.length]!));
    }
    const t = (mesh.indices.length / 3) | 0;
    const neighbors: number[][] = Array.from({ length: t }, () => []);
    const edgeFaces = new Map<string, number[]>();
    for (let i = 0; i < t; i++) {
        const vs = [mesh.indices[i * 3] ?? 0, mesh.indices[i * 3 + 1] ?? 0, mesh.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = edgeKey(vs[e]!, vs[(e + 1) % 3]!);
            const list = edgeFaces.get(k);
            if (list) list.push(i);
            else edgeFaces.set(k, [i]);
        }
    }
    for (const [k, faces] of edgeFaces) {
        if (cut.has(k) || faces.length !== 2) continue;
        neighbors[faces[0]!]!.push(faces[1]!);
        neighbors[faces[1]!]!.push(faces[0]!);
    }
    const seen = new Uint8Array(t);
    const comps: number[][] = [];
    for (let i = 0; i < t; i++) {
        if (seen[i]) continue;
        const comp: number[] = [];
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
            const f = stack.pop()!;
            comp.push(f);
            for (const nb of neighbors[f] ?? []) {
                if (seen[nb]) continue;
                seen[nb] = 1;
                stack.push(nb);
            }
        }
        comps.push(comp);
    }
    let minZ = Infinity;
    let minVert = 0;
    const n = vertexCount(mesh);
    if (heelSeed) {
        minVert = nearestVertex(mesh, heelSeed).index;
    } else {
        for (let i = 0; i < n; i++) {
            const z = mesh.positions[i * 3 + 2] ?? 0;
            if (z < minZ) {
                minZ = z;
                minVert = i;
            }
        }
    }
    const faceOfVert = new Map<number, number[]>();
    for (let i = 0; i < t; i++) {
        for (let k = 0; k < 3; k++) {
            const v = mesh.indices[i * 3 + k] ?? 0;
            const list = faceOfVert.get(v);
            if (list) list.push(i);
            else faceOfVert.set(v, [i]);
        }
    }
    const compId = new Int32Array(t).fill(-1);
    comps.forEach((comp, id) => {
        for (const f of comp) compId[f] = id;
    });
    let keepId = 0;
    let bestScore = -1;
    for (const f of faceOfVert.get(minVert) ?? []) {
        const id = compId[f] ?? 0;
        const score = comps[id]?.length ?? 0;
        if (score > bestScore) {
            bestScore = score;
            keepId = id;
        }
    }
    let keepTris = comps[keepId] ?? [];
    if (keepTris.length < 4 || comps.length < 2) {
        const meanZ = meanLoopZ(mesh, expanded);
        keepTris = [];
        for (let i = 0; i < t; i++) {
            const ia = mesh.indices[i * 3] ?? 0;
            const ib = mesh.indices[i * 3 + 1] ?? 0;
            const ic = mesh.indices[i * 3 + 2] ?? 0;
            const cz =
                ((mesh.positions[ia * 3 + 2] ?? 0) +
                    (mesh.positions[ib * 3 + 2] ?? 0) +
                    (mesh.positions[ic * 3 + 2] ?? 0)) /
                3;
            if (cz <= meanZ + 1e-6) keepTris.push(i);
        }
        if (keepTris.length < 4) keepTris = Array.from({ length: t }, (_, i) => i);
    }
    return compactOpen(mesh, keepTris, expanded);
}

function expandLoop(mesh: AfoTriMesh, loop: number[], allowGeodesic: boolean): number[] {
    if (loop.length < 2) return loop.slice();
    const adjacent = edgeAdjacency(mesh);
    const out: number[] = [];
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const direct = adjacent.has(edgeKey(a, b));
        const path = direct ? [a, b] : allowGeodesic ? (geodesicVertexPath(mesh, a, b) ?? [a, b]) : [a, b];
        const start = i === 0 ? 0 : 1;
        for (let k = start; k < path.length; k++) out.push(path[k]!);
    }
    return out;
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function edgeAdjacency(mesh: AfoTriMesh): Set<string> {
    const out = new Set<string>();
    const t = (mesh.indices.length / 3) | 0;
    for (let i = 0; i < t; i++) {
        const a = mesh.indices[i * 3] ?? 0;
        const b = mesh.indices[i * 3 + 1] ?? 0;
        const c = mesh.indices[i * 3 + 2] ?? 0;
        out.add(edgeKey(a, b));
        out.add(edgeKey(b, c));
        out.add(edgeKey(c, a));
    }
    return out;
}

function meanLoopZ(mesh: AfoTriMesh, loop: number[]): number {
    if (loop.length === 0) return 0;
    let s = 0;
    for (const i of loop) s += mesh.positions[i * 3 + 2] ?? 0;
    return s / loop.length;
}

function compactOpen(mesh: AfoTriMesh, triIds: number[], loop: number[]): OpenSurface {
    const map = new Map<number, number>();
    const positions: number[] = [];
    const indices: number[] = [];
    const add = (old: number): number => {
        let ni = map.get(old);
        if (ni === undefined) {
            ni = map.size;
            map.set(old, ni);
            positions.push(
                mesh.positions[old * 3] ?? 0,
                mesh.positions[old * 3 + 1] ?? 0,
                mesh.positions[old * 3 + 2] ?? 0,
            );
        }
        return ni;
    };
    for (const t of triIds) {
        indices.push(
            add(mesh.indices[t * 3] ?? 0),
            add(mesh.indices[t * 3 + 1] ?? 0),
            add(mesh.indices[t * 3 + 2] ?? 0),
        );
    }
    const compact: AfoTriMesh = {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
    };
    const edges = findBoundaryEdges(compact);
    const boundary = orderBoundary(
        edges,
        loop.map((i) => map.get(i)).filter((v): v is number => v != null),
        vertexCount(compact),
    );
    return { ...compact, boundary, boundaryEdges: edges };
}

/** Unique-use edges of an open surface, oriented as in the owning triangle. */
function findBoundaryEdges(mesh: AfoTriMesh): { a: number; b: number }[] {
    const t = (mesh.indices.length / 3) | 0;
    const edgeUse = new Map<string, { a: number; b: number; n: number }>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < t; i++) {
        const vs = [mesh.indices[i * 3] ?? 0, mesh.indices[i * 3 + 1] ?? 0, mesh.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const a = vs[e]!;
            const b = vs[(e + 1) % 3]!;
            if (a === b) continue;
            const k = key(a, b);
            const prev = edgeUse.get(k);
            if (prev) prev.n += 1;
            else edgeUse.set(k, { a, b, n: 1 });
        }
    }
    const out: { a: number; b: number }[] = [];
    for (const e of edgeUse.values()) {
        if (e.n === 1) out.push({ a: e.a, b: e.b });
    }
    return out;
}

function orderBoundary(edges: { a: number; b: number }[], seed: number[], nVerts: number): number[] {
    const next = new Map<number, number[]>();
    for (const e of edges) {
        (next.get(e.a) ?? next.set(e.a, []).get(e.a)!).push(e.b);
        (next.get(e.b) ?? next.set(e.b, []).get(e.b)!).push(e.a);
    }
    const start = seed.find((s) => next.has(s)) ?? [...next.keys()][0];
    if (start == null) return seed;
    const loop: number[] = [start];
    const seen = new Set<number>([start]);
    let cur = start;
    for (let guard = 0; guard < nVerts + 2; guard++) {
        const nbrs = next.get(cur) ?? [];
        const nxt = nbrs.find((v) => !seen.has(v));
        if (nxt == null) break;
        loop.push(nxt);
        seen.add(nxt);
        cur = nxt;
    }
    return loop.length >= 3 ? loop : seed;
}

/**
 * Collapse boundary edges under 0.05 mm and flip skinny triangles that touch
 * the opening so the rim is not built on slivers.
 */
function cleanupBoundary(surface: OpenSurface): OpenSurface {
    let mesh: AfoTriMesh = {
        positions: new Float32Array(surface.positions),
        indices: new Uint32Array(surface.indices),
    };
    for (let pass = 0; pass < 4; pass++) {
        const edges = findBoundaryEdges(mesh);
        const degree = new Map<number, number>();
        for (const e of edges) {
            degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
            degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
        }
        const parent = new Int32Array(vertexCount(mesh)).map((_, i) => i);
        const find = (i: number): number => {
            let v = i;
            while (parent[v] !== v) v = parent[v]!;
            return v;
        };
        let unions = 0;
        for (const e of edges) {
            if ((degree.get(e.a) ?? 0) > 2 || (degree.get(e.b) ?? 0) > 2) continue;
            if (vertexDist(mesh, e.a, e.b) >= 0.05) continue;
            const ra = find(e.a);
            const rb = find(e.b);
            if (ra === rb) continue;
            parent[rb] = ra;
            unions++;
        }
        if (unions === 0) break;
        const positions = new Float32Array(mesh.positions);
        const weight = new Float32Array(vertexCount(mesh));
        for (let i = 0; i < vertexCount(mesh); i++) {
            const r = find(i);
            if (r === i) continue;
            positions[r * 3] = (positions[r * 3] ?? 0) + (mesh.positions[i * 3] ?? 0);
            positions[r * 3 + 1] = (positions[r * 3 + 1] ?? 0) + (mesh.positions[i * 3 + 1] ?? 0);
            positions[r * 3 + 2] = (positions[r * 3 + 2] ?? 0) + (mesh.positions[i * 3 + 2] ?? 0);
            weight[r] = (weight[r] ?? 0) + 1;
        }
        for (let i = 0; i < vertexCount(mesh); i++) {
            if ((weight[i] ?? 0) === 0) continue;
            const n = (weight[i] ?? 0) + 1;
            positions[i * 3] = (positions[i * 3] ?? 0) / n;
            positions[i * 3 + 1] = (positions[i * 3 + 1] ?? 0) / n;
            positions[i * 3 + 2] = (positions[i * 3 + 2] ?? 0) / n;
        }
        const raw: number[] = [];
        const triCount = (mesh.indices.length / 3) | 0;
        for (let t = 0; t < triCount; t++) {
            const a = find(mesh.indices[t * 3] ?? 0);
            const b = find(mesh.indices[t * 3 + 1] ?? 0);
            const c = find(mesh.indices[t * 3 + 2] ?? 0);
            if (a === b || b === c || c === a) continue;
            raw.push(a, b, c);
        }
        mesh = compactUsed({ positions, indices: new Uint32Array(raw) });
    }
    const boundaryVerts = new Set<number>();
    for (const e of findBoundaryEdges(mesh)) {
        boundaryVerts.add(e.a);
        boundaryVerts.add(e.b);
    }
    for (let n = 0; n < 24; n++) {
        if (!flipSkinnyBoundary(mesh, boundaryVerts)) break;
    }
    relaxSharpBoundaryTurns(mesh);
    const edges = findBoundaryEdges(mesh);
    return {
        positions: mesh.positions,
        indices: mesh.indices,
        boundary: orderBoundary(edges, [], vertexCount(mesh)),
        boundaryEdges: edges,
    };
}

/**
 * A one-triangle nick in the cut leaves a ~100° turn on a sub-0.2 mm edge.
 * Pull just those vertices toward the chord of their two neighbours. The move
 * is a few hundredths of a millimetre, inside the curve tolerance.
 */
function relaxSharpBoundaryTurns(mesh: AfoTriMesh, maxEdgeMm = 0.2, minTurnDeg = 50): void {
    const at = (i: number) => ({
        x: mesh.positions[i * 3] ?? 0,
        y: mesh.positions[i * 3 + 1] ?? 0,
        z: mesh.positions[i * 3 + 2] ?? 0,
    });
    for (let pass = 0; pass < 6; pass++) {
        const edges = findBoundaryEdges(mesh);
        const nbrs = new Map<number, number[]>();
        for (const e of edges) {
            const ab = nbrs.get(e.a) ?? [];
            ab.push(e.b);
            nbrs.set(e.a, ab);
            const ba = nbrs.get(e.b) ?? [];
            ba.push(e.a);
            nbrs.set(e.b, ba);
        }
        const updates: { i: number; x: number; y: number; z: number }[] = [];
        for (const [v, ns] of nbrs) {
            const uniq = [...new Set(ns)];
            if (uniq.length !== 2) continue;
            const a = at(uniq[0]!);
            const b = at(v);
            const c = at(uniq[1]!);
            const e0x = b.x - a.x;
            const e0y = b.y - a.y;
            const e0z = b.z - a.z;
            const e1x = c.x - b.x;
            const e1y = c.y - b.y;
            const e1z = c.z - b.z;
            const l0 = Math.hypot(e0x, e0y, e0z);
            const l1 = Math.hypot(e1x, e1y, e1z);
            if (l0 < 1e-6 || l1 < 1e-6 || l0 > maxEdgeMm || l1 > maxEdgeMm) continue;
            const cos = Math.min(1, Math.max(-1, (e0x * e1x + e0y * e1y + e0z * e1z) / (l0 * l1)));
            if ((Math.acos(cos) * 180) / Math.PI < minTurnDeg) continue;
            updates.push({
                i: v,
                x: b.x * 0.5 + (a.x + c.x) * 0.25,
                y: b.y * 0.5 + (a.y + c.y) * 0.25,
                z: b.z * 0.5 + (a.z + c.z) * 0.25,
            });
        }
        if (updates.length === 0) break;
        for (const u of updates) {
            mesh.positions[u.i * 3] = u.x;
            mesh.positions[u.i * 3 + 1] = u.y;
            mesh.positions[u.i * 3 + 2] = u.z;
        }
    }
}

function vertexDist(mesh: AfoTriMesh, a: number, b: number): number {
    const ax = mesh.positions[a * 3] ?? 0;
    const ay = mesh.positions[a * 3 + 1] ?? 0;
    const az = mesh.positions[a * 3 + 2] ?? 0;
    const bx = mesh.positions[b * 3] ?? 0;
    const by = mesh.positions[b * 3 + 1] ?? 0;
    const bz = mesh.positions[b * 3 + 2] ?? 0;
    return Math.hypot(ax - bx, ay - by, az - bz);
}

function compactUsed(mesh: AfoTriMesh): AfoTriMesh {
    const map = new Map<number, number>();
    const positions: number[] = [];
    const indices: number[] = [];
    const add = (old: number): number => {
        let ni = map.get(old);
        if (ni === undefined) {
            ni = map.size;
            map.set(old, ni);
            positions.push(
                mesh.positions[old * 3] ?? 0,
                mesh.positions[old * 3 + 1] ?? 0,
                mesh.positions[old * 3 + 2] ?? 0,
            );
        }
        return ni;
    };
    for (let i = 0; i < mesh.indices.length; i++) indices.push(add(mesh.indices[i] ?? 0));
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** Flip one internal edge that touches the opening when it raises the minimum angle. */
function flipSkinnyBoundary(mesh: AfoTriMesh, boundary: Set<number>): boolean {
    const t = (mesh.indices.length / 3) | 0;
    const edgeFaces = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < t; i++) {
        const vs = [mesh.indices[i * 3] ?? 0, mesh.indices[i * 3 + 1] ?? 0, mesh.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = edgeFaces.get(k);
            if (list) list.push(i);
            else edgeFaces.set(k, [i]);
        }
    }
    const at = (i: number) => ({
        x: mesh.positions[i * 3] ?? 0,
        y: mesh.positions[i * 3 + 1] ?? 0,
        z: mesh.positions[i * 3 + 2] ?? 0,
    });
    for (const faces of edgeFaces.values()) {
        if (faces.length !== 2) continue;
        const t0 = faces[0]!;
        const t1 = faces[1]!;
        const a0 = [mesh.indices[t0 * 3] ?? 0, mesh.indices[t0 * 3 + 1] ?? 0, mesh.indices[t0 * 3 + 2] ?? 0];
        const a1 = [mesh.indices[t1 * 3] ?? 0, mesh.indices[t1 * 3 + 1] ?? 0, mesh.indices[t1 * 3 + 2] ?? 0];
        const shared = a0.filter((v) => a1.includes(v));
        if (shared.length !== 2) continue;
        if (!boundary.has(shared[0]!) && !boundary.has(shared[1]!)) continue;
        const b = a0.find((v) => !shared.includes(v));
        const d = a1.find((v) => !shared.includes(v));
        if (b == null || d == null || b === d) continue;
        const oldMin = Math.min(
            minTriAngle(at, a0[0]!, a0[1]!, a0[2]!),
            minTriAngle(at, a1[0]!, a1[1]!, a1[2]!),
        );
        if (oldMin > (20 * Math.PI) / 180) continue;
        const n0 = triNormalOf(at, a0[0]!, a0[1]!, a0[2]!);
        const n1 = triNormalOf(at, a1[0]!, a1[1]!, a1[2]!);
        const ref = {
            x: n0.x + n1.x,
            y: n0.y + n1.y,
            z: n0.z + n1.z,
        };
        const candidates = [
            [shared[0]!, b, d, shared[1]!, d, b],
            [shared[0]!, d, b, shared[1]!, b, d],
        ];
        let best: number[] | null = null;
        let bestMin = oldMin;
        for (const c of candidates) {
            const nA = triNormalOf(at, c[0]!, c[1]!, c[2]!);
            const nB = triNormalOf(at, c[3]!, c[4]!, c[5]!);
            const areaA = Math.hypot(nA.x, nA.y, nA.z);
            const areaB = Math.hypot(nB.x, nB.y, nB.z);
            if (areaA < 1e-8 || areaB < 1e-8) continue;
            const agree =
                nA.x * ref.x + nA.y * ref.y + nA.z * ref.z > 0 &&
                nB.x * ref.x + nB.y * ref.y + nB.z * ref.z > 0;
            if (!agree) continue;
            const ang = Math.min(minTriAngle(at, c[0]!, c[1]!, c[2]!), minTriAngle(at, c[3]!, c[4]!, c[5]!));
            if (ang > bestMin + 1e-4) {
                bestMin = ang;
                best = c;
            }
        }
        if (!best) continue;
        for (let k = 0; k < 3; k++) {
            mesh.indices[t0 * 3 + k] = best[k]!;
            mesh.indices[t1 * 3 + k] = best[k + 3]!;
        }
        return true;
    }
    return false;
}

function triNormalOf(
    at: (i: number) => { x: number; y: number; z: number },
    a: number,
    b: number,
    c: number,
): { x: number; y: number; z: number } {
    const pa = at(a);
    const pb = at(b);
    const pc = at(c);
    const ux = pb.x - pa.x;
    const uy = pb.y - pa.y;
    const uz = pb.z - pa.z;
    const vx = pc.x - pa.x;
    const vy = pc.y - pa.y;
    const vz = pc.z - pa.z;
    return { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx };
}

function minTriAngle(
    at: (i: number) => { x: number; y: number; z: number },
    a: number,
    b: number,
    c: number,
): number {
    const p = [at(a), at(b), at(c)];
    let worst = Math.PI;
    for (let i = 0; i < 3; i++) {
        const o = p[i]!;
        const u = p[(i + 1) % 3]!;
        const v = p[(i + 2) % 3]!;
        const ux = u.x - o.x;
        const uy = u.y - o.y;
        const uz = u.z - o.z;
        const vx = v.x - o.x;
        const vy = v.y - o.y;
        const vz = v.z - o.z;
        const ul = Math.hypot(ux, uy, uz);
        const vl = Math.hypot(vx, vy, vz);
        if (ul < 1e-8 || vl < 1e-8) return 0;
        const cos = Math.min(1, Math.max(-1, (ux * vx + uy * vy + uz * vz) / (ul * vl)));
        worst = Math.min(worst, Math.acos(cos));
    }
    return worst;
}

/** Normals for the rim offset are averaged over this geodesic radius, not taken per face. */
const AFO_RIM_NORMAL_WINDOW_MM = 2.5;

/**
 * Replace each opening vertex's normal with the average of per-vertex normals
 * inside a 2.5 mm geodesic ball. A noisy per-face normal is what folds the heel.
 */
function smoothBoundaryNormals(mesh: AfoTriMesh, nrm: Float32Array, edges: { a: number; b: number }[]): void {
    const boundary = new Set<number>();
    for (const e of edges) {
        boundary.add(e.a);
        boundary.add(e.b);
    }
    if (boundary.size === 0) return;
    const n = vertexCount(mesh);
    const adj = adjacency(mesh, n);
    const src = new Float32Array(nrm);
    const read = (buf: Float32Array, i: number) => ({
        x: buf[i * 3] ?? 0,
        y: buf[i * 3 + 1] ?? 0,
        z: buf[i * 3 + 2] ?? 0,
    });
    const dist3 = (a: number, b: number) => {
        const p = read(mesh.positions, a);
        const q = read(mesh.positions, b);
        return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    };
    const windowMm = AFO_RIM_NORMAL_WINDOW_MM;
    for (const origin of boundary) {
        const reached = new Map<number, number>([[origin, 0]]);
        const stack = [origin];
        while (stack.length) {
            let best = 0;
            for (let k = 1; k < stack.length; k++) {
                if ((reached.get(stack[k]!) ?? 0) < (reached.get(stack[best]!) ?? 0)) best = k;
            }
            const u = stack.splice(best, 1)[0]!;
            const du = reached.get(u) ?? 0;
            for (const w of adj[u] ?? []) {
                const nd = du + dist3(u, w);
                if (nd > windowMm) continue;
                const prev = reached.get(w);
                if (prev !== undefined && nd >= prev) continue;
                reached.set(w, nd);
                stack.push(w);
            }
        }
        const base = read(src, origin);
        let ax = 0;
        let ay = 0;
        let az = 0;
        for (const [v, d] of reached) {
            const sample = read(src, v);
            const aligned =
                sample.x * base.x + sample.y * base.y + sample.z * base.z < 0
                    ? { x: -sample.x, y: -sample.y, z: -sample.z }
                    : sample;
            const weight = 1 - d / windowMm;
            ax += aligned.x * weight;
            ay += aligned.y * weight;
            az += aligned.z * weight;
        }
        const len = Math.hypot(ax, ay, az);
        if (len < 1e-8) continue;
        nrm[origin * 3] = ax / len;
        nrm[origin * 3 + 1] = ay / len;
        nrm[origin * 3 + 2] = az / len;
    }
}

/**
 * Neighbouring flare vectors on a short boundary step share one direction and
 * keep their own lengths, so the footplate cap stays 1 mm and the wall stays
 * at the full flare. A length jump (wall meeting footplate) is left alone.
 */
function shareFlareOnShortSteps(
    positions: Float32Array,
    edges: { a: number; b: number }[],
    flare: Float32Array,
): void {
    const read = (i: number) => ({
        x: flare[i * 3] ?? 0,
        y: flare[i * 3 + 1] ?? 0,
        z: flare[i * 3 + 2] ?? 0,
    });
    const write = (i: number, v: { x: number; y: number; z: number }) => {
        flare[i * 3] = v.x;
        flare[i * 3 + 1] = v.y;
        flare[i * 3 + 2] = v.z;
    };
    const len3 = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);
    for (const loop of boundaryLoops(edges)) {
        const count = loop.length;
        if (count < 3) continue;
        for (let iter = 0; iter < 24; iter++) {
            let changed = false;
            for (let i = 0; i < count; i++) {
                const a = loop[i]!;
                const b = loop[(i + 1) % count]!;
                const ax = positions[a * 3] ?? 0;
                const ay = positions[a * 3 + 1] ?? 0;
                const az = positions[a * 3 + 2] ?? 0;
                const edgeLen = Math.hypot(
                    (positions[b * 3] ?? 0) - ax,
                    (positions[b * 3 + 1] ?? 0) - ay,
                    (positions[b * 3 + 2] ?? 0) - az,
                );
                const f0 = read(a);
                const f1 = read(b);
                const l0 = len3(f0);
                const l1 = len3(f1);
                if (Math.abs(l0 - l1) > 0.3) continue;
                const delta = Math.hypot(f0.x - f1.x, f0.y - f1.y, f0.z - f1.z);
                if (delta <= Math.max(edgeLen * 0.2, 1e-4)) continue;
                const avg = { x: (f0.x + f1.x) * 0.5, y: (f0.y + f1.y) * 0.5, z: (f0.z + f1.z) * 0.5 };
                const avgLen = len3(avg) || 1;
                write(a, { x: (avg.x / avgLen) * l0, y: (avg.y / avgLen) * l0, z: (avg.z / avgLen) * l0 });
                write(b, { x: (avg.x / avgLen) * l1, y: (avg.y / avgLen) * l1, z: (avg.z / avgLen) * l1 });
                changed = true;
            }
            if (!changed) break;
        }
    }
}

/** Pull a boundary vertex that has drifted off the trim polyline back onto it. */
function snapBoundaryToCurve(surface: OpenSurface, curve: AfoVec3[] | undefined): OpenSurface {
    if (!curve || curve.length < 3) return surface;
    const boundary = new Set<number>();
    for (const e of surface.boundaryEdges) {
        boundary.add(e.a);
        boundary.add(e.b);
    }
    const positions = new Float32Array(surface.positions);
    for (const i of boundary) {
        const px = positions[i * 3] ?? 0;
        const py = positions[i * 3 + 1] ?? 0;
        const pz = positions[i * 3 + 2] ?? 0;
        let best = Infinity;
        let bx = px;
        let by = py;
        let bz = pz;
        for (let k = 0; k < curve.length; k++) {
            const a = curve[k]!;
            const b = curve[(k + 1) % curve.length]!;
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const abz = b.z - a.z;
            const ab2 = abx * abx + aby * aby + abz * abz || 1;
            const t = Math.min(
                1,
                Math.max(0, ((px - a.x) * abx + (py - a.y) * aby + (pz - a.z) * abz) / ab2),
            );
            const qx = a.x + abx * t;
            const qy = a.y + aby * t;
            const qz = a.z + abz * t;
            const d = Math.hypot(px - qx, py - qy, pz - qz);
            if (d < best) {
                best = d;
                bx = qx;
                by = qy;
                bz = qz;
            }
        }
        if (best > 0.02 && best < 0.25) {
            positions[i * 3] = bx;
            positions[i * 3 + 1] = by;
            positions[i * 3 + 2] = bz;
        }
    }
    return { ...surface, positions };
}

/**
 * A vertex-normal offset of 4 mm can land inside a concavity, so another part
 * of the inner skin is closer than the paired vertex. Slide that outer vertex
 * along its offset ray to the distance whose true clearance is nearest 4 mm.
 * Vertices inside the rim band keep the blended edge thickness.
 */
function restoreFarWall(shell: AfoTriMesh, thicknessMm: number): void {
    const n = shell.outerVertex0;
    const face0 = shell.rimFaceStart;
    if (n == null || face0 == null || thicknessMm < 1) return;
    const innerIdx: number[] = [];
    const boundary = new Map<string, { a: number; b: number; n: number }>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let f = 0; f < face0; f++) {
        const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
        if (!vs.every((v) => v < n)) continue;
        innerIdx.push(vs[0]!, vs[1]!, vs[2]!);
        for (let e = 0; e < 3; e++) {
            const a = vs[e]!;
            const b = vs[(e + 1) % 3]!;
            const k = key(a, b);
            const prev = boundary.get(k);
            if (prev) prev.n += 1;
            else boundary.set(k, { a, b, n: 1 });
        }
    }
    const opening: { a: AfoVec3; b: AfoVec3 }[] = [];
    for (const e of boundary.values()) {
        if (e.n !== 1) continue;
        opening.push({
            a: {
                x: shell.positions[e.a * 3] ?? 0,
                y: shell.positions[e.a * 3 + 1] ?? 0,
                z: shell.positions[e.a * 3 + 2] ?? 0,
            },
            b: {
                x: shell.positions[e.b * 3] ?? 0,
                y: shell.positions[e.b * 3 + 1] ?? 0,
                z: shell.positions[e.b * 3 + 2] ?? 0,
            },
        });
    }
    const distOpen = (p: AfoVec3) => {
        let best = Infinity;
        for (const e of opening) {
            const abx = e.b.x - e.a.x;
            const aby = e.b.y - e.a.y;
            const abz = e.b.z - e.a.z;
            const ab2 = abx * abx + aby * aby + abz * abz || 1;
            const t = Math.min(
                1,
                Math.max(0, ((p.x - e.a.x) * abx + (p.y - e.a.y) * aby + (p.z - e.a.z) * abz) / ab2),
            );
            best = Math.min(
                best,
                Math.hypot(p.x - (e.a.x + abx * t), p.y - (e.a.y + aby * t), p.z - (e.a.z + abz * t)),
            );
        }
        return best;
    };
    const innerMesh: AfoTriMesh = {
        positions: shell.positions.subarray(0, n * 3),
        indices: new Uint32Array(innerIdx),
    };
    const proj = meshProjector(innerMesh);
    const floor = thicknessMm - 0.1;
    for (let i = 0; i < n; i++) {
        const ix = shell.positions[i * 3] ?? 0;
        const iy = shell.positions[i * 3 + 1] ?? 0;
        const iz = shell.positions[i * 3 + 2] ?? 0;
        if (distOpen({ x: ix, y: iy, z: iz }) < AFO_RIM_BAND_MM) continue;
        const ox = shell.positions[(n + i) * 3] ?? 0;
        const oy = shell.positions[(n + i) * 3 + 1] ?? 0;
        const oz = shell.positions[(n + i) * 3 + 2] ?? 0;
        if (proj.closest({ x: ox, y: oy, z: oz }).errorMm >= floor) continue;
        const dx = ox - ix;
        const dy = oy - iy;
        const dz = oz - iz;
        const len = Math.hypot(dx, dy, dz) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const uz = dz / len;
        let bestD = Math.hypot(dx, dy, dz);
        let bestPenalty = Infinity;
        for (let d = 1.5; d <= 12.01; d += 0.25) {
            const c = proj.closest({ x: ix + ux * d, y: iy + uy * d, z: iz + uz * d }).errorMm;
            if (c < floor) continue;
            const penalty = Math.abs(c - thicknessMm);
            if (penalty < bestPenalty) {
                bestPenalty = penalty;
                bestD = d;
            }
        }
        if (bestPenalty === Infinity) continue;
        shell.positions[(n + i) * 3] = ix + ux * bestD;
        shell.positions[(n + i) * 3 + 1] = iy + uy * bestD;
        shell.positions[(n + i) * 3 + 2] = iz + uz * bestD;
    }
}

function thickenOpenSurface(
    surfaceIn: OpenSurface,
    thicknessMm: number,
    edgeMm: number,
    flareMm: number,
): AfoTriMesh {
    const surface = surfaceIn;
    const inner: AfoTriMesh = {
        positions: new Float32Array(surface.positions),
        indices: new Uint32Array(surface.indices),
    };
    const n = vertexCount(inner);
    const nrm = computeVertexNormals(inner);
    smoothBoundaryNormals(inner, nrm, surface.boundaryEdges);
    const boundarySet = new Set<number>(surface.boundary);
    for (const e of surface.boundaryEdges) {
        boundarySet.add(e.a);
        boundarySet.add(e.b);
    }
    const distToRim = vertexDistToSet(inner, boundarySet);
    const outward = boundaryOutward(inner, surface.boundaryEdges);
    let minZ = Infinity;
    for (let i = 0; i < n; i++) minZ = Math.min(minZ, inner.positions[i * 3 + 2] ?? 0);
    const blendAt: number[] = [];
    const flareDisp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const dist = distToRim[i] ?? 0;
        const rimT = clamp01(dist / AFO_RIM_BAND_MM);
        const blend = rimT * rimT * (3 - 2 * rimT);
        const nx = nrm[i * 3] ?? 0;
        const ny = nrm[i * 3 + 1] ?? 0;
        const nz = nrm[i * 3 + 2] ?? 0;
        const plantar = nz < -0.65 && (inner.positions[i * 3 + 2] ?? 0) < minZ + 8;
        const flareCap = plantar ? Math.min(flareMm, AFO_FOOTPLATE_FLARE_CAP_MM) : flareMm;
        const flare = flareCap * (1 - blend);
        blendAt.push(blend);
        flareDisp[i * 3] = nx * flare;
        flareDisp[i * 3 + 1] = ny * flare;
        flareDisp[i * 3 + 2] = nz * flare;
    }
    // The same short-step share used by the rim offset. A 2.5 mm lift along
    // neighbouring normals otherwise kinks the heel the thickness step used to.
    shareFlareOnShortSteps(inner.positions, surface.boundaryEdges, flareDisp);
    for (let i = 0; i < n; i++) {
        inner.positions[i * 3] = (inner.positions[i * 3] ?? 0) + (flareDisp[i * 3] ?? 0);
        inner.positions[i * 3 + 1] = (inner.positions[i * 3 + 1] ?? 0) + (flareDisp[i * 3 + 1] ?? 0);
        inner.positions[i * 3 + 2] = (inner.positions[i * 3 + 2] ?? 0) + (flareDisp[i * 3 + 2] ?? 0);
    }
    relaxSharpBoundaryTurns(inner);
    // The lift can leave a longer nick than the pre-flare pass. Smooth only
    // the flared shell so the plain opening, which is the curve, stays put.
    if (flareMm > 0) relaxSharpBoundaryTurns(inner, 0.4, 35);
    const outer = cloneMesh(inner);
    for (let i = 0; i < n; i++) {
        const blend = blendAt[i] ?? 0;
        const thick = edgeMm + (thicknessMm - edgeMm) * blend;
        const nx = nrm[i * 3] ?? 0;
        const ny = nrm[i * 3 + 1] ?? 0;
        const nz = nrm[i * 3 + 2] ?? 0;
        outer.positions[i * 3] = (inner.positions[i * 3] ?? 0) + nx * thick;
        outer.positions[i * 3 + 1] = (inner.positions[i * 3 + 1] ?? 0) + ny * thick;
        outer.positions[i * 3 + 2] = (inner.positions[i * 3 + 2] ?? 0) + nz * thick;
    }

    const innerIdx = new Uint32Array(inner.indices.length);
    for (let i = 0; i < inner.indices.length; i += 3) {
        innerIdx[i] = inner.indices[i + 2] ?? 0;
        innerIdx[i + 1] = inner.indices[i + 1] ?? 0;
        innerIdx[i + 2] = inner.indices[i] ?? 0;
    }
    const outerIdx = new Uint32Array(outer.indices.length);
    for (let i = 0; i < outer.indices.length; i++) {
        outerIdx[i] = (outer.indices[i] ?? 0) + n;
    }

    const edges =
        surface.boundaryEdges.length > 0
            ? surface.boundaryEdges
            : surface.boundary.map((a, i) => ({
                  a,
                  b: surface.boundary[(i + 1) % surface.boundary.length]!,
              }));
    return closeShellWithRoundRim({
        innerPositions: inner.positions,
        outerPositions: outer.positions,
        innerIndices: innerIdx,
        outerIndices: outerIdx,
        edges,
        outward,
    });
}

function boundaryOutward(mesh: AfoTriMesh, edges: { a: number; b: number }[]): Float32Array {
    const n = vertexCount(mesh);
    const acc = new Float32Array(n * 3);
    const t = (mesh.indices.length / 3) | 0;
    const edgeTri = new Map<string, number>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < t; i++) {
        const vs = [mesh.indices[i * 3] ?? 0, mesh.indices[i * 3 + 1] ?? 0, mesh.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) edgeTri.set(key(vs[e]!, vs[(e + 1) % 3]!), i);
    }
    for (const e of edges) {
        const tri = edgeTri.get(key(e.a, e.b));
        if (tri == null) continue;
        const vs = [
            mesh.indices[tri * 3] ?? 0,
            mesh.indices[tri * 3 + 1] ?? 0,
            mesh.indices[tri * 3 + 2] ?? 0,
        ];
        const other = vs.find((v) => v !== e.a && v !== e.b) ?? e.a;
        const mx = ((mesh.positions[e.a * 3] ?? 0) + (mesh.positions[e.b * 3] ?? 0)) * 0.5;
        const my = ((mesh.positions[e.a * 3 + 1] ?? 0) + (mesh.positions[e.b * 3 + 1] ?? 0)) * 0.5;
        const mz = ((mesh.positions[e.a * 3 + 2] ?? 0) + (mesh.positions[e.b * 3 + 2] ?? 0)) * 0.5;
        let ox = mx - (mesh.positions[other * 3] ?? 0);
        let oy = my - (mesh.positions[other * 3 + 1] ?? 0);
        let oz = mz - (mesh.positions[other * 3 + 2] ?? 0);
        const len = Math.hypot(ox, oy, oz) || 1;
        ox /= len;
        oy /= len;
        oz /= len;
        for (const v of [e.a, e.b]) {
            acc[v * 3] = (acc[v * 3] ?? 0) + ox;
            acc[v * 3 + 1] = (acc[v * 3 + 1] ?? 0) + oy;
            acc[v * 3 + 2] = (acc[v * 3 + 2] ?? 0) + oz;
        }
    }
    for (let i = 0; i < n; i++) {
        const len = Math.hypot(acc[i * 3] ?? 0, acc[i * 3 + 1] ?? 0, acc[i * 3 + 2] ?? 0);
        if (len < 1e-8) continue;
        acc[i * 3] = (acc[i * 3] ?? 0) / len;
        acc[i * 3 + 1] = (acc[i * 3 + 1] ?? 0) / len;
        acc[i * 3 + 2] = (acc[i * 3 + 2] ?? 0) / len;
    }
    return acc;
}

function vertexDistToSet(mesh: AfoTriMesh, set: Set<number>): Float32Array {
    const n = vertexCount(mesh);
    const d = new Float32Array(n).fill(1e9);
    for (const i of set) d[i] = 0;
    const adj = adjacency(mesh, n);
    const queue = [...set];
    for (let q = 0; q < queue.length; q++) {
        const u = queue[q]!;
        for (const v of adj[u] ?? []) {
            const dx = (mesh.positions[u * 3] ?? 0) - (mesh.positions[v * 3] ?? 0);
            const dy = (mesh.positions[u * 3 + 1] ?? 0) - (mesh.positions[v * 3 + 1] ?? 0);
            const dz = (mesh.positions[u * 3 + 2] ?? 0) - (mesh.positions[v * 3 + 2] ?? 0);
            const nd = (d[u] ?? 0) + Math.hypot(dx, dy, dz);
            if (nd < (d[v] ?? 1e9)) {
                d[v] = nd;
                queue.push(v);
            }
        }
    }
    return d;
}

function adjacency(mesh: AfoTriMesh, n: number): number[][] {
    const adj: number[][] = Array.from({ length: n }, () => []);
    const t = (mesh.indices.length / 3) | 0;
    const add = (a: number, b: number) => {
        if (!adj[a]!.includes(b)) adj[a]!.push(b);
        if (!adj[b]!.includes(a)) adj[b]!.push(a);
    };
    for (let i = 0; i < t; i++) {
        const a = mesh.indices[i * 3] ?? 0;
        const b = mesh.indices[i * 3 + 1] ?? 0;
        const c = mesh.indices[i * 3 + 2] ?? 0;
        add(a, b);
        add(b, c);
        add(c, a);
    }
    return adj;
}

function clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
}

/** Hemisphere keep-loop for a UV sphere centred at the origin (z ≤ 0). */
export function equatorialLoop(mesh: AfoTriMesh): number[] {
    const n = vertexCount(mesh);
    const ring: { i: number; ang: number; z: number }[] = [];
    for (let i = 0; i < n; i++) {
        const z = mesh.positions[i * 3 + 2] ?? 0;
        ring.push({
            i,
            z: Math.abs(z),
            ang: Math.atan2(mesh.positions[i * 3 + 1] ?? 0, mesh.positions[i * 3] ?? 0),
        });
    }
    ring.sort((a, b) => a.z - b.z);
    const z0 = ring[0]?.z ?? 0;
    const band = ring.filter((r) => r.z <= z0 + 1.5).sort((a, b) => a.ang - b.ang);
    const uniq: number[] = [];
    const seen = new Set<number>();
    for (const r of band) {
        if (seen.has(r.i)) continue;
        seen.add(r.i);
        uniq.push(r.i);
    }
    return uniq;
}

/** Convenience: thicken a closed body by offsetting along normals then this is NOT a shell. */
export function offsetClosedAlongNormals(mesh: AfoTriMesh, distanceMm: number): AfoTriMesh {
    return offsetMeshAlongNormals(mesh, distanceMm);
}
