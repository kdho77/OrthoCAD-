// Frozen measurement copied from BASE 268aac85847160b5b2703a05688721ea4cb93b24
// (vertex/src/lib/geometry/mesh-close.ts). The candidate's own counter is not
// the number these gates compare to the threshold.
// biome-ignore-all lint/style/noNonNullAssertion: frozen copy of the BASE counter
import { type BufferGeometry, Vector3 } from "three";

const QUANT = 1e4;
const HEEL_BRIDGE_Y_MAX_MM = 80;

function quantKey(x: number, y: number, z: number): string {
    return `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`;
}

function edgeKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface FrozenManifold {
    openEdges: number;
    nonManifoldEdges: number;
    isWatertight: boolean;
    eulerCharacteristic: number;
    triangleCount: number;
    vertexCount: number;
}

/** Same watertight bit as analyzeManifold, plus the V−E+F euler of those welded edges. */
export function frozenManifold(geometry: BufferGeometry): FrozenManifold {
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (!position) {
        return {
            openEdges: -1,
            nonManifoldEdges: -1,
            isWatertight: false,
            eulerCharacteristic: 0,
            triangleCount: 0,
            vertexCount: 0,
        };
    }
    const triangleCount = index ? index.count / 3 : position.count / 3;
    const edgeCount = new Map<string, number>();
    const verts = new Set<string>();
    const key = (i: number) => quantKey(position.getX(i), position.getY(i), position.getZ(i));
    const at = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    for (let t = 0; t < triangleCount; t++) {
        const ka = key(at(t, 0));
        const kb = key(at(t, 1));
        const kc = key(at(t, 2));
        verts.add(ka);
        verts.add(kb);
        verts.add(kc);
        for (const [a, b] of [
            [ka, kb],
            [kb, kc],
            [kc, ka],
        ] as const) {
            const ek = edgeKey(a, b);
            edgeCount.set(ek, (edgeCount.get(ek) ?? 0) + 1);
        }
    }
    let openEdges = 0;
    let nonManifoldEdges = 0;
    for (const count of edgeCount.values()) {
        if (count === 1) openEdges++;
        else if (count > 2) nonManifoldEdges++;
    }
    return {
        openEdges,
        nonManifoldEdges,
        isWatertight: openEdges === 0 && nonManifoldEdges === 0,
        eulerCharacteristic: verts.size - edgeCount.size + triangleCount,
        triangleCount,
        vertexCount: position.count,
    };
}

function triTriIntersect(t1: [Vector3, Vector3, Vector3], t2: [Vector3, Vector3, Vector3]): boolean {
    const eps = 1e-8;
    const edges1 = [
        new Vector3().subVectors(t1[1], t1[0]),
        new Vector3().subVectors(t1[2], t1[1]),
        new Vector3().subVectors(t1[0], t1[2]),
    ];
    const edges2 = [
        new Vector3().subVectors(t2[1], t2[0]),
        new Vector3().subVectors(t2[2], t2[1]),
        new Vector3().subVectors(t2[0], t2[2]),
    ];
    const n1 = new Vector3().crossVectors(edges1[0]!, edges1[2]!.clone().negate()).normalize();
    const n2 = new Vector3().crossVectors(edges2[0]!, edges2[2]!.clone().negate()).normalize();
    const axes: Vector3[] = [n1, n2];
    for (const e1 of edges1) {
        for (const e2 of edges2) {
            axes.push(new Vector3().crossVectors(e1, e2));
        }
    }
    for (const axis of axes) {
        if (axis.lengthSq() < eps) continue;
        let min1 = Infinity;
        let max1 = -Infinity;
        let min2 = Infinity;
        let max2 = -Infinity;
        for (const p of t1) {
            const d = p.dot(axis);
            min1 = Math.min(min1, d);
            max1 = Math.max(max1, d);
        }
        for (const p of t2) {
            const d = p.dot(axis);
            min2 = Math.min(min2, d);
            max2 = Math.max(max2, d);
        }
        if (max1 < min2 - eps || max2 < min1 - eps) return false;
    }
    return true;
}

function sharesVertexIndices(a: number[], b: number[]): boolean {
    return a.some((v) => b.includes(v));
}

export interface FrozenHeelBridge {
    heelBridgeSelfIntersections: number;
    bridgeTriangles: number;
}

/** Pairwise SAT count of heel-band bridge triangles. topVertexCount <= 0 cannot report 0 as a pass. */
export function frozenHeelBridge(geometry: BufferGeometry, topVertexCount: number): FrozenHeelBridge {
    const index = geometry.index;
    const pos = geometry.getAttribute("position");
    if (!index || !pos || topVertexCount <= 0) {
        return { heelBridgeSelfIntersections: -1, bridgeTriangles: 0 };
    }
    const arr = pos.array as ArrayLike<number>;
    const getV = (vi: number) => new Vector3(arr[vi * 3]!, arr[vi * 3 + 1]!, arr[vi * 3 + 2]!);
    type BridgeTri = { i: [number, number, number]; v: [Vector3, Vector3, Vector3] };
    const bridge: BridgeTri[] = [];
    const triCount = index.count / 3;
    for (let t = 0; t < triCount; t++) {
        const ia = index.getX(t * 3);
        const ib = index.getX(t * 3 + 1);
        const ic = index.getX(t * 3 + 2);
        const nTop =
            (ia < topVertexCount ? 1 : 0) + (ib < topVertexCount ? 1 : 0) + (ic < topVertexCount ? 1 : 0);
        const nBot =
            (ia >= topVertexCount ? 1 : 0) + (ib >= topVertexCount ? 1 : 0) + (ic >= topVertexCount ? 1 : 0);
        if (nTop === 0 || nBot === 0) continue;
        const va = getV(ia);
        const vb = getV(ib);
        const vc = getV(ic);
        const ymin = Math.min(va.y, vb.y, vc.y);
        if (ymin >= HEEL_BRIDGE_Y_MAX_MM) continue;
        bridge.push({ i: [ia, ib, ic], v: [va, vb, vc] });
    }
    let count = 0;
    for (let i = 0; i < bridge.length; i++) {
        for (let j = i + 1; j < bridge.length; j++) {
            if (sharesVertexIndices(bridge[i]!.i, bridge[j]!.i)) continue;
            if (triTriIntersect(bridge[i]!.v, bridge[j]!.v)) count++;
        }
    }
    return { heelBridgeSelfIntersections: count, bridgeTriangles: bridge.length };
}
