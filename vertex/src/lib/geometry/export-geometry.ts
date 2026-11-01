// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
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
import { resolveLiveBottomPattern } from "@/lib/geometry/procedural-wall/live-bottom-pattern";
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

async function buildModifiedBaseGeometry(
    design: DesignState,
    side: Side,
    smoothingIterations = 2,
): Promise<BufferGeometry | null> {
    const base = getDesignBase(design, side);
    if (!base) return null;
    const viewer = useDesignStore.getState().viewer;
    if (wantsProceduralExportSolid(base, viewer?.wallModel)) {
        const effThickness = design.paired
            ? side === "left"
                ? design.paired.leftThicknessMm
                : design.paired.rightThicknessMm
            : design.thicknessMm;
        const field = baseModifierFieldAuthoritative(design, side, effThickness);
        const edits = useMeshEditStore.getState();
        const preview = await buildProceduralExportSolid({
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
            mirrored: Boolean(base.mirrored),
        });
        return preview.geometry;
    }
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

/** Build and validate the actual manufacturing mesh. Caller owns the geometry. */
export async function buildValidatedExportGeometry(side: Side): Promise<BufferGeometry> {
    const { design } = useDesignStore.getState();
    assertShapeFinishExportAllowed(design, side);
    const geometry = await buildModifiedBaseGeometry(design, side, 0);
    if (!geometry) {
        throw new Error(
            "[EXPORT] No GLB base geometry available. Load a stock base before exporting. Parametric export is not supported.",
        );
    }
    let solid: BufferGeometry | undefined;
    try {
        solid = closeGlbInsoleToSolid(geometry);
        const topN = (solid.userData as { topVertexCount?: number }).topVertexCount ?? 0;
        assertClosedSolidAcceptable(solid, topN, topN > 0 ? DEFAULT_GLB_CLOSED_BASELINE : null);
        scaleFootprintUniform(solid, insoleLayoutFromDesign(design).scale);
        return solid;
    } catch (error) {
        if (solid && solid !== geometry) solid.dispose();
        if (!solid || solid === geometry) geometry.dispose();
        throw error;
    } finally {
        if (solid && solid !== geometry) geometry.dispose();
    }
}

/** STL and 3MF serialize the same validated manufacturing shell. */
export async function buildExportStl(side: Side, _options: BuildExportStlOptions = {}): Promise<ArrayBuffer> {
    const solid = await buildValidatedExportGeometry(side);
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
