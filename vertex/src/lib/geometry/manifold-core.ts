import type { ManifoldReport } from "@/lib/geometry/manifold";

/** Worker-safe manifold analysis on raw geometry buffers. */
export function analyzeManifoldBuffers(positions: Float32Array, indices: Uint32Array | null): ManifoldReport {
    const vertexCount = positions.length / 3;
    const triangleCount = indices ? indices.length / 3 : vertexCount / 3;
    const QUANT = 1e4;

    const key = (i: number): string => {
        const x = Math.round(positions[i * 3]! * QUANT);
        const y = Math.round(positions[i * 3 + 1]! * QUANT);
        const z = Math.round(positions[i * 3 + 2]! * QUANT);
        return `${x},${y},${z}`;
    };

    const edgeCount = new Map<string, number>();
    const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

    const idx = (t: number, k: number) => (indices ? indices[t * 3 + k]! : t * 3 + k);

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
        vertexCount,
        openEdges,
        nonManifoldEdges,
        isWatertight: openEdges === 0 && nonManifoldEdges === 0,
    };
}
