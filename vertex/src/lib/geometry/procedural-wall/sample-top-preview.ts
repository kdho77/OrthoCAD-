// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { baseModifierField, StockGlbLoadError } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { fullLengthWedgeActive } from "@/lib/geometry/full-length-wedge";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { heelCupWidthScaleFactor, widthCorrectionFollowEnvelope } from "@/lib/geometry/height-field";
import { perfMark } from "@/lib/geometry/perf/load-export-perf";
import { scaleSourceShapeToFootprint } from "@/lib/geometry/shoe-size";
import { shoeWidthAffineActive } from "@/lib/geometry/shoe-width";
import { effectiveInsoleThicknessMm } from "@/lib/geometry/sink";
import { hasActiveComposedTextMarking } from "@/lib/geometry/text-marking/compose";
import type { TrimlineCurve } from "@/lib/geometry/trimline";
import {
    extractMergedGeometry,
    loadGlbFromBuffer,
    mirrorGeometry,
    reorientToFootprintFrame,
} from "@/lib/library/loaders";
import type { PlacedSink, ScanPattern, Side, SideCorrections, TextMarking } from "@/types";
import { insetsForScanPattern, PATTERN_SOURCE_SYNTHETIC, syntheticBottomPattern } from "./bottom-pattern";
import type { PolyPoint } from "./curves";
import { extractTopOnlyModel, isCombinedStockGeometry } from "./extract";
import {
    awaitManufacturingLoftInflight,
    cachedManufacturingSolidIncludesExportText,
    cachedManufacturingSolidMatchesFrame,
    dropManufacturingSolid,
    type ManufacturingSolidContext,
    manufacturingSolidFingerprint,
    noteManufacturingSolidBuilt,
    noteManufacturingSolidReused,
    peekManufacturingSolid,
    rememberManufacturingSolid,
    stampManufacturingSolidFrame,
} from "./manufacturing-solid-cache";
import { FOREFOOT_SHIFT_U_HOLD, forefootFeatureBoxes, offsetPlanLoopForefootWidthMm } from "./modifiers";
import {
    composePrintSolidTop,
    fieldWithoutSinks,
    type PrintSolidShoeWidth,
    withDefaultPrintShell,
} from "./print-solid-compose";
import { hasCurveOrTopModifiers, reconstructProceduralWalls } from "./reconstruct";
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

/**
 * Install SAMPLE_Top parsed by {@link sampleTopFromArrayBuffer}.
 * loadSampleTopGeometry then clones this mesh instead of fetching.
 */
export function primeSampleTopGeometry(geometry: BufferGeometry): void {
    cachedNative?.dispose();
    cachedNative = geometry;
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
    const fore = corrections?.forefootWidthMm ?? 0;
    if ((!heel && !fore) || pattern.length < 3) return pattern;
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
    const scaled = rim.map((p) => {
        const u = Math.max(0, Math.min(1, (p.x - model.bounds.minX) / length));
        let y = p.y;
        if (heel) {
            const s = heelCupWidthScaleFactor(u, heel);
            y = yMid + (y - yMid) * s;
        }
        return { x: p.x, y, z: 0 };
    });
    const live = fore ? offsetPlanLoopForefootWidthMm(scaled, model.bounds, fore) : scaled;
    return shiftPatternByRimFollow(pattern, rim, live, (p) => {
        const u = Math.max(0, Math.min(1, (p.x - model.bounds.minX) / length));
        return widthCorrectionFollowEnvelope(u, heel, fore);
    });
}

function cacheHitModel(): StockWallModel {
    return { id: "manufacturing-cache" } as StockWallModel;
}

function tagManufacturingSolid(geometry: BufferGeometry, fingerprint: string, fromCache: boolean): void {
    geometry.userData = {
        ...geometry.userData,
        manufacturingFingerprint: fingerprint,
        fromManufacturingCache: fromCache,
    };
}

/** Leader is not applied here. Text runs once, and only when this mesh is not already engraved. */
async function applyExportText(
    geometry: BufferGeometry,
    options: ProceduralPreviewOptions & { mirrored?: boolean },
): Promise<BufferGeometry> {
    if (
        !hasActiveComposedTextMarking(
            options.textMarking,
            options.patientDisplayName,
            options.side ?? "right",
        )
    ) {
        return geometry;
    }
    const { applyTextMarkingToPrintSolid } = await import("@/lib/geometry/text-marking/apply");
    const { TextMarkingError } = await import("@/lib/geometry/text-marking/errors");
    const { buildTextGuide } = await import("@/lib/geometry/text-marking/place");
    const textGuide = buildTextGuide(geometry);
    try {
        const marked = await applyTextMarkingToPrintSolid(
            geometry,
            options.textMarking,
            {
                side: options.side ?? (options.mirrored ? "left" : "right"),
                beltPrint: options.beltPrint,
            },
            options.patientDisplayName,
        );
        if (marked !== geometry) geometry.dispose();
        marked.userData = { ...marked.userData, textGuide };
        return marked;
    } catch (e) {
        if (!(e instanceof TextMarkingError)) throw e;
        geometry.userData = { ...geometry.userData, textFitError: e.message, textGuide };
        return geometry;
    }
}

/**
 * Print / STL: loft the approved solid. Same reconstruct math as the frozen STLs.
 * A cache hit skips reconstruct. Print already engraved the composed patient
 * name, so that hit is returned as-is. Text runs only for a pre-text loft.
 * The caller still closes and validates the mesh, then the G-code path adds the leader once.
 */
export async function buildProceduralExportSolid(
    options: ProceduralPreviewOptions & { mirrored?: boolean } = {},
    cache?: ManufacturingSolidContext | null,
): Promise<{ model: StockWallModel; pattern: PolyPoint[]; geometry: BufferGeometry }> {
    const side = cache?.side ?? options.side ?? (options.mirrored ? "left" : "right");
    const fingerprint = cache ? manufacturingSolidFingerprint(options, cache) : "";
    if (cache && fingerprint) {
        await awaitManufacturingLoftInflight(fingerprint, side);
        const started = performance.now();
        const cached = peekManufacturingSolid(fingerprint, side);
        if (cached && !cachedManufacturingSolidMatchesFrame(cached, options, cache)) {
            cached.dispose();
            dropManufacturingSolid(side);
        } else if (cached) {
            perfMark("export:loft", { side, warm: true });
            const geometry = cachedManufacturingSolidIncludesExportText(cached, options)
                ? cached
                : await applyExportText(cached, options);
            tagManufacturingSolid(geometry, fingerprint, true);
            noteManufacturingSolidReused(side, performance.now() - started);
            return { model: cacheHitModel(), pattern: [], geometry };
        }
    }

    perfMark("export:loft", { side, warm: false });
    noteManufacturingSolidBuilt(side);
    let raw = await loadSampleTopGeometry();
    if (options.mirrored) {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    try {
        const preview = await reconstructProceduralPreview(raw, options);
        if (cache && fingerprint) {
            stampManufacturingSolidFrame(preview.geometry, options, cache);
            rememberManufacturingSolid(fingerprint, side, preview.geometry);
        }
        const geometry = await applyExportText(preview.geometry, options);
        if (fingerprint) tagManufacturingSolid(geometry, fingerprint, false);
        return geometry === preview.geometry ? preview : { ...preview, geometry };
    } finally {
        raw.dispose();
    }
}

/** Same XY map as the top sheet. The Men's 9 pattern is scaled, not re-fit. */
function scalePlanLoop(points: PolyPoint[], scale: number, center: { x: number; y: number }): PolyPoint[] {
    return points.map((p) => ({
        x: center.x + (p.x - center.x) * scale,
        y: center.y + (p.y - center.y) * scale,
        z: 0,
    }));
}

/**
 * The viewer stores the bottom pattern in the native SAMPLE_Top frame.
 * Print scales the top sheet by `scale` about `center`; the pattern has to
 * use that same map or lateral stations stay on the Men's 9 outline and
 * fall outside a smaller TopSheet rim.
 */
export function scaleBottomPatternToFootprint(
    pattern: PolyPoint[],
    center: { x: number; y: number },
    scale: number,
): PolyPoint[] {
    if (!pattern.length || !Number.isFinite(scale) || Math.abs(scale - 1) <= 1e-9) {
        return pattern.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
    }
    return scalePlanLoop(pattern, scale, center);
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
    /** Linked client name for bottom addPatientName (not stored in textMarking.text). */
    patientDisplayName?: string | null;
    /** Foot side for left/right placement (wall text is never glyph-mirrored). */
    side?: Side;
    /**
     * Belt manufacturing STL only. Keeps the bottom-name cap at +Y so
     * VertexSlice's det −1 forward prints the name upright from below.
     * Omitted on the viewer and on a plain STL download.
     */
    beltPrint?: boolean;
    /**
     * Scale the top sheet to this shoe footprint before compose. Export and CNC
     * set it. The viewer leaves it unset so the on-screen SAMPLE_Top stays native.
     */
    footprintMm?: { lengthMm: number; widthMm: number } | null;
    /**
     * Analytic-top sinks. Passed through without sourceField so a sink-free
     * export stays on the same loft path as main.
     */
    sinks?: PlacedSink[];
    sinkStyloidThicken?: boolean;
    /**
     * Uniform scale vs Men's 9, applied to this top sheet before compose and
     * loft. XY about the bbox center; Z relief above the 2 mm floor by the
     * same factor. Omitted or 1 leaves every vertex unwritten.
     */
    footprintScale?: number;
}

/**
 * Viewer reconstruct for procedural mode: top-only SAMPLE_Top + faired B.
 * With sourceField: compose once, extractTopOnlyModel on the composed top,
 * loft without applyAnalyticTopDeltas. Do not pass raw+sourceGeometry into
 * the Default extractTopSheet steal — that yields a 0-station ring.
 *
 * Identity preview (wall style / side / sinks only) uses that same
 * composePrintSolidTop → applyBaseModifiers path as manufacturing export,
 * including the default zonal shell. An explicit corrections object stays
 * analytic so a delta is not mixed with a pre-composed sheet.
 */
async function withDefaultPrintCompose(options: ProceduralPreviewOptions): Promise<ProceduralPreviewOptions> {
    if (options.sourceField || options.composedTop === true) return options;
    if (options.corrections) return options;
    if ((options.archGrindDepthMm ?? 0) !== 0) return options;
    if ((options.lateralFlange?.heightMm ?? 0) !== 0) return options;
    if (
        hasCurveOrTopModifiers({
            composedTop: false,
            thicknessMm: options.thicknessMm,
            stockThicknessMm: options.stockThicknessMm,
        })
    ) {
        return options;
    }
    const { defaultDesign } = await import("@/stores/design-store");
    const design = defaultDesign();
    const side = options.side ?? "left";
    const thicknessMm = options.thicknessMm ?? design.thicknessMm;
    return {
        ...options,
        side,
        sourceField: baseModifierField(design, side, thicknessMm),
        composedTop: true,
        thicknessMm,
        stockThicknessMm: options.stockThicknessMm ?? BASE_REFERENCE_THICKNESS_MM,
        scanPattern: options.scanPattern ?? design.pattern,
        deviceType: options.deviceType ?? "functional",
    };
}

function heelCupWidthMmOf(options: ProceduralPreviewOptions): number {
    return options.corrections?.heelCupWidthMm ?? options.sourceField?.corrections?.heelCupWidthMm ?? 0;
}

/**
 * Men's 9 fair, then a uniform size scale, does not include the shoe-width
 * move the top sheet gets next. On a short narrow foot the rim moves in and
 * the station ray hits the far side of that pattern (S1-PRELOFT skew).
 * Heel-cup width already follows the rim, and that path already exports, so
 * it is left alone.
 */
function patternNeedsShoeWidthFollow(options: ProceduralPreviewOptions): boolean {
    const sw = options.shoeWidth;
    if (!sw || !shoeWidthAffineActive(sw.width, sw.heelOverrideMm)) return false;
    return Math.abs(heelCupWidthMmOf(options)) < 1e-6;
}

function rimPlanOf(model: StockWallModel): PolyPoint[] | null {
    const pos = model.top.meshPositions;
    const rim = model.top.rimLocal;
    if (!pos || !rim || rim.length < 3) return null;
    return rim.map((i) => ({
        x: pos[i * 3] ?? 0,
        y: pos[i * 3 + 1] ?? 0,
        z: 0,
    }));
}

function isPreloftSkewError(error: unknown): boolean {
    return (
        error instanceof Error && error.message.includes("[S1-PRELOFT]") && error.message.includes("skew[")
    );
}

function reflectPlanY(points: PolyPoint[], y0: number): PolyPoint[] {
    return points.map((p) => ({ x: p.x, y: 2 * y0 - p.y, z: p.z ?? 0 }));
}

/**
 * The right field was built on the mirrored sheet. Drop mesh closures so the
 * left-frame loft rebuilds them from the unmirrored stock, and place elements
 * on the opposite side of the centre.
 */
function leftFieldFromMirroredRight(field: HeightFieldParams): HeightFieldParams {
    const copy: HeightFieldParams = {
        ...field,
        side: "left",
        elements: field.elements?.map((el) => ({
            ...el,
            side: "left",
            position: { x: el.position.x, y: -el.position.y },
            rotationDeg: -el.rotationDeg,
        })),
    };
    delete copy.topEdgeAvProfile;
    delete copy.fullLengthRim;
    return copy;
}

export async function reconstructProceduralPreview(
    topGeo: BufferGeometry,
    options: ProceduralPreviewOptions = {},
): Promise<{ model: StockWallModel; pattern: PolyPoint[]; geometry: BufferGeometry }> {
    if (isCombinedStockGeometry(topGeo)) {
        throw new Error("[S1-PROCEDURAL] combined/stock GLB is not a procedural input — use legacy");
    }
    options = await withDefaultPrintCompose(options);
    const footprintScale = options.footprintScale;
    let working = topGeo;
    let footprintClone: BufferGeometry | null = null;
    let scaledPattern: PolyPoint[] | null = null;
    let nativeFairScaled = false;
    let fairCenter: { x: number; y: number } | null = null;
    if (footprintScale != null && Number.isFinite(footprintScale) && Math.abs(footprintScale - 1) > 1e-9) {
        if (!topGeo.boundingBox) topGeo.computeBoundingBox();
        const box = topGeo.boundingBox;
        const center = box ? { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 } : null;
        fairCenter = center;
        if (center && options.bottomPattern?.length) {
            // Live / edited pattern is in the pre-scale frame. Use a fresh
            // bbox so the center matches scaleSourceShapeToFootprint.
            topGeo.computeBoundingBox();
            const live = topGeo.boundingBox;
            if (live) {
                scaledPattern = scaleBottomPatternToFootprint(
                    options.bottomPattern,
                    { x: (live.min.x + live.max.x) / 2, y: (live.min.y + live.max.y) / 2 },
                    footprintScale,
                );
            }
        } else if (center && insetsForScanPattern(options.scanPattern) == null) {
            nativeFairScaled = true;
            const native = topGeo.clone();
            try {
                const nativeModel = extractTopOnlyModel(native, {
                    id: SAMPLE_TOP_ASSET_ID,
                    name: SAMPLE_TOP_NAME,
                });
                scaledPattern = scalePlanLoop(
                    buildFairedPatternFromTop(nativeModel, options.scanPattern),
                    footprintScale,
                    center,
                );
            } finally {
                native.dispose();
            }
        }
        footprintClone = topGeo.clone();
        scaleSourceShapeToFootprint(footprintClone, footprintScale, BASE_REFERENCE_THICKNESS_MM);
        working = footprintClone;
    }
    // Rim before the shoe-width affine. Captured from the sized sheet, before
    // compose moves it. Used only if the unmoved pattern fails the skew gate.
    let shoeWidthRimBefore: PolyPoint[] | null = null;
    if (nativeFairScaled && scaledPattern && patternNeedsShoeWidthFollow(options)) {
        const sized = working.clone();
        try {
            shoeWidthRimBefore = rimPlanOf(
                extractTopOnlyModel(sized, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME }),
            );
        } finally {
            sized.dispose();
        }
    }
    const useComposed = Boolean(options.sourceField) || options.composedTop === true;
    let source = working;
    let owned = false;
    if (options.sourceField) {
        const fore = options.sourceField.corrections?.forefootWidthMm ?? 0;
        // Pair and loft the zero-forefoot sheet. The wall applies one lateral
        // normal offset after main's stations exist. A full-length wedge samples
        // the same held u as that offset, so the toe rim does not keep tilting.
        const widthFree =
            fore !== 0
                ? {
                      ...options.sourceField,
                      corrections: { ...options.sourceField.corrections, forefootWidthMm: 0 },
                      ...(fullLengthWedgeActive(options.sourceField.corrections)
                          ? { fullLengthToeHoldU: FOREFOOT_SHIFT_U_HOLD }
                          : {}),
                  }
                : options.sourceField;
        // Resolve the shell mode at the slider thickness first. Raising the
        // number before that would skip the zonal shell and retessellate the
        // wall. The lift is the same solid-top raise the slider uses, then
        // the cut is applied after the loft.
        const sinkList = options.sinks?.length ? options.sinks : widthFree.sinks;
        const setThickness = options.thicknessMm ?? widthFree.thicknessMm;
        const shelled = withDefaultPrintShell({ ...widthFree, thicknessMm: setThickness });
        const effectiveThickness = effectiveInsoleThicknessMm(setThickness, {
            ...shelled,
            sinks: sinkList,
            sinkStyloidThicken: options.sinkStyloidThicken ?? shelled.sinkStyloidThicken,
        });
        const thickened =
            effectiveThickness === shelled.thicknessMm
                ? shelled
                : { ...shelled, thicknessMm: effectiveThickness };
        const sourceField = fieldWithoutSinks(thickened);
        source = await composePrintSolidTop(working, {
            sourceField,
            shoeWidth: options.shoeWidth,
            trimline: options.trimline,
        });
        owned = source !== working;
    }
    const model = extractTopOnlyModel(source, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
    const discard = new Set<BufferGeometry>();
    if (owned) discard.add(source);
    if (footprintClone) discard.add(footprintClone);
    for (const geo of discard) geo.dispose();
    const requested =
        scaledPattern ??
        (options.bottomPattern?.length
            ? options.bottomPattern
            : buildFairedPatternFromTop(model, options.scanPattern));
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
            flatPlantar: true,
            wallStyle: options.wallStyle,
            deviceType: options.deviceType,
            lateralFlange: options.lateralFlange,
            archGrindDepthMm: options.archGrindDepthMm,
            sourceField: options.sourceField,
            composedTop: useComposed,
            forefootRigidBoxes: forefootFeatureBoxes(model.bounds, {
                lengthMm: model.bounds.maxX - model.bounds.minX,
                elements: options.sourceField?.elements,
                text: options.textMarking,
            }),
            // Do not set sourceField just to carry sinks — that flips composedTop.
            ...(options.sinks && options.sinks.length > 0
                ? { sinks: options.sinks, sinkStyloidThicken: options.sinkStyloidThicken }
                : {}),
            // Scaled outlines only. Native posting and the US 9 reference
            // stay on the triangulation those baselines already froze.
            ...(footprintClone ? { repairUpwardBottom: true } : {}),
        });
        return { model, pattern, geometry };
    };
    try {
        return loft(requested);
    } catch (e) {
        // Designs that already clear the skew gate keep the unaligned pattern,
        // so their mesh stays byte-for-byte. Only a failed gate is rebuilt.
        const shoeWidthRimAfter = shoeWidthRimBefore ? rimPlanOf(model) : null;
        if (shoeWidthRimBefore && shoeWidthRimAfter && scaledPattern && isPreloftSkewError(e)) {
            // The rim-follow map is already the mirror of the left map, but the
            // station loft is not mirror-symmetric and still misses the 0.5×inset
            // cap. Run that same left loft on the unmirrored stock and mirror the
            // solid back. Z is not flipped, so the seam stays on the bottom.
            if (options.side === "right" && options.sourceField && fairCenter) {
                const leftTop = mirrorGeometry(topGeo);
                try {
                    const leftPreview = await reconstructProceduralPreview(leftTop, {
                        ...options,
                        side: "left",
                        sourceField: leftFieldFromMirroredRight(options.sourceField),
                    });
                    const geometry = mirrorGeometry(leftPreview.geometry);
                    leftPreview.geometry.dispose();
                    return {
                        model,
                        pattern: reflectPlanY(leftPreview.pattern, fairCenter.y),
                        geometry,
                    };
                } finally {
                    leftTop.dispose();
                }
            }
            return loft(shiftPatternByRimFollow(scaledPattern, shoeWidthRimBefore, shoeWidthRimAfter, 1));
        }
        if (options.bottomPattern?.length || !options.scanPattern || options.scanPattern === "full_contact") {
            throw e;
        }
        // Prefab 3D / Flat must still produce a mesh from SAMPLE_Top.
        return loft(buildFairedPatternFromTop(model));
    }
}
