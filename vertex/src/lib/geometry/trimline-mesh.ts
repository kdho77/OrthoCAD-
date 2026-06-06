// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Vector3 } from "three";
import { type HeightFieldParams, heightAt } from "@/lib/geometry/height-field";
import { trimlineToCurve, type TrimlineCurve } from "@/lib/geometry/trimline";

/**
 * Parameters for the GLB-ready tapered insole mesh generator.
 *
 * The mesh is built as a concentric-ring topology so the outer boundary of the
 * top surface is *exactly* the user's trimline curve (resampled smoothly via
 * Catmull–Rom). Every ring shares vertices with its neighbours, which makes the
 * resulting mesh watertight and two-manifold by construction.
 */
export interface TrimlineMeshOptions {
    /** Closed top-edge curve in local footprint mm (x along length, y across width, z is ignored). */
    trimline: TrimlineCurve;
    /** Height-field parameters used to evaluate the top surface. */
    field: HeightFieldParams;
    /** Outer perimeter samples; defaults to 192. Higher = smoother outline. */
    perimeterSamples?: number;
    /** Number of inward concentric rings on the top surface. */
    topRings?: number;
    /** Number of inward concentric rings on the bottom surface. */
    bottomRings?: number;
    /**
     * Bottom inset in mm (uniform inward shrink of the bottom outline relative
     * to the top trimline). Produces a slight outward-tapered side wall that
     * prints cleanly. Set to 0 for vertical walls.
     */
    bottomInsetMm?: number;
    /**
     * Minimum total insole thickness (mm) under any point of the trimline.
     * Acts as a floor when the height field returns a thin region near the
     * outline. Guarantees the mesh stays printable.
     */
    minWallThicknessMm?: number;
    /** Bottom plane z (mm). Defaults to 0. */
    bottomZ?: number;
}

interface MeshBuilder {
    positions: number[];
    indices: number[];
}

function pushVertex(b: MeshBuilder, x: number, y: number, z: number): number {
    const idx = b.positions.length / 3;
    b.positions.push(x, y, z);
    return idx;
}

function pushTri(b: MeshBuilder, a: number, c: number, d: number): void {
    b.indices.push(a, c, d);
}

/**
 * Resample a closed trimline curve into `samples` evenly-spaced XY points using
 * a Catmull–Rom interpolation, so the outer ring is dense and smooth even when
 * the user only edited a handful of control points.
 */
function resamplePerimeter(curve: TrimlineCurve, samples: number): Vector3[] {
    const pts = curve.points.map((p) => new Vector3(p.x, p.y, 0));
    if (pts.length < 4) {
        return pts.length > 0 ? pts.map((p) => p.clone()) : [];
    }
    const cr: CatmullRomCurve3 = trimlineToCurve(pts, true);
    const out: Vector3[] = [];
    for (let i = 0; i < samples; i++) {
        const t = i / samples;
        out.push(cr.getPoint(t));
    }
    return out;
}

/** Centroid (mean XY) of a polygon. */
function polygonCentroid(points: Vector3[]): Vector3 {
    let sx = 0;
    let sy = 0;
    for (const p of points) {
        sx += p.x;
        sy += p.y;
    }
    return new Vector3(sx / points.length, sy / points.length, 0);
}

/**
 * Signed XY area of a closed polygon. Positive ⇒ counter-clockwise when viewed
 * from +Z (which gives the top surface a +Z normal under our ring topology).
 */
function polygonSignedArea(points: Vector3[]): number {
    let s = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        s += a.x * b.y - b.x * a.y;
    }
    return 0.5 * s;
}

/**
 * Evaluate the height-field at a given (x, y) in local footprint mm. Maps the
 * point onto the (u, vSigned) parameter space the existing height field uses,
 * clamped to legal bounds so interior samples are always valid.
 */
function evalHeightAtXY(x: number, y: number, field: HeightFieldParams): number {
    const u = Math.max(0, Math.min(1, x / field.lengthMm));
    const halfW = field.widthMm / 2;
    const vSigned = Math.max(-1, Math.min(1, y / halfW));
    return heightAt(u, vSigned, field);
}

/**
 * Build a closed, watertight insole mesh whose top boundary exactly matches the
 * supplied trimline.
 *
 * Topology (per ring index k, going inward):
 *   - top ring 0   = perimeterSamples vertices on the trimline (z = heightAt)
 *   - top ring k>0 = inward-scaled copy of ring 0 (toward centroid), z = heightAt
 *   - top center   = single vertex at centroid with z = heightAt(centroid)
 *   - bottom ring 0 = trimline (optionally inset), z = bottomZ
 *   - bottom ring k>0 = inward-scaled copy, z = bottomZ
 *   - bottom center = single vertex at centroid, z = bottomZ
 *
 * Faces:
 *   - top: ring-to-ring quad strips + central fan, normals up
 *   - bottom: ring-to-ring quad strips + central fan, normals down (reversed)
 *   - side: quad strip between outer top-ring and outer bottom-ring
 *
 * Because the side wall reuses the *same* outer-ring vertices as the top and
 * bottom caps (no duplication), the mesh is manifold-closed by construction.
 */
export function buildTrimlineInsoleMesh(options: TrimlineMeshOptions): BufferGeometry {
    const {
        trimline,
        field,
        perimeterSamples = 192,
        topRings = 14,
        bottomRings = 10,
        bottomInsetMm = 2.5,
        minWallThicknessMm = 2.0,
        bottomZ = 0,
    } = options;

    if (!trimline.points || trimline.points.length < 4) {
        throw new Error("buildTrimlineInsoleMesh: trimline requires at least 4 points");
    }

    let outer = resamplePerimeter(trimline, perimeterSamples);
    // Ensure CCW winding from +Z so the top surface faces up. If the user's
    // trimline happens to be authored clockwise (or wraps around itself in a
    // way that flips the sign), we reverse the perimeter — this keeps face
    // normals consistent without having to special-case each triangle below.
    if (polygonSignedArea(outer) < 0) {
        outer = outer.slice().reverse();
    }
    const n = outer.length;
    const centroid = polygonCentroid(outer);

    const builder: MeshBuilder = { positions: [], indices: [] };

    // ---- Top surface rings ----------------------------------------------
    // ring 0 = outer (top), heights from the field — guaranteed to honour the user's outline.
    // Inner rings scale toward centroid; heights sampled from the field at the scaled XY.
    const topRingIdx: number[][] = [];
    const topCount = topRings + 1; // inclusive of ring 0
    for (let k = 0; k < topCount; k++) {
        const s = 1 - k / topRings; // 1.0 at outer ring, 0.0 at innermost (but capped below)
        const scale = Math.max(0.04, s); // never fully collapse; central vertex closes it
        const row: number[] = [];
        for (let i = 0; i < n; i++) {
            const op = outer[i]!;
            const x = centroid.x + (op.x - centroid.x) * scale;
            const y = centroid.y + (op.y - centroid.y) * scale;
            const zRaw = evalHeightAtXY(x, y, field);
            // Enforce min thickness from bottom plane — keeps the rim from collapsing
            // below the side-wall bottom (avoids inside-out triangles near the edge).
            const z = Math.max(bottomZ + minWallThicknessMm, zRaw);
            row.push(pushVertex(builder, x, y, z));
        }
        topRingIdx.push(row);
    }
    // Central top vertex (closes the fan)
    const topCenterZ = Math.max(
        bottomZ + minWallThicknessMm,
        evalHeightAtXY(centroid.x, centroid.y, field),
    );
    const topCenterIdx = pushVertex(builder, centroid.x, centroid.y, topCenterZ);

    // Top: quad strips between adjacent rings (winding CCW from above, so face normals point +Z).
    for (let k = 0; k < topCount - 1; k++) {
        const r0 = topRingIdx[k]!;
        const r1 = topRingIdx[k + 1]!;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const a = r0[i]!;
            const b = r0[j]!;
            const c = r1[j]!;
            const d = r1[i]!;
            // Quad (a,b,c,d) → two triangles. Winding chosen so normals point up.
            pushTri(builder, a, b, c);
            pushTri(builder, a, c, d);
        }
    }
    // Top: central fan from innermost ring to centroid vertex.
    const topInner = topRingIdx[topCount - 1]!;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        pushTri(builder, topInner[i]!, topInner[j]!, topCenterIdx);
    }

    // ---- Bottom surface rings -------------------------------------------
    // The bottom outline is the trimline shrunk inward by `bottomInsetMm` in
    // the XY plane (uniform offset toward centroid). This produces a printable
    // outward-tapered side wall. With bottomInsetMm = 0 the walls are vertical.
    const bottomOuter: Vector3[] = outer.map((p) => {
        const dx = p.x - centroid.x;
        const dy = p.y - centroid.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return new Vector3(p.x, p.y, bottomZ);
        const ratio = Math.max(0, 1 - bottomInsetMm / len);
        return new Vector3(centroid.x + dx * ratio, centroid.y + dy * ratio, bottomZ);
    });

    const bottomRingIdx: number[][] = [];
    const bottomCount = bottomRings + 1;
    for (let k = 0; k < bottomCount; k++) {
        const s = 1 - k / bottomRings;
        const scale = Math.max(0.04, s);
        const row: number[] = [];
        for (let i = 0; i < n; i++) {
            const op = bottomOuter[i]!;
            const x = centroid.x + (op.x - centroid.x) * scale;
            const y = centroid.y + (op.y - centroid.y) * scale;
            row.push(pushVertex(builder, x, y, bottomZ));
        }
        bottomRingIdx.push(row);
    }
    const bottomCenterIdx = pushVertex(builder, centroid.x, centroid.y, bottomZ);

    // Bottom: quad strips, winding reversed so normals point -Z.
    for (let k = 0; k < bottomCount - 1; k++) {
        const r0 = bottomRingIdx[k]!;
        const r1 = bottomRingIdx[k + 1]!;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const a = r0[i]!;
            const b = r0[j]!;
            const c = r1[j]!;
            const d = r1[i]!;
            pushTri(builder, a, d, c);
            pushTri(builder, a, c, b);
        }
    }
    // Bottom: central fan, reversed.
    const botInner = bottomRingIdx[bottomCount - 1]!;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        pushTri(builder, botInner[i]!, bottomCenterIdx, botInner[j]!);
    }

    // ---- Side wall -------------------------------------------------------
    // Between top outer ring and bottom outer ring (both share the same
    // perimeterSamples count and ordering). Side faces point outward.
    const topOuter = topRingIdx[0]!;
    const bottomOuterIdx = bottomRingIdx[0]!;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const tA = topOuter[i]!;
        const tB = topOuter[j]!;
        const bA = bottomOuterIdx[i]!;
        const bB = bottomOuterIdx[j]!;
        // Quad (tA, tB, bB, bA) — winding outward (CCW seen from outside).
        pushTri(builder, tA, bA, bB);
        pushTri(builder, tA, bB, tB);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array(builder.positions), 3),
    );
    geometry.setIndex(builder.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}
