// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Position-welded interior-edge fold metrics (Default.glb / multi-mesh bases).
 * Coincident copies share a supernode so shading/index seams are not counted
 * as folds. Optional heel-u filter matches the CAD diagnosis band (u ≤ 0.42).
 */

const QUANT = 1e4;
const MIN_ALTITUDE_MM = 0.15;
const PLANTAR_Z_MAX_MM = 1.0;

export interface WeldedFoldMetrics {
    maxWorseDeg: number;
    p99WorseDeg: number;
    edgesGe5: number;
    edgesGe10: number;
    edgeCount: number;
}

function faceNormal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] {
    const ax = pos[a * 3]!;
    const ay = pos[a * 3 + 1]!;
    const az = pos[a * 3 + 2]!;
    const ux = pos[b * 3]! - ax;
    const uy = pos[b * 3 + 1]! - ay;
    const uz = pos[b * 3 + 2]! - az;
    const vx = pos[c * 3]! - ax;
    const vy = pos[c * 3 + 1]! - ay;
    const vz = pos[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
}

function angleDeg(n0: [number, number, number], n1: [number, number, number]): number {
    const d = Math.max(-1, Math.min(1, n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]));
    return (Math.acos(d) * 180) / Math.PI;
}

function quantKey(pos: Float32Array, i: number): string {
    return `${Math.round(pos[i * 3]! * QUANT)},${Math.round(pos[i * 3 + 1]! * QUANT)},${Math.round(pos[i * 3 + 2]! * QUANT)}`;
}

function detectLengthAxis(pos: Float32Array, count: number): { axis: number; min: number; size: number } {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        for (let a = 0; a < 3; a++) {
            const v = pos[i * 3 + a]!;
            if (v < min[a]!) min[a] = v;
            if (v > max[a]!) max[a] = v;
        }
    }
    const size = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
    let axis = 0;
    if (size[1]! > size[axis]!) axis = 1;
    if (size[2]! > size[axis]!) axis = 2;
    return { axis, min: min[axis]!, size: size[axis]! || 1 };
}

function triangleAltitudeMm(pos: Float32Array, a: number, b: number, c: number): number {
    const ax = pos[a * 3] ?? 0;
    const ay = pos[a * 3 + 1] ?? 0;
    const az = pos[a * 3 + 2] ?? 0;
    const bx = pos[b * 3] ?? 0;
    const by = pos[b * 3 + 1] ?? 0;
    const bz = pos[b * 3 + 2] ?? 0;
    const cx = pos[c * 3] ?? 0;
    const cy = pos[c * 3 + 1] ?? 0;
    const cz = pos[c * 3 + 2] ?? 0;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area2 = Math.hypot(nx, ny, nz);
    const ab = Math.hypot(ux, uy, uz);
    const ac = Math.hypot(vx, vy, vz);
    const bc = Math.hypot(cx - bx, cy - by, cz - bz);
    const longest = Math.max(ab, ac, bc);
    return longest > 1e-12 ? area2 / longest : 0;
}

export function measureWeldedFold(
    basePos: Float32Array,
    modPos: Float32Array,
    index: ArrayLike<number>,
    options?: { heelUMax?: number; topVertexCount?: number; wallOnly?: boolean; thickAxis?: number },
): WeldedFoldMetrics {
    const count = basePos.length / 3;
    const topN = options?.topVertexCount ?? 0;
    const heelUMax = options?.heelUMax;
    const length = heelUMax !== undefined ? detectLengthAxis(basePos, count) : null;
    const wallOnly = options?.wallOnly === true;
    let thickAxis = options?.thickAxis;
    if (wallOnly && thickAxis === undefined) {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < count; i++) {
            for (let a = 0; a < 3; a++) {
                const v = basePos[i * 3 + a]!;
                if (v < min[a]!) min[a] = v;
                if (v > max[a]!) max[a] = v;
            }
        }
        const size = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
        thickAxis = 0;
        if (size[1]! < size[thickAxis]!) thickAxis = 1;
        if (size[2]! < size[thickAxis]!) thickAxis = 2;
    }

    const groupOf = new Int32Array(count);
    const keyToGroup = new Map<string, number>();
    let groupCount = 0;
    for (let i = 0; i < count; i++) {
        const k = quantKey(basePos, i);
        let g = keyToGroup.get(k);
        if (g === undefined) {
            g = groupCount++;
            keyToGroup.set(k, g);
        }
        groupOf[i] = g;
    }

    const inHeel = (a: number, b: number, c: number): boolean => {
        if (heelUMax === undefined || !length) return true;
        const u = (v: number) => (basePos[v * 3 + length.axis]! - length.min) / length.size;
        return u(a) <= heelUMax || u(b) <= heelUMax || u(c) <= heelUMax;
    };

    const edgeFaces = new Map<string, number[]>();
    for (let f = 0; f < index.length; f += 3) {
        const a = index[f]!;
        const b = index[f + 1]!;
        const c = index[f + 2]!;
        if (topN > 0 && (a < topN || b < topN || c < topN)) continue;
        if (!inHeel(a, b, c)) continue;
        if (triangleAltitudeMm(basePos, a, b, c) < MIN_ALTITUDE_MM) continue;
        if (wallOnly && thickAxis !== undefined) {
            const za = basePos[a * 3 + thickAxis]!;
            const zb = basePos[b * 3 + thickAxis]!;
            const zc = basePos[c * 3 + thickAxis]!;
            if (za <= PLANTAR_Z_MAX_MM && zb <= PLANTAR_Z_MAX_MM && zc <= PLANTAR_Z_MAX_MM) continue;
        }
        for (const [i1, i2] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const g0 = groupOf[i1]!;
            const g1 = groupOf[i2]!;
            if (g0 === g1) continue;
            const k = g0 < g1 ? `${g0},${g1}` : `${g1},${g0}`;
            let arr = edgeFaces.get(k);
            if (!arr) {
                arr = [];
                edgeFaces.set(k, arr);
            }
            arr.push(f);
        }
    }

    const worsens: number[] = [];
    let maxWorse = 0;
    let edgesGe5 = 0;
    let edgesGe10 = 0;
    for (const faces of edgeFaces.values()) {
        if (faces.length !== 2) continue;
        const f1 = faces[0]!;
        const f2 = faces[1]!;
        const bn1 = faceNormal(basePos, index[f1]!, index[f1 + 1]!, index[f1 + 2]!);
        const bn2 = faceNormal(basePos, index[f2]!, index[f2 + 1]!, index[f2 + 2]!);
        const mn1 = faceNormal(modPos, index[f1]!, index[f1 + 1]!, index[f1 + 2]!);
        const mn2 = faceNormal(modPos, index[f2]!, index[f2 + 1]!, index[f2 + 2]!);
        const worse = angleDeg(mn1, mn2) - angleDeg(bn1, bn2);
        worsens.push(worse);
        if (worse > maxWorse) maxWorse = worse;
        if (worse >= 5) edgesGe5++;
        if (worse >= 10) edgesGe10++;
    }
    worsens.sort((a, b) => a - b);
    const p99 = worsens.length
        ? worsens[Math.min(worsens.length - 1, Math.floor(worsens.length * 0.99))]!
        : 0;
    return {
        maxWorseDeg: maxWorse,
        p99WorseDeg: p99,
        edgesGe5,
        edgesGe10,
        edgeCount: worsens.length,
    };
}
