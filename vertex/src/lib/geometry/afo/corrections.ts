// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { isAfoIdentityCorrections } from "./defaults";
import { cloneMesh, computeVertexNormals, vertexCount } from "./mesh-ops";
import type { AfoCorrections, AfoTriMesh } from "./types";

const DEG = Math.PI / 180;

/**
 * Apply AFO corrections to a working positive. All-zero corrections with
 * `smoothIterations = 0` are a true identity (cloned buffers, same positions).
 */
export function applyAfoCorrections(mesh: AfoTriMesh, c: AfoCorrections): AfoTriMesh {
    if (isAfoIdentityCorrections(c)) return cloneMesh(mesh);
    const out = cloneMesh(mesh);
    const n = vertexCount(out);
    const rear = c.legRearDeg * DEG;
    const side = c.legSideDeg * DEG;
    const cr = Math.cos(rear);
    const sr = Math.sin(rear);
    const cs = Math.cos(side);
    const ss = Math.sin(side);

    for (let i = 0; i < n; i++) {
        let x = out.positions[i * 3] ?? 0;
        let y = out.positions[i * 3 + 1] ?? 0;
        let z = out.positions[i * 3 + 2] ?? 0;

        // Leg rotations about the ankle region (y≈40, z≈80). Pivot at heel for
        // rear (X/Z about Y=0) and side (Y/Z about X=0) with a z-weight so the
        // foot stays planted.
        const wLeg = clamp01((z - 40) / 160);
        if (wLeg > 0 && (rear !== 0 || side !== 0)) {
            if (rear !== 0) {
                const xz = x * cr - z * sr * wLeg;
                const zz = x * sr * wLeg + z;
                x = xz;
                z = zz;
            }
            if (side !== 0) {
                const yz = y * cs - z * ss * wLeg;
                const zz = y * ss * wLeg + z;
                y = yz;
                z = zz;
            }
        }

        if (c.heelLiftMm) {
            const t = clamp01(1 - y / 140);
            z += c.heelLiftMm * t;
        }
        if (c.footLiftMedMm && x > 0) {
            z += c.footLiftMedMm * clamp01(x / 40) * clamp01(1 - z / 50);
        }
        if (c.footLiftLatMm && x < 0) {
            z += c.footLiftLatMm * clamp01(-x / 40) * clamp01(1 - z / 50);
        }
        if (c.toeFlowMm) {
            const t = clamp01((y - 120) / 60);
            z += c.toeFlowMm * t;
        }
        if (c.medialArchMm && x > 0) {
            const gy = Math.exp(-((y - 70) ** 2) / (2 * 28 * 28));
            z += c.medialArchMm * gy * clamp01(x / 30);
        }
        if (c.heelWidthMm) {
            const gh = Math.exp(-(y * y) / (2 * 35 * 35)) * clamp01(1 - z / 50);
            x += Math.sign(x || 1) * c.heelWidthMm * 0.5 * gh;
        }
        if (c.braceHeightMm > 0 && z > c.braceHeightMm) {
            // Soft clamp of shin vertices above the designed height.
            z = c.braceHeightMm + (z - c.braceHeightMm) * 0.05;
        }

        out.positions[i * 3] = x;
        out.positions[i * 3 + 1] = y;
        out.positions[i * 3 + 2] = z;
    }

    if (c.smoothIterations > 0) taubinSmooth(out, c.smoothIterations);
    return out;
}

function clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
}

/** Taubin λ/μ smooth that preserves volume better than plain Laplacian. */
export function taubinSmooth(mesh: AfoTriMesh, iterations: number, lambda = 0.33, mu = -0.34): void {
    const n = vertexCount(mesh);
    const nrm = computeVertexNormals(mesh);
    void nrm;
    const adj = buildAdj(mesh, n);
    const tmp = new Float32Array(mesh.positions.length);
    const step = (factor: number) => {
        tmp.set(mesh.positions);
        for (let i = 0; i < n; i++) {
            const nbrs = adj[i] ?? [];
            if (nbrs.length === 0) continue;
            let sx = 0;
            let sy = 0;
            let sz = 0;
            for (const j of nbrs) {
                sx += tmp[j * 3] ?? 0;
                sy += tmp[j * 3 + 1] ?? 0;
                sz += tmp[j * 3 + 2] ?? 0;
            }
            const inv = 1 / nbrs.length;
            const lx = sx * inv - (tmp[i * 3] ?? 0);
            const ly = sy * inv - (tmp[i * 3 + 1] ?? 0);
            const lz = sz * inv - (tmp[i * 3 + 2] ?? 0);
            mesh.positions[i * 3] = (tmp[i * 3] ?? 0) + factor * lx;
            mesh.positions[i * 3 + 1] = (tmp[i * 3 + 1] ?? 0) + factor * ly;
            mesh.positions[i * 3 + 2] = (tmp[i * 3 + 2] ?? 0) + factor * lz;
        }
    };
    for (let k = 0; k < iterations; k++) {
        step(lambda);
        step(mu);
    }
}

function buildAdj(mesh: AfoTriMesh, n: number): number[][] {
    const adj: number[][] = Array.from({ length: n }, () => []);
    const seen = new Set<string>();
    const add = (a: number, b: number) => {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) return;
        seen.add(key);
        adj[a]!.push(b);
        adj[b]!.push(a);
    };
    const t = (mesh.indices.length / 3) | 0;
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
