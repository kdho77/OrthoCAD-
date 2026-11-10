// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { AFO_EDGE_MM, AFO_FLARE_MM, AFO_RIM_BAND_MM, AFO_THICKNESS_MM } from "./defaults";
import { geodesicVertexPath } from "./geodesic";
import { cloneMesh, computeVertexNormals, nearestVertex, vertexCount } from "./mesh-ops";
import { offsetMeshAlongNormals } from "./sdf-offset";
import type { AfoShellOptions, AfoTriMesh, AfoVec3 } from "./types";

/**
 * Build a watertight AFO shell from a closed positive and a closed vertex loop.
 *
 * Keep region = connected faces whose centroids sit on the "brace" side of the
 * trim (below the mean loop z, or the larger region if that is empty).
 * Thicken along vertex normals by `thicknessMm`, blend over `edgeMm` of the
 * rim, and add `flareMm` outward at the opening. Inner + outer + rim strip
 * form a closed solid.
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
    const loop = resolveShellTrimLoop(mesh, trimVertexIndices, options.trimPolygon);
    const keep = extractKeepRegion(mesh, loop, options.heelSeed);
    options.onProgress?.(0.25, "thicken");
    const shell = thickenOpenSurface(keep, options.thicknessMm, options.edgeMm, options.flareMm);
    options.onProgress?.(1, "done");
    return shell;
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
 * Vertex loop the shell cut follows. A trim polygon is resampled onto the same
 * mesh (not raw scan points) so the kept region tracks the drawn contour.
 */
export function resolveShellTrimLoop(mesh: AfoTriMesh, fallback: number[], polygon?: AfoVec3[]): number[] {
    if (!polygon || polygon.length < 3) return fallback;
    const cap = 36;
    const step = Math.max(1, Math.floor(polygon.length / cap));
    const ids: number[] = [];
    for (let i = 0; i < polygon.length; i += step) {
        const idx = nearestVertex(mesh, polygon[i]!).index;
        if (ids[ids.length - 1] !== idx) ids.push(idx);
    }
    if (ids.length >= 2 && ids[0] === ids[ids.length - 1]) ids.pop();
    return ids.length >= 3 ? ids : fallback;
}

function extractKeepRegion(mesh: AfoTriMesh, loop: number[], heelSeed?: AfoVec3): OpenSurface {
    const expanded = expandLoop(mesh, loop);
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

function expandLoop(mesh: AfoTriMesh, loop: number[]): number[] {
    if (loop.length < 2) return loop.slice();
    const out: number[] = [];
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const path = geodesicVertexPath(mesh, a, b) ?? [a, b];
        const start = i === 0 ? 0 : 1;
        for (let k = start; k < path.length; k++) out.push(path[k]!);
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

function thickenOpenSurface(
    surface: OpenSurface,
    thicknessMm: number,
    edgeMm: number,
    flareMm: number,
): AfoTriMesh {
    const inner: AfoTriMesh = {
        positions: new Float32Array(surface.positions),
        indices: new Uint32Array(surface.indices),
    };
    const n = vertexCount(inner);
    const nrm = computeVertexNormals(inner);
    const boundarySet = new Set<number>(surface.boundary);
    for (const e of surface.boundaryEdges) {
        boundarySet.add(e.a);
        boundarySet.add(e.b);
    }
    const distToRim = vertexDistToSet(inner, boundarySet);
    const outward = boundaryOutward(inner, surface.boundaryEdges);
    let minZ = Infinity;
    for (let i = 0; i < n; i++) minZ = Math.min(minZ, inner.positions[i * 3 + 2] ?? 0);
    const outer = cloneMesh(inner);
    for (let i = 0; i < n; i++) {
        const dist = distToRim[i] ?? 0;
        const rimT = clamp01(dist / AFO_RIM_BAND_MM);
        const blend = rimT * rimT * (3 - 2 * rimT);
        const thick = edgeMm + (thicknessMm - edgeMm) * blend;
        const nx = nrm[i * 3] ?? 0;
        const ny = nrm[i * 3 + 1] ?? 0;
        const nz = nrm[i * 3 + 2] ?? 0;
        const plantar = nz < -0.65 && (inner.positions[i * 3 + 2] ?? 0) < minZ + 8;
        const flareCap = plantar ? Math.min(flareMm, 1) : flareMm;
        const flare = flareCap * (1 - blend);
        const ox = outward[i * 3] ?? 0;
        const oy = outward[i * 3 + 1] ?? 0;
        const oz = outward[i * 3 + 2] ?? 0;
        outer.positions[i * 3] = (inner.positions[i * 3] ?? 0) + nx * thick + ox * flare;
        outer.positions[i * 3 + 1] = (inner.positions[i * 3 + 1] ?? 0) + ny * thick + oy * flare;
        outer.positions[i * 3 + 2] = (inner.positions[i * 3 + 2] ?? 0) + nz * thick + oz * flare;
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

    const rim: number[] = [];
    const edges =
        surface.boundaryEdges.length > 0
            ? surface.boundaryEdges
            : surface.boundary.map((a, i) => ({
                  a,
                  b: surface.boundary[(i + 1) % surface.boundary.length]!,
              }));
    const steps = 6;
    const rings = steps - 1;
    const positions = new Float32Array(n * 3 * (2 + rings));
    positions.set(inner.positions, 0);
    positions.set(outer.positions, n * 3);
    for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const base = (s + 1) * n;
        for (let i = 0; i < n; i++) {
            if (!boundarySet.has(i)) continue;
            const ex = (outer.positions[i * 3] ?? 0) - (inner.positions[i * 3] ?? 0);
            const ey = (outer.positions[i * 3 + 1] ?? 0) - (inner.positions[i * 3 + 1] ?? 0);
            const ez = (outer.positions[i * 3 + 2] ?? 0) - (inner.positions[i * 3 + 2] ?? 0);
            const el = Math.hypot(ex, ey, ez) || 1;
            let sx = outward[i * 3] ?? 0;
            let sy = outward[i * 3 + 1] ?? 0;
            let sz = outward[i * 3 + 2] ?? 0;
            if (Math.hypot(sx, sy, sz) < 1e-4) {
                sx = ex / el;
                sy = ey / el;
                sz = ez / el;
            }
            const dir = slerpUnit({ x: sx, y: sy, z: sz }, { x: ex / el, y: ey / el, z: ez / el }, t);
            const o = (base + i) * 3;
            positions[o] = (inner.positions[i * 3] ?? 0) + dir.x * el * t;
            positions[o + 1] = (inner.positions[i * 3 + 1] ?? 0) + dir.y * el * t;
            positions[o + 2] = (inner.positions[i * 3 + 2] ?? 0) + dir.z * el * t;
        }
    }
    for (const e of edges) {
        const a = e.a;
        const c = e.b;
        if (a === c) continue;
        let prevA = a;
        let prevC = c;
        for (let s = 1; s <= steps; s++) {
            const base = s === steps ? n : (s + 1) * n;
            const na = base + a;
            const nc = base + c;
            rim.push(prevA, prevC, nc, prevA, nc, na);
            prevA = na;
            prevC = nc;
        }
    }

    const indices = new Uint32Array(innerIdx.length + outerIdx.length + rim.length);
    indices.set(innerIdx, 0);
    indices.set(outerIdx, innerIdx.length);
    indices.set(rim, innerIdx.length + outerIdx.length);
    return { positions, indices };
}

function slerpUnit(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    t: number,
) {
    const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
    const omega = Math.acos(dot);
    if (omega < 1e-4) return { x: b.x, y: b.y, z: b.z };
    const so = Math.sin(omega);
    const w0 = Math.sin((1 - t) * omega) / so;
    const w1 = Math.sin(t * omega) / so;
    return { x: a.x * w0 + b.x * w1, y: a.y * w0 + b.y * w1, z: a.z * w0 + b.z * w1 };
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
