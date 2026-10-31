// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { mortonsActive } from "@/lib/geometry/mortons";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import type { DesignState, Side } from "@/types";
import { classDensityPct } from "../../../shared/print-recipe/hardness-class-table";
import { collectHardnessRegions, findElement } from "./collect";
import { packHardness3mf } from "./export-3mf";
import type { TriangleMesh } from "./mesh";
import { buildHeightFieldPrism, makeParametricSampler, type RawModifier, type SurfaceSampler } from "./prism";
import { buildExportReport, type HardnessExportReport } from "./report";
import { type ResolvedModifier, resolveModifiers } from "./resolve";

export function samplerForDesign(design: DesignState, side: Side, excludeElementId?: string): SurfaceSampler {
    const layout = insoleLayoutFromDesign(design);
    const thickness = design.paired
        ? side === "left"
            ? design.paired.leftThicknessMm
            : design.paired.rightThicknessMm
        : design.thicknessMm;
    const mortons = design.mortons?.[side];
    const params: HeightFieldParams = {
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm: thickness,
        corrections: design.corrections[side],
        elements: design.elements.filter((e) => e.side === side),
        ...(mortons && mortonsActive(mortons) ? { mortons } : {}),
    };
    return makeParametricSampler(params, excludeElementId);
}

export function buildRawModifiers(
    design: DesignState,
    side: Side,
    sampler?: SurfaceSampler,
): { requested: ReturnType<typeof collectHardnessRegions>; raw: RawModifier[] } {
    const requested = collectHardnessRegions(design, side);
    const raw: RawModifier[] = [];
    for (const region of requested) {
        const el = findElement(design, region);
        const samp =
            sampler ??
            samplerForDesign(
                design,
                side,
                region.kind === "element" ? (el?.id ?? region.elementId) : undefined,
            );
        const built = buildHeightFieldPrism(region, samp, el);
        if (built) raw.push(built);
    }
    return { requested, raw };
}

export interface Hardness3mfResult {
    bytes: Uint8Array;
    report: HardnessExportReport;
    modifiers: ResolvedModifier[];
    designHash: string;
    designJson: string;
}

export async function exportHardness3mf(options: {
    design: DesignState;
    side: Side;
    shell: TriangleMesh;
    sampler?: SurfaceSampler;
}): Promise<Hardness3mfResult> {
    const t0 = Date.now();
    const { requested, raw } = buildRawModifiers(options.design, options.side, options.sampler);
    const unmapped: string[] = [];
    for (const region of requested) {
        try {
            classDensityPct(region.hardnessClass, region.overrides);
        } catch (err) {
            unmapped.push(
                `unmapped region ${region.regionId}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
    if (unmapped.length > 0) {
        throw new Error(`Hardness 3MF export failed: ${unmapped.join("; ")}`);
    }
    const resolved = await resolveModifiers(raw);
    const resolveMs = Date.now() - t0;
    const packed = await packHardness3mf({
        design: options.design,
        side: options.side,
        shell: options.shell,
        modifiers: resolved,
    });
    const exportMs = Date.now() - t0;
    const report = buildExportReport(requested, resolved, { resolveMs, exportMs });
    if (!report.ok) {
        throw new Error(`Hardness 3MF export failed: ${report.errors.join("; ")}`);
    }
    return {
        bytes: packed.bytes,
        report,
        modifiers: resolved,
        designHash: packed.designHash,
        designJson: packed.designJson,
    };
}

export const STL_SHELL_ONLY_WARNING =
    "STL is a shell-only fallback — hardness modifier volumes are not included. Export 3MF for VertexSlice.";
