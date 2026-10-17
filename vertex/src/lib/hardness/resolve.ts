// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { compareRegionResolveOrder, type HardnessRegion } from "../../../shared/print-recipe/hardness-region";
import { pointInPoly, type Xy } from "./clip2";
import {
    loadManifoldApi,
    type ManifoldApi,
    type ManifoldHandle,
    manifoldToMesh,
    manifoldVolume,
    meshToManifold,
} from "./manifold-runtime";
import {
    emptyMesh,
    INTERSECT_EPS_MM3,
    SLIVER_THICKNESS_MM,
    SLIVER_VOLUME_MM3,
    type TriangleMesh,
    thicknessOf,
} from "./mesh";
import type { RawModifier } from "./prism";

export type RegionStatus = "present" | "overridden" | "reassigned" | "dropped";

export interface ResolvedModifier {
    region: HardnessRegion;
    mesh: TriangleMesh;
    footprint: Xy[];
    rawVolumeMm3: number;
    volumeMm3: number;
    status: RegionStatus;
    note?: string;
    meshSha: string;
    sourceHash: string;
    reassignedMm3: number;
}

function dispose(h: ManifoldHandle | undefined): void {
    try {
        h?.delete?.();
    } catch {
        // WASM handles are best-effort.
    }
}

export async function resolveModifiers(raw: RawModifier[]): Promise<ResolvedModifier[]> {
    const api = await loadManifoldApi();
    const ordered = raw
        .map((r, i) => ({ r, i }))
        .sort((a, b) => {
            const c = compareRegionResolveOrder(a.r.region, b.r.region);
            return c !== 0 ? c : a.i - b.i;
        })
        .map((x) => x.r);

    const { sha256Utf8, canonicalizeJson } = await import("./hash");
    const { meshSha } = await import("./mesh");

    const resolvedHandles: {
        region: HardnessRegion;
        handle: ManifoldHandle | null;
        raw: RawModifier;
        status: RegionStatus;
        note?: string;
        reassignedMm3: number;
    }[] = [];

    for (const item of ordered) {
        let handle: ManifoldHandle;
        try {
            handle = meshToManifold(api, item.mesh);
        } catch (err) {
            throw new Error(
                `manifold-3d rejected mesh for ${item.region.regionId}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
        let reassignedMm3 = 0;
        let note: string | undefined;
        let status: RegionStatus = "present";

        for (const prev of resolvedHandles) {
            if (!prev.handle) continue;
            let clipped: ManifoldHandle;
            try {
                clipped = handle.subtract(prev.handle);
            } catch (err) {
                throw new Error(
                    `manifold-3d subtract failed for ${item.region.regionId} vs ${prev.region.regionId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
            dispose(handle);
            handle = clipped;
        }

        const vol = manifoldVolume(handle);
        const thick = thicknessOf(manifoldToMesh(handle));
        let kept: ManifoldHandle | null = handle;

        if (vol < INTERSECT_EPS_MM3) {
            status = "overridden";
            note = "Fully overridden by higher-priority / softer-tie region";
            dispose(handle);
            kept = null;
        } else if (vol < SLIVER_VOLUME_MM3 || thick < SLIVER_THICKNESS_MM) {
            const winner = [...resolvedHandles].reverse().find((h) => h.handle);
            if (winner?.handle) {
                const unioned = winner.handle.add(handle);
                dispose(winner.handle);
                winner.handle = unioned;
                reassignedMm3 = vol;
                status = "reassigned";
                note = `Sliver ${vol.toFixed(3)} mm³ / ${thick.toFixed(2)} mm thick reassigned to ${winner.region.regionId}`;
                dispose(handle);
                kept = null;
            }
        }

        resolvedHandles.push({
            region: item.region,
            handle: kept,
            raw: item,
            status,
            note,
            reassignedMm3,
        });
    }

    const out: ResolvedModifier[] = resolvedHandles.map((item) => {
        const finalMesh =
            item.status === "present" && item.handle ? manifoldToMesh(item.handle) : emptyMesh();
        const sourceHash = sha256Utf8(
            canonicalizeJson({
                regionId: item.region.regionId,
                kind: item.region.kind,
                hardnessClass: item.region.hardnessClass,
                priority: item.region.priority,
                depth: item.region.depth,
                overrides: item.region.overrides ?? null,
                elementId: item.region.elementId ?? null,
                polygon: item.raw.footprint,
            }),
        );
        return {
            region: item.region,
            mesh: finalMesh,
            footprint: item.raw.footprint,
            rawVolumeMm3: item.raw.volumeMm3,
            volumeMm3: item.status === "present" && item.handle ? manifoldVolume(item.handle) : 0,
            status: item.status,
            note: item.note,
            meshSha: meshSha(finalMesh),
            sourceHash,
            reassignedMm3: item.reassignedMm3,
        };
    });

    for (const h of resolvedHandles) dispose(h.handle ?? undefined);
    return out;
}

export async function pairwiseIntersectionVolume(
    api: ManifoldApi,
    a: TriangleMesh,
    b: TriangleMesh,
): Promise<number> {
    if (a.indices.length === 0 || b.indices.length === 0) return 0;
    const ma = meshToManifold(api, a);
    const mb = meshToManifold(api, b);
    try {
        const inter = ma.intersect(mb);
        const v = manifoldVolume(inter);
        dispose(inter);
        return v;
    } finally {
        dispose(ma);
        dispose(mb);
    }
}

export function voxelAssign(
    raw: RawModifier[],
    bounds: { min: [number, number, number]; max: [number, number, number] },
    step = 0.5,
): Map<string, number> {
    const ordered = raw.slice().sort((a, b) => compareRegionResolveOrder(a.region, b.region));
    const counts = new Map<string, number>();
    for (const r of ordered) counts.set(r.region.regionId, 0);
    const volCell = step * step * step;
    for (let z = bounds.min[2] + step / 2; z <= bounds.max[2]; z += step) {
        for (let y = bounds.min[1] + step / 2; y <= bounds.max[1]; y += step) {
            for (let x = bounds.min[0] + step / 2; x <= bounds.max[0]; x += step) {
                for (const item of ordered) {
                    if (!pointInPoly(x, y, item.footprint)) continue;
                    const p = item.mesh.positions;
                    if (p.length === 0) continue;
                    let zmin = Infinity;
                    let zmax = -Infinity;
                    for (let i = 2; i < p.length; i += 3) {
                        zmin = Math.min(zmin, p[i]!);
                        zmax = Math.max(zmax, p[i]!);
                    }
                    if (z < zmin - 1e-3 || z > zmax + 1e-3) continue;
                    counts.set(item.region.regionId, (counts.get(item.region.regionId) ?? 0) + volCell);
                    break;
                }
            }
        }
    }
    return counts;
}
