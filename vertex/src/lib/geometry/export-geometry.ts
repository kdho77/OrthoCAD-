// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { getKernel, isAuthoritativeKernel } from "@/lib/chili3d/kernel";
import { baseModifierField, getDesignBase, loadBaseGeometry } from "@/lib/geometry/base-asset";
import { exportObjectToGlb, meshFromGeometry } from "@/lib/geometry/glb-export";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import { insoleParamsFromDesign, isOcctKernelActive } from "@/lib/geometry/kernel-build";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { getDesignTrimline, sampleDefaultOutline } from "@/lib/geometry/trimline";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { useDesignStore } from "@/stores/design-store";
import type { DesignState, Side } from "@/types";

/**
 * Build the base template geometry for a side with the design's modifiers
 * (corrections / elements) applied via the active kernel. Returns `null` when
 * the design has no base or the base mesh cannot be loaded, so callers fall
 * back to parametric generation.
 */
async function buildModifiedBaseGeometry(design: DesignState, side: Side): Promise<BufferGeometry | null> {
    const base = getDesignBase(design);
    if (!base) return null;
    const raw = await loadBaseGeometry(base);
    if (!raw) return null;
    try {
        const field = baseModifierField(design, side, design.thicknessMm);
        const result = getKernel().buildFromBase(raw, field);
        return result.geometry;
    } finally {
        raw.dispose();
    }
}

/** Builds export geometry for a side — base+modifiers or kernel insole solid. */
export async function buildExportGeometry(side: Side): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();

    const modifiedBase = await buildModifiedBaseGeometry(design, side);
    if (modifiedBase) return modifiedBase;

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
 * Priority order (see docs/hybrid-geometry-architecture.md):
 *   1. Custom-prefab GLB asset assigned to the design (unchanged behaviour).
 *   2. OCCT authoritative solid when the WASM kernel is active and it yields a
 *      closed (watertight) BRep — the high-quality manufacturing path.
 *   3. Trimline-driven mesh generator using the user's confirmed trimline (or
 *      the default parametric outline). Produces top + bottom + tapered side
 *      walls in one watertight, manifold mesh.
 *   4. OCCT/kernel-built solid as a final fallback so existing flows still
 *      work even if the trimline generator throws (e.g. degenerate inputs).
 */
export async function buildExportSolid(side: Side): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();

    // Base + Modifier path: honour the user's base template, with the design's
    // corrections / elements applied on top (rather than rebuilding from the
    // trimline). Falls through to parametric generation when there is no base.
    const modifiedBase = await buildModifiedBaseGeometry(design, side);
    if (modifiedBase) return modifiedBase;

    const params = insoleParamsFromDesign(design, side, "full");
    const trimline = getDesignTrimline(design, side) ?? sampleDefaultOutline(INSOLE_LENGTH_MM, INSOLE_WIDTH_MM);

    // Authoritative OCCT solid first when available — use it only when OCCT
    // confirms a closed solid, otherwise fall through to the procedural mesh.
    if (isAuthoritativeKernel()) {
        try {
            const solid = getKernel().buildInsoleSolid({ ...params, trimline });
            if (solid.manifold.occtClosed || solid.manifold.isWatertight) {
                return solid.geometry;
            }
            solid.geometry.dispose();
        } catch (err) {
            if (typeof console !== "undefined") {
                console.warn("[export-geometry] OCCT solid unavailable, using trimline mesh:", err);
            }
        }
    }

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
