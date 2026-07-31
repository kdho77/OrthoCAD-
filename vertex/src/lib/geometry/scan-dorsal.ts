// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Derive the scan's dorsal direction from plantar surface normals.
 * Never trust vendor file axes — markers sit on the plantar aspect; outward
 * surface normals point away from the foot; dorsal is their negation.
 */

import type { BufferGeometry } from "three";
import * as THREE from "three";

export type ScanDorsalErrorCode = "plantar_normal_disagreement" | "no_normals" | "empty_neighbourhood";

export class ScanDorsalError extends Error {
    readonly code: ScanDorsalErrorCode;

    constructor(code: ScanDorsalErrorCode, message: string) {
        super(message);
        this.name = "ScanDorsalError";
        this.code = code;
    }
}

const DEFAULT_NEIGHBOURHOOD_RADIUS_MM = 5;

type V3 = { x: number; y: number; z: number };

function ensureNormals(geometry: BufferGeometry): void {
    if (!geometry.getAttribute("normal")) {
        geometry.computeVertexNormals();
    }
}

/**
 * Average vertex normals within `radiusMm` of `point`. Falls back to the
 * nearest vertex normal when the ball is empty.
 */
function neighbourhoodNormal(geometry: BufferGeometry, point: V3, radiusMm: number): THREE.Vector3 {
    ensureNormals(geometry);
    const pos = geometry.getAttribute("position");
    const nor = geometry.getAttribute("normal");
    if (!pos || !nor) {
        throw new ScanDorsalError("no_normals", "Scan geometry has no position/normal attributes");
    }

    const r2 = radiusMm * radiusMm;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let n = 0;
    let nearestD2 = Infinity;
    let nx = 0;
    let ny = 0;
    let nz = 1;

    for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        const py = pos.getY(i);
        const pz = pos.getZ(i);
        const dx = px - point.x;
        const dy = py - point.y;
        const dz = pz - point.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < nearestD2) {
            nearestD2 = d2;
            nx = nor.getX(i);
            ny = nor.getY(i);
            nz = nor.getZ(i);
        }
        if (d2 <= r2) {
            sx += nor.getX(i);
            sy += nor.getY(i);
            sz += nor.getZ(i);
            n++;
        }
    }

    if (n === 0) {
        if (!Number.isFinite(nearestD2)) {
            throw new ScanDorsalError("empty_neighbourhood", "No vertices near marker");
        }
        const v = new THREE.Vector3(nx, ny, nz);
        if (v.lengthSq() < 1e-20) {
            throw new ScanDorsalError("no_normals", "Nearest vertex normal is zero");
        }
        return v.normalize();
    }

    const v = new THREE.Vector3(sx / n, sy / n, sz / n);
    if (v.lengthSq() < 1e-20) {
        throw new ScanDorsalError("no_normals", "Neighbourhood normal averaged to zero");
    }
    return v.normalize();
}

/**
 * At each marker, average surface normals in a neighbourhood; average those
 * three; negate → dorsal. If any pairwise angle between the three averages
 * exceeds 90°, markers are not all on the plantar aspect.
 */
export function deriveScanDorsal(
    geometry: BufferGeometry,
    markers: readonly [V3, V3, V3],
    neighbourhoodRadiusMm = DEFAULT_NEIGHBOURHOOD_RADIUS_MM,
): THREE.Vector3 {
    const n0 = neighbourhoodNormal(geometry, markers[0], neighbourhoodRadiusMm);
    const n1 = neighbourhoodNormal(geometry, markers[1], neighbourhoodRadiusMm);
    const n2 = neighbourhoodNormal(geometry, markers[2], neighbourhoodRadiusMm);

    if (n0.dot(n1) < 0 || n0.dot(n2) < 0 || n1.dot(n2) < 0) {
        throw new ScanDorsalError(
            "plantar_normal_disagreement",
            "Marker neighbourhood normals disagree by more than 90° — not all on plantar aspect",
        );
    }

    const mean = n0.add(n1).add(n2).normalize();
    // Outward plantar normal points away from the foot; dorsal is its negation.
    return mean.multiplyScalar(-1);
}
