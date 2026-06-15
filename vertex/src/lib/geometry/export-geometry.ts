// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { getKernel, isAuthoritativeKernel } from "@/lib/chili3d/kernel";
import { baseModifierFieldAuthoritative, getDesignBase, loadBaseGeometry } from "@/lib/geometry/base-asset";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import { exportObjectToGlb, meshFromGeometry } from "@/lib/geometry/glb-export";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import { EXPORT_BOTTOM_FULL_MESH_LIMIT, closeLiveViewerMeshToSolid } from "@/lib/geometry/mesh-export";
import {
    preextractExportBottomRimLoop,
    rimPointsFromVectors,
    type ExportRimPoint,
} from "@/lib/geometry/mesh-close";
import {
    geometryToExportPayload,
    runMeshExportWorker,
} from "@/lib/geometry/mesh-export-worker-runner";
import { insoleParamsFromDesign, isOcctKernelActive } from "@/lib/geometry/kernel-build";
import { getDesignTrimline, sampleDefaultOutline } from "@/lib/geometry/trimline";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { useDesignStore } from "@/stores/design-store";
import {
    getLiveViewerGeometry,
    isViewerGeometryBuilding,
} from "@/stores/viewer-geometry-store";
import type { DesignState, ProductionMethod, Side } from "@/types";

/** Export routing: manufacturing uses direct mesh-close; preview uses the same live mesh path. */
export type ExportMode = "preview" | "manufacturing";

/** Thrown when live viewer geometry is not available for export. */
export class ExportGeometryNotReadyError extends Error {
    constructor(
        message = "Insole geometry not loaded — open the viewer before exporting.",
    ) {
        super(message);
        this.name = "ExportGeometryNotReadyError";
    }
}

/** Thrown when export exceeds the client-side time limit. */
export class ExportTimeoutError extends Error {
    constructor(message = "Export timed out — please try again.") {
        super(message);
        this.name = "ExportTimeoutError";
    }
}

/** @deprecated Export no longer requires OCCT — retained for export-service error handling. */
export class ExportKernelUnavailableError extends Error {
    constructor(
        message = "Export requires OpenCascade kernel. Please wait for the kernel to load and try again.",
    ) {
        super(message);
        this.name = "ExportKernelUnavailableError";
    }
}

/** Default client-side export timeout (worker closure on large stock GLB). */
// 120s: worker processes ~42k top + 446 rim verts; full-mesh edge extraction takes 35-60s on Default.glb
export const EXPORT_OPERATION_TIMEOUT_MS = 120_000;

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
 * Build the base template geometry for a side with modifiers applied (viewer parity).
 * Returns `null` when the design has no base or the base mesh cannot be loaded.
 */
async function buildModifiedBaseGeometry(design: DesignState, side: Side): Promise<BufferGeometry | null> {
    const base = getDesignBase(design, side);
    if (!base) return null;
    const raw = await loadBaseGeometry(base, { sealBottomSlits: false });
    if (!raw) return null;
    try {
        const effThickness = design.paired
            ? side === "left"
                ? design.paired.leftThicknessMm
                : design.paired.rightThicknessMm
            : design.thicknessMm;
        const field = baseModifierFieldAuthoritative(design, side, effThickness);
        return applyBaseModifiers(raw, field, 2);
    } finally {
        raw.dispose();
    }
}

function logDirectMeshPath(geometry: BufferGeometry): void {
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
    console.log(`[EXPORT] direct mesh path: topVerts=${topVerts} bottomVerts=${bottomVerts}`);
}

/** Serialize live viewer geometry via export worker → mesh-close → binary STL. */
async function buildStlFromLiveGeometry(liveGeometry: BufferGeometry): Promise<ArrayBuffer> {
    logDirectMeshPath(liveGeometry);

    const { payload, topVertexCount } = geometryToExportPayload(liveGeometry);
    const bottomVertexCount = payload.positions.length / 3 - topVertexCount;

    if (bottomVertexCount > EXPORT_BOTTOM_FULL_MESH_LIMIT && typeof console !== "undefined") {
        console.warn(
            `[EXPORT] bottom mesh ${bottomVertexCount} verts > limit; extracting rim loop only (worker path)`,
        );
    }

    let precomputedBottomRim: ExportRimPoint[] | undefined;
    if (bottomVertexCount > EXPORT_BOTTOM_FULL_MESH_LIMIT) {
        const extractStart = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (typeof console !== "undefined") {
            console.log("[EXPORT] pre-extracting bottom rim on main thread...");
        }
        const rimVectors = preextractExportBottomRimLoop(liveGeometry, topVertexCount);
        precomputedBottomRim = rimPointsFromVectors(rimVectors);
        if (typeof console !== "undefined") {
            const extractMs =
                (typeof performance !== "undefined" ? performance.now() : Date.now()) - extractStart;
            console.log(
                `[EXPORT] bottom rim pre-extracted: ${precomputedBottomRim.length} verts in ${extractMs.toFixed(0)}ms`,
            );
        }
    }

    if (typeof console !== "undefined") {
        console.log("[EXPORT] posting to worker...");
    }

    const { stlBuffer, bottomRimVertexCount, usedReducedBottom } = await runMeshExportWorker(
        payload,
        topVertexCount,
        exportTimeoutMsOverride ?? EXPORT_OPERATION_TIMEOUT_MS,
        precomputedBottomRim,
    );

    if (typeof console !== "undefined") {
        if (usedReducedBottom) {
            console.log(`[EXPORT] rim loop extracted: ${bottomRimVertexCount} verts`);
        }
        console.log(`[EXPORT] worker returned STL: ${stlBuffer.byteLength} bytes`);
    }

    return stlBuffer;
}

/** Direct mesh export from the live viewer scene (test hook). */
export async function exportManufacturingStlAttempt(
    _design: DesignState,
    side: Side,
): Promise<ArrayBuffer | null> {
    try {
        return await buildDirectMeshExportStl(side);
    } catch {
        return null;
    }
}

async function buildDirectMeshExportStl(side: Side): Promise<ArrayBuffer> {
    if (isViewerGeometryBuilding(side)) {
        throw new ExportGeometryNotReadyError();
    }

    const live = getLiveViewerGeometry(side);
    if (live) {
        return buildStlFromLiveGeometry(live);
    }

    const geometry = await buildExportGeometry(side);
    try {
        return buildStlFromLiveGeometry(geometry);
    } finally {
        geometry.dispose();
    }
}

/** Builds export geometry for a side — base+modifiers or kernel insole mesh. */
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

/** Export STL bytes for the active design side — live viewer mesh, mesh-close, pure JS STL. */
export async function buildExportStl(side: Side, options: BuildExportStlOptions = {}): Promise<ArrayBuffer> {
    const run = async (): Promise<ArrayBuffer> => {
        void options;
        return buildDirectMeshExportStl(side);
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

/** Watertight solid for hybrid upload — uses reduced geometry; large bottoms must use worker STL path. */
export async function buildExportSolid(
    side: Side,
    options: BuildExportStlOptions = {},
): Promise<BufferGeometry> {
    void options;
    if (!isViewerGeometryBuilding(side)) {
        const live = getLiveViewerGeometry(side);
        if (live) {
            const total = live.getAttribute("position").count;
            const storedTop = (live.userData as { topVertexCount?: number }).topVertexCount;
            const topVertexCount =
                storedTop && storedTop > 0 && storedTop < total ? storedTop : total;
            if (total - topVertexCount <= EXPORT_BOTTOM_FULL_MESH_LIMIT) {
                return closeLiveViewerMeshToSolid(live.clone());
            }
        }
    }

    const geometry = await buildExportGlbGeometry(side);
    const total = geometry.getAttribute("position").count;
    const storedTop = (geometry.userData as { topVertexCount?: number }).topVertexCount;
    const topVertexCount =
        storedTop && storedTop > 0 && storedTop < total ? storedTop : total;
    if (total - topVertexCount <= EXPORT_BOTTOM_FULL_MESH_LIMIT) {
        return closeLiveViewerMeshToSolid(geometry);
    }

    geometry.dispose();
    throw new ExportGeometryNotReadyError(
        "Large base mesh export must use STL download — perimeter closure runs in the export worker.",
    );
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
