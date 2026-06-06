// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import * as THREE from "three";
import { getKernel } from "@/lib/chili3d/kernel";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import { extractPrimaryGeometry, loadGlbFromBuffer, loadGlbFromUrl } from "@/lib/library/loaders";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { useCustomLibraryStore } from "@/stores/custom-library-store";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

/** Builds export geometry for a side — custom prefab GLB or kernel insole solid. */
export async function buildExportGeometry(side: Side): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();

    if (design.customPrefabId) {
        const store = useCustomLibraryStore.getState();
        const local = store.getLocalGlb(design.customPrefabId);
        if (local) {
            const group = await loadGlbFromBuffer(base64ToArrayBuffer(local.glbBase64));
            const geo = extractPrimaryGeometry(group);
            group.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.geometry?.dispose();
                    (child.material as { dispose?: () => void })?.dispose?.();
                }
            });
            if (geo) return geo;
        }
        const prefab = store.customPrefabs.find((p) => p.id === design.customPrefabId);
        if (prefab?.url) {
            const group = await loadGlbFromUrl(prefab.url);
            const geo = extractPrimaryGeometry(group);
            if (geo) return geo;
        }
    }

    return getKernel().buildInsole(insoleParamsFromDesign(design, side, "full"));
}

/** Export STL bytes for the active design side. */
export async function buildExportStl(side: Side): Promise<ArrayBuffer> {
    const geometry = await buildExportGeometry(side);
    const kernel = getKernel();
    try {
        return kernel.exportSTL(geometry);
    } catch {
        return geometryToBinarySTL(geometry);
    } finally {
        geometry.dispose();
    }
}
