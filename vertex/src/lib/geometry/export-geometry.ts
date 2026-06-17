// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { ensureKernelReady, getKernel, isAuthoritativeKernel, isKernelInitFailed } from "@/lib/chili3d/kernel";
import { baseModifierFieldAuthoritative, getDesignBase, loadBaseGeometry } from "@/lib/geometry/base-asset";
import { exportObjectToGlb, meshFromGeometry } from "@/lib/geometry/glb-export";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import { insoleParamsFromDesign, isOcctKernelActive } from "@/lib/geometry/kernel-build";
import { closeGlbInsoleToSolid } from "@/lib/geometry/mesh-close";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { getDesignTrimline, sampleDefaultOutline } from "@/lib/geometry/trimline";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { useDesignStore } from "@/stores/design-store";
import type { DesignState, ProductionMethod, Side } from "@/types";

/** Export routing: manufacturing uses OCCT sew first; preview uses mesh-close. */
export type ExportMode = "preview" | "manufacturing";

export function exportModeFromMethod(method: ProductionMethod): ExportMode {
    return method === "printing_solid" || method === "milling_3axis" ? "manufacturing" : "preview";
}

export interface BuildExportStlOptions {
    exportMode?: ExportMode;
}

/**
 * Build the base template geometry for a side with the design's modifiers
 * (corrections / elements) applied via the active kernel. Returns `null` when
 * the design has no base or the base mesh cannot be loaded, so callers fall
 * back to parametric generation.
 */
async function buildModifiedBaseGeometry(
    design: DesignState,
    side: Side,
    smoothingIterations = 2,
): Promise<BufferGeometry | null> {
    const base = getDesignBase(design, side);
    if (!base) return null;
    const raw = await loadBaseGeometry(base);
    if (!raw) return null;
    try {
        const effThickness = design.paired
            ? side === "left"
                ? design.paired.leftThicknessMm
                : design.paired.rightThicknessMm
            : design.thicknessMm;
        const field = baseModifierFieldAuthoritative(design, side, effThickness);
        const result = getKernel().buildFromBase(raw, field, smoothingIterations);
        return result.geometry;
    } finally {
        raw.dispose();
    }
}

/** Load raw base GLB geometry without modifier deformation (for OCCT sew input). */
async function loadRawBaseGeometry(design: DesignState, side: Side): Promise<BufferGeometry | null> {
    const base = getDesignBase(design, side);
    if (!base) return null;
    return loadBaseGeometry(base);
}

/** PATH A — OCCT sew manufacturing STL from raw GLB base (test hook). */
export async function exportManufacturingStlAttempt(
    design: DesignState,
    side: Side,
): Promise<ArrayBuffer | null> {
    return tryOcctManufacturingStl(design, side);
}

/** PATH A — OCCT sew manufacturing STL from raw GLB base. */
async function tryOcctManufacturingStl(design: DesignState, side: Side): Promise<ArrayBuffer | null> {
    if (isKernelInitFailed()) {
        if (typeof console !== "undefined") {
            console.log("[EXPORT] OCCT unavailable — using mesh-close fallback");
        }
        return null;
    }

    const kernelReady = await ensureKernelReady();
    if (!kernelReady) {
        if (typeof console !== "undefined") {
            console.log("[EXPORT] OCCT unavailable — using mesh-close fallback");
        }
        return null;
    }

    const raw = await loadRawBaseGeometry(design, side);
    if (!raw) return null;

    try {
        const effThickness = design.paired
            ? side === "left"
                ? design.paired.leftThicknessMm
                : design.paired.rightThicknessMm
            : design.thicknessMm;
        const field = baseModifierFieldAuthoritative(design, side, effThickness);
        const kernel = getKernel();
        if (!kernel.ready || typeof kernel.exportManufacturingStlFromBase !== "function") {
            if (typeof console !== "undefined") {
                console.error("[EXPORT] OCCT kernel not ready — falling back");
            }
            return null;
        }
        const stl = kernel.exportManufacturingStlFromBase(raw, field) ?? null;
        if (stl) {
            if (typeof console !== "undefined") {
                console.log("[EXPORT] OCCT sew path: success");
            }
            return stl;
        }
        if (typeof console !== "undefined") {
            console.warn("[EXPORT] OCCT sew path: failed reason=sew returned null — falling back to mesh-close");
        }
        return null;
    } catch (err) {
        if (typeof console !== "undefined") {
            const reason = err instanceof Error ? err.message : String(err);
            console.warn(`[EXPORT] OCCT sew path failed: ${reason} — falling back to mesh-close`);
        }
        return null;
    } finally {
        raw.dispose();
    }
}

/** Builds export geometry for a side — base+modifiers only; no parametric fallback. */
export async function buildExportGeometry(side: Side): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();

    const modifiedBase = await buildModifiedBaseGeometry(design, side);
    if (modifiedBase) return modifiedBase;

    throw new Error(
        "[EXPORT] No GLB base geometry available. " +
            "Load a stock base before exporting. " +
            "Parametric export is not supported.",
    );
}

/** Export STL bytes for the active design side. */
export async function buildExportStl(side: Side, _options: BuildExportStlOptions = {}): Promise<ArrayBuffer> {
    const { design } = useDesignStore.getState();
    const modifiedBase = await buildModifiedBaseGeometry(design, side, 0);
    if (!modifiedBase) {
        throw new Error(
            "[EXPORT] No GLB base geometry available. " +
                "Load a stock base before exporting. " +
                "Parametric export is not supported.",
        );
    }
    const geometry = modifiedBase;
    try {
        if (typeof console !== "undefined") {
            console.log("[EXPORT] closing GLB insole rims...");
        }
        const solid = closeGlbInsoleToSolid(geometry);
        try {
            return geometryToBinarySTL(solid);
        } finally {
            solid.dispose();
        }
    } catch (e) {
        if (typeof console !== "undefined") {
            console.error("[EXPORT] export failed:", e);
        }
        throw e;
    } finally {
        geometry.dispose();
    }
}

/**
 * Build export geometry for GLB download / viewer preview — does NOT run mesh-close.
 */
export async function buildExportGlbGeometry(side: Side): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();

    const modifiedBase = await buildModifiedBaseGeometry(design, side);
    if (modifiedBase) return modifiedBase;

    const params = insoleParamsFromDesign(design, side, "full");
    const trimline = getDesignTrimline(design, side) ?? sampleDefaultOutline(INSOLE_LENGTH_MM, INSOLE_WIDTH_MM);

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
            perimeterSamples: 192,
            topRings: 14,
            bottomRings: 10,
            bottomInsetMm: 2.5,
            minWallThicknessMm: Math.max(2.0, params.thicknessMm * 0.6),
            bottomZ: 0,
        });
    } catch (err) {
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
 * Build the watertight tapered insole geometry intended for manufacturing pipelines
 * that need a BufferGeometry (e.g. hybrid server upload). Manufacturing mode skips
 * mesh-close when OCCT already produced a solid.
 */
export async function buildExportSolid(
    side: Side,
    options: BuildExportStlOptions = {},
): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();
    const exportMode = options.exportMode ?? exportModeFromMethod(design.method);

    if (exportMode === "manufacturing" && isAuthoritativeKernel()) {
        const raw = await loadRawBaseGeometry(design, side);
        if (raw) {
            try {
                const effThickness = design.paired
                    ? side === "left"
                        ? design.paired.leftThicknessMm
                        : design.paired.rightThicknessMm
                    : design.thicknessMm;
                const field = baseModifierFieldAuthoritative(design, side, effThickness);
                const result = getKernel().buildFromBase(raw, field, 2);
                if (result.manifold.occtClosed || result.manifold.isWatertight) {
                    return result.geometry;
                }
                result.geometry.dispose();
            } finally {
                raw.dispose();
            }
        }
    }

    const geometry = await buildExportGlbGeometry(side);
    if (exportMode === "manufacturing") {
        return closeGlbInsoleToSolid(geometry);
    }
    return geometry;
}

/**
 * Export GLB bytes for download — preview geometry without mesh-close watertight pass.
 */
export async function buildExportGlb(side: Side): Promise<ArrayBuffer> {
    const { design } = useDesignStore.getState();
    const geometry = await buildExportGlbGeometry(side);
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
        const mat = mesh.material as { dispose?: () => void };
        mat?.dispose?.();
        return arrayBuffer;
    } finally {
        geometry.dispose();
    }
}
