// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import * as THREE from "three";
import { getKernel } from "@/lib/chili3d/kernel";
import { exportObjectToGlb, meshFromGeometry } from "@/lib/geometry/glb-export";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import { insoleParamsFromDesign, isOcctKernelActive } from "@/lib/geometry/kernel-build";
import { extractPrimaryGeometry, loadGlbFromBuffer, loadGlbFromUrl } from "@/lib/library/loaders";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { getDesignTrimline, sampleDefaultOutline } from "@/lib/geometry/trimline";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
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

    return getKernel().buildInsole({
        ...insoleParamsFromDesign(design, side, "full"),
        trimline: getDesignTrimline(design, side),
    });
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

/**
 * Build the watertight tapered insole geometry intended for GLB export.
 *
 * Priority order:
 *   1. Custom-prefab GLB asset assigned to the design (unchanged behaviour).
 *   2. Trimline-driven mesh generator using the user's confirmed trimline (or
 *      the default parametric outline). Produces top + bottom + tapered side
 *      walls in one watertight, manifold mesh.
 *   3. OCCT/kernel-built solid as a final fallback so existing flows still
 *      work even if the trimline generator throws (e.g. degenerate inputs).
 */
export async function buildExportSolid(side: Side): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();

    if (design.customPrefabId) {
        // Custom prefab path is identical to the STL export — we honour the
        // user's chosen GLB asset rather than rebuilding from the trimline.
        const custom = await buildExportGeometry(side);
        return custom;
    }

    const params = insoleParamsFromDesign(design, side, "full");
    const trimline = getDesignTrimline(design, side) ?? sampleDefaultOutline(INSOLE_LENGTH_MM, INSOLE_WIDTH_MM);

    try {
        return await geometryEngine.buildTrimlineMesh({
            trimline,
            field: {
                side: params.side,
                lengthMm: params.lengthMm,
                widthMm: params.widthMm,
                thicknessMm: params.thicknessMm,
                corrections: params.corrections,
                elements: params.elements ?? [],
                includeSkives: true,
                includeElements: true,
                trimline,
            },
            // Defaults chosen to balance smoothness vs. slicer-friendly tri count.
            perimeterSamples: 192,
            topRings: 14,
            bottomRings: 10,
            bottomInsetMm: 2.5,
            minWallThicknessMm: Math.max(2.0, params.thicknessMm * 0.6),
            bottomZ: 0,
        });
    } catch (err) {
        // Fallback to the existing kernel/procedural path so the user still
        // gets *something* exportable when the trimline mesh fails.
        if (typeof console !== "undefined") {
            console.warn("[export-geometry] Trimline mesh failed, falling back to kernel build:", err);
        }
        if (isOcctKernelActive()) {
            return getKernel().buildInsole({ ...params, trimline });
        }
        return buildExportGeometry(side);
    }
}

/**
 * Export GLB bytes for the active design side. Wraps the watertight tapered
 * solid in a `THREE.Mesh` carrying side / thickness / trimline metadata as
 * GLTF `extras`, then serialises with `GLTFExporter`.
 */
export async function buildExportGlb(side: Side): Promise<ArrayBuffer> {
    const { design } = useDesignStore.getState();
    const geometry = await buildExportSolid(side);
    try {
        const mesh = meshFromGeometry(geometry);
        mesh.name = `insole_${side}`;
        const trimline = design.trimlines?.[side];
        mesh.userData = {
            side,
            thicknessMm: design.thicknessMm,
            trimlineVersion: trimline ? trimline.length : 0,
            generator: "vertex-trimline-mesh",
            generatedAt: new Date().toISOString(),
        };
        const { arrayBuffer } = await exportObjectToGlb(mesh);
        // Dispose temporary material so we don't leak GPU resources in long sessions.
        const mat = mesh.material as { dispose?: () => void };
        mat?.dispose?.();
        return arrayBuffer;
    } finally {
        geometry.dispose();
    }
}
