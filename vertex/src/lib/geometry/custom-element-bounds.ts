// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as THREE from "three";

/** Axis-aligned bounds of a custom GLB element in mm (local space). */
export interface CustomElementBounds {
    sizeX: number;
    sizeY: number;
    sizeZ: number;
}

const DEFAULT_BOUNDS: CustomElementBounds = { sizeX: 14, sizeY: 14, sizeZ: 4 };

/** Compute bounds from a Three.js object (typically a saved custom element mesh). */
export function boundsFromObject(object: THREE.Object3D): CustomElementBounds {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return DEFAULT_BOUNDS;
    const size = box.getSize(new THREE.Vector3());
    return {
        sizeX: Math.max(2, size.x),
        sizeY: Math.max(2, size.y),
        sizeZ: Math.max(0.5, size.z),
    };
}

/** Registry of custom element bounds keyed by library item id. */
const boundsRegistry = new Map<string, CustomElementBounds>();

export function registerCustomElementBounds(id: string, bounds: CustomElementBounds): void {
    boundsRegistry.set(id, bounds);
}

export function getCustomElementBounds(id: string | undefined): CustomElementBounds {
    if (!id) return DEFAULT_BOUNDS;
    return boundsRegistry.get(id) ?? DEFAULT_BOUNDS;
}
