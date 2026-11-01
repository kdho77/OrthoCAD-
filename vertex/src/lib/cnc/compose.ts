// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { baseModifierFieldAuthoritative, getDesignBase, loadBaseGeometry } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
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
        const raw = await loadGeo(side);
        if (!raw) continue;
        const thickness = design.paired
            ? side === "left"
                ? design.paired.leftThicknessMm
                : design.paired.rightThicknessMm
            : design.thicknessMm;
        const field = baseModifierFieldAuthoritative(design, side, thickness ?? BASE_REFERENCE_THICKNESS_MM);
        const composed = await composePrintSolidTop(raw, {
            sourceField: { ...field, lengthMm: layout.lengthMm, widthMm: layout.widthMm },
        });
        out.push(attachOrbitMesh(workpieceFromGeometry(composed, side, profile), composed, raw));
    }
    return out;
}
