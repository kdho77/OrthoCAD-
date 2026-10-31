// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { BufferAttribute, BufferGeometry } from "three";
import { baseModifierFieldAuthoritative, getDesignBase, loadBaseGeometry } from "@/lib/geometry/base-asset";
import {
    BASE_REFERENCE_THICKNESS_MM,
    classifyBaseTopFactors,
    getBaseFootprintFrame,
} from "@/lib/geometry/base-modifier";
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
import { wantsProceduralExportSolid } from "@/lib/geometry/procedural-wall/preview-loft-ui";
import { buildProceduralExportSolid } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { assertShapeFinishExportAllowed } from "@/lib/geometry/shape-finish-gates";
import { insoleLayoutFromDesign, scaleGeometryToInsoleSize } from "@/lib/geometry/shoe-size";
import { shoeWidthForSide } from "@/lib/geometry/shoe-width";
import { applySinkCutToGeometry } from "@/lib/geometry/sink";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { getDesignTrimline, sampleDefaultOutline } from "@/lib/geometry/trimline";
import { curveToPolyPoints, useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useDesignStore } from "@/stores/design-store";
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
        const stored = useBottomPatternStore.getState().getPattern(side);
        const layout = insoleLayoutFromDesign(design);
        const heelW = field.corrections?.heelCupWidthMm ?? 0;
        // Same composition as the print viewport: elements (includeElements) and
        // the shoe-width affine (wide = +5 mm ball). Analytic loft dropped both.
        const preview = await buildProceduralExportSolid({
            mirrored: Boolean(base.mirrored),
            corrections: field.corrections,
            thicknessMm: effThickness,
            stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
            wallStyle: viewer?.wallStyle ?? "straight",
            scanPattern: design.pattern,
            textMarking: design.textMarking,
            side,
            sourceField: field,
            footprintMm: { lengthMm: layout.lengthMm, widthMm: layout.widthMm },
            shoeWidth: {
                width: shoeWidthForSide(design, side),
                ballWidthMm: layout.widthMm,
                heelWidthMm: layout.widthMm * 0.62,
                heelOverrideMm: heelW,
            },
            trimline: field.trimline,
            ...(field.sinks && field.sinks.length > 0
                ? { sinks: field.sinks, sinkStyloidThicken: field.sinkStyloidThicken }
                : {}),
            ...(stored ? { bottomPattern: curveToPolyPoints(stored) } : {}),
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

async function buildClosedExportGeometry(side: Side): Promise<BufferGeometry> {
    const { design, viewer } = useDesignStore.getState();
    assertShapeFinishExportAllowed(design, side);
    const modifiedBase = await buildModifiedBaseGeometry(design, side, 0);
    if (!modifiedBase) {
        throw new Error(
            "[EXPORT] No GLB base geometry available. " +
                "Load a stock base before exporting. " +
                "Parametric export is not supported.",
        );
    }
    try {
        const solid = closeGlbInsoleToSolid(modifiedBase);
        const topN = (solid.userData as { topVertexCount?: number }).topVertexCount ?? 0;
        const base = getDesignBase(design, side);
        const procedural = wantsProceduralExportSolid(base, viewer?.wallModel);
        // Default.glb stays on the pinned euler baseline. A shoe-sized SAMPLE_Top
        // solid is a genus-0 manifold (euler 2); that baseline is the legacy sheet.
        assertClosedSolidAcceptable(
            solid,
            topN,
            !procedural && topN > 0 ? DEFAULT_GLB_CLOSED_BASELINE : null,
        );
        return solid;
    } finally {
        modifiedBase.dispose();
    }
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
