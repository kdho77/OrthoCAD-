// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { StockGlbLoadError } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { heelCupWidthLongitudinalEnvelope, heelCupWidthScaleFactor } from "@/lib/geometry/height-field";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { scaleGeometryToInsoleSize } from "@/lib/geometry/shoe-size";
import { hasActiveTextMarking } from "@/lib/geometry/text-marking/constants";
import type { TextGuide } from "@/lib/geometry/text-marking/place";
import type { TrimlineCurve } from "@/lib/geometry/trimline";
import {
    extractMergedGeometry,
    loadGlbFromBuffer,
    mirrorGeometry,
    reorientToFootprintFrame,
} from "@/lib/library/loaders";
import type { ScanPattern, Side, SideCorrections, TextMarking } from "@/types";
import { insetsForScanPattern, PATTERN_SOURCE_SYNTHETIC, syntheticBottomPattern } from "./bottom-pattern";
import type { PolyPoint } from "./curves";
import { extractTopOnlyModel, isCombinedStockGeometry } from "./extract";
import type { FootprintBounds } from "./pattern-hygiene";
import { composePrintSolidTop, type PrintSolidShoeWidth } from "./print-solid-compose";
import { reconstructProceduralWalls } from "./reconstruct";
import { SAMPLE_TOP_ASSET_ID, SAMPLE_TOP_NAME, SAMPLE_TOP_PUBLIC_PATH } from "./sample-top-id";
import { shiftPatternByRimFollow } from "./station-gates";
import type { StockWallModel } from "./types";
import type { ProceduralWallStyle } from "./wall-style";

export {
    SAMPLE_TOP_ASSET_ID,
    SAMPLE_TOP_GLB_PATH,
    SAMPLE_TOP_NAME,
    SAMPLE_TOP_PUBLIC_PATH,
} from "./sample-top-id";

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

/** Drop the cached SAMPLE_Top mesh so a Retry can refetch after a failed load. */
export function resetSampleTopGeometryCache(): void {
    cachedNative?.dispose();
    cachedNative = null;
    inflight = null;
}

/** Load the bundled top-only SAMPLE_Top.glb (cloned; caller owns the result). */
export async function loadSampleTopGeometry(): Promise<BufferGeometry> {
    if (cachedNative) return cachedNative.clone();
    if (!inflight) {
        inflight = (async () => {
            try {
                const res = await fetch(SAMPLE_TOP_PUBLIC_PATH);
                if (!res.ok) {
                    throw new StockGlbLoadError(SAMPLE_TOP_PUBLIC_PATH, `HTTP ${res.status}`);
                }
                const parsed = await sampleTopFromArrayBuffer(await res.arrayBuffer());
                cachedNative = parsed;
                return parsed;
            } catch (e) {
                inflight = null;
                if (e instanceof StockGlbLoadError) throw e;
                throw new StockGlbLoadError(SAMPLE_TOP_PUBLIC_PATH, e);
            }
        })();
    }
    const native = await inflight;
    return native.clone();
}

/** Viewer-only: SAMPLE_Top rim → faired B. Does not loft walls. */
export function buildProceduralViewerPattern(
    topGeo: BufferGeometry,
    scanPattern?: ScanPattern,
    corrections?: Partial<SideCorrections>,
): PolyPoint[] {
    const model = extractTopOnlyModel(topGeo, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
    const pattern = buildFairedPatternFromTop(model, scanPattern);
    return followViewerPattern(pattern, model, corrections);
}

/** Linked heel-widen follow on the viewer pattern (no loft). */
export function followViewerPattern(
    pattern: PolyPoint[],
    model: StockWallModel,
    corrections?: Partial<SideCorrections>,
): PolyPoint[] {
    const heel = corrections?.heelCupWidthMm ?? 0;
    if (!heel || pattern.length < 3) return pattern;
    const pos = model.top.meshPositions;
    const rimLocal = model.top.rimLocal ?? [];
    if (!pos || rimLocal.length < 8) return pattern;
    const rim = rimLocal.map((i) => ({
        x: pos[i * 3] ?? 0,
        y: pos[i * 3 + 1] ?? 0,
        z: 0,
    }));
    const yMid = rim.reduce((s, p) => s + p.y, 0) / rim.length;
    const length = Math.max(1e-3, model.bounds.maxX - model.bounds.minX);
    const live = rim.map((p) => {
        const u = Math.max(0, Math.min(1, (p.x - model.bounds.minX) / length));
        const s = heelCupWidthScaleFactor(u, heel);
        return { x: p.x, y: yMid + (p.y - yMid) * s, z: 0 };
    });
    return shiftPatternByRimFollow(pattern, rim, live, (p) => {
        const u = Math.max(0, Math.min(1, (p.x - model.bounds.minX) / length));
        return heelCupWidthLongitudinalEnvelope(u);
    });
}

/** Print / STL: loft the approved solid. Same reconstruct math as the frozen STLs. */
export async function buildProceduralExportSolid(
    options: ProceduralPreviewOptions & { mirrored?: boolean } = {},
): Promise<{ model: StockWallModel; pattern: PolyPoint[]; geometry: BufferGeometry }> {
    let raw = await loadSampleTopGeometry();
    if (options.mirrored) {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    try {
        const preview = await reconstructProceduralPreview(raw, options);
        if (!hasActiveTextMarking(options.textMarking)) return preview;
        const { applyTextMarkingToPrintSolid } = await import("@/lib/geometry/text-marking/apply");
        const { TextMarkingError } = await import("@/lib/geometry/text-marking/errors");
        const { buildTextGuide, guideWithPlacementClamp } = await import("@/lib/geometry/text-marking/place");
        const textGuide = buildTextGuide(preview.geometry);
        let geometry = preview.geometry;
        try {
            geometry = await applyTextMarkingToPrintSolid(preview.geometry, options.textMarking, {
                side: options.side ?? (options.mirrored ? "left" : "right"),
            });
        } catch (e) {
            if (!(e instanceof TextMarkingError)) throw e;
            geometry.userData = { ...geometry.userData, textFitError: e.message, textGuide };
            return { ...preview, geometry };
        }
        if (geometry !== preview.geometry) preview.geometry.dispose();
        geometry.userData = {
            ...geometry.userData,
            textGuide: guideWithPlacementClamp(
                textGuide,
                (geometry.userData as { textPlacementClamp?: TextGuide["placementClamp"] })
                    .textPlacementClamp,
            ),
        };
        return { ...preview, geometry };
    } finally {
        raw.dispose();
    }
}

/** Fair the SAMPLE_Top rim: ~0 toe inset, heel ~8 mm, medial arch cut-in. */
export function buildFairedPatternFromTop(model: StockWallModel, pattern?: ScanPattern): PolyPoint[] {
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
    return syntheticBottomPattern(rim3d, model.bounds, rim3d, undefined, insetsForScanPattern(pattern));
}

export interface ProceduralPreviewOptions {
    corrections?: Partial<SideCorrections>;
    thicknessMm?: number;
    stockThicknessMm?: number;
    bottomPattern?: PolyPoint[];
    wallStyle?: ProceduralWallStyle;
    deviceType?: "functional" | "accommodative";
    lateralFlange?: { heightMm: number; lengthMm: number; angleDeg: number };
    archGrindDepthMm?: number;
    /** Pattern preset (Full Contact / Prefab 3D / Flat / Custom) drives faired B. */
    scanPattern?: ScanPattern;
    /**
     * Full viewer height field. When set, Print composes once
     * (width → applyBaseModifiers → trimline clip), extracts the composed
     * top via extractTopOnlyModel, and lofts without applyAnalyticTopDeltas.
     */
    sourceField?: HeightFieldParams;
    /** Viewer shoe-width affine applied to the top before modifiers. */
    shoeWidth?: PrintSolidShoeWidth | null;
    /** Committed / draft trimline. Clipped before rim extraction. */
    trimline?: TrimlineCurve | null;
    /** Force the composed-top loft path (skip analytic deltas). */
    composedTop?: boolean;
    /** Print-step custom text. Applied after loft; empty is a no-op. */
    textMarking?: TextMarking | null;
    /** Foot side for left/right placement (wall text is never glyph-mirrored). */
    side?: Side;
    footprintReferenceBounds?: FootprintBounds;
    footprintLengthMm?: number;
    footprintWidthMm?: number;
    sizeLabel?: string;
    userBottomPattern?: boolean;
}

/**
 * Viewer reconstruct for procedural mode: top-only SAMPLE_Top + faired B.
 * With sourceField: compose once, extractTopOnlyModel on the composed top,
 * loft without applyAnalyticTopDeltas. Do not pass raw+sourceGeometry into
 * the Default extractTopSheet steal — that yields a 0-station ring.
 */
export async function reconstructProceduralPreview(
    topGeo: BufferGeometry,
    options: ProceduralPreviewOptions = {},
): Promise<{ model: StockWallModel; pattern: PolyPoint[]; geometry: BufferGeometry }> {
    if (isCombinedStockGeometry(topGeo)) {
        throw new Error("[S1-PROCEDURAL] combined/stock GLB is not a procedural input — use legacy");
    }
    const useComposed = Boolean(options.sourceField) || options.composedTop === true;
    let source = topGeo;
    let owned = false;
    let footprintReferenceBounds = options.footprintReferenceBounds;
    if (
        options.footprintLengthMm != null &&
        options.footprintWidthMm != null &&
        (Math.abs(options.footprintLengthMm - INSOLE_LENGTH_MM) > 1e-3 ||
            Math.abs(options.footprintWidthMm - INSOLE_WIDTH_MM) > 1e-3)
    ) {
        if (!footprintReferenceBounds) {
            topGeo.computeBoundingBox();
            const box = topGeo.boundingBox;
            if (box) {
                footprintReferenceBounds = {
                    minX: box.min.x,
                    maxX: box.max.x,
                    minY: box.min.y,
                    maxY: box.max.y,
                };
            }
        }
        const scaled = scaleGeometryToInsoleSize(topGeo, options.footprintLengthMm, options.footprintWidthMm);
        if (scaled !== topGeo) {
            source = scaled;
            owned = true;
        }
    }
    if (options.sourceField) {
        source = await composePrintSolidTop(topGeo, {
            sourceField: options.sourceField,
            shoeWidth: options.shoeWidth,
            trimline: options.trimline,
        });
        owned = source !== topGeo;
    }
    const model = extractTopOnlyModel(source, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
    if (owned) source.dispose();
    const requested = options.bottomPattern?.length
        ? options.bottomPattern
        : buildFairedPatternFromTop(model, options.scanPattern);
    const loft = (pattern: PolyPoint[]) => {
        const thicknessMm =
            options.thicknessMm ?? options.sourceField?.thicknessMm ?? BASE_REFERENCE_THICKNESS_MM;
        const stockThicknessMm = options.stockThicknessMm ?? BASE_REFERENCE_THICKNESS_MM;
        const geometry = reconstructProceduralWalls(model, {
            corrections: (options.corrections ?? options.sourceField?.corrections) as
                | SideCorrections
                | undefined,
            thicknessMm,
            stockThicknessMm,
            bottomPattern: pattern,
            bottomPatternLabel: PATTERN_SOURCE_SYNTHETIC,
            userBottomPattern: options.userBottomPattern,
            flatPlantar: true,
            wallStyle: options.wallStyle,
            deviceType: options.deviceType,
            lateralFlange: options.lateralFlange,
            archGrindDepthMm: options.archGrindDepthMm,
            scanPattern: options.scanPattern,
            sourceField: options.sourceField,
            composedTop: useComposed,
            shoeWidth: options.shoeWidth,
            footprintReferenceBounds: footprintReferenceBounds ?? options.footprintReferenceBounds,
            footprintLengthMm: options.footprintLengthMm,
            footprintWidthMm: options.footprintWidthMm,
            sizeLabel: options.sizeLabel,
        });
        return { model, pattern, geometry };
    };
    try {
        return loft(requested);
    } catch (e) {
        if (options.bottomPattern?.length || !options.scanPattern || options.scanPattern === "full_contact") {
            throw e;
        }
        // Prefab 3D / Flat must still produce a mesh from SAMPLE_Top.
        return loft(buildFairedPatternFromTop(model));
    }
}
