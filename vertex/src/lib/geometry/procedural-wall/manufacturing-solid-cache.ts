// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { elementGeometryKey } from "@/lib/geometry/element-geometry-key";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    addPatientNameEnabled,
    composeMarkingTextForSide,
    hasActiveComposedTextMarking,
} from "@/lib/geometry/text-marking/compose";
import { textMarkingHash } from "@/lib/geometry/text-marking/hash";
import type { Side } from "@/types";
import {
    MANUFACTURING_STL_PLACEMENT_VERSION,
    manufacturingStlIdentityPayload,
    ORTHOCAD_MANUFACTURING_VERSION,
} from "../../../../shared/manufacturing-stl-identity";
import type { PolyPoint } from "./curves";
import type { ProceduralPreviewOptions } from "./sample-top-preview";
import { sha256Hex } from "./sha256";

export { MANUFACTURING_STL_PLACEMENT_VERSION, ORTHOCAD_MANUFACTURING_VERSION };

/**
 * Bump when the loft algorithm changes so an in-memory solid cannot outlive
 * the math that produced it. Saved designs stay parameter-only; this cache
 * is process memory.
 * 2 — beltPrint and placement version are part of the identity.
 */
export const MANUFACTURING_SOLID_GEOMETRY_VERSION = 2;

export interface ManufacturingSolidContext {
    side: Side;
    mirrored: boolean;
    baseAssetId: string;
    /** Same counter as #259. Leaving Print/Export bumps it and this key misses. */
    printLoftEpoch: number;
    /** Apex product sent to the slicer (Apex Core / Apex Light). */
    productId: string;
    /** Production method plus the locked machine profile id. */
    machineId: string;
    geometryVersion: number;
    /** Belt-frame generation. A solid from an older value is not a cache hit. */
    placementVersion: number;
    /** Full saved design (mesh blobs stripped). Any field change misses. */
    savedDesign: unknown;
    /** OrthoCAD loft generation. */
    orthocadVersion: string;
    /** Slicer build, or the default manufacturing slicer version. */
    slicerVersion: string;
}

export interface ManufacturingLoftStats {
    built: number;
    reused: number;
    published: number;
    builtBySide: Record<Side, number>;
    reusedBySide: Record<Side, number>;
    /** Last warm reuse duration. Cold lofts are not timed here. */
    lastReuseMs: number;
}

const emptySideCounts = (): Record<Side, number> => ({ left: 0, right: 0 });

const stats: ManufacturingLoftStats = {
    built: 0,
    reused: 0,
    published: 0,
    builtBySide: emptySideCounts(),
    reusedBySide: emptySideCounts(),
    lastReuseMs: 0,
};

interface Slot {
    fingerprint: string;
    side: Side;
    geometry: BufferGeometry;
}

const slots = new Map<Side, Slot>();

export function manufacturingLoftStats(): ManufacturingLoftStats {
    return {
        ...stats,
        builtBySide: { ...stats.builtBySide },
        reusedBySide: { ...stats.reusedBySide },
    };
}

export function resetManufacturingSolidCache(): void {
    for (const slot of slots.values()) slot.geometry.dispose();
    slots.clear();
    inflightLofts.clear();
    stats.built = 0;
    stats.reused = 0;
    stats.published = 0;
    stats.builtBySide = emptySideCounts();
    stats.reusedBySide = emptySideCounts();
    stats.lastReuseMs = 0;
}

export function dropManufacturingSolid(side: Side): void {
    const slot = slots.get(side);
    if (!slot) return;
    slot.geometry.dispose();
    slots.delete(side);
}

function stableStringify(value: unknown): string {
    if (typeof value === "function" || typeof value === "undefined") return "null";
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
        .filter((key) => obj[key] !== undefined && typeof obj[key] !== "function")
        .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

function hashPolyline(
    points: ReadonlyArray<{ x: number; y: number; z?: number }> | null | undefined,
): string {
    if (!points?.length) return "";
    const parts = [`n=${points.length}`];
    for (const point of points) {
        parts.push(
            `${Math.round(point.x * 100)},${Math.round(point.y * 100)},${Math.round((point.z ?? 0) * 100)}`,
        );
    }
    return sha256Hex(parts.join(";"));
}

function curveHash(
    curve: { points?: ReadonlyArray<{ x: number; y: number; z?: number }> } | null | undefined,
): string {
    return hashPolyline(curve?.points);
}

/** Compose clip uses the explicit trimline first. Posting uses the field trimline first. */
export function effectiveTrimlineHashes(options: ProceduralPreviewOptions): {
    compose: string;
    posting: string;
} {
    const compose = options.trimline ?? options.sourceField?.trimline ?? null;
    const posting = options.sourceField?.trimline ?? options.trimline ?? null;
    return { compose: curveHash(compose), posting: curveHash(posting) };
}

function fieldIdentity(field: HeightFieldParams | undefined) {
    if (!field) return null;
    return {
        side: field.side,
        lengthMm: field.lengthMm,
        widthMm: field.widthMm,
        thicknessMm: field.thicknessMm,
        corrections: field.corrections,
        elements: elementGeometryKey(field.elements ?? []),
        sinks: field.sinks ?? [],
        sinkStyloidThicken: field.sinkStyloidThicken === true,
        includeSkives: field.includeSkives === true,
        includeElements: field.includeElements !== false,
        shellThicknessMode: field.shellThicknessMode ?? "",
        shellThicknessRfMm: field.shellThicknessRfMm ?? null,
        shellThicknessMfMm: field.shellThicknessMfMm ?? null,
        shellThicknessFfMm: field.shellThicknessFfMm ?? null,
        shellThicknessBlendMm: field.shellThicknessBlendMm ?? null,
        method: field.method ?? "",
        shapeFinish: field.shapeFinish ?? null,
        shoeWidth: field.shoeWidth ?? null,
    };
}

/**
 * Bottom engraving identity. `textMarkingHash` ignores an empty `text` field, so a
 * default row (`text: ""`, `addPatientName: true`) used to miss the patient name.
 * The composed line is what Print engraves and what Export must key on.
 */
export function composedEngravingKey(
    marking: ProceduralPreviewOptions["textMarking"],
    patientDisplayName: string | null | undefined,
    side: Side,
): string {
    if (!marking) return "";
    if (marking.surface === "wall" || marking.surface === "medial") return textMarkingHash(marking);
    const composed = composeMarkingTextForSide(marking, side, patientDisplayName);
    if (!composed) {
        // The saved-design template stores the default bottom row (checkbox on,
        // extra line empty). With no name and no extra line that engraves the
        // same solid as a design that never set textMarking, so the key stays
        // empty. Turning the checkbox off still misses.
        if (addPatientNameEnabled(marking)) return "";
        return "bottom:0";
    }
    return textMarkingHash({ ...marking, text: composed });
}

/**
 * Print stores the solid after the worker engraves. A later Export must not
 * run that engrave again. A cold export stores the pre-text loft (no guide),
 * so the one engraving still happens with that call's belt frame.
 */
export function cachedManufacturingSolidIncludesExportText(
    geometry: BufferGeometry,
    options: ProceduralPreviewOptions & { mirrored?: boolean },
): boolean {
    const side = options.side ?? (options.mirrored ? "left" : "right");
    if (!hasActiveComposedTextMarking(options.textMarking, options.patientDisplayName, side)) return true;
    const ud = geometry.userData as {
        textFitError?: string | null;
        textGuide?: unknown;
        bottomOutlineWorld?: unknown;
    };
    if (ud?.textFitError) return false;
    // Worker copies `textGuide` after a successful engrave. The planar
    // engrave itself leaves `bottomOutlineWorld` on the mesh.
    return Boolean(ud?.textGuide || ud?.bottomOutlineWorld);
}

/**
 * A belt export must not adopt a viewer solid or a pre-#52 engraving.
 * Non-belt callers still accept an unstamped slot. A slot stamped for the
 * belt is not a plain STL hit, and a placement-version mismatch misses.
 */
export function cachedManufacturingSolidMatchesFrame(
    geometry: BufferGeometry,
    options: { beltPrint?: boolean },
    context: ManufacturingSolidContext,
): boolean {
    const ud = geometry.userData as { beltPrint?: boolean; placementVersion?: number };
    const wantsBelt = options.beltPrint === true;
    if (wantsBelt) {
        return ud.beltPrint === true && ud.placementVersion === context.placementVersion;
    }
    if (ud.beltPrint === true) return false;
    if (ud.placementVersion != null && ud.placementVersion !== context.placementVersion) return false;
    return true;
}

export function stampManufacturingSolidFrame(
    geometry: BufferGeometry,
    options: { beltPrint?: boolean },
    context: ManufacturingSolidContext,
): void {
    geometry.userData = {
        ...geometry.userData,
        beltPrint: options.beltPrint === true,
        placementVersion: context.placementVersion,
    };
}

/** Canonical dependency record. `mirrored` on the options object is ignored; context wins. */
export function manufacturingSolidIdentity(
    options: ProceduralPreviewOptions,
    context: ManufacturingSolidContext,
): Record<string, unknown> {
    const trims = effectiveTrimlineHashes(options);
    const pattern: PolyPoint[] | undefined = options.bottomPattern;
    return {
        geometryVersion: context.geometryVersion,
        side: context.side,
        mirrored: context.mirrored,
        baseAssetId: context.baseAssetId,
        printLoftEpoch: context.printLoftEpoch,
        productId: context.productId,
        machineId: context.machineId,
        wallStyle: options.wallStyle ?? "",
        deviceType: options.deviceType ?? "",
        thicknessMm: options.thicknessMm ?? null,
        stockThicknessMm: options.stockThicknessMm ?? null,
        archGrindDepthMm: options.archGrindDepthMm ?? 0,
        scanPattern: options.scanPattern ?? "",
        composedTop: options.composedTop === true,
        footprintScale: options.footprintScale ?? null,
        lateralFlange: options.lateralFlange ?? null,
        shoeWidth: options.shoeWidth ?? null,
        corrections: options.corrections ?? null,
        pattern: hashPolyline(pattern),
        composeTrim: trims.compose,
        postingTrim: trims.posting,
        textMarking: composedEngravingKey(
            options.textMarking,
            options.patientDisplayName,
            options.side ?? context.side,
        ),
        beltPrint: options.beltPrint === true,
        placementVersion: context.placementVersion,
        savedDesignIdentity: manufacturingStlIdentityPayload({
            savedDesign: context.savedDesign,
            side: context.side,
            beltPrint: options.beltPrint === true,
            placementVersion: context.placementVersion,
            orthocadVersion: context.orthocadVersion,
            slicerVersion: context.slicerVersion,
        }),
        field: fieldIdentity(options.sourceField),
        sinks: options.sinks ?? [],
        sinkStyloidThicken: options.sinkStyloidThicken === true,
    };
}

export function manufacturingSolidFingerprint(
    options: ProceduralPreviewOptions,
    context: ManufacturingSolidContext,
): string {
    return sha256Hex(stableStringify(manufacturingSolidIdentity(options, context)));
}

export function rememberManufacturingSolid(fingerprint: string, side: Side, geometry: BufferGeometry): void {
    const existing = slots.get(side);
    if (existing?.fingerprint === fingerprint && existing.side === side) return;
    existing?.geometry.dispose();
    const clone = geometry.clone();
    clone.userData = {
        ...geometry.userData,
        manufacturingFingerprint: fingerprint,
        fromManufacturingCache: false,
    };
    slots.set(side, { fingerprint, side, geometry: clone });
}

export function peekManufacturingSolid(fingerprint: string, side: Side): BufferGeometry | null {
    const slot = slots.get(side);
    if (!slot || slot.side !== side || slot.fingerprint !== fingerprint) return null;
    const clone = slot.geometry.clone();
    clone.userData = { ...slot.geometry.userData, manufacturingFingerprint: fingerprint };
    return clone;
}

export function publishPreviewManufacturingSolid(
    options: ProceduralPreviewOptions,
    context: ManufacturingSolidContext,
    geometry: BufferGeometry,
): void {
    if (context.side !== (options.side ?? context.side)) return;
    stats.published += 1;
    stampManufacturingSolidFrame(geometry, options, context);
    rememberManufacturingSolid(manufacturingSolidFingerprint(options, context), context.side, geometry);
}

export function noteManufacturingSolidBuilt(side: Side): void {
    stats.built += 1;
    stats.builtBySide[side] += 1;
}

export function noteManufacturingSolidReused(side: Side, elapsedMs: number): void {
    stats.reused += 1;
    stats.reusedBySide[side] += 1;
    stats.lastReuseMs = elapsedMs;
}

function inflightLoftKey(fingerprint: string, side: Side): string {
    return `${side}:${fingerprint}`;
}

const inflightLofts = new Map<string, Promise<void>>();

/** Preview / export share one in-flight loft per side+fingerprint. Export awaits instead of duplicating. */
export function trackManufacturingLoftInflight(
    fingerprint: string,
    side: Side,
    work: Promise<unknown>,
): void {
    const key = inflightLoftKey(fingerprint, side);
    const tracked = work
        .then(
            () => undefined,
            () => undefined,
        )
        .finally(() => {
            if (inflightLofts.get(key) === tracked) inflightLofts.delete(key);
        });
    inflightLofts.set(key, tracked);
}

export async function awaitManufacturingLoftInflight(fingerprint: string, side: Side): Promise<void> {
    const pending = inflightLofts.get(inflightLoftKey(fingerprint, side));
    if (pending) await pending;
}

export function resetManufacturingLoftInflightForTests(): void {
    inflightLofts.clear();
}
