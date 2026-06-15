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

import { Box3, BufferAttribute, BufferGeometry, ShapeUtils, Vector2, Vector3 } from "three";
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
/** Legacy — no longer used in bridge weld path. Retained for reference. Remove after v2 stable. */
export const WELD_SNAP_TOLERANCE_MM = 1.0;
/** Distance within which a resampled rim point is treated as an exact boundary endpoint. */
const RIM_ENDPOINT_TOLERANCE_MM = 0.1;
/** Sentinel: resampled rim point must become a new vertex in the merged buffer. */
const NEW_VERTEX = -1;
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

/** Thrown when a shell perimeter cannot be resolved to one continuous loop. */
export class BoundaryFragmentedError extends Error {
    readonly fragmentCount: number;
    readonly shell: "top" | "bottom";

    constructor(shell: "top" | "bottom", fragmentCount: number) {
        super(
            `${shell} mesh boundary has ${fragmentCount} fragments. Merge sub-meshes before export.`,
        );
        this.name = "BoundaryFragmentedError";
        this.fragmentCount = fragmentCount;
        this.shell = shell;
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
    topLoop: Vector3[];
    bottomLoop: Vector3[];
    seamTopIndices: number[];
    weldTopIndices: number[];
    weldBottomIndices: number[];
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

/** DFS boundary walk that enumerates simple cycles through degree>2 branch vertices. */
function extractAllBoundaryCycles(geometry: BufferGeometry): Vector3[][] {
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
    const cycles: Vector3[][] = [];

    const walk = (start: string, prev: string, curr: string, loopKeys: string[]): void => {
        const neighbors = adj.get(curr) ?? [];
        for (const next of neighbors) {
            if (next === prev) continue;
            const e = edgeKey(curr, next);
            if (visitedEdges.has(e)) continue;

            if (next === start && loopKeys.length >= 2) {
                visitedEdges.add(e);
                cycles.push([...loopKeys, curr].map((k) => parseKey(k)));
                continue;
            }

            if (loopKeys.includes(next)) continue;

            visitedEdges.add(e);
            walk(start, curr, next, [...loopKeys, curr]);
            visitedEdges.delete(e);
        }
    };

    for (const [startA, startB] of boundaryEdges) {
        const startEdge = edgeKey(startA, startB);
        if (visitedEdges.has(startEdge)) continue;
        visitedEdges.add(startEdge);
        walk(startA, startA, startB, [startA]);
        visitedEdges.delete(startEdge);
    }

    return cycles;
}

function largestBoundaryLoop(geometry: BufferGeometry): Vector3[] {
    const cycles = extractAllBoundaryCycles(geometry);
    if (cycles.length === 0) return extractOrderedBoundaryLoop(geometry);

    let best = cycles[0]!;
    let bestLen = loopPerimeterLength(best);
    for (let i = 1; i < cycles.length; i++) {
        const loop = cycles[i]!;
        const len = loopPerimeterLength(loop);
        if (len > bestLen) {
            best = loop;
            bestLen = len;
        }
    }
    return best;
}

/**
 * Extract a single ordered boundary loop. When multiple loops exist, returns the
 * largest by perimeter length.
 */
export function extractOrderedBoundaryLoop(geometry: BufferGeometry): Vector3[] {
    return extractOrderedBoundaryLoopWithIndices(geometry).positions;
}

function vertexIndexForQuantKey(geometry: BufferGeometry, key: string): number {
    const pos = geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
        if (quantKey(pos.getX(i), pos.getY(i), pos.getZ(i)) === key) return i;
    }
    return -1;
}

/** Quant-key lookup restricted to a half-open vertex index range [rangeStart, rangeEnd). */
function vertexIndexForQuantKeyInRange(
    geometry: BufferGeometry,
    key: string,
    rangeStart: number,
    rangeEnd: number,
): number {
    const pos = geometry.getAttribute("position");
    for (let i = rangeStart; i < rangeEnd; i++) {
        if (quantKey(pos.getX(i), pos.getY(i), pos.getZ(i)) === key) return i;
    }
    return -1;
}

/** Same loop selection as extractOrderedBoundaryLoop, with mesh vertex indices per point. */
export function extractOrderedBoundaryLoopWithIndices(geometry: BufferGeometry): {
    positions: Vector3[];
    indices: number[];
} {
    const loops = extractBoundaryLoops(geometry);
    if (loops.length === 0) return { positions: [], indices: [] };

    let best = loops[0]!;
    let bestLen = loopPerimeterLength(best);
    for (let i = 1; i < loops.length; i++) {
        const len = loopPerimeterLength(loops[i]!);
        if (len > bestLen) {
            best = loops[i]!;
            bestLen = len;
        }
    }

    const indices = best.map((p) => vertexIndexForQuantKey(geometry, quantKey(p.x, p.y, p.z)));
    return { positions: best, indices };
}

/** Map a boundary loop's positions to LOCAL vertex indices within [rangeStart, rangeEnd). */
function boundaryLoopVertexIndicesLocal(
    geometry: BufferGeometry,
    loop: Vector3[],
    rangeStart: number,
    rangeEnd: number,
): number[] {
    return loop.map((p) => {
        const vi = vertexIndexForQuantKeyInRange(geometry, quantKey(p.x, p.y, p.z), rangeStart, rangeEnd);
        if (vi < 0) {
            throw new MeshNotWatertightError(
                `Boundary loop vertex not found in mesh range [${rangeStart},${rangeEnd}) at (${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`,
                validateManifold(geometry),
            );
        }
        return vi - rangeStart;
    });
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

/** Resample a closed loop to exactly `targetCount` points via arc-length parameterization. */
export function resampleLoop(loop: Vector3[], targetCount: number): Vector3[] {
    return resampleLoopToCount(loop, targetCount);
}

/** Signed area of a loop projected onto the XZ plane (positive = CCW, negative = CW). */
export function signedLoopAreaXZ(loop: Vector3[]): number {
    let area = 0;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        area += a.x * b.z - b.x * a.z;
    }
    return area * 0.5;
}

/** Ensure top and bottom loops share the same winding when viewed on XZ. */
export function alignLoopWindingXZ(
    topLoop: Vector3[],
    botLoop: Vector3[],
): { topLoop: Vector3[]; botLoop: Vector3[]; windingAligned: boolean } {
    const topArea = signedLoopAreaXZ(topLoop);
    const botArea = signedLoopAreaXZ(botLoop);
    if (topArea * botArea < 0) {
        return { topLoop, botLoop: [...botLoop].reverse(), windingAligned: false };
    }
    return { topLoop, botLoop, windingAligned: true };
}

function rotateLoop(loop: Vector3[], offset: number): Vector3[] {
    const n = loop.length;
    if (n === 0) return [];
    const k = ((offset % n) + n) % n;
    return Array.from({ length: n }, (_, i) => loop[(i + k) % n]!.clone());
}

/** Rotate `loop` so its samples best align with `reference` (minimizes XY distance). */
export function alignLoopStartToReference(reference: Vector3[], loop: Vector3[]): Vector3[] {
    const n = reference.length;
    if (n === 0 || loop.length !== n) return loop.map((p) => p.clone());

    let bestK = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let k = 0; k < n; k++) {
        let cost = 0;
        for (let i = 0; i < n; i++) {
            const a = reference[i]!;
            const b = loop[(i + k) % n]!;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            cost += dx * dx + dy * dy;
        }
        if (cost < bestCost) {
            bestCost = cost;
            bestK = k;
        }
    }
    return rotateLoop(loop, bestK);
}

interface SnappedBoundaryLoop {
    positions: Vector3[];
    localIndices: number[];
}

/** Snap each loop sample to the nearest boundary vertex in [rangeStart, rangeEnd). */
function snapLoopToBoundaryVertices(
    geometry: BufferGeometry,
    loop: Vector3[],
    rangeStart: number,
    rangeEnd: number,
): SnappedBoundaryLoop {
    const boundaryVerts = boundaryVertexIndicesInRange(geometry, rangeStart, rangeEnd);
    const pos = geometry.getAttribute("position");
    const positions: Vector3[] = [];
    const localIndices: number[] = [];

    for (const p of loop) {
        let bestVi = rangeStart;
        let bestD2 = Number.POSITIVE_INFINITY;
        for (const vi of boundaryVerts) {
            const dx = pos.getX(vi) - p.x;
            const dy = pos.getY(vi) - p.y;
            const dz = pos.getZ(vi) - p.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestD2) {
                bestD2 = d2;
                bestVi = vi;
            }
        }
        localIndices.push(bestVi - rangeStart);
        positions.push(new Vector3(pos.getX(bestVi), pos.getY(bestVi), pos.getZ(bestVi)));
    }

    return { positions, localIndices };
}

/**
 * Build a complete quad-strip bridge between equal-length rim loops (2N triangles).
 * No Laplacian smoothing — midpoints are not inserted.
 */
export function buildBridgeStrip(topLoop: Vector3[], bottomLoop: Vector3[]): BridgeStripResult {
    const n = topLoop.length;
    if (bottomLoop.length !== n) {
        throw new Error(`buildBridgeStrip requires equal loop lengths, got top=${topLoop.length} bot=${bottomLoop.length}`);
    }

    const positions: number[] = [];
    const indices: number[] = [];
    const topIdx: number[] = [];
    const bottomIdx: number[] = [];
    const midPerSample: number[] = new Array<number>(n).fill(-1);

    const pushV = (v: Vector3): number => {
        const idx = positions.length / 3;
        positions.push(v.x, v.y, v.z);
        return idx;
    };

    for (let i = 0; i < n; i++) {
        topIdx.push(pushV(topLoop[i]!));
        bottomIdx.push(pushV(bottomLoop[i]!));
    }

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const tA = topIdx[i]!;
        const tB = topIdx[j]!;
        const bA = bottomIdx[i]!;
        const bB = bottomIdx[j]!;
        indices.push(tA, bA, tB);
        indices.push(tB, bA, bB);
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

function buildVertexAdjacency(geometry: BufferGeometry): number[][] {
    const index = geometry.getIndex();
    const pos = geometry.getAttribute("position");
    const count = pos.count;
    const adj: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
    if (!index) return adj.map((s) => Array.from(s));
    for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        adj[a]!.add(b).add(c);
        adj[b]!.add(a).add(c);
        adj[c]!.add(a).add(b);
    }
    return adj.map((s) => Array.from(s));
}

/** Order seam vertices into a ring following mesh adjacency. */
function orderSeamRingIndices(geometry: BufferGeometry, candidates: number[]): number[] {
    const unique = Array.from(new Set(candidates));
    if (unique.length < 3) return unique;
    const candidateSet = new Set(unique);
    const adj = buildVertexAdjacency(geometry);

    const ring: number[] = [unique[0]!];
    const used = new Set<number>([unique[0]!]);
    while (ring.length < unique.length) {
        const cur = ring[ring.length - 1]!;
        const next = adj[cur]!.find((n) => candidateSet.has(n) && !used.has(n));
        if (next === undefined) break;
        ring.push(next);
        used.add(next);
    }
    return ring;
}

/** Laplacian-smooth vertex normals along the seam ring (positions unchanged). */
function smoothSeamVertexNormals(geometry: BufferGeometry, ring: number[], iterations = 2): void {
    const nor = geometry.getAttribute("normal");
    if (!nor || ring.length < 3) return;
    const arr = nor.array as Float32Array;
    for (let it = 0; it < iterations; it++) {
        const next = new Float32Array(arr.length);
        next.set(arr);
        for (let i = 0; i < ring.length; i++) {
            const vi = ring[i]!;
            const prev = ring[(i - 1 + ring.length) % ring.length]!;
            const nxt = ring[(i + 1) % ring.length]!;
            const avg = new Vector3(
                (arr[prev * 3]! + arr[vi * 3]! + arr[nxt * 3]!) / 3,
                (arr[prev * 3 + 1]! + arr[vi * 3 + 1]! + arr[nxt * 3 + 1]!) / 3,
                (arr[prev * 3 + 2]! + arr[vi * 3 + 2]! + arr[nxt * 3 + 2]!) / 3,
            ).normalize();
            next[vi * 3] = avg.x;
            next[vi * 3 + 1] = avg.y;
            next[vi * 3 + 2] = avg.z;
        }
        arr.set(next);
    }
    nor.needsUpdate = true;
}

/** Vertex indices that lie on mesh boundary edges (half-edge count = 1). */
// TODO: Legacy snap path — no longer used in bridge weld. Remove after v2 stable.
function collectBoundaryVertexIndices(geometry: BufferGeometry): number[] {
    const { edgeCount, edgeVerts } = buildEdgeUsage(geometry);
    const boundaryKeys = new Set<string>();
    for (const [ek, count] of edgeCount) {
        if (count !== 1) continue;
        const pair = edgeVerts.get(ek);
        if (pair) {
            boundaryKeys.add(pair[0]);
            boundaryKeys.add(pair[1]);
        }
    }
    const pos = geometry.getAttribute("position");
    const out: number[] = [];
    for (let i = 0; i < pos.count; i++) {
        const key = quantKey(pos.getX(i), pos.getY(i), pos.getZ(i));
        if (boundaryKeys.has(key)) out.push(i);
    }
    return out;
}

/** Nearest vertex search restricted to a candidate set (boundary loop members only). */
// TODO: Legacy snap path — no longer used in bridge weld. Remove after v2 stable.
function findVertexAmongCandidates(
    geometry: BufferGeometry,
    target: Vector3,
    candidates: number[],
    toleranceMm = WELD_SNAP_TOLERANCE_MM,
): number {
    const pos = geometry.getAttribute("position");
    const key = quantKey(target.x, target.y, target.z);
    for (const i of candidates) {
        if (quantKey(pos.getX(i), pos.getY(i), pos.getZ(i)) === key) return i;
    }
    const tol2 = toleranceMm * toleranceMm;
    let best = -1;
    let bestD2 = tol2;
    for (const i of candidates) {
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

interface RimContactBuildResult {
    /** Body index, NEW_VERTEX sentinel, or allocated index after resolution. */
    rawIndices: number[];
    /** Positions for interior resampled rim points (parallel to NEW_VERTEX entries). */
    newRimVertices: Vector3[];
}

/**
 * Map resampled rim points to body vertex indices or NEW_VERTEX for interior edge points.
 * Endpoints reference original boundary vertices by index — no position snap.
 */
function buildRimContactIndices(
    resampledLoop: Vector3[],
    sourceLoopPositions: Vector3[],
    boundaryLoopIndices: number[],
    bodyVertexOffset: number,
): RimContactBuildResult {
    const rawIndices: number[] = [];
    const newRimVertices: Vector3[] = [];

    for (const p of resampledLoop) {
        const { seg, point } = closestPointOnLoopSegment(p, sourceLoopPositions);
        const p0 = sourceLoopPositions[seg]!;
        const p1 = sourceLoopPositions[(seg + 1) % sourceLoopPositions.length]!;
        const i0 = boundaryLoopIndices[seg]!;
        const i1 = boundaryLoopIndices[(seg + 1) % sourceLoopPositions.length]!;

        if (point.distanceTo(p0) <= RIM_ENDPOINT_TOLERANCE_MM) {
            rawIndices.push(bodyVertexOffset + i0);
        } else if (point.distanceTo(p1) <= RIM_ENDPOINT_TOLERANCE_MM) {
            rawIndices.push(bodyVertexOffset + i1);
        } else {
            rawIndices.push(NEW_VERTEX);
            newRimVertices.push(p.clone());
        }
    }

    return { rawIndices, newRimVertices };
}

function assertRimContactIndicesInRange(
    rimTop: number[],
    rimBottom: number[],
    totalVerts: number,
    topVertexCount: number,
    bottomVertexCount: number,
): void {
    const all = [...rimTop, ...rimBottom];
    for (const idx of all) {
        if (idx < 0 || idx >= totalVerts) {
            throw new Error(
                `Index out of range: ${idx} not in [0, ${totalVerts}). topVertCount=${topVertexCount} bottomVertCount=${bottomVertexCount}`,
            );
        }
    }
}

/** Infer top-shell vertex count from the highest-Z triangle component when userData lacks it. */
function inferTopVertexCount(geometry: BufferGeometry): number {
    const components = splitTriangleComponents(geometry);
    if (components.length < 2) return geometry.getAttribute("position").count;

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
    const topTris = new Set(scored[0]!.tris);
    const used = new Set<number>();
    const triN = triangleCount(geometry);
    for (let t = 0; t < triN; t++) {
        if (!topTris.has(t)) continue;
        for (let k = 0; k < 3; k++) used.add(idx(geometry, t, k));
    }
    if (used.size === 0) return geometry.getAttribute("position").count;
    return Math.max(...used) + 1;
}

/** @internal Regression tests verify bridge rim indices are globally offset. */
export function mergeGeometriesWithWeldedBridge(
    body: BufferGeometry,
    topLoop: Vector3[],
    bottomLoop: Vector3[],
    bridge: BridgeStripResult,
    sourceTopLoop: Vector3[],
    sourceBottomLoop: Vector3[],
    sourceTopIndices: number[],
    sourceBottomIndices: number[],
    topVertexCount: number,
    bottomVertexCount: number,
): { geometry: BufferGeometry; rimTopIndices: number[]; rimBottomIndices: number[] } {
    if (!body) {
        throw new Error(
            "mergeGeometriesWithWeldedBridge requires a body geometry. Do not pre-merge before calling this function.",
        );
    }
    if (topVertexCount <= 0 || bottomVertexCount <= 0) {
        throw new Error(
            `mergeGeometriesWithWeldedBridge requires separate top and bottom vertex ranges. ` +
                `Got topVertexCount=${topVertexCount} bottomVertexCount=${bottomVertexCount}. ` +
                "Pass concatenated [top][bottom] geometry from extractMergedGeometry, not a pre-welded single shell.",
        );
    }
    const bodyVertexCount = body.getAttribute("position").count;
    if (topVertexCount + bottomVertexCount !== bodyVertexCount) {
        throw new Error(
            `mergeGeometriesWithWeldedBridge vertex layout mismatch: top=${topVertexCount} + bottom=${bottomVertexCount} ` +
                `!= body=${bodyVertexCount}. The body must be [top vertices][bottom vertices] without bridge verts.`,
        );
    }
    if (typeof console !== "undefined") {
        console.log(
            `[MESH-CLOSE] mergeGeometriesWithWeldedBridge: top verts=${topVertexCount} bottom verts=${bottomVertexCount}`,
        );
    }

    // MERGED VERTEX BUFFER LAYOUT
    // [0 .. topVertCount-1]                              → top body mesh vertices (copied as-is)
    // [topVertCount .. topVertCount+bottomVertCount-1]   → bottom body vertices
    // [topVertCount+bottomVertCount .. end]              → bridge rim interior + midpoint vertices
    //                                                      (rim contact at endpoints = body indices above)

    const indexed = toIndexed(body);
    const posAttr = indexed.getAttribute("position");
    const bodyCount = posAttr.count;
    const triN = triangleCount(indexed);

    const topContact = buildRimContactIndices(topLoop, sourceTopLoop, sourceTopIndices, 0);
    const bottomContact = buildRimContactIndices(
        bottomLoop,
        sourceBottomLoop,
        sourceBottomIndices,
        topVertexCount,
    );

    const newRimPositions: number[] = [];
    const topBodyIdx: number[] = [];
    let newOffset = bodyCount;

    const allocateNew = (p: Vector3): number => {
        const vi = newOffset++;
        newRimPositions.push(p.x, p.y, p.z);
        return vi;
    };

    let newTopIdx = 0;
    for (let i = 0; i < topContact.rawIndices.length; i++) {
        const raw = topContact.rawIndices[i]!;
        if (raw === NEW_VERTEX) {
            topBodyIdx.push(allocateNew(topContact.newRimVertices[newTopIdx]!));
            newTopIdx++;
        } else {
            topBodyIdx.push(raw);
        }
    }

    let newBottomIdx = 0;
    const bottomBodyIdx: number[] = [];
    for (let i = 0; i < bottomContact.rawIndices.length; i++) {
        const raw = bottomContact.rawIndices[i]!;
        if (raw === NEW_VERTEX) {
            bottomBodyIdx.push(allocateNew(bottomContact.newRimVertices[newBottomIdx]!));
            newBottomIdx++;
        } else {
            bottomBodyIdx.push(raw);
        }
    }

    const bufferSize = bodyCount + newRimPositions.length / 3;
    assertRimContactIndicesInRange(
        topBodyIdx,
        bottomBodyIdx,
        bufferSize,
        topVertexCount,
        bottomVertexCount,
    );
    for (let i = 0; i < topBodyIdx.length; i++) {
        const ti = topBodyIdx[i]!;
        const bi = bottomBodyIdx[i]!;
        if (ti < 0 || ti >= bufferSize) {
            if (indexed !== body) indexed.dispose();
            throw new MeshNotWatertightError(
                `Bridge index out of range: side=top sample=${i} index=${ti} bufferSize=${bufferSize}. This is a bug in buildRimContactIndices.`,
                validateManifold(indexed),
            );
        }
        if (bi < 0 || bi >= bufferSize) {
            if (indexed !== body) indexed.dispose();
            throw new MeshNotWatertightError(
                `Bridge index out of range: side=bottom sample=${i} index=${bi} bufferSize=${bufferSize}. This is a bug in buildRimContactIndices.`,
                validateManifold(indexed),
            );
        }
    }

    const midBodyIdx: number[] = [];
    for (let i = 0; i < bridge.midPerSample.length; i++) {
        const mid = bridge.midPerSample[i]!;
        if (mid < 0) {
            midBodyIdx.push(-1);
            continue;
        }
        const base = mid * 3;
        const vi = newOffset++;
        newRimPositions.push(
            bridge.positions[base]!,
            bridge.positions[base + 1]!,
            bridge.positions[base + 2]!,
        );
        midBodyIdx.push(vi);
    }

    const totalVerts = bodyCount + newRimPositions.length / 3;
    const positions = new Float32Array(totalVerts * 3);
    for (let i = 0; i < bodyCount * 3; i++) positions[i] = (posAttr.array as Float32Array)[i]!;
    for (let i = 0; i < newRimPositions.length; i++) {
        positions[bodyCount * 3 + i] = newRimPositions[i]!;
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
    return { geometry: out, rimTopIndices: topBodyIdx, rimBottomIndices: bottomBodyIdx };
}

function closestPointOnLoopSegment(
    p: Vector3,
    loop: Vector3[],
): { seg: number; point: Vector3; dist: number } {
    let bestSeg = 0;
    let bestPoint = loop[0]!;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ab = new Vector3().subVectors(b, a);
        const len2 = ab.lengthSq();
        if (len2 < 1e-12) continue;
        const t = Math.max(0, Math.min(1, new Vector3().subVectors(p, a).dot(ab) / len2));
        const proj = new Vector3().copy(a).addScaledVector(ab, t);
        const d = p.distanceTo(proj);
        if (d < bestDist) {
            bestDist = d;
            bestSeg = i;
            bestPoint = proj;
        }
    }
    return { seg: bestSeg, point: bestPoint, dist: bestDist };
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

function recomputeNormalsNearSeam(
    geometry: BufferGeometry,
    topLoop: Vector3[],
    bottomLoop: Vector3[],
): void {
    const pos = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (!index) return;

    const near = new Set<number>();
    for (let vi = 0; vi < pos.count; vi++) {
        const p = new Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        const dTop = distancePointToLoop(p, topLoop);
        const dBottom = distancePointToLoop(p, bottomLoop);
        if (dTop <= NORMAL_RECOMPUTE_RADIUS_MM || dBottom <= NORMAL_RECOMPUTE_RADIUS_MM) {
            near.add(vi);
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

const FRAGMENT_STITCH_GAP_MM = 1.0;

/** Distance from point P to the closest point on a closed polyline loop. */
function distancePointToLoop(p: Vector3, loop: Vector3[]): number {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ab = new Vector3().subVectors(b, a);
        const len2 = ab.lengthSq();
        if (len2 < 1e-12) {
            best = Math.min(best, p.distanceTo(a));
            continue;
        }
        const t = Math.max(0, Math.min(1, new Vector3().subVectors(p, a).dot(ab) / len2));
        const proj = new Vector3().copy(a).addScaledVector(ab, t);
        best = Math.min(best, p.distanceTo(proj));
    }
    return best;
}

/** Stitch loop fragments whose endpoints are within `maxGapMm`. */
function stitchNearbyFragments(loops: Vector3[][], maxGapMm = FRAGMENT_STITCH_GAP_MM): Vector3[] | null {
    if (loops.length === 0) return null;
    if (loops.length === 1) return loops[0]!;

    const chains = loops.map((loop) => loop.slice());
    let merged = true;
    while (merged && chains.length > 1) {
        merged = false;
        outer: for (let i = 0; i < chains.length; i++) {
            for (let j = i + 1; j < chains.length; j++) {
                const a = chains[i]!;
                const b = chains[j]!;
                const pairs: Array<[number, number, number]> = [
                    [0, 0, a[0]!.distanceTo(b[0]!)],
                    [0, b.length - 1, a[0]!.distanceTo(b[b.length - 1]!)],
                    [a.length - 1, 0, a[a.length - 1]!.distanceTo(b[0]!)],
                    [a.length - 1, b.length - 1, a[a.length - 1]!.distanceTo(b[b.length - 1]!)],
                ];
                pairs.sort((x, y) => x[2] - y[2]);
                const [ai, bi, dist] = pairs[0]!;
                if (dist > maxGapMm) continue;
                const reversed = ai === a.length - 1 && bi === 0;
                const reversedB = bi === b.length - 1 && ai === 0;
                let next = a.slice();
                const attach = reversedB ? b.slice().reverse() : b.slice();
                if (reversed) next = a.slice().reverse();
                if (ai === next.length - 1) next.push(...attach.slice(1));
                else next.unshift(...attach.slice(0, -1));
                chains.splice(j, 1);
                chains[i] = next;
                merged = true;
                break outer;
            }
        }
    }

    if (chains.length !== 1) return null;
    return chains[0]!;
}

function groupLoopsByMeanZ(loops: Vector3[][]): { high: Vector3[][]; low: Vector3[][] } {
    if (loops.length < 2) return { high: loops, low: loops };
    const scored = loops.map((loop) => {
        const c = new Vector3();
        for (const p of loop) c.add(p);
        c.multiplyScalar(1 / loop.length);
        return { loop, z: c.z };
    });
    scored.sort((a, b) => b.z - a.z);
    const mid = (scored[0]!.z + scored[scored.length - 1]!.z) / 2;
    const high: Vector3[][] = [];
    const low: Vector3[][] = [];
    for (const s of scored) {
        if (s.z >= mid) high.push(s.loop);
        else low.push(s.loop);
    }
    return { high, low };
}

function pickTopBottomLoops(loops: Vector3[][]): { top: Vector3[]; bottom: Vector3[] } | null {
    if (loops.length < 2) return null;

    const { high, low } = groupLoopsByMeanZ(loops);
    const top = stitchNearbyFragments(high);
    const bottom = stitchNearbyFragments(low);
    if (!top || !bottom) {
        if (high.length > 1) throw new BoundaryFragmentedError("top", high.length);
        if (low.length > 1) throw new BoundaryFragmentedError("bottom", low.length);
        return null;
    }
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

/** Extract a vertex-index submesh containing only triangles whose vertices lie in [rangeStart, rangeEnd). */
export function submeshByVertexRange(
    geometry: BufferGeometry,
    rangeStart: number,
    rangeEnd: number,
): BufferGeometry {
    const pos = geometry.getAttribute("position");
    const index = geometry.index;
    if (!index) return geometry.clone();

    const remap = new Map<number, number>();
    const newPos: number[] = [];
    const newIdx: number[] = [];
    const map = (vi: number): number => {
        if (!remap.has(vi)) {
            remap.set(vi, remap.size);
            newPos.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        }
        return remap.get(vi)!;
    };

    for (let t = 0; t < index.count; t += 3) {
        const i0 = index.getX(t);
        const i1 = index.getX(t + 1);
        const i2 = index.getX(t + 2);
        if (i0 < rangeStart || i0 >= rangeEnd) continue;
        if (i1 < rangeStart || i1 >= rangeEnd) continue;
        if (i2 < rangeStart || i2 >= rangeEnd) continue;
        newIdx.push(map(i0), map(i1), map(i2));
    }

    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(new Float32Array(newPos), 3));
    if (newIdx.length > 0) out.setIndex(newIdx);
    return out;
}

/**
 * For multi-mesh GLB bases the bottom shell often has branched boundary graphs (degree-4
 * pinch vertices) that defeat generic loop extraction. The top perimeter is reliable; match
 * each top loop point to the nearest bottom-shell vertex in XY within the bottom index range.
 */
/** Vertex indices in [rangeStart, rangeEnd) that touch at least one open boundary edge. */
function boundaryVertexIndicesInRange(
    geometry: BufferGeometry,
    rangeStart: number,
    rangeEnd: number,
): Set<number> {
    const { edgeCount, edgeVerts } = buildEdgeUsage(geometry);
    const pos = geometry.getAttribute("position");
    const out = new Set<number>();

    for (const [ek, count] of edgeCount) {
        if (count !== 1) continue;
        const pair = edgeVerts.get(ek);
        if (!pair) continue;
        for (const key of pair) {
            const vi = vertexIndexForQuantKeyInRange(geometry, key, rangeStart, rangeEnd);
            if (vi >= 0) out.add(vi);
        }
    }

    // Fallback when boundary keys fail quant lookup (should be rare).
    if (out.size === 0) {
        for (let i = rangeStart; i < rangeEnd; i++) out.add(i);
    }
    return out;
}

function buildBottomLoopFromTopXY(
    geometry: BufferGeometry,
    topLoop: Vector3[],
    topVertexCount: number,
): Vector3[] {
    const pos = geometry.getAttribute("position");
    const total = pos.count;
    const boundaryVerts = boundaryVertexIndicesInRange(geometry, topVertexCount, total);
    const bottomLoop: Vector3[] = [];

    for (const tp of topLoop) {
        let bestVi = topVertexCount;
        let bestD2 = Number.POSITIVE_INFINITY;
        for (const i of boundaryVerts) {
            const dx = pos.getX(i) - tp.x;
            const dy = pos.getY(i) - tp.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
                bestD2 = d2;
                bestVi = i;
            }
        }
        bottomLoop.push(new Vector3(pos.getX(bestVi), pos.getY(bestVi), pos.getZ(bestVi)));
    }

    return bottomLoop;
}

/** Order the outer bottom perimeter from boundary vertices sorted by polar angle in XY. */
function extractOuterBoundaryLoopByAngle(geometry: BufferGeometry): Vector3[] {
    const { edgeCount, edgeVerts } = buildEdgeUsage(geometry);
    const boundaryVerts = new Set<string>();
    for (const [ek, count] of edgeCount) {
        if (count !== 1) continue;
        const pair = edgeVerts.get(ek);
        if (!pair) continue;
        boundaryVerts.add(pair[0]);
        boundaryVerts.add(pair[1]);
    }
    if (boundaryVerts.size < 3) return [];

    const pts = Array.from(boundaryVerts).map((k) => parseKey(k));
    const centroid = new Vector3();
    for (const p of pts) centroid.add(p);
    centroid.multiplyScalar(1 / pts.length);

    pts.sort(
        (a, b) =>
            Math.atan2(a.y - centroid.y, a.x - centroid.x) - Math.atan2(b.y - centroid.y, b.x - centroid.x),
    );
    return pts;
}

/** Add a planar XY cap for one boundary loop using existing mesh vertices where possible. */
function capBoundaryLoopInPlace(geometry: BufferGeometry, loop: Vector3[]): boolean {
    if (loop.length < 3) return false;

    const contour = loop.map((p) => new Vector2(p.x, p.y));
    if (Math.abs(ShapeUtils.area(contour)) < 1e-6) return false;

    let triangulated: number[][];
    try {
        triangulated = ShapeUtils.triangulateShape(contour, []);
    } catch {
        return false;
    }
    if (triangulated.length === 0) return false;

    const index = geometry.index;
    if (!index) return false;

    const loopIndices: number[] = [];
    for (const p of loop) {
        const vi = vertexIndexForQuantKey(geometry, quantKey(p.x, p.y, p.z));
        if (vi < 0) return false;
        loopIndices.push(vi);
    }

    const newIdx = Array.from(index.array as ArrayLike<number>);
    for (const tri of triangulated) {
        newIdx.push(loopIndices[tri[0]!]!, loopIndices[tri[1]!]!, loopIndices[tri[2]!]!);
    }
    geometry.setIndex(newIdx);
    return true;
}

/**
 * Seal any remaining open boundary cycles after the main top/bottom bridge.
 * Stock GLB bottoms often include internal slit boundaries (degree-4 branch nodes)
 * that must be capped separately for watertight STL export.
 */
function capRemainingBoundaryLoops(geometry: BufferGeometry): boolean {
    let cappedAny = false;
    for (let pass = 0; pass < 4; pass++) {
        const report = validateManifold(geometry);
        if (report.isWatertight && report.eulerCharacteristic === 2) break;

        const loops = extractBoundaryLoops(geometry).sort(
            (a, b) => loopPerimeterLength(b) - loopPerimeterLength(a),
        );
        if (loops.length === 0) break;

        let cappedPass = false;
        for (const loop of loops) {
            // Skip the main outer perimeter — already handled by the bridge strip.
            if (loop.length > 512) continue;
            if (capBoundaryLoopInPlace(geometry, loop)) {
                cappedAny = true;
                cappedPass = true;
            }
        }
        if (!cappedPass) break;
    }
    return cappedAny;
}

function sealBottomSlitLoopsBeyondOuterLoop(
    geometry: BufferGeometry,
    topVertexCount: number,
    outerBottomLoop: Vector3[],
): boolean {
    const outerKeys = new Set(outerBottomLoop.map((p) => quantKey(p.x, p.y, p.z)));
    const { edgeCount, edgeVerts } = buildEdgeUsage(geometry);
    const total = geometry.getAttribute("position").count;

    const internalEdges: Array<[string, string]> = [];
    for (const [ek, count] of edgeCount) {
        if (count !== 1) continue;
        const pair = edgeVerts.get(ek);
        if (!pair) continue;
        const inRange = pair.every((key) => {
            const vi = vertexIndexForQuantKeyInRange(geometry, key, topVertexCount, total);
            return vi >= 0;
        });
        if (!inRange) continue;
        if (pair.every((key) => outerKeys.has(key))) continue;
        internalEdges.push(pair);
    }
    if (internalEdges.length === 0) return false;

    const adj = new Map<string, string[]>();
    for (const [a, b] of internalEdges) {
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a)!.push(b);
        adj.get(b)!.push(a);
    }

    const visited = new Set<string>();
    let capped = false;
    for (const [startA, startB] of internalEdges) {
        const startEdge = edgeKey(startA, startB);
        if (visited.has(startEdge)) continue;

        const loopKeys: string[] = [startA];
        let prev = startA;
        let curr = startB;
        visited.add(startEdge);

        for (let guard = 0; guard < internalEdges.length + 2; guard++) {
            loopKeys.push(curr);
            const next = (adj.get(curr) ?? []).find((n) => n !== prev && !visited.has(edgeKey(curr, n)));
            if (!next) break;
            visited.add(edgeKey(curr, next));
            if (next === startA && loopKeys.length >= 3) {
                const loop = loopKeys.map((k) => parseKey(k));
                if (loop.length <= 256 && capBoundaryLoopInPlace(geometry, loop)) capped = true;
                break;
            }
            prev = curr;
            curr = next;
        }
    }
    return capped;
}

/**
 * stored `topVertexCount` split instead of combined-mesh seam heuristics.
 */
function resolveMultiMeshBaseLoops(
    geometry: BufferGeometry,
    topVertexCount: number,
): { top: Vector3[]; bottom: Vector3[] } | null {
    const total = geometry.getAttribute("position").count;
    if (topVertexCount <= 0 || topVertexCount >= total) return null;

    const topSub = submeshByVertexRange(geometry, 0, topVertexCount);
    const topLoop = extractOrderedBoundaryLoop(topSub);
    topSub.dispose();

    if (topLoop.length < 3) return null;

    const bottomLoop = buildBottomLoopFromTopXY(geometry, topLoop, topVertexCount);
    if (bottomLoop.length < 3) return null;

    return { top: topLoop, bottom: bottomLoop };
}

function resolveTopBottomLoops(geometry: BufferGeometry): { top: Vector3[]; bottom: Vector3[] } | null {
    const boundaryLoops = extractBoundaryLoops(geometry);
    const fromBoundary = pickTopBottomLoops(boundaryLoops);
    if (fromBoundary) return fromBoundary;

    const userData = geometry.userData as { isMultiMeshBase?: boolean; topVertexCount?: number };
    const storedTop = userData.topVertexCount;
    if (userData.isMultiMeshBase && storedTop && storedTop > 0 && storedTop < geometry.getAttribute("position").count) {
        const multi = resolveMultiMeshBaseLoops(geometry, storedTop);
        if (multi) return multi;
    }

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
            topLoop: [],
            bottomLoop: [],
            seamTopIndices: [],
            weldTopIndices: [],
            weldBottomIndices: [],
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

    const storedTopForSlits = (working.userData as { isMultiMeshBase?: boolean; topVertexCount?: number })
        .topVertexCount;
    if (
        (working.userData as { isMultiMeshBase?: boolean }).isMultiMeshBase &&
        storedTopForSlits &&
        storedTopForSlits > 0
    ) {
        sealBottomSlitLoopsBeyondOuterLoop(working, storedTopForSlits, pair.bottom);
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

    const bodyVertexCount = working.getAttribute("position").count;
    const storedTop = (working.userData as { topVertexCount?: number }).topVertexCount;
    const topVertexCount =
        storedTop && storedTop > 0 && storedTop < bodyVertexCount
            ? storedTop
            : inferTopVertexCount(working);
    const bottomVertexCount = bodyVertexCount - topVertexCount;

    const sourceTopIndices = boundaryLoopVertexIndicesLocal(working, pair.top, 0, topVertexCount);
    const sourceBottomIndices = boundaryLoopVertexIndicesLocal(
        working,
        pair.bottom,
        topVertexCount,
        bodyVertexCount,
    );

    const bridge = generateBridgeStrip(topLoop, bottomLoop);
    smoothBridgeStrip(
        bridge.positions,
        bridge.midPerSample,
        bridge.topIdx,
        bridge.bottomIdx,
        BRIDGE_SMOOTH_ITERATIONS,
        BRIDGE_SMOOTH_STRENGTH,
    );

    const { geometry: merged, rimTopIndices: weldTopIndices, rimBottomIndices: weldBottomIndices } =
        mergeGeometriesWithWeldedBridge(
            working,
            topLoop,
            bottomLoop,
            bridge,
            pair.top,
            pair.bottom,
            sourceTopIndices,
            sourceBottomIndices,
            topVertexCount,
            bottomVertexCount,
        );
    if (disposed) working.dispose();
    const seamTopIndices = orderSeamRingIndices(
        merged,
        Array.from(new Set(weldTopIndices.filter((i) => i >= 0))),
    );
    merged.computeVertexNormals();
    recomputeNormalsNearSeam(merged, topLoop, bottomLoop);
    smoothSeamVertexNormals(merged, seamTopIndices, 2);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();

    if (typeof console !== "undefined") {
        const belowTop = weldBottomIndices.filter((i) => i >= 0 && i < topVertexCount).length;
        const minBot = weldBottomIndices.length > 0 ? Math.min(...weldBottomIndices) : -1;
        console.log(
            `[MESH-CLOSE] pre-validate: weldBottom belowTop=${belowTop} minBotIndex=${minBot} topVertexCount=${topVertexCount}`,
        );
    }

    const report = validateManifold(merged);
    if (!report.isWatertight || report.eulerCharacteristic !== 2) {
        throw new MeshNotWatertightError(
            `Mesh closure failed: openEdges=${report.openEdges} nonManifold=${report.nonManifoldEdges} euler=${report.eulerCharacteristic}`,
            report,
        );
    }

    if (typeof console !== "undefined") {
        console.log(
            `[MESH-CLOSE] closure complete: V=${report.vertexCount} E=${report.edgeCount} F=${report.triangleCount} Euler=${report.eulerCharacteristic} Watertight=${report.isWatertight}`,
        );
    }

    return {
        geometry: merged,
        report,
        bridgeTriangleCount: bridge.triangleCount,
        smoothingIterations: BRIDGE_SMOOTH_ITERATIONS,
        rimHeightsMm,
        topLoop,
        bottomLoop,
        seamTopIndices,
        weldTopIndices,
        weldBottomIndices,
    };
}

/**
 * Closes a multi-mesh GLB insole into a watertight solid by bridging top and
 * bottom rim loops extracted from each sub-mesh separately — never runs
 * full-mesh boundary resolution on the combined vertex buffer.
 */
export function closeGlbInsoleToSolid(geometry: BufferGeometry): BufferGeometry {
    const precheck = validateManifold(geometry);
    if (precheck.isWatertight && precheck.eulerCharacteristic === 2) {
        const clone = geometry.clone();
        if (geometry.userData) clone.userData = { ...geometry.userData };
        return clone;
    }

    const bodyVertexCount = geometry.getAttribute("position").count;
    const userData = geometry.userData as { isMultiMeshBase?: boolean; topVertexCount?: number };
    const storedTop = userData.topVertexCount;
    const topVertexCount =
        storedTop && storedTop > 0 && storedTop < bodyVertexCount
            ? storedTop
            : userData.isMultiMeshBase
              ? inferTopVertexCount(geometry)
              : 0;

    if (!userData.isMultiMeshBase || topVertexCount <= 0) {
        const result = closeMeshPerimeter(geometry);
        const out = result.geometry;
        if (geometry.userData) out.userData = { ...geometry.userData };
        return out;
    }

    const bottomVertexCount = bodyVertexCount - topVertexCount;
    const topSub = submeshByVertexRange(geometry, 0, topVertexCount);
    const botSub = submeshByVertexRange(geometry, topVertexCount, bodyVertexCount);

    try {
        const topRawLoop = extractOrderedBoundaryLoop(topSub);
        const botRawLoop = extractOrderedBoundaryLoop(botSub);

        if (topRawLoop.length < 3 || botRawLoop.length < 3) {
            throw new MeshNotWatertightError(
                `[MESH-CLOSE] rim loop too short: top=${topRawLoop.length} bot=${botRawLoop.length}`,
                precheck,
            );
        }

        if (typeof console !== "undefined") {
            const topBB = new Box3();
            topRawLoop.forEach((v) => topBB.expandByPoint(v));
            const botBB = new Box3();
            botRawLoop.forEach((v) => botBB.expandByPoint(v));
            console.log(
                "[RIM-DIAG] topLoop BB:",
                JSON.stringify({
                    minX: topBB.min.x.toFixed(1),
                    maxX: topBB.max.x.toFixed(1),
                    minY: topBB.min.y.toFixed(1),
                    maxY: topBB.max.y.toFixed(1),
                    minZ: topBB.min.z.toFixed(1),
                    maxZ: topBB.max.z.toFixed(1),
                }),
            );
            console.log(
                "[RIM-DIAG] botLoop BB:",
                JSON.stringify({
                    minX: botBB.min.x.toFixed(1),
                    maxX: botBB.max.x.toFixed(1),
                    minY: botBB.min.y.toFixed(1),
                    maxY: botBB.max.y.toFixed(1),
                    minZ: botBB.min.z.toFixed(1),
                    maxZ: botBB.max.z.toFixed(1),
                }),
            );

            console.log("[RIM-DIAG] topLoop verts:", topRawLoop.length);
            console.log("[RIM-DIAG] botLoop verts:", botRawLoop.length);

            const topYMin = Math.min(...topRawLoop.map((v) => v.y));
            const topYMax = Math.max(...topRawLoop.map((v) => v.y));
            const botYMin = Math.min(...botRawLoop.map((v) => v.y));
            const botYMax = Math.max(...botRawLoop.map((v) => v.y));
            console.log("[RIM-DIAG] top Y range:", topYMin.toFixed(3), "to", topYMax.toFixed(3));
            console.log("[RIM-DIAG] bot Y range:", botYMin.toFixed(3), "to", botYMax.toFixed(3));
            const yOverlap = Math.min(topYMax, botYMax) - Math.max(topYMin, botYMin);
            console.log("[RIM-DIAG] Y overlap (positive=gap, negative=inversion):", yOverlap.toFixed(3));

            const sampleN = 8;
            for (let i = 0; i < sampleN; i++) {
                const ti = Math.floor((i * topRawLoop.length) / sampleN);
                const bi = Math.floor((i * botRawLoop.length) / sampleN);
                const tv = topRawLoop[ti]!;
                const bv = botRawLoop[bi]!;
                console.log(
                    `[RIM-DIAG] sample ${i}: top=(${tv.x.toFixed(1)},${tv.y.toFixed(1)},${tv.z.toFixed(1)}) bot=(${bv.x.toFixed(1)},${bv.y.toFixed(1)},${bv.z.toFixed(1)})`,
                );
            }

            const inversionCount = topRawLoop.filter((v) => v.y < botYMin).length;
            console.log(
                "[RIM-DIAG] top rim verts BELOW bot rim min Y:",
                inversionCount,
                "/",
                topRawLoop.length,
                `(${(inversionCount / topRawLoop.length) * 100).toFixed(1)}%)`,
            );

            console.log(
                "[RIM-DIAG] parent userData.topVertexCount:",
                (geometry.userData as { topVertexCount?: number }).topVertexCount,
            );
            console.log("[RIM-DIAG] topSub position count:", topSub.getAttribute("position").count);
            console.log("[RIM-DIAG] botSub position count:", botSub.getAttribute("position").count);
        }

        sealBottomSlitLoopsBeyondOuterLoop(geometry, topVertexCount, botRawLoop);

        const targetN = Math.max(topRawLoop.length, botRawLoop.length);
        let topLoop = resampleLoop(topRawLoop, targetN);
        let botLoop = resampleLoop(botRawLoop, targetN);

        if (typeof console !== "undefined") {
            console.log(`[MESH-CLOSE] resampled loops: top=${targetN} bot=${targetN}`);
        }

        const winding = alignLoopWindingXZ(topLoop, botLoop);
        topLoop = winding.topLoop;
        botLoop = alignLoopStartToReference(topLoop, winding.botLoop);

        if (typeof console !== "undefined") {
            console.log(`[MESH-CLOSE] winding aligned: ${winding.windingAligned}`);
        }

        const snappedTop = snapLoopToBoundaryVertices(geometry, topLoop, 0, topVertexCount);
        const snappedBot = snapLoopToBoundaryVertices(
            geometry,
            botLoop,
            topVertexCount,
            bodyVertexCount,
        );
        topLoop = snappedTop.positions;
        botLoop = snappedBot.positions;

        const topVal = validateLoop(topLoop, loopPerimeterLength(topLoop) / targetN * 2);
        const bottomVal = validateLoop(botLoop, loopPerimeterLength(botLoop) / targetN * 2);
        if (!topVal.ok || !bottomVal.ok) {
            throw new MeshNotWatertightError(
                `closeGlbInsoleToSolid: boundary loop validation failed: top=${topVal.reason ?? "ok"}, bottom=${bottomVal.reason ?? "ok"}`,
                precheck,
            );
        }

        const rimHeightsMm = measureRimHeights(topLoop, botLoop);
        for (const h of rimHeightsMm) {
            if (h < RIM_HEIGHT_MIN_WARNING_MM && typeof console !== "undefined") {
                console.warn(
                    `[mesh-close] rim height ${h.toFixed(3)}mm < ${RIM_HEIGHT_MIN_WARNING_MM}mm — may look pinched`,
                );
            }
        }

        const bridge = buildBridgeStrip(topLoop, botLoop);
        if (typeof console !== "undefined") {
            console.log(`[MESH-CLOSE] bridge strip: tris=${bridge.triangleCount}`);
        }

        const { geometry: merged, rimTopIndices: weldTopIndices } = mergeGeometriesWithWeldedBridge(
            geometry,
            topLoop,
            botLoop,
            bridge,
            topLoop,
            botLoop,
            snappedTop.localIndices,
            snappedBot.localIndices,
            topVertexCount,
            bottomVertexCount,
        );

        const seamTopIndices = orderSeamRingIndices(
            merged,
            Array.from(new Set(weldTopIndices.filter((i) => i >= 0))),
        );
        merged.computeVertexNormals();
        recomputeNormalsNearSeam(merged, topLoop, botLoop);
        smoothSeamVertexNormals(merged, seamTopIndices, 2);
        merged.computeBoundingBox();
        merged.computeBoundingSphere();

        const report = validateManifold(merged);
        if (!report.isWatertight || report.eulerCharacteristic !== 2) {
            merged.dispose();
            throw new MeshNotWatertightError(
                `closeGlbInsoleToSolid failed: openEdges=${report.openEdges} nonManifold=${report.nonManifoldEdges} euler=${report.eulerCharacteristic}`,
                report,
            );
        }

        if (typeof console !== "undefined") {
            console.log(`[MESH-CLOSE] solid complete: total verts=${merged.getAttribute("position").count}`);
            console.log(
                `[MESH-CLOSE] closeGlbInsoleToSolid complete: V=${report.vertexCount} openEdges=${report.openEdges} Euler=${report.eulerCharacteristic}`,
            );
        }

        if (geometry.userData) merged.userData = { ...geometry.userData };
        return merged;
    } finally {
        topSub.dispose();
        botSub.dispose();
    }
}

/**
 * Export-time helper: close multi-mesh base geometry when the perimeter is open.
 * Preserves geometry when already watertight.
 */
export function ensureWatertightForExport(geometry: BufferGeometry): BufferGeometry {
    const userData = geometry.userData as { isMultiMeshBase?: boolean; topVertexCount?: number };
    const bodyVertexCount = geometry.getAttribute("position").count;
    const storedTop = userData.topVertexCount;
    const topVerts =
        storedTop && storedTop > 0 && storedTop < bodyVertexCount
            ? storedTop
            : userData.isMultiMeshBase
              ? inferTopVertexCount(geometry)
              : bodyVertexCount;
    const bottomVerts = userData.isMultiMeshBase ? Math.max(0, bodyVertexCount - topVerts) : 0;

    if (typeof console !== "undefined") {
        console.log(
            `[MESH-CLOSE] ensureWatertightForExport called: topVerts=${topVerts} bottomVerts=${bottomVerts}`,
        );
    }

    const pre = validateManifold(geometry);
    const isMultiMesh = !!userData.isMultiMeshBase;
    const needsClosure =
        isMultiMesh &&
        (!pre.isWatertight || pre.eulerCharacteristic !== 2 || pre.openEdges > 0);

    if (!needsClosure) return geometry;

    const savedUserData = geometry.userData ? { ...geometry.userData } : undefined;
    const closed = isMultiMesh ? closeGlbInsoleToSolid(geometry) : closeMeshPerimeter(geometry).geometry;
    if (closed !== geometry) {
        geometry.dispose();
    }
    if (savedUserData) {
        closed.userData = savedUserData;
    }
    return closed;
}

/** @internal Heal internal slit boundaries on a GLB shell before top/bottom concatenation. */
export function healShellInternalBoundaries(geometry: BufferGeometry): boolean {
    const cycles = extractAllBoundaryCycles(geometry);
    const loops =
        cycles.length > 0
            ? cycles
            : extractBoundaryLoops(geometry);
    if (loops.length === 0) return false;

    let capped = false;
    for (const loop of loops) {
        if (loop.length > 256) continue;
        if (capBoundaryLoopInPlace(geometry, loop)) capped = true;
    }
    return capped;
}

/** @internal Exposes branched boundary cycle extraction for regression tests. */
export function extractAllBoundaryCyclesForTest(geometry: BufferGeometry): Vector3[][] {
    return extractAllBoundaryCycles(geometry);
}

/** Max angle between adjacent vertex normals along the welded seam ring (shading smoothness proxy). */
export function maxSeamVertexNormalDiscontinuityDeg(
    geometry: BufferGeometry,
    seamTopIndices: number[],
): number {
    const nor = geometry.getAttribute("normal");
    if (!nor || seamTopIndices.length < 2) return 0;

    let maxDeg = 0;
    for (let i = 0; i < seamTopIndices.length; i++) {
        const a = seamTopIndices[i]!;
        const b = seamTopIndices[(i + 1) % seamTopIndices.length]!;
        const na = new Vector3(nor.getX(a), nor.getY(a), nor.getZ(a)).normalize();
        const nb = new Vector3(nor.getX(b), nor.getY(b), nor.getZ(b)).normalize();
        const dot = Math.max(-1, Math.min(1, na.dot(nb)));
        maxDeg = Math.max(maxDeg, (Math.acos(dot) * 180) / Math.PI);
    }
    return maxDeg;
}

/** Max XY distance from bridge midpoint vertices to the perimeter loop (clinical guard). */
export function maxBridgeMidpointDistanceFromPerimeterMm(
    geometry: BufferGeometry,
    topLoop: Vector3[],
    bottomLoop: Vector3[],
): number {
    const pos = geometry.getAttribute("position");
    let maxD = 0;
    for (let i = 0; i < pos.count; i++) {
        const p = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
        const dTop = distancePointToLoop(p, topLoop);
        const dBot = distancePointToLoop(p, bottomLoop);
        if (dTop > 0.5 && dBot > 0.5) continue;
        const zTop = topLoop[0] ? topLoop.reduce((s, v, j) => {
            const d = Math.hypot(v.x - p.x, v.y - p.y);
            return d < Math.hypot(topLoop[s]!.x - p.x, topLoop[s]!.y - p.y) ? j : s;
        }, 0) : 0;
        const zLo = bottomLoop[zTop]?.z ?? 0;
        const zHi = topLoop[zTop]?.z ?? p.z;
        if (p.z <= zLo + 0.05 || p.z >= zHi - 0.05) continue;
        maxD = Math.max(maxD, Math.min(dTop, dBot));
    }
    return maxD;
}

/** True when bridge-wall face normals point outward from mesh centroid. */
export function bridgeNormalsPointOutward(geometry: BufferGeometry, topLoop: Vector3[], bottomLoop: Vector3[]): boolean {
    const pos = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (!index) return true;

    const centroid = new Vector3();
    for (const p of topLoop) centroid.add(p);
    for (const p of bottomLoop) centroid.add(p);
    centroid.multiplyScalar(1 / (topLoop.length + bottomLoop.length));

    const isBridgeWallTri = (i0: number, i1: number, i2: number): boolean => {
        const p0 = new Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
        const p1 = new Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
        const p2 = new Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
        const nearTop = [p0, p1, p2].some((p) => distancePointToLoop(p, topLoop) < 0.75);
        const nearBot = [p0, p1, p2].some((p) => distancePointToLoop(p, bottomLoop) < 0.75);
        const spans = nearTop && nearBot;
        const mid = [p0, p1, p2].some((p) => {
            const dT = distancePointToLoop(p, topLoop);
            const dB = distancePointToLoop(p, bottomLoop);
            return dT < 0.75 && dB < 0.75 && p.z > bottomLoop[0]!.z + 0.1 && p.z < topLoop[0]!.z - 0.1;
        });
        return spans || mid;
    };

    const triN = index.count / 3;
    for (let t = 0; t < triN; t++) {
        const i0 = index.getX(t * 3);
        const i1 = index.getX(t * 3 + 1);
        const i2 = index.getX(t * 3 + 2);
        if (!isBridgeWallTri(i0, i1, i2)) continue;
        const a = new Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
        const b = new Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
        const c = new Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
        const center = new Vector3().addVectors(a, b).add(c).multiplyScalar(1 / 3);
        const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
        const outward = new Vector3().subVectors(center, centroid);
        if (n.dot(outward) <= 0) return false;
    }
    return true;
}

/** True when consecutive welded seam vertices are mesh-adjacent (no chord-snap jumps). */
export function bridgeWeldRingIsAdjacent(geometry: BufferGeometry, seamTopIndices: number[]): boolean {
    if (seamTopIndices.length < 2) return true;
    const adj = buildVertexAdjacency(geometry);
    for (let i = 0; i < seamTopIndices.length; i++) {
        const a = seamTopIndices[i]!;
        const b = seamTopIndices[(i + 1) % seamTopIndices.length]!;
        if (a === b) continue;
        if (!adj[a]!.includes(b)) return false;
    }
    return true;
}

/** Max distance from welded rim vertex positions to their loop polyline. */
export function maxWeldVertexLoopDistanceMm(
    geometry: BufferGeometry,
    loop: Vector3[],
    weldIndices: number[],
): number {
    const pos = geometry.getAttribute("position");
    let maxD = 0;
    for (const vi of new Set(weldIndices.filter((i) => i >= 0))) {
        const p = new Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        maxD = Math.max(maxD, distancePointToLoop(p, loop));
    }
    return maxD;
}
