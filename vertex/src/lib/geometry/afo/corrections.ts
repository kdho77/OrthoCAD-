// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { AFO_REAR_ROT_RANGE, AFO_SIDE_ROT_RANGE, isAfoIdentityCorrections } from "./defaults";
import { cloneMesh, computeVertexNormals, vertexCount } from "./mesh-ops";
import { clamp01, smoothstep } from "./offset-field";
import type { AfoCorrections, AfoTriMesh, AfoVec3 } from "./types";

const DEG = Math.PI / 180;

export interface AfoRotationAxes {
    medialMal: AfoVec3;
    lateralMal: AfoVec3;
}

export function clampSagittalDeg(v: number): number {
    return Math.min(AFO_SIDE_ROT_RANGE[1], Math.max(AFO_SIDE_ROT_RANGE[0], v));
}

export function clampFrontalDeg(v: number): number {
    return Math.min(AFO_REAR_ROT_RANGE[1], Math.max(AFO_REAR_ROT_RANGE[0], v));
}

export function malleolarAxes(
    medial: AfoVec3,
    lateral: AfoVec3,
): {
    origin: AfoVec3;
    sagittal: AfoVec3;
    frontal: AfoVec3;
    leg: AfoVec3;
} {
    const origin = {
        x: (medial.x + lateral.x) * 0.5,
        y: (medial.y + lateral.y) * 0.5,
        z: (medial.z + lateral.z) * 0.5,
    };
    const sx = lateral.x - medial.x;
    const sy = lateral.y - medial.y;
    const sz = lateral.z - medial.z;
    const sl = Math.hypot(sx, sy, sz) || 1;
    const sagittal = { x: sx / sl, y: sy / sl, z: sz / sl };
    const leg = { x: 0, y: 0, z: 1 };
    const fx = sagittal.y * leg.z - sagittal.z * leg.y;
    const fy = sagittal.z * leg.x - sagittal.x * leg.z;
    const fz = sagittal.x * leg.y - sagittal.y * leg.x;
    const fl = Math.hypot(fx, fy, fz) || 1;
    const frontal = { x: fx / fl, y: fy / fl, z: fz / fl };
    return { origin, sagittal, frontal, leg };
}

/** Degrees away from perpendicular (0 = orthogonal). */
export function axisOrthogonalityDeg(a: AfoVec3, b: AfoVec3): number {
    const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z);
    return (Math.asin(Math.min(1, d)) * 180) / Math.PI;
}

function rotateAround(p: AfoVec3, origin: AfoVec3, axis: AfoVec3, angle: number): AfoVec3 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const vx = p.x - origin.x;
    const vy = p.y - origin.y;
    const vz = p.z - origin.z;
    const cx = axis.y * vz - axis.z * vy;
    const cy = axis.z * vx - axis.x * vz;
    const cz = axis.x * vy - axis.y * vx;
    const dot = axis.x * vx + axis.y * vy + axis.z * vz;
    return {
        x: origin.x + vx * c + cx * s + axis.x * dot * (1 - c),
        y: origin.y + vy * c + cy * s + axis.y * dot * (1 - c),
        z: origin.z + vz * c + cz * s + axis.z * dot * (1 - c),
    };
}

/**
 * Apply AFO corrections to a working positive. All-zero corrections with
 * `smoothIterations = 0` are a true identity (cloned buffers, same positions).
 * Sagittal rotation is about the malleolar axis; frontal about the axis through
 * the midpoint perpendicular to the malleolar and leg axes. Warp w is 0 below
 * midpoint.z − 15 and 1 above midpoint.z + 25.
 */
export function applyAfoCorrections(mesh: AfoTriMesh, c: AfoCorrections, axes?: AfoRotationAxes): AfoTriMesh {
    if (isAfoIdentityCorrections(c)) return cloneMesh(mesh);
    const out = cloneMesh(mesh);
    const n = vertexCount(out);
    const sagDeg = clampSagittalDeg(c.legSideDeg);
    const frontDeg = clampFrontalDeg(c.legRearDeg);
    const medial = axes?.medialMal ?? { x: 35, y: 40, z: 80 };
    const lateral = axes?.lateralMal ?? { x: -35, y: 40, z: 80 };
    const ax = malleolarAxes(medial, lateral);
    const sag = sagDeg * DEG;
    const front = frontDeg * DEG;

    for (let i = 0; i < n; i++) {
        let x = out.positions[i * 3] ?? 0;
        let y = out.positions[i * 3 + 1] ?? 0;
        let z = out.positions[i * 3 + 2] ?? 0;
        const w = smoothstep(ax.origin.z - 15, ax.origin.z + 25, z);
        if (w > 0 && (sag !== 0 || front !== 0)) {
            let p = { x, y, z };
            if (sag !== 0) p = rotateAround(p, ax.origin, ax.sagittal, sag * w);
            if (front !== 0) p = rotateAround(p, ax.origin, ax.frontal, front * w);
            x = p.x;
            y = p.y;
            z = p.z;
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
        if (c.medialArchMm && x > 0) {
            const gy = Math.exp(-((y - 70) ** 2) / (2 * 28 * 28));
            z += c.medialArchMm * gy * clamp01(x / 30);
        }
        if (c.heelWidthMm) {
            const gh = Math.exp(-(y * y) / (2 * 35 * 35)) * clamp01(1 - z / 50);
            x += Math.sign(x || 1) * c.heelWidthMm * 0.5 * gh;
        }
        if (c.braceHeightMm > 0 && z > c.braceHeightMm) {
            z = c.braceHeightMm + (z - c.braceHeightMm) * 0.05;
        }

        out.positions[i * 3] = x;
        out.positions[i * 3 + 1] = y;
        out.positions[i * 3 + 2] = z;
    }

    if (c.smoothIterations > 0) taubinSmooth(out, c.smoothIterations);
    return out;
}

function taubinSmooth(mesh: AfoTriMesh, iterations: number, lambda = 0.33, mu = -0.34): void {
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
