// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Production Default.glb loader for mesh-close / export-solid tests.
 *
 * Loads the committed fixture and applies the same transforms as
 * `loadBaseGeometry` for stock bases: `reorientToFootprintFrame`, then optional
 * `mirrorGeometry` when the slot is the contralateral side.
 *
 * Row B (acceptance for the slit-cap fix): reoriented positions with author
 * winding restored — cycles match the success multiset but pre-fix close
 * still failed (openEdges 6 / nonManifold 2). See mesh-close parity suite.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    extractMergedGeometry,
    loadGlbFromBuffer,
    mirrorGeometry,
    reorientToFootprintFrame,
} from "@/lib/library/loaders";

export const DEFAULT_GLB_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/Default.glb");

/** Success-path bottom branched-cycle multiset on Default.glb. */
export const DEFAULT_GLB_SUCCESS_CYCLE_MULTISET = [1184, 4, 4, 3] as const;

export type ProductionDefaultGlbSlot = "left" | "right" | "unreoriented";

export interface ProductionDefaultGlbOptions {
    /**
     * Stock `primarySide`. When `"left"` (builtin Default.glb), the left slot is
     * reorient-only and the right slot is reorient+mirror. When `"right"`, the
     * assignments swap.
     */
    primarySide?: "left" | "right";
    /** Which paired slot (or unreoriented custom-prefab path). */
    slot?: ProductionDefaultGlbSlot;
}

type LoadedGeo = ReturnType<typeof reorientToFootprintFrame>;

function flipTriangleWindingInPlace(geometry: LoadedGeo): void {
    const index = geometry.index;
    if (!index) return;
    const arr = index.array as Uint32Array | Uint16Array;
    for (let i = 0; i < arr.length; i += 3) {
        const tmp = arr[i + 1]!;
        arr[i + 1] = arr[i + 2]!;
        arr[i + 2] = tmp;
    }
    index.needsUpdate = true;
}

/** Raw merged geometry from the committed Default.glb fixture (no reorient). */
export async function loadRawDefaultGlb(): Promise<LoadedGeo> {
    const buf = readFileSync(DEFAULT_GLB_FIXTURE_PATH);
    const group = await loadGlbFromBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    const merged = extractMergedGeometry(group);
    if (!merged) throw new Error("Default.glb fixture produced no merged geometry");
    return merged.geometry;
}

/**
 * Geometry as produced for a production stock/custom slot.
 *
 * - `unreoriented`: custom-prefab path (no reorient, no mirror)
 * - `left` / `right`: stock path under `primarySide` (default `"left"`)
 */
export async function loadProductionDefaultGlb(
    options: ProductionDefaultGlbOptions = {},
): Promise<LoadedGeo> {
    const primarySide = options.primarySide ?? "left";
    const slot = options.slot ?? "left";
    const raw = await loadRawDefaultGlb();

    if (slot === "unreoriented") {
        return raw;
    }

    const reoriented = reorientToFootprintFrame(raw);
    raw.dispose();

    const sourceIsLeft = primarySide === "left";
    const slotIsSource = sourceIsLeft ? slot === "left" : slot === "right";
    if (slotIsSource) {
        return reoriented;
    }
    const mirrored = mirrorGeometry(reoriented);
    reoriented.dispose();
    return mirrored;
}

/**
 * Row B fixture: reoriented positions, original (author) winding.
 * Pre-fix: cycles [1184,4,4,3] but close failed with openEdges=6 / nonManifold=2.
 * Isolates the slit-cap defect from the cycle-decomposition defect.
 */
export async function loadDefaultGlbRowB(): Promise<LoadedGeo> {
    const raw = await loadRawDefaultGlb();
    const reoriented = reorientToFootprintFrame(raw);
    raw.dispose();
    flipTriangleWindingInPlace(reoriented);
    return reoriented;
}
