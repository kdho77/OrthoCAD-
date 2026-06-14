// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { ensureKernelReady, getKernel, isAuthoritativeKernel, isKernelInitFailed } from "@/lib/chili3d/kernel";
import { baseModifierFieldAuthoritative, getDesignBase, loadBaseGeometry } from "@/lib/geometry/base-asset";
import { exportObjectToGlb, meshFromGeometry } from "@/lib/geometry/glb-export";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import { insoleParamsFromDesign, isOcctKernelActive } from "@/lib/geometry/kernel-build";
import { ensureWatertightForExport } from "@/lib/geometry/mesh-close";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { getDesignTrimline, sampleDefaultOutline } from "@/lib/geometry/trimline";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { useDesignStore } from "@/stores/design-store";
import type { DesignState, ProductionMethod, Side } from "@/types";

/** Export routing: manufacturing uses OCCT sew first; preview uses mesh-close. */
export type ExportMode = "preview" | "manufacturing";

/** Thrown when a design references a base GLB that has not finished loading yet. */
export class ExportGeometryNotReadyError extends Error {
    constructor(message = "Geometry not ready, please wait for the base model to finish loading.") {
        super(message);
        this.name = "ExportGeometryNotReadyError";
    }
}

/** Thrown when manufacturing export exceeds the client-side time limit. */
export class ExportTimeoutError extends Error {
    constructor(message = "Export timed out — please try again.") {
        super(message);
        this.name = "ExportTimeoutError";
    }
}

/** Thrown when OCCT is required for manufacturing export but is unavailable. */
export class ExportKernelUnavailableError extends Error {
    constructor(
        message = "Export requires OpenCascade kernel. Please wait for the kernel to load and try again.",
    ) {
        super(message);
        this.name = "ExportKernelUnavailableError";
    }
}

/** Default client-side export timeout (manufacturing OCCT + GLB load). */
export const EXPORT_OPERATION_TIMEOUT_MS = 30_000;

/** @internal Test hook to shorten export timeout in unit tests. */
let exportTimeoutMsOverride: number | null = null;

/** @internal Reset after each test that overrides the export timeout. */
export function setExportTimeoutMsForTesting(value: number | null): void {
    exportTimeoutMsOverride = value;
}

/** Reject when an export operation exceeds the configured timeout. */
export async function withExportTimeout<T>(
    promise: Promise<T>,
    timeoutMs = exportTimeoutMsOverride ?? EXPORT_OPERATION_TIMEOUT_MS,
): Promise<T> {
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => {
                    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
                    if (typeof console !== "undefined") {
                        console.error(
                            `[EXPORT] timed out after ${elapsed.toFixed(0)}ms (limit ${timeoutMs}ms)`,
                        );
                    }
                    reject(new ExportTimeoutError());
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

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
async function buildModifiedBaseGeometry(design: DesignState, side: Side): Promise<BufferGeometry | null> {
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
        const result = getKernel().buildFromBase(raw, field, 2);
        return result.geometry;
    } finally {
        raw.dispose();
    }
}

function logMeshClosePath(geometry: BufferGeometry): void {
    if (typeof console === "undefined") return;
    const userData = geometry.userData as { isMultiMeshBase?: boolean; topVertexCount?: number };
    const total = geometry.getAttribute("position").count;
    const topVerts =
        userData.topVertexCount && userData.topVertexCount > 0 && userData.topVertexCount < total
            ? userData.topVertexCount
            : userData.isMultiMeshBase
              ? Math.floor(total / 2)
              : total;
    const bottomVerts = userData.isMultiMeshBase ? Math.max(0, total - topVerts) : 0;
    console.log(`[EXPORT] fallback mesh-close path: topVerts=${topVerts} bottomVerts=${bottomVerts}`);
}

function exportStlFromGeometry(geometry: BufferGeometry): ArrayBuffer {
    const kernel = getKernel();
    try {
        return kernel.exportSTL(geometry);
    } catch {
        return geometryToBinarySTL(geometry);
    }
}

/** PATH B — mesh-close preview / fallback STL export. */
function buildPreviewStlFromGeometry(geometry: BufferGeometry): ArrayBuffer {
    logMeshClosePath(geometry);
    const closed = ensureWatertightForExport(geometry);
    try {
        return exportStlFromGeometry(closed);
    } finally {
        if (closed !== geometry) closed.dispose();
    }
}

/** PATH A — OCCT sew manufacturing STL from raw GLB base (test hook). */
export async function exportManufacturingStlAttempt(
    design: DesignState,
    side: Side,
): Promise<ArrayBuffer | null> {
    try {
        return await tryOcctManufacturingStl(design, side);
    } catch {
        return null;
    }
}

/**
 * PATH A — manufacturing STL via buildInsoleSolid (same parametric path as the viewer OCCT badge).
 * Never loads GLB mesh, sealBottomSlits, or mesh-close on the main thread.
 */
async function tryOcctManufacturingStl(design: DesignState, side: Side): Promise<ArrayBuffer> {
    if (isKernelInitFailed()) {
        throw new ExportKernelUnavailableError();
    }

    const kernelReady = await ensureKernelReady();
    if (!kernelReady) {
        throw new ExportKernelUnavailableError();
    }

    const kernel = getKernel();
    if (!kernel.ready) {
        throw new ExportKernelUnavailableError();
    }

    const params = insoleParamsFromDesign(design, side, "full");
    const trimline = getDesignTrimline(design, side) ?? sampleDefaultOutline(INSOLE_LENGTH_MM, INSOLE_WIDTH_MM);

    try {
        const solid = kernel.buildInsoleSolid({ ...params, trimline });
        try {
            if (!solid.manifold.occtClosed && !solid.manifold.isWatertight) {
                if (typeof console !== "undefined") {
                    console.warn(
                        `[EXPORT] buildInsoleSolid not watertight: openEdges=${solid.manifold.openEdges} tris=${solid.manifold.triangleCount}`,
                    );
                }
                throw new ExportKernelUnavailableError();
            }
            if (typeof console !== "undefined") {
                console.log("[EXPORT] OCCT sew path: success (buildInsoleSolid)");
            }
            return kernel.exportSTL(solid.geometry);
        } finally {
            solid.geometry.dispose();
        }
    } catch (err) {
        if (
            err instanceof ExportKernelUnavailableError ||
            err instanceof ExportTimeoutError
        ) {
            throw err;
        }
        if (typeof console !== "undefined") {
            const reason = err instanceof Error ? err.message : String(err);
            console.warn(`[EXPORT] buildInsoleSolid export failed: ${reason}`);
        }
        throw new ExportKernelUnavailableError();
    }
}

/** Builds export geometry for a side — base+modifiers or kernel insole solid. */
export async function buildExportGeometry(side: Side): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();
    const base = getDesignBase(design, side);

    const modifiedBase = await buildModifiedBaseGeometry(design, side);
    if (modifiedBase) return modifiedBase;

    if (base) {
        throw new ExportGeometryNotReadyError();
    }

    return getKernel().buildInsole({
        ...insoleParamsFromDesign(design, side, "full"),
        trimline: getDesignTrimline(design, side),
    });
}

/** Export STL bytes for the active design side. */
export async function buildExportStl(side: Side, options: BuildExportStlOptions = {}): Promise<ArrayBuffer> {
    const run = async (): Promise<ArrayBuffer> => {
        const { design } = useDesignStore.getState();
        const exportMode = options.exportMode ?? exportModeFromMethod(design.method);

        if (exportMode === "manufacturing") {
            return tryOcctManufacturingStl(design, side);
        }

        let geometry = await buildExportGeometry(side);
        try {
            return buildPreviewStlFromGeometry(geometry);
        } finally {
            geometry.dispose();
        }
    };

    return withExportTimeout(run());
}

/**
 * Build export geometry for GLB download / viewer preview — does NOT run mesh-close.
 */
export async function buildExportGlbGeometry(side: Side): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();
    const base = getDesignBase(design, side);

    const modifiedBase = await buildModifiedBaseGeometry(design, side);
    if (modifiedBase) return modifiedBase;

    if (base) {
        throw new ExportGeometryNotReadyError();
    }

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
        const params = insoleParamsFromDesign(design, side, "full");
        const trimline = getDesignTrimline(design, side) ?? sampleDefaultOutline(INSOLE_LENGTH_MM, INSOLE_WIDTH_MM);
        try {
            const solid = getKernel().buildInsoleSolid({ ...params, trimline });
            if (solid.manifold.occtClosed || solid.manifold.isWatertight) {
                return solid.geometry;
            }
            solid.geometry.dispose();
        } catch {
            // fall through to GLB / trimline mesh paths
        }
    }

    const geometry = await buildExportGlbGeometry(side);
    if (exportMode === "manufacturing") {
        return ensureWatertightForExport(geometry);
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
