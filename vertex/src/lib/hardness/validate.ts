// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { loadManifoldApi } from "./manifold-runtime";
import {
    COPLANAR_ANGLE_DEG,
    COPLANAR_AREA_MM2,
    COPLANAR_GAP_MM,
    DEPTH_TOL_MM,
    INTERSECT_EPS_MM3,
    meshIsWatertight,
    meshSignedVolume,
    meshVolume,
    OVERSHOOT_MIN_MM,
    OVERSHOOT_MM,
    type TriangleMesh,
    VOXEL_REL_TOL,
} from "./mesh";
import type { RawModifier } from "./prism";
import { pairwiseIntersectionVolume, type ResolvedModifier, voxelAssign } from "./resolve";

export interface GateResult {
    ok: boolean;
    detail: string;
}

export function gateModifiersManifold(mods: ResolvedModifier[]): GateResult {
    for (const m of mods) {
        if (m.status !== "present") continue;
        if (!meshIsWatertight(m.mesh)) {
            return { ok: false, detail: `${m.region.regionId} is not watertight` };
        }
        if (meshSignedVolume(m.mesh) <= 0) {
            return { ok: false, detail: `${m.region.regionId} volume is not positive` };
        }
    }
    return { ok: true, detail: "modifiers watertight/manifold/positive" };
}

export async function gatePairwiseIntersection(mods: ResolvedModifier[]): Promise<GateResult> {
    const api = await loadManifoldApi();
    const present = mods.filter((m) => m.status === "present" && m.mesh.indices.length > 0);
    for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
            const v = await pairwiseIntersectionVolume(api, present[i]!.mesh, present[j]!.mesh);
            if (v > INTERSECT_EPS_MM3) {
                return {
                    ok: false,
                    detail: `intersection ${present[i]!.region.regionId} ∩ ${present[j]!.region.regionId} = ${v} mm³`,
                };
            }
        }
    }
    return { ok: true, detail: `pairwise ∩ ≤ ${INTERSECT_EPS_MM3} mm³` };
}

export function gateCoverage(raw: RawModifier[], resolved: ResolvedModifier[]): GateResult {
    const rawVol = raw.reduce((s, r) => s + r.volumeMm3, 0);
    const resVol =
        resolved.reduce((s, r) => s + r.volumeMm3, 0) + resolved.reduce((s, r) => s + r.reassignedMm3, 0);
    const delta = Math.abs(rawVol - resVol);
    if (delta > INTERSECT_EPS_MM3 && delta > 0.02 * Math.max(rawVol, 1)) {
        return { ok: false, detail: `coverage Δ ${delta.toFixed(4)} mm³ (raw ${rawVol} resolved ${resVol})` };
    }
    return { ok: true, detail: `coverage Δ ${delta.toFixed(4)} mm³` };
}

export function gatePriorityVoxel(
    raw: RawModifier[],
    resolved: ResolvedModifier[],
    bounds: { min: [number, number, number]; max: [number, number, number] },
): GateResult {
    const voxel = voxelAssign(raw, bounds, 0.5);
    let worst = 0;
    for (const m of resolved) {
        const vox = voxel.get(m.region.regionId) ?? 0;
        const geom = m.volumeMm3;
        const denom = Math.max(vox, geom, 1);
        const rel = Math.abs(vox - geom) / denom;
        if (rel > worst) worst = rel;
        if (rel > VOXEL_REL_TOL + 0.05 && geom > 5 && vox > 5) {
            return {
                ok: false,
                detail: `${m.region.regionId} voxel rel error ${(rel * 100).toFixed(2)}% (voxel ${vox.toFixed(1)} mesh ${geom.toFixed(1)})`,
            };
        }
    }
    return { ok: true, detail: `max voxel rel ${(worst * 100).toFixed(2)}%` };
}

export function gateOvershootAndDepth(
    resolved: ResolvedModifier[],
    zTopAt: (x: number, y: number) => number,
): GateResult {
    for (const m of resolved) {
        if (m.status !== "present" || m.mesh.positions.length === 0) continue;
        const p = m.mesh.positions;
        let maxZ = -Infinity;
        let minZ = Infinity;
        let x = 0;
        let y = 0;
        for (let i = 0; i < p.length; i += 3) {
            const z = p[i + 2]!;
            if (z > maxZ) {
                maxZ = z;
                x = p[i]!;
                y = p[i + 1]!;
            }
            minZ = Math.min(minZ, z);
        }
        const zTop = zTopAt(x, y);
        const overshoot = maxZ - zTop;
        if (overshoot < OVERSHOOT_MIN_MM) {
            return {
                ok: false,
                detail: `${m.region.regionId} overshoot ${overshoot.toFixed(3)} mm < ${OVERSHOOT_MIN_MM}`,
            };
        }
        if (Math.abs(overshoot - OVERSHOOT_MM) > 0.15) {
            return { ok: false, detail: `${m.region.regionId} overshoot ${overshoot.toFixed(3)} mm` };
        }
        if (m.region.depth.type === "mm") {
            const expectedBottom = zTop - m.region.depth.mm;
            if (Math.abs(minZ - expectedBottom) > DEPTH_TOL_MM + 0.1) {
                return {
                    ok: false,
                    detail: `${m.region.regionId} depth bottom ${minZ.toFixed(3)} vs ${expectedBottom.toFixed(3)}`,
                };
            }
        }
    }
    return { ok: true, detail: "overshoot/depth within spec" };
}

function triNormalArea(
    mesh: TriangleMesh,
    t: number,
): { nx: number; ny: number; nz: number; area: number; z: number } | null {
    const ix = mesh.indices;
    const p = mesh.positions;
    const a = ix[t * 3]! * 3;
    const b = ix[t * 3 + 1]! * 3;
    const c = ix[t * 3 + 2]! * 3;
    const ux = p[b]! - p[a]!;
    const uy = p[b + 1]! - p[a + 1]!;
    const uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!;
    const vy = p[c + 1]! - p[a + 1]!;
    const vz = p[c + 2]! - p[a + 2]!;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return null;
    nx /= len;
    ny /= len;
    nz /= len;
    const area = len / 2;
    const z = (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3;
    return { nx, ny, nz, area, z };
}

export function gateCoplanarFaces(mods: ResolvedModifier[]): GateResult {
    const present = mods.filter((m) => m.status === "present");
    const cosTol = Math.cos((COPLANAR_ANGLE_DEG * Math.PI) / 180);
    for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
            let shared = 0;
            const a = present[i]!.mesh;
            const b = present[j]!.mesh;
            const na = meshVolume(a) > 0 ? meshTriCountSafe(a) : 0;
            const nb = meshVolume(b) > 0 ? meshTriCountSafe(b) : 0;
            const limitA = Math.min(na, 80);
            const limitB = Math.min(nb, 80);
            for (let ta = 0; ta < limitA; ta++) {
                const A = triNormalArea(a, ta);
                if (!A || A.area < 0.05) continue;
                for (let tb = 0; tb < limitB; tb++) {
                    const B = triNormalArea(b, tb);
                    if (!B) continue;
                    const dot = A.nx * B.nx + A.ny * B.ny + A.nz * B.nz;
                    if (Math.abs(dot) < cosTol) continue;
                    if (Math.abs(A.z - B.z) > COPLANAR_GAP_MM) continue;
                    shared += Math.min(A.area, B.area);
                    if (shared > COPLANAR_AREA_MM2) {
                        return {
                            ok: false,
                            detail: `coplanar faces ${present[i]!.region.regionId}/${present[j]!.region.regionId}`,
                        };
                    }
                }
            }
        }
    }
    return { ok: true, detail: "no coplanar overlap > 1 mm²" };
}

function meshTriCountSafe(m: TriangleMesh): number {
    return Math.floor(m.indices.length / 3);
}
