// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { analyzeManifold } from "@/lib/geometry/manifold";

const INNER_SLIT_MAX_ARC_MM = 5;
const INNER_SLIT_CLOSE_MM = 2;

function indexEdgeKey(a: number, b: number): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function vertexAt(positions: Float32Array, vi: number, target = new Vector3()): Vector3 {
    const base = vi * 3;
    return target.set(positions[base]!, positions[base + 1]!, positions[base + 2]!);
}

function buildIndexBoundaryGraph(geometry: BufferGeometry): {
    edgeCount: Map<string, number>;
    edgeVerts: Map<string, [number, number]>;
    adj: Map<number, number[]>;
} {
    const index = geometry.getIndex();
    if (!index) {
        return { edgeCount: new Map(), edgeVerts: new Map(), adj: new Map() };
    }

    const edgeCount = new Map<string, number>();
    const edgeVerts = new Map<string, [number, number]>();
    for (let t = 0; t < index.count; t += 3) {
        const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
        for (let i = 0; i < 3; i++) {
            const a = tri[i]!;
            const b = tri[(i + 1) % 3]!;
            const ek = indexEdgeKey(a, b);
            edgeCount.set(ek, (edgeCount.get(ek) ?? 0) + 1);
            if (!edgeVerts.has(ek)) edgeVerts.set(ek, [a, b]);
        }
    }

    const adj = new Map<number, number[]>();
    for (const [ek, count] of edgeCount) {
        if (count !== 1) continue;
        const [a, b] = edgeVerts.get(ek)!;
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a)!.push(b);
        adj.get(b)!.push(a);
    }

    return { edgeCount, edgeVerts, adj };
}

function chainArcLength(chain: number[], positions: Float32Array): number {
    let len = 0;
    const a = new Vector3();
    const b = new Vector3();
    for (let i = 0; i < chain.length - 1; i++) {
        len += vertexAt(positions, chain[i]!, a).distanceTo(vertexAt(positions, chain[i + 1]!, b));
    }
    return len;
}

/** Duplicate branch vertices so each boundary edge pair gets a unique endpoint. */
export function splitDegree4BranchNodes(geometry: BufferGeometry): BufferGeometry {
    const pos = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (!index) return geometry;

    const { edgeVerts, adj } = buildIndexBoundaryGraph(geometry);
    const branchNodes = [...adj.entries()].filter(([, neighbors]) => neighbors.length === 4).map(([vi]) => vi);
    if (branchNodes.length === 0) return geometry;

    const positions = Array.from(pos.array as Float32Array);
    const indices = Array.from(index.array as ArrayLike<number>);
    let nextVert = pos.count;

    for (const src of branchNodes) {
        const neighbors = adj.get(src) ?? [];
        if (neighbors.length !== 4) continue;

        for (const nb of neighbors) {
            const vi = nextVert++;
            const srcBase = src * 3;
            positions.push(positions[srcBase]!, positions[srcBase + 1]!, positions[srcBase + 2]!);
            const targetEk = indexEdgeKey(src, nb);

            for (let t = 0; t < indices.length; t += 3) {
                const tri = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
                for (let k = 0; k < 3; k++) {
                    const a = tri[k]!;
                    const b = tri[(k + 1) % 3]!;
                    if (indexEdgeKey(a, b) !== targetEk) continue;
                    if (a === src) indices[t + k] = vi;
                    else if (b === src) indices[t + ((k + 1) % 3)] = vi;
                }
            }
        }
    }

    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    out.setIndex(indices);
    const normal = geometry.getAttribute("normal");
    if (normal) {
        const normals = new Float32Array(nextVert * 3);
        normals.set(normal.array as Float32Array, 0);
        out.setAttribute("normal", new BufferAttribute(normals, 3));
    }
    if (geometry.userData) out.userData = { ...geometry.userData };
    return out;
}

function capNearClosedChain(geometry: BufferGeometry, chain: number[]): boolean {
    if (chain.length < 3) return false;

    const pos = geometry.getAttribute("position");
    const positions = pos.array as Float32Array;
    const start = vertexAt(positions, chain[0]!);
    const end = vertexAt(positions, chain[chain.length - 1]!);
    if (start.distanceTo(end) > INNER_SLIT_CLOSE_MM) return false;

    const index = geometry.getIndex();
    if (!index) return false;

    const centroid = new Vector3();
    for (const vi of chain) centroid.add(vertexAt(positions, vi));
    centroid.multiplyScalar(1 / chain.length);

    const centerVi = pos.count;
    const nextPositions = new Float32Array((pos.count + 1) * 3);
    nextPositions.set(positions, 0);
    nextPositions[centerVi * 3] = centroid.x;
    nextPositions[centerVi * 3 + 1] = centroid.y;
    nextPositions[centerVi * 3 + 2] = centroid.z;

    const newIdx = Array.from(index.array as ArrayLike<number>);
    for (let i = 0; i < chain.length; i++) {
        const a = chain[i]!;
        const b = chain[(i + 1) % chain.length]!;
        newIdx.push(centerVi, a, b);
    }

    geometry.setAttribute("position", new BufferAttribute(nextPositions, 3));
    geometry.setIndex(newIdx);
    return true;
}

function extractBoundaryChains(geometry: BufferGeometry): number[][] {
    const { edgeCount, edgeVerts, adj } = buildIndexBoundaryGraph(geometry);
    const visitedEdges = new Set<string>();
    const chains: number[][] = [];

    for (const [ek, count] of edgeCount) {
        if (count !== 1 || visitedEdges.has(ek)) continue;
        const [startA, startB] = edgeVerts.get(ek)!;
        const chain = [startA, startB];
        visitedEdges.add(ek);
        let prev = startA;
        let curr = startB;

        for (let guard = 0; guard < edgeCount.size + 4; guard++) {
            const next = (adj.get(curr) ?? []).find(
                (n) => n !== prev && !visitedEdges.has(indexEdgeKey(curr, n)),
            );
            if (next === undefined) break;
            visitedEdges.add(indexEdgeKey(curr, next));
            if (next === startA) break;
            chain.push(next);
            prev = curr;
            curr = next;
        }
        chains.push(chain);
    }

    return chains;
}

/** @internal Test hook for boundary chain extraction. */
export function extractBoundaryChainsForTest(geometry: BufferGeometry): number[][] {
    return extractBoundaryChains(geometry);
}

/**
 * Viewer-only bottom shell cleanup: seal small internal slit loops and split
 * degree-4 branch nodes. Does NOT run before the OCCT manufacturing path.
 */
export function sealInternalSlits(geometry: BufferGeometry): BufferGeometry {
    const before = analyzeManifold(geometry).openEdges;
    let working = splitDegree4BranchNodes(geometry);
    if (working !== geometry) geometry.dispose();

    const positions = working.getAttribute("position").array as Float32Array;
    const chains = extractBoundaryChains(working);
    if (chains.length === 0) {
        if (typeof console !== "undefined") {
            console.log(`[BOTTOM-CLEAN] open edges before=${before} after=${before}`);
        }
        return working;
    }

    const sorted = chains.slice().sort((a, b) => chainArcLength(b, positions) - chainArcLength(a, positions));
    const outer = sorted[0]!;

    for (let i = 1; i < sorted.length; i++) {
        const chain = sorted[i]!;
        const arc = chainArcLength(chain, positions);
        if (arc >= INNER_SLIT_MAX_ARC_MM) {
            if (typeof console !== "undefined") {
                console.warn(
                    `[BOTTOM-CLEAN] skipping large internal slit (arc=${arc.toFixed(2)}mm, verts=${chain.length})`,
                );
            }
            continue;
        }
        capNearClosedChain(working, chain);
    }

    const after = analyzeManifold(working).openEdges;
    if (typeof console !== "undefined") {
        console.log(
            `[BOTTOM-CLEAN] open edges before=${before} after=${after} outerChainVerts=${outer.length}`,
        );
    }
    return working;
}
