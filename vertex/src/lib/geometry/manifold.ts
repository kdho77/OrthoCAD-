import type { BufferGeometry } from "three";

// Mesh manifold analysis. A closed (watertight) solid is two-manifold: every
// edge is shared by exactly two triangles. We key edges by quantized vertex
// position so coincident-but-unwelded vertices still match.

export interface ManifoldReport {
    triangleCount: number;
    vertexCount: number;
    openEdges: number; // edges used by exactly one triangle (boundary)
    nonManifoldEdges: number; // edges used by 3+ triangles
    isWatertight: boolean;
}

const QUANT = 1e4; // 0.0001 mm precision
/** Weld ids stay below this so min*STRIDE+max does not collide. */
const MANIFOLD_ID_STRIDE = 2_097_152;

export function analyzeManifold(geometry: BufferGeometry): ManifoldReport {
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const triangleCount = index ? index.count / 3 : position.count / 3;
    const idx = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    const idOf = new Int32Array(position.count);
    const xMap = new Map<number, Map<number, Map<number, number>>>();
    let nextId = 1;
    const idFor = (i: number): number => {
        const cached = idOf[i] ?? 0;
        if (cached) return cached;
        const x = Math.round(position.getX(i) * QUANT);
        const y = Math.round(position.getY(i) * QUANT);
        const z = Math.round(position.getZ(i) * QUANT);
        let yz = xMap.get(x);
        if (!yz) {
            yz = new Map();
            xMap.set(x, yz);
        }
        let zs = yz.get(y);
        if (!zs) {
            zs = new Map();
            yz.set(y, zs);
        }
        let id = zs.get(z);
        if (id === undefined) {
            id = nextId++;
            zs.set(z, id);
        }
        idOf[i] = id;
        return id;
    };

    const edgeCount = new Map<number, number>();
    let overflow = false;
    for (let t = 0; t < triangleCount; t++) {
        const ka = idFor(idx(t, 0));
        const kb = idFor(idx(t, 1));
        const kc = idFor(idx(t, 2));
        if (nextId > MANIFOLD_ID_STRIDE) {
            overflow = true;
            break;
        }
        for (const [a, b] of [
            [ka, kb],
            [kb, kc],
            [kc, ka],
        ]) {
            const lo = a < b ? a : b;
            const hi = a < b ? b : a;
            const e = lo * MANIFOLD_ID_STRIDE + hi;
            edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
        }
    }
    if (overflow) return analyzeManifoldStringKeys(geometry);

    let openEdges = 0;
    let nonManifoldEdges = 0;
    for (const count of edgeCount.values()) {
        if (count === 1) openEdges++;
        else if (count > 2) nonManifoldEdges++;
    }

    return {
        triangleCount,
        vertexCount: position.count,
        openEdges,
        nonManifoldEdges,
        isWatertight: openEdges === 0 && nonManifoldEdges === 0,
    };
}

function analyzeManifoldStringKeys(geometry: BufferGeometry): ManifoldReport {
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const triangleCount = index ? index.count / 3 : position.count / 3;
    const key = (i: number): string => {
        const x = Math.round(position.getX(i) * QUANT);
        const y = Math.round(position.getY(i) * QUANT);
        const z = Math.round(position.getZ(i) * QUANT);
        return `${x},${y},${z}`;
    };
    const edgeCount = new Map<string, number>();
    const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const idx = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    for (let t = 0; t < triangleCount; t++) {
        const ka = key(idx(t, 0));
        const kb = key(idx(t, 1));
        const kc = key(idx(t, 2));
        for (const [a, b] of [
            [ka, kb],
            [kb, kc],
            [kc, ka],
        ]) {
            const e = edgeKey(a, b);
            edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
        }
    }
    let openEdges = 0;
    let nonManifoldEdges = 0;
    for (const count of edgeCount.values()) {
        if (count === 1) openEdges++;
        else if (count > 2) nonManifoldEdges++;
    }
    return {
        triangleCount,
        vertexCount: position.count,
        openEdges,
        nonManifoldEdges,
        isWatertight: openEdges === 0 && nonManifoldEdges === 0,
    };
}
