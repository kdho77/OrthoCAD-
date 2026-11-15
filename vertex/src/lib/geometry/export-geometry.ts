// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { BufferAttribute, BufferGeometry } from "three";
import { afoMeshToGeometry } from "@/lib/geometry/afo/mesh-ops";
import { baseModifierFieldAuthoritative, getDesignBase, loadBaseGeometry } from "@/lib/geometry/base-asset";
import { classifyBaseTopFactors, getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import { geometryEngine } from "@/lib/geometry/geometry-engine";
import { getKernel } from "@/lib/geometry/geometry-kernel";
import { exportObjectToGlb, meshFromGeometry } from "@/lib/geometry/glb-export";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import {
    assertClosedSolidAcceptable,
    closeGlbInsoleToSolid,
    DEFAULT_GLB_CLOSED_BASELINE,
} from "@/lib/geometry/mesh-close";
import { perfMark } from "@/lib/geometry/perf/load-export-perf";
import { resolveLiveBottomPattern } from "@/lib/geometry/procedural-wall/live-bottom-pattern";
import {
    dropManufacturingSolid,
    manufacturingSolidFingerprint,
} from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { manufacturingCacheContext } from "@/lib/geometry/procedural-wall/manufacturing-solid-context";
import { wantsProceduralExportSolid } from "@/lib/geometry/procedural-wall/preview-loft-ui";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import { buildProceduralExportSolid } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { assertShapeFinishExportAllowed } from "@/lib/geometry/shape-finish-gates";
import {
    insoleLayoutFromDesign,
    scaleFootprintUniform,
    scaleGeometryToInsoleSize,
} from "@/lib/geometry/shoe-size";
import { applySinkCutToGeometry } from "@/lib/geometry/sink";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { getDesignTrimline, sampleDefaultOutline } from "@/lib/geometry/trimline";
import { useAfoStore } from "@/stores/afo-store";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { DesignState, ProductionMethod, Side } from "@/types";

/** Export routing: manufacturing and preview STL both use mesh-close. */
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
/** S after the kernel solid. No-op without sinks, so the no-sink STL bytes stay put. */
function cutExportSinks(geometry: BufferGeometry, field: HeightFieldParams): BufferGeometry {
    if (!field.sinks || field.sinks.length === 0) return geometry;
    const frame = getBaseFootprintFrame(geometry, field.side);
    const factors = classifyBaseTopFactors(geometry);
    applySinkCutToGeometry(geometry, geometry, field, frame, factors);
    return geometry;
}

/** Same inputs buildExportStl lofts. Fingerprint and the solid must share this object. */
function proceduralExportRequest(design: DesignState, side: Side) {
    const base = getDesignBase(design, side);
    if (!base) return null;
    const viewer = useDesignStore.getState().viewer;
    if (!wantsProceduralExportSolid(base, viewer?.wallModel)) return null;
    const effThickness = design.paired
        ? side === "left"
            ? design.paired.leftThicknessMm
            : design.paired.rightThicknessMm
        : design.thicknessMm;
    const field = baseModifierFieldAuthoritative(design, side, effThickness);
    const edits = useMeshEditStore.getState();
    const mirrored = Boolean(base.mirrored);
    const solidOptions = {
        ...printSolidOptions({
            design,
            side,
            field,
            viewer: viewer ?? {},
            trimline: edits.getActiveDraftTrimline(side) ?? getDesignTrimline(design, side),
            bottomPattern: resolveLiveBottomPattern({
                draft: edits.getActiveDraftBottomPattern(side),
                stored: useBottomPatternStore.getState().getPattern(side),
            }),
        }),
        mirrored,
    };
    return {
        solidOptions,
        cache: manufacturingCacheContext({
            design,
            side,
            baseAssetId: base.assetId ?? "",
            mirrored,
        }),
    };
}

/** Freshness key for the active Export solid. Throws when the canonical loft is not the path. */
export function manufacturingFingerprintForActiveExport(side: Side): string {
    const request = proceduralExportRequest(useDesignStore.getState().design, side);
    if (!request) {
        throw new Error("Manufacturing fingerprint requires the canonical procedural export solid");
    }
    return manufacturingSolidFingerprint(request.solidOptions, request.cache);
}

async function buildModifiedBaseGeometry(
    design: DesignState,
    side: Side,
    smoothingIterations = 2,
): Promise<BufferGeometry | null> {
    const request = proceduralExportRequest(design, side);
    if (request) {
        const preview = await buildProceduralExportSolid(request.solidOptions, request.cache);
        return preview.geometry;
    }
    const base = getDesignBase(design, side);
    if (!base) return null;
    const raw = await loadBaseGeometry(base);
    if (!raw) return null;
    let sized: BufferGeometry | null = null;
    try {
        const layout = insoleLayoutFromDesign(design);
        sized = scaleGeometryToInsoleSize(raw, layout.lengthMm, layout.widthMm);
        const effThickness = design.paired
            ? side === "left"
                ? design.paired.leftThicknessMm
                : design.paired.rightThicknessMm
            : design.thicknessMm;
        const field = baseModifierFieldAuthoritative(design, side, effThickness);
        const result = getKernel().buildFromBase(sized, field, smoothingIterations);
        return cutExportSinks(result.geometry, field);
    } finally {
        raw.dispose();
        sized?.dispose();
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

/** Feet in an order download. One foot when that side has no paired base. */
export function orderDownloadSides(design: DesignState): Side[] {
    const sides: Side[] = [];
    if (design.paired?.leftBase ?? design.base) sides.push("left");
    if (design.paired?.rightBase) sides.push("right");
    if (sides.length === 0) sides.push("left");
    return sides;
}

/** Shift a foot in Y so a pair file does not stack both solids on the same origin. */
export function offsetGeometryY(geometry: BufferGeometry, dy: number): BufferGeometry {
    const g = geometry.clone();
    const pos = g.getAttribute("position");
    if (!pos || dy === 0) return g;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + dy);
    pos.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
}

/** One indexed mesh. Each input keeps its vertex order. */
export function mergeGeometries(parts: BufferGeometry[]): BufferGeometry {
    let vCount = 0;
    let iCount = 0;
    for (const p of parts) {
        const pos = p.getAttribute("position");
        if (!pos) continue;
        vCount += pos.count;
        iCount += p.getIndex()?.count ?? pos.count;
    }
    const positions = new Float32Array(vCount * 3);
    const indices = new Uint32Array(iCount);
    let vOff = 0;
    let iOff = 0;
    for (const p of parts) {
        const pos = p.getAttribute("position");
        if (!pos) continue;
        for (let i = 0; i < pos.count; i++) {
            positions[(vOff + i) * 3] = pos.getX(i);
            positions[(vOff + i) * 3 + 1] = pos.getY(i);
            positions[(vOff + i) * 3 + 2] = pos.getZ(i);
        }
        const idx = p.getIndex();
        const n = idx?.count ?? pos.count;
        for (let i = 0; i < n; i++) indices[iOff + i] = (idx ? idx.getX(i) : i) + vOff;
        vOff += pos.count;
        iOff += n;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(positions, 3));
    g.setIndex(new BufferAttribute(indices, 1));
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
}

function solidCameFromManufacturingCache(geometry: BufferGeometry | undefined): boolean {
    return Boolean(
        (geometry?.userData as { fromManufacturingCache?: boolean } | undefined)?.fromManufacturingCache,
    );
}

/** Close, watertight-check, and scale one foot. A bad cache entry is dropped and lofted once. */
async function closeAndValidateExportGeometry(side: Side): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();
    if (design.productType === "afo") {
        const shell = useAfoStore.getState().shellMesh;
        if (!shell) {
            throw new Error("[EXPORT] Generate the AFO shell on the Print step before exporting STL.");
        }
        const geometry = afoMeshToGeometry(shell);
        assertClosedSolidAcceptable(geometry, 0, null);
        return geometry;
    }
    assertShapeFinishExportAllowed(design, side);
    const geometry = await buildModifiedBaseGeometry(design, side, 0);
    if (!geometry) {
        throw new Error(
            "[EXPORT] No GLB base geometry available. Load a stock base before exporting. Parametric export is not supported.",
        );
    }
    const fromCache = solidCameFromManufacturingCache(geometry);
    let solid: BufferGeometry | undefined;
    try {
        perfMark("export:close");
        solid = closeGlbInsoleToSolid(geometry);
        const topN = (solid.userData as { topVertexCount?: number }).topVertexCount ?? 0;
        // topVertexCount is also set by SAMPLE_Top lofts; it is not evidence
        // that this mesh came from the legacy Default.glb bridge pipeline.
        const baseline =
            solid.userData.wallModel === "procedural"
                ? { eulerCharacteristic: 2, heelBridgeSelfIntersections: 0 }
                : topN > 0
                  ? DEFAULT_GLB_CLOSED_BASELINE
                  : null;
        perfMark("export:validate");
        assertClosedSolidAcceptable(solid, topN, baseline);
        // Procedural solids are lofted on the already-scaled outline
        // (printSolidOptions.footprintScale). Scaling the finished mesh in XY
        // only steepens every wall. Legacy Default.glb still scales here.
        if (solid.userData.wallModel !== "procedural") {
            scaleFootprintUniform(solid, insoleLayoutFromDesign(design).scale);
        }
        return solid;
    } catch (error) {
        if (solid && solid !== geometry) solid.dispose();
        if (!solid || solid === geometry) geometry.dispose();
        if (fromCache) {
            dropManufacturingSolid(side);
            if (error && typeof error === "object") {
                (error as { fromManufacturingCache?: boolean }).fromManufacturingCache = true;
            }
        }
        throw error;
    } finally {
        if (solid && solid !== geometry) geometry.dispose();
    }
}

/** Build and validate the actual manufacturing mesh. Caller owns the geometry. */
async function buildClosedExportGeometry(side: Side): Promise<BufferGeometry> {
    try {
        return await closeAndValidateExportGeometry(side);
    } catch (error) {
        // A fresh loft that fails validation stays failed. printLoftEpoch is not bumped.
        if (!(error as { fromManufacturingCache?: boolean } | null)?.fromManufacturingCache) throw error;
        return closeAndValidateExportGeometry(side);
    }
}

/** Same closed solid as manufacturing STL; exported for validation UI. */
export async function buildValidatedExportGeometry(side: Side): Promise<BufferGeometry> {
    return buildClosedExportGeometry(side);
}

/**
 * Closed solids for every foot on the order, in one mesh.
 * The right foot is shifted in +Y by the shoe width plus the viewer gap so the
 * shells do not occupy the same origin. Each foot is still the order solid.
 */
export async function buildOrderPairGeometry(): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();
    const sides = orderDownloadSides(design);
    const layout = insoleLayoutFromDesign(design);
    const gap = layout.widthMm + 30;
    const parts: BufferGeometry[] = [];
    try {
        for (const side of sides) {
            const solid = await buildClosedExportGeometry(side);
            const dy = side === "right" && sides.length > 1 ? gap : 0;
            const placed = dy === 0 ? solid : offsetGeometryY(solid, dy);
            if (placed !== solid) solid.dispose();
            parts.push(placed);
        }
        if (parts.length === 1) return parts[0]!;
        const merged = mergeGeometries(parts);
        return merged;
    } finally {
        // mergeGeometries copies vertices. A single part is returned as-is.
        if (parts.length > 1) for (const p of parts) p.dispose();
    }
}

/** Export STL bytes for one foot. Pair downloads use {@link buildOrderPairGeometry}. */
export async function buildExportStl(side: Side, _options: BuildExportStlOptions = {}): Promise<ArrayBuffer> {
    const solid = await buildClosedExportGeometry(side);
    try {
        perfMark("export:stl", { side });
        return geometryToBinarySTL(solid);
    } finally {
        solid.dispose();
    }
}

/** STL bytes for every foot on the order, one file. */
export async function buildOrderPairStl(): Promise<ArrayBuffer> {
    const solid = await buildOrderPairGeometry();
    try {
        return geometryToBinarySTL(solid);
    } finally {
        solid.dispose();
    }
}

/**
 * Build export geometry for GLB download / viewer preview — does NOT run mesh-close.
 */
export async function buildExportGlbGeometry(side: Side): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();
    assertShapeFinishExportAllowed(design, side);

    const modifiedBase = await buildModifiedBaseGeometry(design, side);
    if (modifiedBase) return modifiedBase;

    const params = insoleParamsFromDesign(design, side, "full");
    const layout = insoleLayoutFromDesign(design);
    const trimline = getDesignTrimline(design, side) ?? sampleDefaultOutline(layout.lengthMm, layout.widthMm);

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
            console.warn("[export-geometry] Trimline mesh failed, falling back to base export:", err);
        }
        return buildExportGeometry(side);
    }
}

/**
 * Build the watertight tapered insole geometry intended for manufacturing pipelines
 * that need a BufferGeometry (e.g. hybrid server upload).
 */
export async function buildExportSolid(
    side: Side,
    options: BuildExportStlOptions = {},
): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();
    const exportMode = options.exportMode ?? exportModeFromMethod(design.method);

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
