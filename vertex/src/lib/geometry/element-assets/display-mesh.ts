// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH } from "three-mesh-bvh";
import type { PlacedElement, Side } from "@/types";
import { loadTransformedAssetPositions, resolvePlacedAssetContexts } from "./element-asset";
import { anchorMmFromPlacement, defaultNoFlowHeightHooks } from "./no-flow-blend";
import { isLibraryHeightFieldKind } from "./types";

/** Library additions stay separate during design; manufacturing owns the blend. */
export function elementsForSurface(elements: PlacedElement[], print: boolean): PlacedElement[] {
    return print ? elements : elements.filter((element) => !isLibraryHeightFieldKind(element.kind));
}

export interface ElementDisplayMesh {
    element: PlacedElement;
    surface: BufferGeometry;
    border: BufferGeometry;
}

type Point = { x: number; y: number; z: number; clearance: number };

/** Clip an exposed triangle at its intersection with the base, without voxelizing its contour. */
function clipExposed(points: Point[]): Point[] {
    const out: Point[] = [];
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        if (a.clearance >= 0) out.push(a);
        if (a.clearance >= 0 !== b.clearance >= 0) {
            const t = a.clearance / (a.clearance - b.clearance);
            out.push({
                x: a.x + t * (b.x - a.x),
                y: a.y + t * (b.y - a.y),
                z: a.z + t * (b.z - a.z),
                clearance: 0,
            });
        }
    }
    return out;
}

/** Boundary edges only. Coordinate welding removes GLB material/normal seams. */
export function surfaceBorder(surface: BufferGeometry): BufferGeometry {
    const pos = surface.getAttribute("position");
    const edges = new Map<string, { count: number; a: number; b: number }>();
    const key = (i: number) =>
        [pos.getX(i), pos.getY(i), pos.getZ(i)].map((n) => Math.round(n * 10000)).join(",");
    for (let i = 0; i < pos.count; i += 3) {
        for (let j = 0; j < 3; j++) {
            const a = i + j;
            const b = i + ((j + 1) % 3);
            const ka = key(a);
            const kb = key(b);
            const k = ka < kb ? `${ka}/${kb}` : `${kb}/${ka}`;
            const edge = edges.get(k);
            if (edge) edge.count++;
            else edges.set(k, { count: 1, a, b });
        }
    }
    const vertices: number[] = [];
    for (const { count, a, b } of edges.values()) {
        if (count !== 1) continue;
        for (const i of [a, b]) vertices.push(pos.getX(i), pos.getY(i), pos.getZ(i) + 0.015);
    }
    return new BufferGeometry().setAttribute("position", new BufferAttribute(new Float32Array(vertices), 3));
}

/**
 * Render original GLB top triangles, never the insole's rasterized color boundary.
 * Design: flow the authored mesh onto the corrected base, without rim feather or smooth union.
 * Print: drape its exact planform over the composed solid for a crisp material boundary.
 * These meshes are display-only and never enter manufacturing/export geometry.
 */
export async function buildElementDisplayMeshes(
    base: BufferGeometry,
    elements: PlacedElement[],
    side: Side,
    print: boolean,
    placementBase: BufferGeometry = base,
): Promise<ElementDisplayMesh[]> {
    const contexts = await resolvePlacedAssetContexts(elements, side, 0, 0, placementBase);
    if (contexts.length === 0) return [];
    const reference = base.clone();
    const bvh = new MeshBVH(reference);
    reference.computeBoundingBox();
    const ray = new Ray(new Vector3(), new Vector3(0, 0, -1));
    const rayZ = reference.boundingBox!.max.z + 100;
    const height = (x: number, y: number): number | undefined => {
        ray.origin.set(x, y, rayZ);
        return bvh.raycastFirst(ray, DoubleSide)?.point.z;
    };
    const placementCopy = placementBase === base ? reference : placementBase.clone();
    const placementBvh = placementCopy === reference ? bvh : new MeshBVH(placementCopy);
    const placementHeight = (x: number, y: number): number | undefined => {
        ray.origin.set(x, y, rayZ);
        return placementBvh.raycastFirst(ray, DoubleSide)?.point.z;
    };
    const result: ElementDisplayMesh[] = [];
    try {
        for (const ctx of contexts) {
            if (ctx.transform.category !== "add") continue;
            const { positions, indices } = await loadTransformedAssetPositions(ctx.assetId, ctx.transform);
            const anchor = anchorMmFromPlacement(
                placementBase,
                side,
                ctx.placed.position.x,
                ctx.placed.position.y,
            );
            const anchorZ = defaultNoFlowHeightHooks.baseHeightAtAnchor(placementBase, anchor.x, anchor.y, 2);
            const angle = (ctx.transform.rotationDeg * Math.PI) / 180;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const points: (Point | null)[] = [];
            for (let i = 0; i < positions.length; i += 3) {
                const x = anchor.x + c * positions[i]! - s * positions[i + 1]!;
                const y = anchor.y + s * positions[i]! + c * positions[i + 1]!;
                const baseZ = placementHeight(x, y);
                const displayZ = print ? height(x, y) : baseZ;
                if (baseZ === undefined || displayZ === undefined) {
                    points.push(null);
                    continue;
                }
                const z =
                    (ctx.transform.placementMode === "flow" ? baseZ : anchorZ) +
                    positions[i + 2]! +
                    ctx.transform.zOffsetMm;
                points.push({
                    x,
                    y,
                    z: print ? displayZ + 0.025 : z + 0.025,
                    clearance: z - baseZ,
                });
            }
            const vertices: number[] = [];
            for (let f = 0; f < indices.length; f += 3) {
                const a = indices[f]!;
                const b = indices[f + 1]!;
                const d = indices[f + 2]!;
                const crossZ =
                    (positions[b * 3]! - positions[a * 3]!) *
                        (positions[d * 3 + 1]! - positions[a * 3 + 1]!) -
                    (positions[b * 3 + 1]! - positions[a * 3 + 1]!) * (positions[d * 3]! - positions[a * 3]!);
                // Exclude the underside and vertical closure of a solid GLB.
                if (
                    crossZ <= 1e-10 ||
                    Math.max(positions[a * 3 + 2]!, positions[b * 3 + 2]!, positions[d * 3 + 2]!) <= 1e-6
                )
                    continue;
                const pa = points[a];
                const pb = points[b];
                const pd = points[d];
                if (!pa || !pb || !pd) continue;
                const clipped = clipExposed([pa, pb, pd]);
                for (let j = 1; j + 1 < clipped.length; j++) {
                    for (const p of [clipped[0]!, clipped[j]!, clipped[j + 1]!]) vertices.push(p.x, p.y, p.z);
                }
            }
            const surface = new BufferGeometry().setAttribute(
                "position",
                new BufferAttribute(new Float32Array(vertices), 3),
            );
            const border = surfaceBorder(surface);
            const smoothSurface = mergeVertices(surface, 1e-5);
            surface.dispose();
            smoothSurface.computeVertexNormals();
            result.push({ element: ctx.placed, surface: smoothSurface, border });
        }
        return result;
    } catch (error) {
        for (const mesh of result) {
            mesh.surface.dispose();
            mesh.border.dispose();
        }
        throw error;
    } finally {
        if (placementCopy !== reference) placementCopy.dispose();
        reference.dispose();
    }
}
