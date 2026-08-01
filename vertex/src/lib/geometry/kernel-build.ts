import type { BufferGeometry } from "three";
import * as THREE from "three";
import type { SolidResult } from "@/lib/chili3d/kernel";
import { getKernel } from "@/lib/chili3d/kernel";
import type { InsoleParams } from "@/lib/geometry/insole";
import type { TrimLine } from "@/lib/geometry/mesh-edit";
import { applyTrimLines, applyVertexOverrides } from "@/lib/geometry/mesh-edit";
import type { GeometryQuality } from "@/lib/geometry/quality";
import { segmentsForQuality } from "@/lib/geometry/quality";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { mergeCorrections, mergeElementPreviews } from "@/stores/performance-store";
import type { DesignState, Side } from "@/types";

export function isOcctKernelActive(): boolean {
    return getKernel().name === "opencascade-wasm";
}

/** Build canonical insole params from the live design store + optional preview merges.
 * Supports paired workspace: uses per-side thickness/method/base from design.paired if present.
 */
export function insoleParamsFromDesign(
    design: DesignState,
    side: Side,
    quality: GeometryQuality = "full",
): InsoleParams {
    const paired = design.paired;
    // Paired workspace stores per-side thickness/method flat (leftThicknessMm…),
    // not under paired.left/right — reading the wrong shape silently fell back
    // to the legacy shared thickness for both sides.
    const thickness = paired
        ? side === "left"
            ? paired.leftThicknessMm
            : paired.rightThicknessMm
        : design.thicknessMm;
    const method = paired ? (side === "left" ? paired.leftMethod : paired.rightMethod) : design.method;
    const layout = insoleLayoutFromDesign(design);
    return {
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm: thickness,
        corrections: mergeCorrections(side, design.corrections[side]),
        elements: mergeElementPreviews(design.elements.filter((e) => e.side === side)),
        method: method,
        ...segmentsForQuality(quality),
    };
}

/** Yield to the browser before heavy synchronous OCCT work. */
export function scheduleMainThread<T>(fn: () => T): Promise<T> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve(fn()));
    });
}

export interface MeshEditOptions {
    trimLines?: TrimLine[];
    vertexOverrides?: Map<number, { x: number; y: number; z: number }>;
    applyEdits?: boolean;
}

function applyMeshEdits(geometry: BufferGeometry, options: MeshEditOptions): BufferGeometry {
    if (!options.applyEdits) return geometry;
    let g = geometry;
    const trimLines = options.trimLines ?? [];
    const vertexOverrides = options.vertexOverrides ?? new Map();
    if (trimLines.length > 0) g = applyTrimLines(g, trimLines);
    if (vertexOverrides.size > 0) {
        const vecMap = new Map<number, THREE.Vector3>();
        for (const [idx, v] of vertexOverrides) vecMap.set(idx, new THREE.Vector3(v.x, v.y, v.z));
        g = applyVertexOverrides(g, vecMap);
    }
    return g;
}

/** Production-grade build via the active kernel (OCCT when loaded). */
export async function buildViaKernel(
    params: InsoleParams,
    meshEdits: MeshEditOptions = {},
): Promise<BufferGeometry> {
    return scheduleMainThread(() => {
        const geo = getKernel().buildInsole(params);
        return applyMeshEdits(geo, meshEdits);
    });
}

/** Production-grade solid + watertight validation via the active kernel. */
export async function buildSolidViaKernel(params: InsoleParams): Promise<SolidResult> {
    return scheduleMainThread(() => getKernel().buildInsoleSolid(params));
}
