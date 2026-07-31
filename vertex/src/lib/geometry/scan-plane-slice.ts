// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Deterministic plane clipping for imported scan meshes.
 *
 * Removes connected noise that component labeling cannot separate: triangles
 * on the discard side of a plane are removed; straddling triangles are clipped
 * to the keep side. Operates on scan-local coordinates. No ML, no deps.
 */

import type { BufferGeometry } from "three";
import * as THREE from "three";

const EPS = 1e-9;

/** Serializable plane in scan-local space (THREE.Plane: n·x + constant = 0). */
export type ScanSlicePlane = {
    normal: [number, number, number];
    constant: number;
    /** Keep the half-space where signed distance >= 0 when true; else < 0. */
    keepPositive: boolean;
};

export function planeFromScanSlice(sp: ScanSlicePlane): THREE.Plane {
    return new THREE.Plane(new THREE.Vector3(sp.normal[0], sp.normal[1], sp.normal[2]), sp.constant);
}

export function scanSliceFromPlane(plane: THREE.Plane, keepPositive: boolean): ScanSlicePlane {
    const n = plane.normal.clone().normalize();
    return {
        normal: [n.x, n.y, n.z],
        constant: plane.constant,
        keepPositive,
    };
}

/**
 * Build a cutting plane from two world-space sketch points and a view direction.
 * The plane contains P0→P1 and is parallel to viewDir (line appears edge-on).
 * Returns null if degenerate.
 */
export function cuttingPlaneFromViewLine(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    viewDir: THREE.Vector3,
): THREE.Plane | null {
    const edge = new THREE.Vector3().subVectors(p1, p0);
    if (edge.lengthSq() < 1e-12) return null;
    const n = new THREE.Vector3().crossVectors(edge, viewDir);
    if (n.lengthSq() < 1e-12) return null;
    n.normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p0);
    return plane;
}

/** Transform a world-space plane into the local frame of matrixWorld. */
export function planeWorldToLocal(planeWorld: THREE.Plane, matrixWorld: THREE.Matrix4): THREE.Plane {
    const inv = matrixWorld.clone().invert();
    // Transform three coplanar points, rebuild.
    const n = planeWorld.normal;
    const c = planeWorld.coplanarPoint(new THREE.Vector3());
    const t1 = new THREE.Vector3();
    const t2 = new THREE.Vector3();
    if (Math.abs(n.x) < 0.9) t1.set(1, 0, 0).cross(n).normalize();
    else t1.set(0, 1, 0).cross(n).normalize();
    t2.crossVectors(n, t1).normalize();
    const a = c.clone().applyMatrix4(inv);
    const b = c.clone().add(t1).applyMatrix4(inv);
    const d = c.clone().add(t2).applyMatrix4(inv);
    return new THREE.Plane().setFromCoplanarPoints(a, b, d);
}

function signedDist(plane: THREE.Plane, x: number, y: number, z: number): number {
    return plane.normal.x * x + plane.normal.y * y + plane.normal.z * z + plane.constant;
}

function keepSide(d: number, keepPositive: boolean): boolean {
    return keepPositive ? d >= -EPS : d <= EPS;
}

function lerpCorner(
    ax: number,
    ay: number,
    az: number,
    da: number,
    bx: number,
    by: number,
    bz: number,
    db: number,
): [number, number, number] {
    const t = da / (da - db);
    return [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t];
}

function pushTri(
    out: number[],
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
): void {
    // Skip degenerate after clip.
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz < 1e-24) return;
    out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
}

/**
 * Clip geometry to the keep half-space of `plane`.
 * Input may be indexed or non-indexed; output is non-indexed triangle soup.
 */
export function sliceBufferGeometryByPlane(
    geometry: BufferGeometry,
    plane: THREE.Plane,
    keepPositive: boolean,
): BufferGeometry {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count === 0) {
        return new THREE.BufferGeometry();
    }
    const index = geometry.getIndex();
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    const out: number[] = [];

    const get = (i: number): [number, number, number] => [pos.getX(i), pos.getY(i), pos.getZ(i)];

    for (let t = 0; t < triCount; t++) {
        let ia: number;
        let ib: number;
        let ic: number;
        if (index) {
            ia = index.getX(t * 3);
            ib = index.getX(t * 3 + 1);
            ic = index.getX(t * 3 + 2);
        } else {
            ia = t * 3;
            ib = t * 3 + 1;
            ic = t * 3 + 2;
        }
        const [ax, ay, az] = get(ia);
        const [bx, by, bz] = get(ib);
        const [cx, cy, cz] = get(ic);
        const da = signedDist(plane, ax, ay, az);
        const db = signedDist(plane, bx, by, bz);
        const dc = signedDist(plane, cx, cy, cz);
        const ka = keepSide(da, keepPositive);
        const kb = keepSide(db, keepPositive);
        const kc = keepSide(dc, keepPositive);
        const keepCount = (ka ? 1 : 0) + (kb ? 1 : 0) + (kc ? 1 : 0);

        if (keepCount === 3) {
            pushTri(out, ax, ay, az, bx, by, bz, cx, cy, cz);
            continue;
        }
        if (keepCount === 0) continue;

        // Collect keep verts and intersection points in winding order A→B→C.
        type V = [number, number, number];
        const verts: V[] = [];
        const corners: { p: V; d: number; k: boolean }[] = [
            { p: [ax, ay, az], d: da, k: ka },
            { p: [bx, by, bz], d: db, k: kb },
            { p: [cx, cy, cz], d: dc, k: kc },
        ];
        for (let i = 0; i < 3; i++) {
            const cur = corners[i]!;
            const next = corners[(i + 1) % 3]!;
            if (cur.k) verts.push(cur.p);
            if (cur.k !== next.k) {
                verts.push(
                    lerpCorner(cur.p[0], cur.p[1], cur.p[2], cur.d, next.p[0], next.p[1], next.p[2], next.d),
                );
            }
        }
        if (verts.length === 3) {
            pushTri(
                out,
                verts[0]![0],
                verts[0]![1],
                verts[0]![2],
                verts[1]![0],
                verts[1]![1],
                verts[1]![2],
                verts[2]![0],
                verts[2]![1],
                verts[2]![2],
            );
        } else if (verts.length === 4) {
            pushTri(
                out,
                verts[0]![0],
                verts[0]![1],
                verts[0]![2],
                verts[1]![0],
                verts[1]![1],
                verts[1]![2],
                verts[2]![0],
                verts[2]![1],
                verts[2]![2],
            );
            pushTri(
                out,
                verts[0]![0],
                verts[0]![1],
                verts[0]![2],
                verts[2]![0],
                verts[2]![1],
                verts[2]![2],
                verts[3]![0],
                verts[3]![1],
                verts[3]![2],
            );
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
    if (out.length > 0) {
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
    }
    return geo;
}

/** Apply a sequence of scan-local slice planes. */
export function applyScanSlicePlanes(geometry: BufferGeometry, planes: ScanSlicePlane[]): BufferGeometry {
    if (planes.length === 0) return geometry.clone();
    let current: BufferGeometry | null = null;
    for (const sp of planes) {
        const src = current ?? geometry;
        const next = sliceBufferGeometryByPlane(src, planeFromScanSlice(sp), sp.keepPositive);
        if (current) current.dispose();
        current = next;
    }
    return current ?? geometry.clone();
}

/**
 * Choose keepPositive so the majority of sample points (e.g. bbox center) are kept.
 */
export function keepPositiveTowardPoint(plane: THREE.Plane, point: THREE.Vector3): boolean {
    return plane.distanceToPoint(point) >= 0;
}
