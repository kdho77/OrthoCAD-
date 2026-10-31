// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { baseModifierFieldAuthoritative, getDesignBase, loadBaseGeometry } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { insoleLayoutFromDesign, scaleGeometryToInsoleSize } from "@/lib/geometry/shoe-size";
import { shoeWidthForSide } from "@/lib/geometry/shoe-width";
import type { DesignState, Side } from "@/types";
import type { CncWorkpiece, MillingProfile } from "./types";
import { workpieceFromGeometry } from "./workpiece";

/** Keep the composed top for mill orbit. Clone when `composed` is the loaded SAMPLE_Top sheet. */
export function attachOrbitMesh(
    wp: CncWorkpiece,
    composed: BufferGeometry,
    raw?: BufferGeometry | null,
): CncWorkpiece {
    const mesh = raw && composed === raw ? composed.clone() : composed;
    mesh.computeVertexNormals();
    wp.mesh = mesh;
    return wp;
}

/** Build a CAM workpiece from a composed top mesh. Does not mutate `design`. */
export function workpieceFromComposed(
    composed: BufferGeometry,
    side: Side,
    profile: MillingProfile,
): CncWorkpiece {
    return attachOrbitMesh(workpieceFromGeometry(composed, side, profile), composed);
}

/**
 * Read-only: compose the same print-solid top the elements use, then rasterize
 * for CAM. Never writes design state.
 */
export async function workpiecesFromDesign(
    design: DesignState,
    sides: Side[],
    profile: MillingProfile,
    loadGeo: (side: Side) => Promise<BufferGeometry | null> = async (side) => {
        const base = getDesignBase(design, side);
        if (!base) return null;
        return loadBaseGeometry(base);
    },
): Promise<CncWorkpiece[]> {
    const out: CncWorkpiece[] = [];
    const layout = insoleLayoutFromDesign(design);
    for (const side of sides) {
        const loaded = await loadGeo(side);
        if (!loaded) continue;
        // Toolpath the shoe-size footprint. SAMPLE_Top is ~272 mm; US M 9 is 260 mm.
        // Scale before compose so elements and the outline share that frame.
        const raw = scaleGeometryToInsoleSize(loaded, layout.lengthMm, layout.widthMm);
        if (raw !== loaded) loaded.dispose();
        const thickness = design.paired
            ? side === "left"
                ? design.paired.leftThicknessMm
                : design.paired.rightThicknessMm
            : design.thicknessMm;
        const field = baseModifierFieldAuthoritative(design, side, thickness ?? BASE_REFERENCE_THICKNESS_MM);
        const widthId = shoeWidthForSide(design, side);
        const heelW = field.corrections?.heelCupWidthMm ?? 0;
        const composed = await composePrintSolidTop(raw, {
            // Same field the order build uses (includeElements, shape finish, effective length).
            sourceField: field,
            shoeWidth: {
                width: widthId,
                ballWidthMm: layout.widthMm,
                heelWidthMm: layout.widthMm * 0.62,
                heelOverrideMm: heelW,
            },
        });
        const workpiece = attachOrbitMesh(workpieceFromGeometry(composed, side, profile), composed, raw);
        if (workpiece.mesh !== raw) raw.dispose();
        out.push(workpiece);
    }
    return out;
}
