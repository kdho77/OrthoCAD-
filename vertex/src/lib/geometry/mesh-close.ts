// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// EXPORT PIPELINE MAP (discovered 2026-06-13)
// Step 1: [client trigger] exportDesign / generateHybridGcode → vertex/src/features/exports/export-service.ts
// Step 2: [server receives] trpc.export.authorize (tokens only) → vertex/server/src/routers/export.ts
// Step 3: [GLB loaded via] GLTFLoader + extractMergedGeometry → vertex/src/lib/library/loaders.ts
// Step 4: [meshes merged via] concatGeometries + mergeVertices (Top/Bottom concatenation, no side wall) → loaders.ts
// Step 5: [watertight check via] analyzeManifold / validateSolid — false positive when OCCT isClosed() passes on
//         tessellation with seam edges, or when trimline-mesh claims watertight-by-construction but base path skips it
// Step 6: [STL written via] kernel.exportSTL → shapesToStl (OCCT) or geometryToBinarySTL → vertex/src/lib/geometry/stl.ts

import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { analyzeManifold, type ManifoldReport } from "@/lib/geometry/manifold";

/** Laplacian smoothing iterations applied to bridge interior vertices only. */
export const BRIDGE_SMOOTH_ITERATIONS = 2;
/** Laplacian smoothing blend strength for bridge interior vertices. */
export const BRIDGE_SMOOTH_STRENGTH = 0.3;
/** Maximum gap between consecutive boundary loop vertices (mm). */
export const BOUNDARY_GAP_TOLERANCE_MM = 0.5;
/** Rim height at/above which an adaptive midpoint row is inserted in the bridge. */
export const RIM_HEIGHT_ADAPTIVE_THRESHOLD_MM = 2.0;
/** Rim height below which a sub-1mm warning is logged. */
export const RIM_HEIGHT_MIN_WARNING_MM = 1.0;
/** Radius around the bridge within which vertex normals are recomputed after merge. */
export const NORMAL_RECOMPUTE_RADIUS_MM = 3.0;
/** Maximum inward distance from the perimeter that smoothing may affect (clinical guard). */
export const SMOOTH_INWARD_LIMIT_MM = 3.0;

export class MeshNotWatertightError extends Error {
    readonly report: ManifoldValidationReport;

    constructor(message: string, report: ManifoldValidationReport) {
        super(message);
        this.name = "MeshNotWatertightError";
        this.report = report;
    }
}

export interface ManifoldValidationReport extends ManifoldReport {
    edgeCount: number;
    eulerCharacteristic: number;
    nakedEdgeKeys: string[];
}

export interface CloseMeshResult {
    geometry: BufferGeometry;
    report: ManifoldValidationReport;
    bridgeTriangleCount: number;
    smoothingIterations: number;
    rimHeightsMm: number[];
}

const QUANT = 1e4;

function quantKey(x: number, y: number, z: number): string {
    return `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`;
}

function edgeKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function parseKey(key: string): Vector3 {
    const [xs, ys, zs] = key.split(",");
    return new Vector3(Number(xs) / QUANT, Number(ys) / QUANT, Number(zs) / QUANT);
}

function toIndexed(geometry: BufferGeometry): BufferGeometry {
    if (geometry.index) return geometry;
    return geometry.clone().toNonIndexed();
}

function triangleCount(geometry: BufferGeometry): number {
    const index = geometry.getIndex();
    const pos = geometry.getAttribute("position");
    return index ? index.count / 3 : pos.count / 3;
}

function idx(geometry: BufferGeometry, t: number, k: number): number {
    const index = geometry.getIndex();
    return index ? index.getX(t * 3 + k) : t * 3 + k;
}

function vertexKeyAt(geometry: BufferGeometry, vi: number): string {
    const pos = geometry.getAttribute("position");
    return quantKey(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
}

/** Half-edge edge usage map and per-edge vertex keys. */
function buildEdgeUsage(geometry: BufferGeometry): {
    edgeCount: Map<string, number>;
    edgeVerts: Map<string, [string, string]>;
} {
    const edgeCount = new Map<string, number>();
    const edgeVerts = new Map<string, [string, string]>();
    const triN = triangleCount(geometry);

    for (let t = 0; t < triN; t++) {
        const keys = [0, 1, 2].map((k) => vertexKeyAt(geometry, idx(geometry, t, k)));
        for (let i = 0; i < 3; i++) {
            const a = keys[i]!;
            const b = keys[(i + 1) % 3]!;
            const ek = edgeKey(a, b);
            edgeCount.set(ek, (edgeCount.get(ek) ?? 0) + 1);
            if (!edgeVerts.has(ek)) edgeVerts.set(ek, [a, b]);
        }
    }

    return { edgeCount, edgeVerts };
}

/** Extract all boundary edge loops from a mesh as ordered Vector3[] loops. */
export function extractBoundaryLoops(geometry: BufferGeometry): Vector3[][] {
    const { edgeCount, edgeVerts } = buildEdgeUsage(geometry);
    const boundaryEdges: Array<[string, string]> = [];

    for (const [ek, count] of edgeCount) {
        if (count === 1) {
            const pair = edgeVerts.get(ek);
            if (pair) boundaryEdges.push(pair);
        }
    }

    if (boundaryEdges.length === 0) return [];

    const adj = new Map<string, string[]>();
    for (const [a, b] of boundaryEdges) {
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a)!.push(b);
        adj.get(b)!.push(a);
    }

    const visitedEdges = new Set<string>();
    const loops: Vector3[][] = [];

    for (const [startA, startB] of boundaryEdges) {
        const startEdge = edgeKey(startA, startB);
        if (visitedEdges.has(startEdge)) continue;

        const loopKeys: string[] = [startA];
        let prev = startA;
        let curr = startB;
        visitedEdges.add(startEdge);

        for (let guard = 0; guard < boundaryEdges.length + 2; guard++) {
            loopKeys.push(curr);
            const neighbors = adj.get(curr) ?? [];
            const next = neighbors.find((n) => n !== prev);
            if (!next) break;
            const e = edgeKey(curr, next);
            if (visitedEdges.has(e)) break;
            visitedEdges.add(e);
            if (next === startA) {
                loops.push(loopKeys.map((k) => parseKey(k)));
                break;
            }
            prev = curr;
            curr = next;
        }
    }

    return loops;
}

/**
 * Extract a single ordered boundary loop. When multiple loops exist, returns the
 * largest by perimeter length.
 */
export function extractOrderedBoundaryLoop(geometry: BufferGeometry): Vector3[] {
    const loops = extractBoundaryLoops(geometry);
    if (loops.length === 0) return [];

    let best = loops[0]!;
    let bestLen = loopPerimeterLength(best);
    for (let i = 1; i < loops.length; i++) {
        const len = loopPerimeterLength(loops[i]!);
        if (len > bestLen) {
            best = loops[i]!;
            bestLen = len;
        }
    }
    return best;
}

function loopPerimeterLength(loop: Vector3[]): number {
    let len = 0;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        len += a.distanceTo(b);
    }
    return len;
}

function validateLoop(loop: Vector3[], maxGapMm = BOUNDARY_GAP_TOLERANCE_MM): { ok: boolean; reason?: string } {
    if (loop.length < 3) return { ok: false, reason: "loop has fewer than 3 vertices" };

    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const gap = a.distanceTo(b);
        if (gap > maxGapMm) {
            return { ok: false, reason: `gap ${gap.toFixed(3)}mm exceeds tolerance` };
        }
    }

    // Simple self-intersection test in XY projection.
    const n = loop.length;
    for (let i = 0; i < n; i++) {
        const a0 = loop[i]!;
        const a1 = loop[(i + 1) % n]!;
        for (let j = i + 2; j < n; j++) {
            if (j === n - 1 && i === 0) continue;
            const b0 = loop[j]!;
            const b1 = loop[(j + 1) % n]!;
            if (segmentsIntersectXY(a0, a1, b0, b1)) {
                return { ok: false, reason: "self-intersection detected in XY projection" };
            }
        }
    }

    return { ok: true };
}

function segmentsIntersectXY(a0: Vector3, a1: Vector3, b0: Vector3, b1: Vector3): boolean {
    const orient = (p: Vector3, q: Vector3, r: Vector3) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const onSeg = (p: Vector3, q: Vector3, r: Vector3) =>
        Math.min(p.x, r.x) <= q.x + 1e-9 &&
        q.x <= Math.max(p.x, r.x) + 1e-9 &&
        Math.min(p.y, r.y) <= q.y + 1e-9 &&
        q.y <= Math.max(p.y, r.y) + 1e-9;

    const o1 = orient(a0, a1, b0);
    const o2 = orient(a0, a1, b1);
    const o3 = orient(b0, b1, a0);
    const o4 = orient(b0, b1, a1);

    if (o1 * o2 < 0 && o3 * o4 < 0) return true;
    if (Math.abs(o1) < 1e-9 && onSeg(a0, b0, a1)) return true;
    if (Math.abs(o2) < 1e-9 && onSeg(a0, b1, a1)) return true;
    if (Math.abs(o3) < 1e-9 && onSeg(b0, a0, b1)) return true;
    if (Math.abs(o4) < 1e-9 && onSeg(b0, a1, b1)) return true;
    return false;
}

/** Resample a closed loop to exactly `n` evenly-spaced points via arc-length parameterization. */
export function resampleLoopToCount(loop: Vector3[], n: number): Vector3[] {
    if (loop.length === 0 || n < 3) return [];
    if (loop.length === n) return loop.map((p) => p.clone());

    const cumulative: number[] = [0];
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        cumulative.push(cumulative[cumulative.length - 1]! + a.distanceTo(b));
    }
    const total = cumulative[cumulative.length - 1]!;
    if (total < 1e-9) return loop.slice(0, n).map((p) => p.clone());

    const out: Vector3[] = [];
    for (let i = 0; i < n; i++) {
        const target = (i / n) * total;
        let seg = 0;
        while (seg < loop.length && cumulative[seg + 1]! < target) seg++;
        const segStart = cumulative[seg]!;
        const segEnd = cumulative[seg + 1]!;
        const t = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
        const a = loop[seg % loop.length]!;
        const b = loop[(seg + 1) % loop.length]!;
        out.push(new Vector3().lerpVectors(a, b, t));
    }
    return out;
}

function roundUpToNearest4(n: number): number {
    return Math.max(4, Math.ceil(n / 4) * 4);
}

export interface BridgeStripResult {
    positions: number[];
    indices: number[];
    /** Midpoint vertex index per perimeter sample, or -1 when linear bridge is used. */
    midPerSample: number[];
    topIdx: number[];
    bottomIdx: number[];
    triangleCount: number;
}

/**
 * Generate a bridge triangle strip between corresponding top and bottom loops.
 * Inserts midpoint rows where local rim height >= RIM_HEIGHT_ADAPTIVE_THRESHOLD_MM.
 */
export function generateBridgeStrip(topLoop: Vector3[], bottomLoop: Vector3[]): BridgeStripResult {
    const n = topLoop.length;
    const positions: number[] = [];
    const indices: number[] = [];
    const midPerSample: number[] = [];

    const pushV = (v: Vector3): number => {
        const idx = positions.length / 3;
        positions.push(v.x, v.y, v.z);
        return idx;
    };

    const topIdx: number[] = [];
    const bottomIdx: number[] = [];
    const midIdx: number[] = [];

    for (let i = 0; i < n; i++) {
        const t = topLoop[i]!;
        const b = bottomLoop[i]!;
        topIdx.push(pushV(t));
        bottomIdx.push(pushV(b));
        const rimH = t.distanceTo(b);
        if (rimH >= RIM_HEIGHT_ADAPTIVE_THRESHOLD_MM) {
            const mid = new Vector3().lerpVectors(t, b, 0.5);
            midIdx.push(pushV(mid));
        } else {
            midIdx.push(-1);
        }
        midPerSample.push(midIdx[midIdx.length - 1]!);
    }

    const centroid = new Vector3();
    for (let i = 0; i < n; i++) {
        centroid.add(topLoop[i]!);
        centroid.add(bottomLoop[i]!);
    }
    centroid.multiplyScalar(1 / (2 * n));

    const emitTri = (a: number, b: number, c: number) => {
        const va = new Vector3(positions[a * 3]!, positions[a * 3 + 1]!, positions[a * 3 + 2]!);
        const vb = new Vector3(positions[b * 3]!, positions[b * 3 + 1]!, positions[b * 3 + 2]!);
        const vc = new Vector3(positions[c * 3]!, positions[c * 3 + 1]!, positions[c * 3 + 2]!);
        const ab = new Vector3().subVectors(vb, va);
        const ac = new Vector3().subVectors(vc, va);
        const normal = new Vector3().crossVectors(ab, ac);
        const center = new Vector3().addVectors(va, vb).add(vc).multiplyScalar(1 / 3);
        const outward = new Vector3().subVectors(center, centroid);
        if (normal.dot(outward) < 0) {
            indices.push(a, c, b);
        } else {
            indices.push(a, b, c);
        }
    };

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const tA = topIdx[i]!;
        const tB = topIdx[j]!;
        const bA = bottomIdx[i]!;
        const bB = bottomIdx[j]!;
        const mA = midIdx[i]!;
        const mB = midIdx[j]!;

        if (mA >= 0 && mB >= 0) {
            emitTri(tA, mA, mB);
            emitTri(tA, mB, tB);
            emitTri(mA, bA, bB);
            emitTri(mA, bB, mB);
        } else {
            emitTri(tA, bA, bB);
            emitTri(tA, bB, tB);
        }
    }

    return {
        positions,
        indices,
        midPerSample,
        topIdx,
        bottomIdx,
        triangleCount: indices.length / 3,
    };
}

/** Laplacian smooth only the bridge interior (midpoint) vertices — not top/bottom rim copies. */
export function smoothBridgeStrip(
    positions: number[],
    midPerSample: number[],
    topIdx: number[],
    bottomIdx: number[],
    iterations = BRIDGE_SMOOTH_ITERATIONS,
    strength = BRIDGE_SMOOTH_STRENGTH,
): void {
    const n = topIdx.length;
    const interiorSet = new Set(midPerSample.filter((m) => m >= 0));
    if (interiorSet.size === 0 || iterations <= 0) return;

    const adj = new Map<number, number[]>();

    for (let i = 0; i < n; i++) {
        const midI = midPerSample[i]!;
        if (midI < 0) continue;
        const j = (i + 1) % n;
        const neighbors = [topIdx[i]!, topIdx[j]!, bottomIdx[i]!, bottomIdx[j]!];
        const midJ = midPerSample[j]!;
        if (midJ >= 0) neighbors.push(midJ);
        const midPrev = midPerSample[(i - 1 + n) % n]!;
        if (midPrev >= 0) neighbors.push(midPrev);
        adj.set(midI, neighbors);
    }

    for (let it = 0; it < iterations; it++) {
        const deltas = new Map<number, Vector3>();
        for (const vi of interiorSet) {
            const neighbors = adj.get(vi) ?? [];
            if (neighbors.length === 0) continue;
            const avg = new Vector3();
            for (const ni of neighbors) {
                avg.x += positions[ni * 3]!;
                avg.y += positions[ni * 3 + 1]!;
                avg.z += positions[ni * 3 + 2]!;
            }
            avg.multiplyScalar(1 / neighbors.length);
            const cur = new Vector3(positions[vi * 3]!, positions[vi * 3 + 1]!, positions[vi * 3 + 2]!);
            const delta = new Vector3().subVectors(avg, cur).multiplyScalar(strength);
            deltas.set(vi, delta);
        }
        for (const [vi, delta] of deltas) {
            positions[vi * 3]! += delta.x;
            positions[vi * 3 + 1]! += delta.y;
            positions[vi * 3 + 2]! += delta.z;
        }
    }
}

function removeSeamCapFaces(geometry: BufferGeometry): BufferGeometry {
    const components = splitTriangleComponents(geometry);
    if (components.length < 2) return geometry;

    const scored = components.map((tris) => {
        const pos = geometry.getAttribute("position");
        let meanZ = 0;
        let count = 0;
        for (const t of tris) {
            for (let k = 0; k < 3; k++) {
                meanZ += pos.getZ(idx(geometry, t, k));
                count++;
            }
        }
        return { tris, meanZ: meanZ / Math.max(1, count) };
    });
    scored.sort((a, b) => b.meanZ - a.meanZ);

    const topTris = scored[0]!.tris;
    const bottomTris = scored[scored.length - 1]!.tris;
    const pos = geometry.getAttribute("position");

    let topSeamZ = Number.POSITIVE_INFINITY;
    for (const t of topTris) {
        for (let k = 0; k < 3; k++) topSeamZ = Math.min(topSeamZ, pos.getZ(idx(geometry, t, k)));
    }
    let bottomSeamZ = Number.NEGATIVE_INFINITY;
    for (const t of bottomTris) {
        for (let k = 0; k < 3; k++) bottomSeamZ = Math.max(bottomSeamZ, pos.getZ(idx(geometry, t, k)));
    }

    const zBand = 0.75;
    const isHorizontalCap = (t: number): boolean => {
        const i0 = idx(geometry, t, 0);
        const i1 = idx(geometry, t, 1);
        const i2 = idx(geometry, t, 2);
        const z0 = pos.getZ(i0);
        const z1 = pos.getZ(i1);
        const z2 = pos.getZ(i2);
        if (Math.abs(z0 - z1) > zBand || Math.abs(z1 - z2) > zBand || Math.abs(z0 - z2) > zBand) {
            return false;
        }
        const avgZ = (z0 + z1 + z2) / 3;
        const inTop = topTris.includes(t) && Math.abs(avgZ - topSeamZ) <= zBand;
        const inBottom = bottomTris.includes(t) && Math.abs(avgZ - bottomSeamZ) <= zBand;
        return inTop || inBottom;
    };

    const triN = triangleCount(geometry);
    const keep: number[] = [];
    for (let t = 0; t < triN; t++) {
        if (!isHorizontalCap(t)) keep.push(idx(geometry, t, 0), idx(geometry, t, 1), idx(geometry, t, 2));
    }

    const out = new BufferGeometry();
    out.setAttribute("position", pos.clone());
    out.setIndex(keep);
    const normal = geometry.getAttribute("normal");
    if (normal) out.setAttribute("normal", normal.clone());
    if (geometry.userData) out.userData = { ...geometry.userData };
    return out;
}

function findVertexByPosition(geometry: BufferGeometry, target: Vector3, toleranceMm = 0.05): number {
    const pos = geometry.getAttribute("position");
    const key = quantKey(target.x, target.y, target.z);
    for (let i = 0; i < pos.count; i++) {
        if (quantKey(pos.getX(i), pos.getY(i), pos.getZ(i)) === key) return i;
    }
    const tol2 = toleranceMm * toleranceMm;
    let best = -1;
    let bestD2 = tol2;
    for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - target.x;
        const dy = pos.getY(i) - target.y;
        const dz = pos.getZ(i) - target.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= bestD2) {
            bestD2 = d2;
            best = i;
        }
    }
    return best;
}

function mergeGeometriesWithWeldedBridge(
    body: BufferGeometry,
    topLoop: Vector3[],
    bottomLoop: Vector3[],
    bridge: BridgeStripResult,
): BufferGeometry {
    const indexed = toIndexed(body);
    const posAttr = indexed.getAttribute("position");
    const bodyCount = posAttr.count;
    const triN = triangleCount(indexed);

    const topBodyIdx: number[] = [];
    const bottomBodyIdx: number[] = [];
    for (let i = 0; i < topLoop.length; i++) {
        const ti = findVertexByPosition(indexed, topLoop[i]!, 5.0);
        const bi = findVertexByPosition(indexed, bottomLoop[i]!, 5.0);
        if (ti < 0 || bi < 0) {
            if (indexed !== body) indexed.dispose();
            throw new MeshNotWatertightError(
                `Bridge weld failed at sample ${i}: top=${ti} bottom=${bi}`,
                validateManifold(indexed),
            );
        }
        topBodyIdx.push(ti);
        bottomBodyIdx.push(bi);
    }

    const newVertexStart = bodyCount;
    const positions = new Float32Array(bodyCount * 3 + bridge.positions.length);
    for (let i = 0; i < bodyCount * 3; i++) positions[i] = (posAttr.array as Float32Array)[i]!;

    const midBodyIdx: number[] = [];
    let newOffset = 0;
    for (let i = 0; i < bridge.midPerSample.length; i++) {
        const mid = bridge.midPerSample[i]!;
        if (mid < 0) {
            midBodyIdx.push(-1);
            continue;
        }
        const base = mid * 3;
        positions[bodyCount * 3 + newOffset] = bridge.positions[base]!;
        positions[bodyCount * 3 + newOffset + 1] = bridge.positions[base + 1]!;
        positions[bodyCount * 3 + newOffset + 2] = bridge.positions[base + 2]!;
        midBodyIdx.push(newVertexStart + newOffset / 3);
        newOffset += 3;
    }

    const indices: number[] = [];
    for (let t = 0; t < triN; t++) {
        indices.push(idx(indexed, t, 0), idx(indexed, t, 1), idx(indexed, t, 2));
    }

    const n = topLoop.length;
    const centroid = new Vector3();
    for (let i = 0; i < n; i++) {
        centroid.add(topLoop[i]!);
        centroid.add(bottomLoop[i]!);
    }
    centroid.multiplyScalar(1 / (2 * n));

    const emitTri = (a: number, b: number, c: number) => {
        const va = new Vector3(positions[a * 3]!, positions[a * 3 + 1]!, positions[a * 3 + 2]!);
        const vb = new Vector3(positions[b * 3]!, positions[b * 3 + 1]!, positions[b * 3 + 2]!);
        const vc = new Vector3(positions[c * 3]!, positions[c * 3 + 1]!, positions[c * 3 + 2]!);
        const ab = new Vector3().subVectors(vb, va);
        const ac = new Vector3().subVectors(vc, va);
        const normal = new Vector3().crossVectors(ab, ac);
        const center = new Vector3().addVectors(va, vb).add(vc).multiplyScalar(1 / 3);
        const outward = new Vector3().subVectors(center, centroid);
        if (normal.dot(outward) < 0) indices.push(a, c, b);
        else indices.push(a, b, c);
    };

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const tA = topBodyIdx[i]!;
        const tB = topBodyIdx[j]!;
        const bA = bottomBodyIdx[i]!;
        const bB = bottomBodyIdx[j]!;
        const mA = midBodyIdx[i]!;
        const mB = midBodyIdx[j]!;

        if (mA >= 0 && mB >= 0) {
            emitTri(tA, mA, mB);
            emitTri(tA, mB, tB);
            emitTri(mA, bA, bB);
            emitTri(mA, bB, mB);
        } else {
            emitTri(tA, bA, bB);
            emitTri(tA, bB, tB);
        }
    }

    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(positions, 3));
    out.setIndex(indices);
    if (indexed !== body) indexed.dispose();
    return out;
}

/** Full half-edge manifold validation with Euler characteristic and naked-edge listing. */
export function validateManifold(geometry: BufferGeometry): ManifoldValidationReport {
    const base = analyzeManifold(geometry);
    const { edgeCount, edgeVerts } = buildEdgeUsage(geometry);
    const nakedEdgeKeys: string[] = [];
    for (const [ek, count] of edgeCount) {
        if (count === 1) nakedEdgeKeys.push(ek);
    }

    const V = new Set<string>();
    for (const [ek] of edgeCount) {
        const pair = edgeVerts.get(ek);
        if (pair) {
            V.add(pair[0]);
            V.add(pair[1]);
        }
    }

    const E = edgeCount.size;
    const F = triangleCount(geometry);
    const eulerCharacteristic = V.size - E + F;

    return {
        ...base,
        edgeCount: E,
        eulerCharacteristic,
        nakedEdgeKeys,
    };
}

function recomputeNormalsNearBridge(geometry: BufferGeometry, bridgePositions: number[], topCount: number): void {
    const pos = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (!index) return;

    const bridgeVerts: Vector3[] = [];
    for (let i = 0; i < topCount; i++) {
        bridgeVerts.push(
            new Vector3(bridgePositions[i * 3]!, bridgePositions[i * 3 + 1]!, bridgePositions[i * 3 + 2]!),
        );
    }

    const near = new Set<number>();
    const r2 = NORMAL_RECOMPUTE_RADIUS_MM * NORMAL_RECOMPUTE_RADIUS_MM;
    for (let vi = 0; vi < pos.count; vi++) {
        const vx = pos.getX(vi);
        const vy = pos.getY(vi);
        const vz = pos.getZ(vi);
        for (const bv of bridgeVerts) {
            const dx = vx - bv.x;
            const dy = vy - bv.y;
            const dz = vz - bv.z;
            if (dx * dx + dy * dy + dz * dz <= r2) {
                near.add(vi);
                break;
            }
        }
    }

    const triN = index.count / 3;
    const faceNormals: Vector3[] = [];
    const accum = new Map<number, Vector3>();
    const weight = new Map<number, number>();

    for (let t = 0; t < triN; t++) {
        const i0 = index.getX(t * 3);
        const i1 = index.getX(t * 3 + 1);
        const i2 = index.getX(t * 3 + 2);
        const a = new Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
        const b = new Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
        const c = new Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
        const ab = new Vector3().subVectors(b, a);
        const ac = new Vector3().subVectors(c, a);
        const fn = new Vector3().crossVectors(ab, ac);
        const area = fn.length();
        if (area < 1e-12) continue;
        fn.normalize();
        faceNormals.push(fn);

        for (const vi of [i0, i1, i2]) {
            if (!near.has(vi)) continue;
            if (!accum.has(vi)) accum.set(vi, new Vector3());
            if (!weight.has(vi)) weight.set(vi, 0);
            accum.get(vi)!.addScaledVector(fn, area);
            weight.set(vi, weight.get(vi)! + area);
        }
    }

    const normals = new Float32Array(pos.count * 3);
    const existing = geometry.getAttribute("normal");
    if (existing) {
        for (let i = 0; i < pos.count * 3; i++) normals[i] = (existing.array as Float32Array)[i]!;
    } else {
        geometry.computeVertexNormals();
        const computed = geometry.getAttribute("normal")!;
        for (let i = 0; i < pos.count * 3; i++) normals[i] = (computed.array as Float32Array)[i]!;
    }

    for (const vi of near) {
        const w = weight.get(vi);
        if (!w || w < 1e-12) continue;
        const n = accum.get(vi)!.multiplyScalar(1 / w).normalize();
        normals[vi * 3] = n.x;
        normals[vi * 3 + 1] = n.y;
        normals[vi * 3 + 2] = n.z;
    }

    geometry.setAttribute("normal", new BufferAttribute(normals, 3));
}

function measureRimHeights(topLoop: Vector3[], bottomLoop: Vector3[], samples = 8): number[] {
    const n = topLoop.length;
    const heights: number[] = [];
    for (let s = 0; s < samples; s++) {
        const i = Math.floor((s / samples) * n) % n;
        heights.push(topLoop[i]!.distanceTo(bottomLoop[i]!));
    }
    return heights;
}

function pickTopBottomLoops(loops: Vector3[][]): { top: Vector3[]; bottom: Vector3[] } | null {
    if (loops.length < 2) return null;

    const scored = loops.map((loop) => {
        const c = new Vector3();
        for (const p of loop) c.add(p);
        c.multiplyScalar(1 / loop.length);
        return { loop, z: c.z, len: loopPerimeterLength(loop) };
    });

    scored.sort((a, b) => b.z - a.z);
    const top = scored[0]!.loop;
    const bottom = scored[scored.length - 1]!.loop;
    return { top, bottom };
}

/** Union-find connected triangle components sharing quantized edges. */
function splitTriangleComponents(geometry: BufferGeometry): number[][] {
    const triN = triangleCount(geometry);
    const parent = Array.from({ length: triN }, (_, i) => i);
    const find = (x: number): number => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]!]!;
            x = parent[x]!;
        }
        return x;
    };
    const unite = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[rb] = ra;
    };

    const edgeToTri = new Map<string, number>();
    for (let t = 0; t < triN; t++) {
        const keys = [0, 1, 2].map((k) => vertexKeyAt(geometry, idx(geometry, t, k)));
        for (let i = 0; i < 3; i++) {
            const ek = edgeKey(keys[i]!, keys[(i + 1) % 3]!);
            const other = edgeToTri.get(ek);
            if (other !== undefined) unite(t, other);
            else edgeToTri.set(ek, t);
        }
    }

    const groups = new Map<number, number[]>();
    for (let t = 0; t < triN; t++) {
        const r = find(t);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r)!.push(t);
    }
    return Array.from(groups.values());
}

/** Order seam vertices into a closed CCW loop in XY at a target Z band. */
function extractSeamLoopFromComponent(
    geometry: BufferGeometry,
    triangles: number[],
    seam: "minZ" | "maxZ",
    zBandMm = 0.75,
): Vector3[] {
    const pos = geometry.getAttribute("position");
    let zTarget = seam === "minZ" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;

    for (const t of triangles) {
        for (let k = 0; k < 3; k++) {
            const vi = idx(geometry, t, k);
            const z = pos.getZ(vi);
            if (seam === "minZ") zTarget = Math.min(zTarget, z);
            else zTarget = Math.max(zTarget, z);
        }
    }

    const unique = new Map<string, Vector3>();
    for (const t of triangles) {
        for (let k = 0; k < 3; k++) {
            const vi = idx(geometry, t, k);
            const x = pos.getX(vi);
            const y = pos.getY(vi);
            const z = pos.getZ(vi);
            if (Math.abs(z - zTarget) > zBandMm) continue;
            const key = quantKey(x, y, z);
            if (!unique.has(key)) unique.set(key, new Vector3(x, y, z));
        }
    }

    const pts = Array.from(unique.values());
    if (pts.length < 3) return [];

    const centroid = new Vector3();
    for (const p of pts) centroid.add(p);
    centroid.multiplyScalar(1 / pts.length);

    pts.sort((a, b) => Math.atan2(a.y - centroid.y, a.x - centroid.x) - Math.atan2(b.y - centroid.y, b.x - centroid.x));
    return pts;
}

/** Extract top/bottom seam loops from disconnected closed shells (no naked edges). */
function pickTopBottomSeamLoops(geometry: BufferGeometry): { top: Vector3[]; bottom: Vector3[] } | null {
    const components = splitTriangleComponents(geometry);
    if (components.length < 2) return null;

    const scored = components.map((tris) => {
        const pos = geometry.getAttribute("position");
        let meanZ = 0;
        let count = 0;
        for (const t of tris) {
            for (let k = 0; k < 3; k++) {
                meanZ += pos.getZ(idx(geometry, t, k));
                count++;
            }
        }
        return { tris, meanZ: meanZ / Math.max(1, count) };
    });
    scored.sort((a, b) => b.meanZ - a.meanZ);

    const topTris = scored[0]!.tris;
    const bottomTris = scored[scored.length - 1]!.tris;
    const top = extractSeamLoopFromComponent(geometry, topTris, "minZ");
    const bottom = extractSeamLoopFromComponent(geometry, bottomTris, "maxZ");
    if (top.length < 3 || bottom.length < 3) return null;
    return { top, bottom };
}

function resolveTopBottomLoops(geometry: BufferGeometry): { top: Vector3[]; bottom: Vector3[] } | null {
    const boundaryLoops = extractBoundaryLoops(geometry);
    const fromBoundary = pickTopBottomLoops(boundaryLoops);
    if (fromBoundary) return fromBoundary;
    return pickTopBottomSeamLoops(geometry);
}

/**
 * Close the perimeter gap between top and bottom shells using explicit boundary
 * stitching (Option B). Returns the input unchanged when already watertight.
 */
export function closeMeshPerimeter(geometry: BufferGeometry): CloseMeshResult {
    let working = geometry;
    let disposed = false;

    const precheck = validateManifold(geometry);
    if (precheck.isWatertight && precheck.eulerCharacteristic === 2) {
        return {
            geometry,
            report: precheck,
            bridgeTriangleCount: 0,
            smoothingIterations: 0,
            rimHeightsMm: [],
        };
    }

    // Closed Top+Bottom shells hide the seam behind internal cap faces — remove them
    // so the perimeter becomes an open boundary loop we can stitch.
    if (precheck.isWatertight && precheck.eulerCharacteristic !== 2) {
        working = removeSeamCapFaces(geometry);
        disposed = working !== geometry;
    }

    const workingPrecheck = validateManifold(working);
    const pair = resolveTopBottomLoops(working);
    if (!pair) {
        if (disposed) working.dispose();
        throw new MeshNotWatertightError(
            `Cannot close mesh: no top/bottom seam loops (euler=${workingPrecheck.eulerCharacteristic}, openEdges=${workingPrecheck.openEdges})`,
            workingPrecheck,
        );
    }

    const targetN = roundUpToNearest4(Math.max(pair.top.length, pair.bottom.length));
    const topLoop = resampleLoopToCount(pair.top, targetN);
    const bottomLoop = resampleLoopToCount(pair.bottom, targetN);

    const topVal = validateLoop(topLoop, loopPerimeterLength(topLoop) / targetN * 2);
    const bottomVal = validateLoop(bottomLoop, loopPerimeterLength(bottomLoop) / targetN * 2);
    if (!topVal.ok || !bottomVal.ok) {
        throw new MeshNotWatertightError(
            `Boundary loop validation failed after resample: top=${topVal.reason ?? "ok"}, bottom=${bottomVal.reason ?? "ok"}`,
            precheck,
        );
    }

    const rimHeightsMm = measureRimHeights(topLoop, bottomLoop);
    for (const h of rimHeightsMm) {
        if (h < RIM_HEIGHT_MIN_WARNING_MM && typeof console !== "undefined") {
            console.warn(`[mesh-close] rim height ${h.toFixed(3)}mm < ${RIM_HEIGHT_MIN_WARNING_MM}mm — may look pinched`);
        }
    }

    const bridge = generateBridgeStrip(topLoop, bottomLoop);
    smoothBridgeStrip(
        bridge.positions,
        bridge.midPerSample,
        bridge.topIdx,
        bridge.bottomIdx,
        BRIDGE_SMOOTH_ITERATIONS,
        BRIDGE_SMOOTH_STRENGTH,
    );

    const merged = mergeGeometriesWithWeldedBridge(working, topLoop, bottomLoop, bridge);
    if (disposed) working.dispose();
    recomputeNormalsNearBridge(merged, bridge.positions, targetN);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();

    const report = validateManifold(merged);
    if (!report.isWatertight || report.eulerCharacteristic !== 2) {
        throw new MeshNotWatertightError(
            `Mesh closure failed: openEdges=${report.openEdges} nonManifold=${report.nonManifoldEdges} euler=${report.eulerCharacteristic}`,
            report,
        );
    }

    if (typeof console !== "undefined") {
        console.log(
            `Mesh closed: V=${report.vertexCount} E=${report.edgeCount} F=${report.triangleCount} Euler=${report.eulerCharacteristic} Watertight=true`,
        );
    }

    return {
        geometry: merged,
        report,
        bridgeTriangleCount: bridge.triangleCount,
        smoothingIterations: BRIDGE_SMOOTH_ITERATIONS,
        rimHeightsMm,
    };
}

/**
 * Export-time helper: close multi-mesh base geometry when the perimeter is open.
 * Preserves geometry when already watertight.
 */
export function ensureWatertightForExport(geometry: BufferGeometry): BufferGeometry {
    const pre = validateManifold(geometry);
    const isMultiMesh = !!(geometry.userData as { isMultiMeshBase?: boolean })?.isMultiMeshBase;
    const needsClosure =
        isMultiMesh &&
        (!pre.isWatertight || pre.eulerCharacteristic !== 2 || pre.openEdges > 0);

    if (!needsClosure) return geometry;

    const result = closeMeshPerimeter(geometry);
    if (result.geometry !== geometry) {
        geometry.dispose();
    }
    if (geometry.userData) {
        result.geometry.userData = { ...geometry.userData };
    }
    return result.geometry;
}
