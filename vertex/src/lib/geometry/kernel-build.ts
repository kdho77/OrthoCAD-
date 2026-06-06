import type { BufferGeometry } from "three";
import { getKernel } from "@/lib/chili3d/kernel";
import type { SolidResult } from "@/lib/chili3d/kernel";
import { applyTrimLines, applyVertexOverrides } from "@/lib/geometry/mesh-edit";
import type { InsoleParams } from "@/lib/geometry/insole";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import type { GeometryQuality } from "@/lib/geometry/quality";
import { segmentsForQuality } from "@/lib/geometry/quality";
import { mergeCorrections, mergeElementPreviews } from "@/stores/performance-store";
import type { DesignState, Side } from "@/types";
import type { TrimLine } from "@/lib/geometry/mesh-edit";
import * as THREE from "three";

export function isOcctKernelActive(): boolean {
    return getKernel().name === "opencascade-wasm";
}

/** Build canonical insole params from the live design store + optional preview merges. */
export function insoleParamsFromDesign(
    design: DesignState,
    side: Side,
    quality: GeometryQuality = "full",
): InsoleParams {
    return {
        side,
        lengthMm: INSOLE_LENGTH_MM,
        widthMm: INSOLE_WIDTH_MM,
        thicknessMm: design.thicknessMm,
        corrections: mergeCorrections(side, design.corrections[side]),
        elements: mergeElementPreviews(design.elements.filter((e) => e.side === side)),
        method: design.method,
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

function applyMeshEdits(
    geometry: BufferGeometry,
    options: MeshEditOptions,
): BufferGeometry {
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
