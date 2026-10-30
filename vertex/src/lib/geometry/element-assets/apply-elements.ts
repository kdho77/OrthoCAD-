// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { BufferAttribute, type BufferGeometry } from "three";
import {
    classifyBaseTopFactors,
    getBaseFootprintFrame,
    vertexFootprintAt,
} from "@/lib/geometry/base-modifier";
import {
    ELEMENT_IDS_KEY,
    ELEMENT_LIFT_ATTRIBUTE,
    ELEMENT_OWNER_ATTRIBUTE,
} from "@/lib/geometry/element-visualization";
import { elementHeightAt } from "@/lib/geometry/elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    EDGE_FEATHER_EASE_START_R,
    quinticSmoothstep,
    resolveOutlineHalfWidth,
} from "@/lib/geometry/height-field";
import { applySinkCutToGeometry, sinksActive } from "@/lib/geometry/sink";
import type { PlacedElement } from "@/types";
import { loadTransformedAssetPositions, resolvePlacedAssetContexts } from "./element-asset";
import { gridEdgeRingMax, sampleGridBilinear } from "./height-grid";
import {
    anchorMmFromPlacement,
    defaultNoFlowHeightHooks,
    type NoFlowHeightHooks,
    smoothMaxMm,
    smoothMinMm,
} from "./no-flow-blend";
import {
    ELEMENT_SUBDIVIDE_EDGE_MM,
    type ElementFeatherMm,
    LIBRARY_HEIGHT_FIELD_KINDS,
    NO_FLOW_SMOOTH_MAX_K_MM,
    type PlacedElementAssetContext,
} from "./types";

const DEG = Math.PI / 180;

function c1Smoothstep01(t: number): number {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
}

const HIGH_EDGE_RING_MM = 1;

function rimBandClipFactor(u: number, vSigned: number, field: HeightFieldParams): number {
    const av = Math.abs(vSigned);
    const avEdge = field.topEdgeAvProfile ? field.topEdgeAvProfile(u, vSigned) : 0;
    if (avEdge <= 1e-6) return 1;
    if (av >= avEdge) return 0;
    return 1;
}

/** #184 rim-band fade to 0 at the local top-sheet edge (C2 / therefore C1). */
export function rimBandFadeFactor(u: number, vSigned: number, field: HeightFieldParams): number {
    const av = Math.abs(vSigned);
    const avEdge = field.topEdgeAvProfile ? field.topEdgeAvProfile(u, vSigned) : 0;
    if (avEdge <= 1e-6) return 1;
    const r = av / avEdge;
    if (r >= 1) return 0;
    if (r <= EDGE_FEATHER_EASE_START_R) return 1;
    const t = (r - EDGE_FEATHER_EASE_START_R) / (1 - EDGE_FEATHER_EASE_START_R);
    return 1 - quinticSmoothstep(t);
}

function fillEmptyBins(bins: Float64Array): void {
    let last = 0;
    for (let i = 0; i < bins.length; i++) {
        const v = bins[i] ?? 0;
        if (v > 1e-6) last = v;
        else bins[i] = last;
    }
    last = 0;
    for (let i = bins.length - 1; i >= 0; i--) {
        const v = bins[i] ?? 0;
        if (v > 1e-6) last = v;
        else bins[i] = last;
    }
}

/** Build a local top-sheet |v| profile from the reference mesh when the field has none. */
export function ensureTopEdgeAvProfile(field: HeightFieldParams, base: BufferGeometry): void {
    if (field.topEdgeAvProfile) return;
    const frame = getBaseFootprintFrame(base, field.side);
    const pos = base.getAttribute("position");
    if (!pos) return;
    const arr = pos.array as Float32Array;
    const bins = 64;
    const posB = new Float64Array(bins);
    const negB = new Float64Array(bins);
    for (let i = 0; i < pos.count; i++) {
        const { u, vSigned } = vertexFootprintAt(frame, arr, i);
        const b = Math.min(bins - 1, Math.floor(Math.max(0, Math.min(1, u)) * bins));
        const target = vSigned >= 0 ? posB : negB;
        target[b] = Math.max(target[b] ?? 0, Math.abs(vSigned));
    }
    fillEmptyBins(posB);
    fillEmptyBins(negB);
    field.topEdgeAvProfile = (u: number, vSigned: number): number => {
        const row = vSigned >= 0 ? posB : negB;
        const x = Math.max(0, Math.min(1, u)) * bins - 0.5;
        const b0 = Math.max(0, Math.min(bins - 1, Math.floor(x)));
        const b1 = Math.min(bins - 1, b0 + 1);
        const f = Math.max(0, Math.min(1, x - b0));
        return (row[b0] ?? 0) * (1 - f) + (row[b1] ?? 0) * f;
    };
}

function flowFeatherWeight(
    lx: number,
    ly: number,
    gridOriginX: number,
    gridOriginY: number,
    nx: number,
    ny: number,
    cellMm: number,
    featherMm: ElementFeatherMm,
): number {
    // Per-edge sidecar feathers are already authored into the mesh (edge z=0).
    // Extra AABB would reshape the CAD-approved height field — do not apply.
    if (typeof featherMm !== "number") return 1;
    const margin = featherMm;
    if (margin <= 1e-9) return 1;
    const minX = gridOriginX + margin;
    const maxX = gridOriginX + nx * cellMm - margin;
    const minY = gridOriginY + margin;
    const maxY = gridOriginY + ny * cellMm - margin;
    const dx = Math.min(lx - minX, maxX - lx, margin);
    const dy = Math.min(ly - minY, maxY - ly, margin);
    const d = Math.min(dx, dy);
    if (d >= margin) return 1;
    return c1Smoothstep01(d / Math.max(1e-6, margin));
}

function localCoordsFlow(
    x: number,
    y: number,
    anchorX: number,
    anchorY: number,
    rotDeg: number,
): { lx: number; ly: number } {
    const dx = x - anchorX;
    const dy = y - anchorY;
    const a = -rotDeg * DEG;
    return {
        lx: dx * Math.cos(a) - dy * Math.sin(a),
        ly: dx * Math.sin(a) + dy * Math.cos(a),
    };
}

async function applyAssetContext(
    geometry: BufferGeometry,
    base: BufferGeometry,
    field: HeightFieldParams,
    ctx: PlacedElementAssetContext,
    hooks: NoFlowHeightHooks,
): Promise<void> {
    const frame = getBaseFootprintFrame(base, field.side);
    const pos = geometry.getAttribute("position") as BufferAttribute;
    const arr = pos.array as Float32Array;
    const basePos = base.getAttribute("position")?.array as Float32Array | undefined;
    const uvArr = basePos && basePos.length === arr.length ? basePos : arr;
    const { grid } = await loadTransformedAssetPositions(ctx.assetId, ctx.transform);
    const anchor = anchorMmFromPlacement(base, field.side, ctx.placed.position.x, ctx.placed.position.y);
    const sign = ctx.sidecar.category === "sink" ? -1 : 1;
    const ta = frame.thickAxis;

    if (ctx.transform.placementMode === "noFlow") {
        const baseZ = hooks.baseHeightAtAnchor(geometry, anchor.x, anchor.y, ta);
        const k = NO_FLOW_SMOOTH_MAX_K_MM;
        const edgeRing = ctx.sidecar.edgeRingMaxMm ?? gridEdgeRingMax(grid);
        const fadeHighEdge = edgeRing > HIGH_EDGE_RING_MM;
        for (let i = 0; i < pos.count; i++) {
            const x = arr[i * 3]!;
            const y = arr[i * 3 + 1]!;
            const z = arr[i * 3 + ta]!;
            const { lx, ly } = localCoordsFlow(x, y, anchor.x, anchor.y, ctx.transform.rotationDeg);
            const hMag = sampleGridBilinear(grid, lx, ly);
            if (hMag <= 1e-9) continue;
            const { u, vSigned } = vertexFootprintAt(frame, uvArr, i);
            const rim = fadeHighEdge
                ? rimBandFadeFactor(u, vSigned, field)
                : rimBandClipFactor(u, vSigned, field);
            if (rim <= 1e-6) continue;
            if (ctx.sidecar.category === "add") {
                const stamp = baseZ + hMag + ctx.transform.zOffsetMm;
                const elementTop = z + (stamp - z) * rim;
                if (elementTop <= z - k) continue;
                const next = smoothMaxMm(z, elementTop, k);
                arr[i * 3 + ta] = Math.max(z, next);
            } else {
                const stamp = baseZ - hMag + ctx.transform.zOffsetMm;
                const elementFloor = z + (stamp - z) * rim;
                if (elementFloor >= z + k) continue;
                const next = smoothMinMm(z, elementFloor, k);
                arr[i * 3 + ta] = Math.min(z, next);
            }
        }
        return;
    }

    for (let i = 0; i < pos.count; i++) {
        const x = arr[i * 3]!;
        const y = arr[i * 3 + 1]!;
        const { u, vSigned } = vertexFootprintAt(frame, uvArr, i);
        const rim = rimBandFadeFactor(u, vSigned, field);
        if (rim <= 1e-9) continue;
        const { lx, ly } = localCoordsFlow(x, y, anchor.x, anchor.y, ctx.transform.rotationDeg);
        const assetH = sampleGridBilinear(grid, lx, ly);
        if (assetH <= 1e-9) continue;
        const w = flowFeatherWeight(
            lx,
            ly,
            grid.originX,
            grid.originY,
            grid.nx,
            grid.ny,
            grid.cellMm,
            ctx.sidecar.featherMm,
        );
        const lift = (sign * assetH * w + ctx.transform.zOffsetMm * w) * rim;
        arr[i * 3 + ta] += lift;
    }
}

function applyProceduralElements(
    geometry: BufferGeometry,
    base: BufferGeometry,
    field: HeightFieldParams,
    elements: PlacedElement[],
    assetKinds: Set<string>,
): void {
    const procedural = elements.filter(
        (e) => e.side === field.side && e.kind !== "custom" && !assetKinds.has(e.kind),
    );
    if (procedural.length === 0) return;
    const frame = getBaseFootprintFrame(base, field.side);
    const pos = geometry.getAttribute("position") as BufferAttribute;
    const basePos = base.getAttribute("position")!.array as Float32Array;
    const arr = pos.array as Float32Array;
    const ta = frame.thickAxis;
    const halfW = field.widthMm / 2;
    const centerX = frame.lenMin + frame.lenSize / 2;
    for (let i = 0; i < pos.count; i++) {
        const lenCoord = basePos[i * 3 + frame.lengthAxis]!;
        const widCoord = basePos[i * 3 + frame.widthAxis]!;
        const xMm = lenCoord - centerX;
        const vSigned = Math.max(
            -1,
            Math.min(1, (frame.widthSign * (widCoord - frame.widCenter)) / (frame.widSize / 2)),
        );
        const hw = resolveOutlineHalfWidth((lenCoord - frame.lenMin) / frame.lenSize, field) * halfW;
        const yMm = vSigned * hw;
        const { u, vSigned: vs } = vertexFootprintAt(frame, basePos, i);
        if (rimBandClipFactor(u, vs, field) < 0.5) continue;
        const h = elementHeightAt(procedural, xMm, yMm, field.lengthMm);
        if (h === 0) continue;
        const z0 = arr[i * 3 + ta]!;
        if (h > 0) arr[i * 3 + ta] = Math.max(z0, z0 + h);
        else arr[i * 3 + ta] = Math.min(z0, z0 + h);
    }
}

function subdivideLongEdgesUnderFootprint(
    geometry: BufferGeometry,
    footprintTest: (x: number, y: number) => boolean,
    maxEdgeMm: number,
): void {
    const pos = geometry.getAttribute("position") as BufferAttribute;
    const index = geometry.getIndex();
    if (!index) return;
    const maxIter = 6;
    for (let iter = 0; iter < maxIter; iter++) {
        const arr = pos.array as Float32Array;
        const idx = Array.from(index.array as ArrayLike<number>);
        let split = false;
        const edgeMap = new Map<string, number>();
        const newIdx: number[] = [];
        const addMid = (a: number, b: number): number => {
            const key = a < b ? `${a},${b}` : `${b},${a}`;
            const hit = edgeMap.get(key);
            if (hit !== undefined) return hit;
            const mx = (arr[a * 3]! + arr[b * 3]!) / 2;
            const my = (arr[a * 3 + 1]! + arr[b * 3 + 1]!) / 2;
            const mz = (arr[a * 3 + 2]! + arr[b * 3 + 2]!) / 2;
            if (!footprintTest(mx, my)) return -1;
            const dx = arr[a * 3]! - arr[b * 3]!;
            const dy = arr[a * 3 + 1]! - arr[b * 3 + 1]!;
            const dz = arr[a * 3 + 2]! - arr[b * 3 + 2]!;
            if (Math.hypot(dx, dy, dz) <= maxEdgeMm) return -1;
            const vi = pos.count;
            const next = new Float32Array(arr.length + 3);
            next.set(arr);
            next[vi * 3] = mx;
            next[vi * 3 + 1] = my;
            next[vi * 3 + 2] = mz;
            pos.array = next;
            pos.count = vi + 1;
            edgeMap.set(key, vi);
            split = true;
            return vi;
        };
        for (let f = 0; f < idx.length; f += 3) {
            const a = idx[f]!;
            const b = idx[f + 1]!;
            const c = idx[f + 2]!;
            const mab = addMid(a, b);
            if (mab >= 0) {
                newIdx.push(a, mab, b, mab, c, a);
                continue;
            }
            newIdx.push(a, b, c);
        }
        geometry.setIndex(newIdx);
        if (!split) break;
    }
}

export interface ApplyElementsOptions {
    noFlowHooks?: NoFlowHeightHooks;
    subdivide?: boolean;
    referenceForSize?: BufferGeometry | null;
}

/**
 * Apply placed elements LAST on the composed top (after wedge/posting/arch).
 * Additive elements never lower the top; only sinks may subtract.
 * GLB assets are a height-field lift (thick axis), flow or no-flow per #189.
 */
export async function applyElementsToTopMeshLast(
    geometry: BufferGeometry,
    referenceBase: BufferGeometry,
    field: HeightFieldParams,
    options?: ApplyElementsOptions,
): Promise<void> {
    const elements = field.elements ?? [];
    geometry.deleteAttribute(ELEMENT_LIFT_ATTRIBUTE);
    geometry.deleteAttribute(ELEMENT_OWNER_ATTRIBUTE);
    geometry.userData[ELEMENT_IDS_KEY] = [];
    const hasSinks = sinksActive(field.sinks);
    // No elements and no sinks: same early return as before (byte-identical).
    if (elements.length === 0 && !hasSinks) return;
    if (elements.length === 0) {
        applySinkCutLast(geometry, referenceBase, field);
        return;
    }
    ensureTopEdgeAvProfile(field, referenceBase);
    const hooks = options?.noFlowHooks ?? defaultNoFlowHeightHooks;
    const contexts = await resolvePlacedAssetContexts(
        elements,
        field.side,
        field.lengthMm,
        field.widthMm,
        referenceBase,
        options?.referenceForSize,
    );
    const assetKinds = new Set(contexts.map((c) => c.placed.kind));
    for (const element of elements) {
        if (element.side !== field.side) continue;
        if (
            (LIBRARY_HEIGHT_FIELD_KINDS as readonly string[]).includes(element.kind) &&
            !contexts.some((context) => context.placed.id === element.id)
        ) {
            throw new Error(
                `Library element ${element.kind} could not be loaded; refusing a substitute shape`,
            );
        }
    }

    const topOnlyOpen = classifyBaseTopFactors(referenceBase) === null;
    if (options?.subdivide !== false && !topOnlyOpen) {
        for (const ctx of contexts) {
            const anchor = anchorMmFromPlacement(
                referenceBase,
                field.side,
                ctx.placed.position.x,
                ctx.placed.position.y,
            );
            const { grid } = await loadTransformedAssetPositions(ctx.assetId, ctx.transform);
            const rx = (grid.nx * grid.cellMm) / 2;
            const ry = (grid.ny * grid.cellMm) / 2;
            subdivideLongEdgesUnderFootprint(
                geometry,
                (x, y) => {
                    const dx = x - anchor.x;
                    const dy = y - anchor.y;
                    return Math.abs(dx) <= rx * 1.05 && Math.abs(dy) <= ry * 1.05;
                },
                ELEMENT_SUBDIVIDE_EDGE_MM,
            );
        }
    }

    // Record the composed top immediately before placement. This is the source
    // of truth for design highlighting, including no-flow areas buried in the base.
    const position = geometry.getAttribute("position");
    const thickAxis = getBaseFootprintFrame(referenceBase, field.side).thickAxis;
    const before = new Float32Array(position.count);
    const previous = new Float32Array(position.count);
    const owners = new Float32Array(position.count);
    const lift = new Float32Array(position.count);
    const topFactors = classifyBaseTopFactors(geometry);
    for (let i = 0; i < position.count; i++) {
        before[i] = previous[i] = position.getComponent(i, thickAxis);
    }
    const recordOwner = (elementIndex: number) => {
        for (let i = 0; i < position.count; i++) {
            const z = position.getComponent(i, thickAxis);
            if (z > previous[i]! + 1e-6) owners[i] = elementIndex + 1;
            previous[i] = z;
        }
    };
    for (let index = 0; index < elements.length; index++) {
        applyProceduralElements(geometry, referenceBase, field, [elements[index]!], assetKinds);
        recordOwner(index);
    }
    for (const ctx of contexts) {
        await applyAssetContext(geometry, referenceBase, field, ctx, hooks);
        recordOwner(elements.indexOf(ctx.placed));
    }
    for (let i = 0; i < position.count; i++) {
        // Open top sheets have no bottom; closed bases must not color their undersides.
        if (!topFactors || topFactors[i]! > 0.5) {
            lift[i] = Math.max(0, position.getComponent(i, thickAxis) - before[i]!);
        }
    }
    geometry.setAttribute(ELEMENT_LIFT_ATTRIBUTE, new BufferAttribute(lift, 1));
    geometry.setAttribute(ELEMENT_OWNER_ATTRIBUTE, new BufferAttribute(owners, 1));
    geometry.userData[ELEMENT_IDS_KEY] = elements.map((element) => element.id);
    const pos = geometry.getAttribute("position");
    if (pos) pos.needsUpdate = true;
    geometry.computeVertexNormals();
    if (hasSinks) applySinkCutLast(geometry, referenceBase, field);
}

function applySinkCutLast(
    geometry: BufferGeometry,
    referenceBase: BufferGeometry,
    field: HeightFieldParams,
): void {
    if (!sinksActive(field.sinks)) return;
    const frame = getBaseFootprintFrame(referenceBase, field.side);
    const factors = classifyBaseTopFactors(referenceBase);
    // z-only. Subdivision re-lofts the wall and moves the heel outline.
    applySinkCutToGeometry(geometry, referenceBase, field, frame, factors);
    geometry.computeVertexNormals();
}

export function fieldWithoutElementsForModifiers(field: HeightFieldParams): HeightFieldParams {
    return {
        ...field,
        includeElements: false,
        elements: [],
        // T and S are applied beside this pass, not inside the wedge/element delta.
        sinks: undefined,
        sinkStyloidThicken: undefined,
        sinkMarkers: undefined,
    };
}
