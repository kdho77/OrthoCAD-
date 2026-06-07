import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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

/** Result of inspecting all meshes inside a loaded GLB. */
export interface MergedGlbGeometry {
    /** Combined, welded geometry baked into world space (position + normal). */
    geometry: THREE.BufferGeometry;
    /** Number of source meshes that were merged. */
    meshCount: number;
    /** Names of the source meshes (e.g. ["Top", "Bottom"]). */
    meshNames: string[];
}

/**
 * Merge every mesh inside a loaded GLB group into a single geometry, baking each
 * mesh's world transform. Bases authored as separate "Top" / "Bottom" meshes are
 * combined into one surface so the Base + Modifier deformation treats the whole
 * shell as the base. Only position + normal are kept (the deformation pipeline
 * recomputes normals); duplicate vertices are welded so adjacency-based smoothing
 * still works. Returns `null` when the group contains no mesh geometry.
 */
export function extractMergedGeometry(group: THREE.Group): MergedGlbGeometry | null {
    group.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    const meshNames: string[] = [];

    group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
        const g = obj.geometry.clone();
        g.applyMatrix4(obj.matrixWorld);
        // Reduce to position + normal so every part shares the same attribute set
        // (a hard requirement for mergeGeometries) regardless of UVs/colors/etc.
        for (const name of Object.keys(g.attributes)) {
            if (name !== "position" && name !== "normal") g.deleteAttribute(name);
        }
        if (!g.getAttribute("normal")) g.computeVertexNormals();
        g.morphAttributes = {};
        parts.push(g.index ? g.toNonIndexed() : g);
        meshNames.push(obj.name || `mesh_${parts.length}`);
    });

    if (parts.length === 0) return null;

    const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
    if (!merged) {
        // Fallback: if attribute sets still mismatch, use the first part alone.
        return { geometry: parts[0]!, meshCount: parts.length, meshNames };
    }

    let geometry: THREE.BufferGeometry;
    try {
        geometry = mergeVertices(merged);
    } catch {
        geometry = merged;
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, meshCount: parts.length, meshNames };
}

/** Count the meshes in a loaded GLB group (for upload validation / UI hints). */
export function countMeshes(group: THREE.Group): { count: number; names: string[] } {
    const names: string[] = [];
    group.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry) names.push(obj.name || `mesh_${names.length + 1}`);
    });
    return { count: names.length, names };
}
