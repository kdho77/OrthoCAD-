// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { elementGeometryKey } from "@/lib/geometry/element-geometry-key";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { textMarkingHash } from "@/lib/geometry/text-marking/hash";
import type { Side } from "@/types";
import type { PolyPoint } from "./curves";
import type { ProceduralPreviewOptions } from "./sample-top-preview";
import { sha256Hex } from "./sha256";

/**
 * Bump when the loft algorithm changes so an in-memory solid cannot outlive
 * the math that produced it. Saved designs stay parameter-only; this cache
 * is process memory.
 */
export const MANUFACTURING_SOLID_GEOMETRY_VERSION = 1;

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
        textMarking: textMarkingHash(options.textMarking),
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
