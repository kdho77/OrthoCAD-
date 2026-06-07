import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
 * Bake a single mesh's geometry into world space as a plain, **de-interleaved**,
 * non-indexed geometry carrying only `position` + `normal`.
 *
 * De-interleaving is the crucial step: GLB files (e.g. exported from Rhino) very
 * often store `position`/`normal` as `InterleavedBufferAttribute`s, which
 * `mergeGeometries` cannot merge. Reading every component through `getX/getY/getZ`
 * flattens both interleaved and indexed layouts into a contiguous `Float32Array`
 * so the parts can always be concatenated reliably.
 */
function bakeMeshGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
    let g = mesh.geometry.clone();
    // Expand the index so every triangle vertex is explicit (per-mesh weld/seams
    // are restored later by `mergeVertices` on the combined geometry).
    if (g.index) {
        const ni = g.toNonIndexed();
        g.dispose();
        g = ni;
    }
    // Bake the full world transform (position + normal via the normal matrix) so
    // separate "Top"/"Bottom" meshes land in their correct, aligned positions.
    g.applyMatrix4(mesh.matrixWorld);

    const src = g.getAttribute("position");
    const count = src.count;
    const position = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        position[i * 3] = src.getX(i);
        position[i * 3 + 1] = src.getY(i);
        position[i * 3 + 2] = src.getZ(i);
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(position, 3));

    const srcN = g.getAttribute("normal");
    if (srcN && srcN.count === count) {
        const normal = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            normal[i * 3] = srcN.getX(i);
            normal[i * 3 + 1] = srcN.getY(i);
            normal[i * 3 + 2] = srcN.getZ(i);
        }
        out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    }

    g.dispose();
    if (!out.getAttribute("normal")) out.computeVertexNormals();
    return out;
}

/** Concatenate baked parts (plain position + normal arrays) into one geometry. */
function concatGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    let total = 0;
    for (const p of parts) total += p.getAttribute("position").count;

    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    let offset = 0;
    for (const p of parts) {
        const pos = p.getAttribute("position").array as ArrayLike<number>;
        const nor = p.getAttribute("normal")?.array as ArrayLike<number> | undefined;
        position.set(pos as ArrayLike<number> & Float32Array, offset);
        if (nor) normal.set(nor as ArrayLike<number> & Float32Array, offset);
        offset += pos.length;
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(position, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    return out;
}

/**
 * Merge every mesh inside a loaded GLB group into a single geometry, baking each
 * mesh's world transform. Bases authored as separate "Top" / "Bottom" meshes are
 * combined into one surface so the Base + Modifier deformation treats the whole
 * shell as the base. Only position + normal are kept (the deformation pipeline
 * recomputes normals); duplicate vertices are welded so adjacency-based smoothing
 * still works. Returns `null` when the group contains no mesh geometry.
 *
 * Parts are normalised to plain (de-interleaved) arrays and concatenated directly
 * rather than via `mergeGeometries`, which silently fails on the interleaved
 * attribute layouts GLB exporters emit — previously that failure dropped every
 * sub-mesh except the first, leaving an offset/flat partial surface in the viewer.
 */
export function extractMergedGeometry(group: THREE.Group): MergedGlbGeometry | null {
    group.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    const meshNames: string[] = [];

    group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
        parts.push(bakeMeshGeometry(obj));
        meshNames.push(obj.name || `mesh_${parts.length}`);
    });

    if (parts.length === 0) return null;

    const meshCount = parts.length;
    const combined = meshCount === 1 ? parts[0]! : concatGeometries(parts);
    if (meshCount > 1) {
        for (const p of parts) p.dispose();
    }

    let geometry: THREE.BufferGeometry;
    try {
        geometry = mergeVertices(combined);
        if (geometry !== combined) combined.dispose();
    } catch {
        geometry = combined;
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    // Mark multi-mesh bases so that applyBaseModifiers can preserve exact
    // relative alignment between "Top" and "Bottom" layers (uniform delta
    // instead of topFactor-weighted, which would anchor one layer).
    if (meshCount > 1) {
        geometry.userData = geometry.userData || {};
        (geometry.userData as any).isMultiMeshBase = true;
        (geometry.userData as any).sourceMeshNames = meshNames;
    }

    return { geometry, meshCount, meshNames };
}

/**
 * Mirror a base geometry across its sagittal plane (Left ↔ Right). The width
 * axis (medial↔lateral) is detected from the geometry's extents — the middle of
 * its three bounding-box dimensions, matching the Base + Modifier axis
 * resolution — and every vertex is reflected about the width-axis centre. The
 * reflection inverts triangle winding, so the index order is reversed and
 * normals recomputed to keep the surface facing outward. The result stays a
 * clean, single, welded base that the deformation pipeline can consume directly.
 */
export function mirrorGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
    const g = geometry.clone();
    g.computeBoundingBox();
    const box = g.boundingBox;
    if (!box) return g;

    const sizes: [number, number][] = [
        [0, box.max.x - box.min.x],
        [1, box.max.y - box.min.y],
        [2, box.max.z - box.min.z],
    ];
    sizes.sort((a, b) => a[1] - b[1]);
    const widthAxis = sizes[1]![0];
    const minByAxis = [box.min.x, box.min.y, box.min.z];
    const maxByAxis = [box.max.x, box.max.y, box.max.z];
    const center = (minByAxis[widthAxis]! + maxByAxis[widthAxis]!) / 2;

    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
        const v = pos.getComponent(i, widthAxis);
        pos.setComponent(i, widthAxis, 2 * center - v);
    }
    pos.needsUpdate = true;

    // A reflection flips orientation: reverse winding so faces stay outward.
    if (g.index) {
        const idx = g.index.array;
        for (let i = 0; i < idx.length; i += 3) {
            const tmp = idx[i + 1]!;
            (idx as Uint32Array | Uint16Array)[i + 1] = idx[i + 2]!;
            (idx as Uint32Array | Uint16Array)[i + 2] = tmp;
        }
        g.index.needsUpdate = true;
    } else {
        const arr = pos.array as Float32Array;
        for (let i = 0; i < pos.count; i += 3) {
            for (let c = 0; c < 3; c++) {
                const a = (i + 1) * 3 + c;
                const b = (i + 2) * 3 + c;
                const tmp = arr[a]!;
                arr[a] = arr[b]!;
                arr[b] = tmp;
            }
        }
    }

    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
}

/** Count the meshes in a loaded GLB group (for upload validation / UI hints). */
export function countMeshes(group: THREE.Group): { count: number; names: string[] } {
    const names: string[] = [];
    group.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry) names.push(obj.name || `mesh_${names.length + 1}`);
    });
    return { count: names.length, names };
}
