// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Last check before a manufacturing STL is uploaded. The loft must be the
// saved design's SAMPLE_Top foot. A generic last, a foot whose arch is on the
// wrong side, a heel-first solid, or a missing plantar name is refused.

import type { BufferGeometry } from "three";
import { activePatientDisplayName } from "@/lib/clinical/patient-display-name";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { meshYSign } from "@/lib/geometry/handedness";
import { outlineHalfWidth } from "@/lib/geometry/height-field";
import { insoleLayoutFromDesign, scaleSourceShapeToFootprint } from "@/lib/geometry/shoe-size";
import { hasActiveComposedTextMarking } from "@/lib/geometry/text-marking/compose";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { DesignState, Side } from "@/types";
import { extractTopOnlyModel } from "./extract";
import { composePrintSolidTop } from "./print-solid-compose";
import { printSolidOptions } from "./print-solid-options";

/** Floor for "this is the composed SAMPLE_Top", above a parametric last (~0.65). */
export const FOOT_OUTLINE_MIN_IOU = 0.9;

/** Same inconclusive band the belt handedness gate uses. */
const HAND_MARGIN_MM = 5;

const BINS = 48;

export class ManufacturingFootRefusal extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ManufacturingFootRefusal";
    }
}

interface Silhouette {
    lo: number[];
    hi: number[];
}

function silhouetteInSpan(pts: Array<{ x: number; y: number }>, minX: number, maxX: number): Silhouette {
    const lo = new Array(BINS).fill(Infinity);
    const hi = new Array(BINS).fill(-Infinity);
    const span = Math.max(1e-6, maxX - minX);
    for (const p of pts) {
        if (p.x < minX - 1 || p.x > maxX + 1) continue;
        let b = Math.floor(((p.x - minX) / span) * (BINS - 1));
        if (b < 0) b = 0;
        if (b >= BINS) b = BINS - 1;
        if (p.y < lo[b]) lo[b] = p.y;
        if (p.y > hi[b]) hi[b] = p.y;
    }
    return { lo, hi };
}

/** Outline overlap of a mesh against a rim. Leader vertices outside the rim span are ignored. */
export function meshOutlineIoU(
    positions: ArrayLike<number>,
    footRim: Array<{ x: number; y: number }>,
): number {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of footRim) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const meshPts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
        meshPts.push({ x: positions[i] ?? 0, y: positions[i + 1] ?? 0 });
    }
    return silhouetteIoU(silhouetteInSpan(meshPts, minX, maxX), silhouetteInSpan(footRim, minX, maxX));
}

export function silhouetteIoU(a: Silhouette, b: Silhouette): number {
    let inter = 0;
    let union = 0;
    for (let i = 0; i < a.lo.length; i++) {
        if (!Number.isFinite(a.lo[i]) || !Number.isFinite(b.lo[i])) continue;
        const top = Math.min(a.hi[i]!, b.hi[i]!);
        const bot = Math.max(a.lo[i]!, b.lo[i]!);
        inter += Math.max(0, top - bot);
        union += Math.max(a.hi[i]!, b.hi[i]!) - Math.min(a.lo[i]!, b.lo[i]!);
    }
    return union > 0 ? inter / union : 0;
}

function rimOf(geometry: BufferGeometry): Array<{ x: number; y: number }> {
    const model = extractTopOnlyModel(geometry, { id: "sample-top", name: "SAMPLE_Top" });
    const pos = model.top.meshPositions;
    const rim = model.top.rimLocal ?? [];
    if (!pos || rim.length < 8) {
        throw new ManufacturingFootRefusal(
            "Manufacturing mesh reference SAMPLE_Top rim is missing. Refusing to upload.",
        );
    }
    return rim.map((i) => ({ x: pos[i * 3] ?? 0, y: pos[i * 3 + 1] ?? 0 }));
}

/** Composed SAMPLE_Top rim at this design's size, the outline the loft is judged against. */
export async function composedFootRim(
    native: BufferGeometry,
    design: DesignState,
    side: Side,
): Promise<Array<{ x: number; y: number }>> {
    const layout = insoleLayoutFromDesign(design, side);
    const field = baseModifierFieldAuthoritative(design, side, design.thicknessMm);
    const options = printSolidOptions({
        design,
        side,
        field,
        viewer: { wallModel: "procedural", wallStyle: "round" },
        trimline: null,
        bottomPattern: null,
    });
    let sheet = native.clone();
    if (side === "right") {
        const mirrored = mirrorGeometry(sheet);
        sheet.dispose();
        sheet = mirrored;
    }
    scaleSourceShapeToFootprint(sheet, layout.scale, BASE_REFERENCE_THICKNESS_MM);
    const composed = await composePrintSolidTop(sheet, {
        sourceField: field,
        shoeWidth: options.shoeWidth,
        trimline: null,
    });
    sheet.dispose();
    try {
        return rimOf(composed);
    } finally {
        composed.dispose();
    }
}

export function stlPositions(stl: ArrayBuffer): Float64Array {
    if (stl.byteLength < 84) {
        throw new ManufacturingFootRefusal("Manufacturing mesh is not a binary STL. Refusing to upload.");
    }
    const view = new DataView(stl);
    const triangles = view.getUint32(80, true);
    if (stl.byteLength < 84 + triangles * 50) {
        throw new ManufacturingFootRefusal("Manufacturing mesh STL is truncated. Refusing to upload.");
    }
    const xyz = new Float64Array(triangles * 9);
    let offset = 84;
    let n = 0;
    for (let t = 0; t < triangles; t++) {
        offset += 12;
        for (let k = 0; k < 9; k++) xyz[n++] = view.getFloat32(offset + k * 4, true);
        offset += 38;
    }
    return xyz;
}

export interface FootMeshCheck {
    positions: ArrayLike<number>;
    side: Side;
    footRim: Array<{ x: number; y: number }>;
    widthMm: number;
    /** Saved marking composes to a non-empty plantar string. */
    textRequired: boolean;
}

/**
 * Refuse a mesh that is not this design's lofted foot.
 * `positions` is a flat xyz list (STL corners or a geometry attribute).
 */
export function assertLoftedFootMesh(input: FootMeshCheck): void {
    const { positions, side, footRim, widthMm, textRequired } = input;
    if (footRim.length < 8 || positions.length < 9) {
        throw new ManufacturingFootRefusal("Manufacturing mesh has no foot outline. Refusing to upload.");
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of footRim) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const meshPts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
        const x = positions[i] ?? 0;
        const y = positions[i + 1] ?? 0;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        meshPts.push({ x, y });
    }
    const mesh = silhouetteInSpan(meshPts, minX, maxX);
    const foot = silhouetteInSpan(footRim, minX, maxX);
    const span = Math.max(1e-6, maxX - minX);
    const lastPts: Array<{ x: number; y: number }> = [];
    for (let b = 0; b < BINS; b++) {
        const u = b / (BINS - 1);
        const hw = outlineHalfWidth(u) * (widthMm / 2);
        const x = minX + u * span;
        lastPts.push({ x, y: -hw }, { x, y: hw });
    }
    const last = silhouetteInSpan(lastPts, minX, maxX);
    const iouFoot = silhouetteIoU(mesh, foot);
    const iouLast = silhouetteIoU(mesh, last);
    if (!(iouFoot >= FOOT_OUTLINE_MIN_IOU) || !(iouFoot > iouLast)) {
        throw new ManufacturingFootRefusal(
            `Manufacturing mesh is not the lofted foot for this design (outline overlap ${iouFoot.toFixed(3)} with SAMPLE_Top, ${iouLast.toFixed(3)} with the generic last). Refusing to upload.`,
        );
    }

    const midY = (minY + maxY) / 2;
    const medial = meshYSign(side, "medial");
    let meshMinX = Infinity;
    let meshMaxX = -Infinity;
    for (const p of meshPts) {
        if (p.x < minX - 1 || p.x > maxX + 1) continue;
        if (p.x < meshMinX) meshMinX = p.x;
        if (p.x > meshMaxX) meshMaxX = p.x;
    }
    const meshSpan = Math.max(1e-6, meshMaxX - meshMinX);
    let heelZ = -Infinity;
    let toeZ = -Infinity;
    let medialZ = -Infinity;
    let lateralZ = -Infinity;
    for (let i = 0; i + 2 < positions.length; i += 3) {
        const x = positions[i] ?? 0;
        const y = positions[i + 1] ?? 0;
        const z = positions[i + 2] ?? 0;
        if (x < minX - 1 || x > maxX + 1) continue;
        const u = (x - meshMinX) / meshSpan;
        if (u < 0.2) heelZ = Math.max(heelZ, z);
        if (u > 0.8) toeZ = Math.max(toeZ, z);
        if (u >= 0.4 && u < 0.6) {
            const onMedial = medial < 0 ? y < midY : y > midY;
            if (onMedial) medialZ = Math.max(medialZ, z);
            else lateralZ = Math.max(lateralZ, z);
        }
    }
    const margin = medialZ - lateralZ;
    if (margin < -HAND_MARGIN_MM) {
        throw new ManufacturingFootRefusal(
            `Manufacturing mesh handedness margin ${margin.toFixed(1)} mm is opposite the ${side} foot. Refusing to upload.`,
        );
    }
    if (!(heelZ > toeZ + 1)) {
        throw new ManufacturingFootRefusal(
            "Manufacturing mesh is heel-first (the thick end is not at the heel). Refusing to upload.",
        );
    }
    if (textRequired && !plantarNameEngraved(positions, footRim)) {
        throw new ManufacturingFootRefusal(
            "Manufacturing mesh is missing the plantar name. Refusing to upload.",
        );
    }
}

/**
 * Bottom engrave keeps the sole at z = 0 and lifts the letter floor to the
 * depth (default 0.6 mm). Those vertices sit in the interior, clear of the wall.
 */
export function plantarNameEngraved(
    positions: ArrayLike<number>,
    footRim: Array<{ x: number; y: number }>,
): boolean {
    let count = 0;
    for (let i = 0; i + 2 < positions.length; i += 3) {
        const x = positions[i] ?? 0;
        const y = positions[i + 1] ?? 0;
        const z = positions[i + 2] ?? 0;
        if (z < 0.35 || z > 0.95) continue;
        if (distanceToRim(x, y, footRim) < 8) continue;
        if (!pointInRim(x, y, footRim)) continue;
        count++;
        if (count >= 12) return true;
    }
    return false;
}

function distanceToRim(x: number, y: number, rim: Array<{ x: number; y: number }>): number {
    let best = Infinity;
    for (let i = 0; i < rim.length; i++) {
        const a = rim[i]!;
        const b = rim[(i + 1) % rim.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        const dx = x - (a.x + ex * t);
        const dy = y - (a.y + ey * t);
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
    }
    return Math.sqrt(best);
}

function pointInRim(x: number, y: number, rim: Array<{ x: number; y: number }>): boolean {
    let inside = false;
    for (let i = 0, j = rim.length - 1; i < rim.length; j = i++) {
        const a = rim[j]!;
        const b = rim[i]!;
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}

/** Reference rim from the primed SAMPLE_Top, then the STL check. Throws instead of uploading. */
export async function assertProductionFootStl(input: {
    stl: ArrayBuffer;
    design: DesignState;
    side: Side;
    native: BufferGeometry;
}): Promise<void> {
    const rim = await composedFootRim(input.native, input.design, input.side);
    const layout = insoleLayoutFromDesign(input.design, input.side);
    assertLoftedFootMesh({
        positions: stlPositions(input.stl),
        side: input.side,
        footRim: rim,
        widthMm: layout.widthMm,
        textRequired: hasActiveComposedTextMarking(
            input.design.textMarking,
            activePatientDisplayName(),
            input.side,
        ),
    });
}
