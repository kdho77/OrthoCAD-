// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { loadManifoldApi } from "./manifold-runtime";
import {
    BOTTOM_CLAMP_MM,
    bboxOf as bboxOfMesh,
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
import { pairwiseIntersectionVolume, type ResolvedModifier, unionVolume, voxelAssign } from "./resolve";

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

export async function gateCoverage(raw: RawModifier[], resolved: ResolvedModifier[]): Promise<GateResult> {
    const api = await loadManifoldApi();
    const rawVol = await unionVolume(
        api,
        raw.map((r) => r.mesh),
    );
    const resVol =
        (await unionVolume(
            api,
            resolved.filter((r) => r.status === "present").map((r) => r.mesh),
        )) + resolved.reduce((s, r) => s + r.reassignedMm3, 0);
    const delta = Math.abs(rawVol - resVol);
    if (delta > INTERSECT_EPS_MM3 && delta > 0.02 * Math.max(rawVol, 1)) {
        return {
            ok: false,
            detail: `coverage Δ ${delta.toFixed(4)} mm³ (raw ∪ ${rawVol} resolved ∪ ${resVol})`,
        };
    }
    return { ok: true, detail: `coverage Δ ${delta.toFixed(4)} mm³` };
}

export function gatePriorityVoxel(
    raw: RawModifier[],
    resolved: ResolvedModifier[],
    bounds: { min: [number, number, number]; max: [number, number, number] },
): GateResult {
    const voxel = voxelAssign(raw, bounds, 0.5);
    const voxTotal = [...voxel.values()].reduce((s, v) => s + v, 0);
    const meshTotal = resolved.reduce((s, m) => s + m.volumeMm3, 0);
    let worst = 0;
    for (const m of resolved) {
        const vox = voxel.get(m.region.regionId) ?? 0;
        const geom = m.volumeMm3;
        const voxFrac = vox / Math.max(voxTotal, 1e-9);
        const meshFrac = geom / Math.max(meshTotal, 1e-9);
        const rel = Math.abs(voxFrac - meshFrac);
        if (rel > worst) worst = rel;
        if (rel > VOXEL_REL_TOL && geom > 5 && vox > 5) {
            return {
                ok: false,
                detail: `${m.region.regionId} voxel share error ${(rel * 100).toFixed(2)}% (voxel ${vox.toFixed(1)} mesh ${geom.toFixed(1)})`,
            };
        }
    }
    return { ok: true, detail: `max voxel share Δ ${(worst * 100).toFixed(2)}%` };
}

export function gateOvershootAndDepth(
    resolved: ResolvedModifier[],
    zTopAt: (x: number, y: number) => number,
): GateResult {
    for (const m of resolved) {
        if (m.status !== "present" || m.mesh.positions.length === 0) continue;
        const p = m.mesh.positions;
        const bb = bboxOfMesh(m.mesh);
        const mx = (bb.min[0] + bb.max[0]) / 2;
        const my = (bb.min[1] + bb.max[1]) / 2;
        const inset = 0.35;
        let maxZ = -Infinity;
        let minZ = Infinity;
        let x = mx;
        let y = my;
        let minX = mx;
        let minY = my;
        for (let i = 0; i < p.length; i += 3) {
            const px = p[i]!;
            const py = p[i + 1]!;
            const z = p[i + 2]!;
            if (px < bb.min[0] + inset || px > bb.max[0] - inset) continue;
            if (py < bb.min[1] + inset || py > bb.max[1] - inset) continue;
            if (z < minZ) {
                minZ = z;
                minX = px;
                minY = py;
            }
            if (z > maxZ) {
                maxZ = z;
                x = px;
                y = py;
            }
        }
        if (!Number.isFinite(maxZ)) {
            maxZ = bb.max[2];
            x = mx;
            y = my;
        }
        if (!Number.isFinite(minZ)) minZ = bb.min[2];
        const zTop = zTopAt(x, y);
        const overshoot = maxZ - zTop;
        if (overshoot < OVERSHOOT_MIN_MM) {
            return {
                ok: false,
                detail: `${m.region.regionId} overshoot ${overshoot.toFixed(3)} mm < ${OVERSHOOT_MIN_MM} (maxZ ${maxZ.toFixed(3)} zTop ${zTop.toFixed(3)})`,
            };
        }
        if (Math.abs(overshoot - OVERSHOOT_MM) > 0.2) {
            return {
                ok: false,
                detail: `${m.region.regionId} overshoot ${overshoot.toFixed(3)} mm (maxZ ${maxZ.toFixed(3)} zTop ${zTop.toFixed(3)})`,
            };
        }
        if (m.region.depth.type === "mm") {
            const expectedBottom = Math.max(BOTTOM_CLAMP_MM, zTopAt(minX, minY) - m.region.depth.mm);
            if (Math.abs(minZ - expectedBottom) > DEPTH_TOL_MM + 0.15) {
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
                    const ab = triXyBbox(a, ta);
                    const bb = triXyBbox(b, tb);
                    if (!xyBboxesOverlap(ab, bb)) continue;
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

function triXyBbox(
    mesh: TriangleMesh,
    t: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
    const ix = mesh.indices;
    const p = mesh.positions;
    const ia = ix[t * 3]! * 3;
    const ib = ix[t * 3 + 1]! * 3;
    const ic = ix[t * 3 + 2]! * 3;
    const xs = [p[ia]!, p[ib]!, p[ic]!];
    const ys = [p[ia + 1]!, p[ib + 1]!, p[ic + 1]!];
    return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
    };
}

function xyBboxesOverlap(
    a: { minX: number; minY: number; maxX: number; maxY: number },
    b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
    return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}
