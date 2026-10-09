// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";

const QUANT = 1e4;

function quantKey(x: number, y: number, z: number): string {
    return `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`;
}

/**
 * Average vertex normals across coincident position copies when their angle
 * is below `creaseDeg` (default 60°). Leaves true creases split so the viewer
 * weld (position+normal) no longer paints a shading seam on smooth walls.
 */
export function averageCoincidentNormals(geometry: BufferGeometry, creaseDeg = 60): void {
    const pos = geometry.getAttribute("position");
    const nrm = geometry.getAttribute("normal");
    if (!pos || !nrm) return;
    const count = pos.count;
    const p = pos.array as Float32Array;
    const n = nrm.array as Float32Array;
    const groups = new Map<string, number[]>();
    for (let i = 0; i < count; i++) {
        const k = quantKey(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!);
        let g = groups.get(k);
        if (!g) {
            g = [];
            groups.set(k, g);
        }
        g.push(i);
    }
    const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
    for (const members of groups.values()) {
        if (members.length < 2) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (const i of members) {
            sx += n[i * 3]!;
            sy += n[i * 3 + 1]!;
            sz += n[i * 3 + 2]!;
        }
        const len = Math.hypot(sx, sy, sz);
        if (len < 1e-12) continue;
        const mx = sx / len;
        const my = sy / len;
        const mz = sz / len;
        let allClose = true;
        for (const i of members) {
            const d = n[i * 3]! * mx + n[i * 3 + 1]! * my + n[i * 3 + 2]! * mz;
            if (d < cosCrease) {
                allClose = false;
                break;
            }
        }
        if (!allClose) continue;
        for (const i of members) {
            n[i * 3] = mx;
            n[i * 3 + 1] = my;
            n[i * 3 + 2] = mz;
        }
    }
    nrm.needsUpdate = true;
}
