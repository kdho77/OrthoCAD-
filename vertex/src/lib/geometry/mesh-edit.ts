import * as THREE from "three";

export interface TrimLine {
    id: string;
    points: THREE.Vector3[];
}

/** Apply per-vertex offsets to a geometry clone. */
export function applyVertexOverrides(
    geometry: THREE.BufferGeometry,
    overrides: Map<number, THREE.Vector3>,
): THREE.BufferGeometry {
    if (overrides.size === 0) return geometry;
    const g = geometry.clone();
    const pos = g.getAttribute("position");
    for (const [idx, v] of overrides) {
        if (idx < pos.count) {
            pos.setXYZ(idx, v.x, v.y, v.z);
        }
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
}

/**
 * Simplified trim: vertices on the negative side of the trim polyline plane
 * (average normal from polyline) are projected toward the boundary.
 * For the procedural kernel this gives a visible trim effect without OCCT booleans.
 */
export function applyTrimLines(
    geometry: THREE.BufferGeometry,
    trimLines: TrimLine[],
): THREE.BufferGeometry {
    if (trimLines.length === 0 || trimLines.every((t) => t.points.length < 2)) {
        return geometry;
    }
    const g = geometry.clone();
    const pos = g.getAttribute("position");

    for (const line of trimLines) {
        if (line.points.length < 2) continue;
        const a = line.points[0]!;
        const b = line.points[line.points.length - 1]!;
        const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
        const dir = new THREE.Vector3().subVectors(b, a).normalize();
        const normal = new THREE.Vector3(-dir.y, dir.x, 0).normalize();

        for (let i = 0; i < pos.count; i++) {
            const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
            const d = p.clone().sub(mid).dot(normal);
            if (d < 0) {
                p.addScaledVector(normal, -d * 0.85);
                pos.setXYZ(i, p.x, p.y, p.z);
            }
        }
    }

    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
}

/** Pick the nearest vertex index to a world-space point. */
export function nearestVertexIndex(
    geometry: THREE.BufferGeometry,
    worldPoint: THREE.Vector3,
    matrixWorld: THREE.Matrix4,
): number {
    const inv = matrixWorld.clone().invert();
    const local = worldPoint.clone().applyMatrix4(inv);
    const pos = geometry.getAttribute("position");
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - local.x;
        const dy = pos.getY(i) - local.y;
        const dz = pos.getZ(i) - local.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}
