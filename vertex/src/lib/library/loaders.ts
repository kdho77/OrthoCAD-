import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";

const loader = new GLTFLoader();

/** Load a GLB from a URL or ArrayBuffer into a Three.js group. */
export async function loadGlbFromUrl(url: string): Promise<THREE.Group> {
    const gltf = await loader.loadAsync(url);
    const group = new THREE.Group();
    group.add(gltf.scene);
    return group;
}

/** Load a GLB from raw bytes (offline / local library). */
export async function loadGlbFromBuffer(buffer: ArrayBuffer): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
        loader.parse(
            buffer,
            "",
            (gltf) => {
                const group = new THREE.Group();
                group.add(gltf.scene);
                resolve(group);
            },
            reject,
        );
    });
}

/** Extract the first mesh geometry from a loaded GLB group (for preview/placement). */
export function extractPrimaryGeometry(group: THREE.Group): THREE.BufferGeometry | null {
    let found: THREE.BufferGeometry | null = null;
    group.traverse((obj) => {
        if (found) return;
        if (obj instanceof THREE.Mesh && obj.geometry) {
            found = obj.geometry.clone();
        }
    });
    return found;
}
