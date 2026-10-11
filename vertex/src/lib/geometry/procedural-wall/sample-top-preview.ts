// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { extractMergedGeometry, loadGlbFromBuffer, reorientToFootprintFrame } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";
import { PATTERN_SOURCE_SYNTHETIC, syntheticBottomPattern } from "./bottom-pattern";
import type { PolyPoint } from "./curves";
import { extractTopOnlyModel } from "./extract";
import { reconstructProceduralWalls } from "./reconstruct";
import type { StockWallModel } from "./types";
import type { ProceduralWallStyle } from "./wall-style";

/** Bundled top-only input that produced the approved procedural STLs. */
export const SAMPLE_TOP_PUBLIC_PATH = "/Templates/SAMPLE_Top.glb";
export const SAMPLE_TOP_ASSET_ID = "sample-top";
export const SAMPLE_TOP_NAME = "SAMPLE_Top";

let cachedNative: BufferGeometry | null = null;
let inflight: Promise<BufferGeometry> | null = null;

/** Parse SAMPLE_Top bytes the same way the S1 SAMPLE_Top gate does. */
export async function sampleTopFromArrayBuffer(buffer: ArrayBuffer): Promise<BufferGeometry> {
    const group = await loadGlbFromBuffer(buffer);
    const merged = extractMergedGeometry(group);
    if (!merged) throw new Error("SAMPLE_Top.glb produced no geometry");
    const reoriented = reorientToFootprintFrame(merged.geometry, { preserveAuthorZ: true });
    merged.geometry.dispose();
    return reoriented;
}

/** Load the bundled top-only SAMPLE_Top.glb (cloned; caller owns the result). */
export async function loadSampleTopGeometry(): Promise<BufferGeometry> {
    if (cachedNative) return cachedNative.clone();
    if (!inflight) {
        inflight = (async () => {
            const res = await fetch(SAMPLE_TOP_PUBLIC_PATH);
            if (!res.ok) {
                throw new Error(`SAMPLE_Top.glb missing at ${SAMPLE_TOP_PUBLIC_PATH} (${res.status})`);
            }
            const parsed = await sampleTopFromArrayBuffer(await res.arrayBuffer());
            cachedNative = parsed;
            return parsed;
        })();
    }
    const native = await inflight;
    return native.clone();
}

/** Fair the SAMPLE_Top rim: ~0 toe inset, heel ~8 mm, medial arch cut-in. */
export function buildFairedPatternFromTop(model: StockWallModel): PolyPoint[] {
    const pos = model.top.meshPositions;
    const rimLocal = model.top.rimLocal ?? [];
    if (!pos || rimLocal.length < 8) {
        throw new Error("SAMPLE_Top rim missing — cannot build faired bottom pattern");
    }
    const rim3d = rimLocal.map((i) => ({
        x: pos[i * 3] ?? 0,
        y: pos[i * 3 + 1] ?? 0,
        z: pos[i * 3 + 2] ?? 0,
    }));
    return syntheticBottomPattern(rim3d, model.bounds, rim3d);
}

export interface ProceduralPreviewOptions {
    corrections?: Partial<SideCorrections>;
    thicknessMm?: number;
    stockThicknessMm?: number;
    sourceGeometry?: BufferGeometry;
    sourceField?: HeightFieldParams;
    bottomPattern?: PolyPoint[];
    wallStyle?: ProceduralWallStyle;
    deviceType?: "functional" | "accommodative";
    lateralFlange?: { heightMm: number; lengthMm: number; angleDeg: number };
    archGrindDepthMm?: number;
}

/**
 * Viewer reconstruct for procedural mode: top-only SAMPLE_Top + faired B.
 * Same inputs as the approved SAMPLE_Top + synthetic-pattern STLs.
 */
export function reconstructProceduralPreview(
    topGeo: BufferGeometry,
    options: ProceduralPreviewOptions = {},
): { model: StockWallModel; pattern: PolyPoint[]; geometry: BufferGeometry } {
    const model = extractTopOnlyModel(topGeo, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
    const pattern = options.bottomPattern?.length ? options.bottomPattern : buildFairedPatternFromTop(model);
    const geometry = reconstructProceduralWalls(model, {
        corrections: options.corrections as SideCorrections | undefined,
        thicknessMm: options.thicknessMm,
        stockThicknessMm: options.stockThicknessMm,
        sourceGeometry: options.sourceGeometry,
        sourceField: options.sourceField,
        bottomPattern: pattern,
        bottomPatternLabel: PATTERN_SOURCE_SYNTHETIC,
        flatPlantar: true,
        wallStyle: options.wallStyle,
        deviceType: options.deviceType,
        lateralFlange: options.lateralFlange,
        archGrindDepthMm: options.archGrindDepthMm,
    });
    return { model, pattern, geometry };
}
