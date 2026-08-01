// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";

/** Interactive preview LOD target (10k–20k tris). */
export const INTERACTIVE_LOD_TARGET_TRIS = 15_000;
export const INTERACTIVE_LOD_MIN_TRIS = 10_000;
export const INTERACTIVE_LOD_MAX_TRIS = 20_000;

function triangleCountOf(geometry: BufferGeometry): number {
    const index = geometry.getIndex();
    const pos = geometry.getAttribute("position");
    if (!pos) return 0;
    return index ? index.count / 3 : pos.count / 3;
}

/**
 * Build a lighter editing mesh for slider drags by stride-thinning triangles.
 * Preserves multi-mesh top/bottom split when `userData.topVertexCount` is set by
 * decimating each range independently and concatenating.
 *
 * Never use the watertight export solid (250k+ verts) as input — pass the stock
 * editing mesh (~86k tris) only.
 */
export function buildInteractiveLodGeometry(
    source: BufferGeometry,
    targetTriangles = INTERACTIVE_LOD_TARGET_TRIS,
): BufferGeometry {
    const target = Math.min(INTERACTIVE_LOD_MAX_TRIS, Math.max(INTERACTIVE_LOD_MIN_TRIS, targetTriangles));
    const pos = source.getAttribute("position");
    if (!pos) return source.clone();
    const srcCount = triangleCountOf(source);
    if (srcCount <= target) {
        // Still clone topology into an independent buffer so modifiers never touch source.
        return cloneGeometryArrays(source);
    }

    const userData = source.userData as { isMultiMeshBase?: boolean; topVertexCount?: number };
    const topN =
        userData.isMultiMeshBase && typeof userData.topVertexCount === "number" && userData.topVertexCount > 0
            ? userData.topVertexCount
            : 0;

    if (topN > 0 && topN < pos.count) {
        const top = extractVertexRange(source, 0, topN);
        const bot = extractVertexRange(source, topN, pos.count);
        const topShare = Math.max(0.15, topN / pos.count);
        const topTarget = Math.max(2_000, Math.floor(target * topShare));
        const botTarget = Math.max(2_000, target - topTarget);
        const topLod = strideDecimate(top, topTarget);
        const botLod = strideDecimate(bot, botTarget);
        const merged = concatRanges(topLod, botLod);
        merged.geometry.userData = {
            ...source.userData,
            isMultiMeshBase: true,
            topVertexCount: topLod.vertexCount,
            interactiveLod: true,
            sourceTriangleCount: srcCount,
        };
        return merged.geometry;
    }

    const lod = strideDecimate(source, target);
    lod.geometry.userData = {
        ...source.userData,
        isMultiMeshBase: false,
        interactiveLod: true,
        sourceTriangleCount: srcCount,
    };
    return lod.geometry;
}

function cloneGeometryArrays(source: BufferGeometry): BufferGeometry {
    const pos = source.getAttribute("position")!;
    const src = pos.array as Float32Array;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(src), 3));
    const index = source.getIndex();
    if (index) {
        const arr = index.array;
        geometry.setIndex(
            new BufferAttribute(
                arr instanceof Uint32Array ? new Uint32Array(arr) : new Uint32Array(arr as ArrayLike<number>),
                1,
            ),
        );
    }
    geometry.userData = { ...source.userData };
    return geometry;
}

function extractVertexRange(source: BufferGeometry, start: number, end: number): BufferGeometry {
    const pos = source.getAttribute("position")!;
    const src = pos.array as Float32Array;
    const positions = src.subarray(start * 3, end * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    const index = source.getIndex();
    if (index) {
        const out: number[] = [];
        const arr = index.array as ArrayLike<number>;
        for (let t = 0; t < index.count; t += 3) {
            const a = arr[t]!;
            const b = arr[t + 1]!;
            const c = arr[t + 2]!;
            if (a < start || b < start || c < start || a >= end || b >= end || c >= end) continue;
            out.push(a - start, b - start, c - start);
        }
        geometry.setIndex(new BufferAttribute(new Uint32Array(out), 1));
    }
    return geometry;
}

function strideDecimate(
    source: BufferGeometry,
    targetTriangles: number,
): { geometry: BufferGeometry; vertexCount: number } {
    const pos = source.getAttribute("position")!;
    const src = pos.array as Float32Array;
    const index = source.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    const stride = Math.max(1, Math.ceil(triCount / targetTriangles));

    const used = new Int32Array(pos.count);
    used.fill(-1);
    const newPositions: number[] = [];
    const newIndices: number[] = [];

    const mapVertex = (i: number): number => {
        let mapped = used[i]!;
        if (mapped >= 0) return mapped;
        mapped = newPositions.length / 3;
        used[i] = mapped;
        newPositions.push(src[i * 3]!, src[i * 3 + 1]!, src[i * 3 + 2]!);
        return mapped;
    };

    if (index) {
        const arr = index.array as ArrayLike<number>;
        for (let t = 0; t < triCount; t += stride) {
            const a = arr[t * 3]!;
            const b = arr[t * 3 + 1]!;
            const c = arr[t * 3 + 2]!;
            newIndices.push(mapVertex(a), mapVertex(b), mapVertex(c));
        }
    } else {
        for (let t = 0; t < triCount; t += stride) {
            newIndices.push(mapVertex(t * 3), mapVertex(t * 3 + 1), mapVertex(t * 3 + 2));
        }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(newPositions), 3));
    geometry.setIndex(new BufferAttribute(new Uint32Array(newIndices), 1));
    return { geometry, vertexCount: newPositions.length / 3 };
}

function concatRanges(
    top: { geometry: BufferGeometry; vertexCount: number },
    bot: { geometry: BufferGeometry; vertexCount: number },
): { geometry: BufferGeometry; vertexCount: number } {
    const topPos = top.geometry.getAttribute("position")!.array as Float32Array;
    const botPos = bot.geometry.getAttribute("position")!.array as Float32Array;
    const positions = new Float32Array(topPos.length + botPos.length);
    positions.set(topPos, 0);
    positions.set(botPos, topPos.length);

    const topIdx = top.geometry.getIndex()?.array as ArrayLike<number> | undefined;
    const botIdx = bot.geometry.getIndex()?.array as ArrayLike<number> | undefined;
    const indices: number[] = [];
    if (topIdx) {
        for (let i = 0; i < topIdx.length; i++) indices.push(topIdx[i]!);
    }
    if (botIdx) {
        for (let i = 0; i < botIdx.length; i++) indices.push(botIdx[i]! + top.vertexCount);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    if (indices.length) geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
    top.geometry.dispose();
    bot.geometry.dispose();
    return { geometry, vertexCount: positions.length / 3 };
}

export function geometryTriangleCount(geometry: BufferGeometry): number {
    return triangleCountOf(geometry);
}
