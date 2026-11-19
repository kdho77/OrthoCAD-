// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, rs, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyDisplayedAmputation } from "@/hooks/useBaseInsoleGeometry";
import {
    type AmputationPoint,
    confirmAmputationDraw,
    normalizeSideAmputation,
} from "@/lib/geometry/amputee-filler";
import { baseModifierField, baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { buildValidatedExportGeometry } from "@/lib/geometry/export-geometry";
import { outlineHalfWidth } from "@/lib/geometry/height-field";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { composeViewerPrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    buildProceduralExportSolid,
    reconstructProceduralPreview,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { PlacedSink, Side, SideAmputation } from "@/types";
import { settingsEnvelopeForSave } from "../vertex/server/src/lib/design-schema";
import { readStoredDesignSettings } from "../vertex/shared/design-settings";
import { shellQuality } from "./helpers/s1-ring-export.harness";

const sampleBytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
const SIZES = [2, 9, 15] as const;
const SIDES: Side[] = ["left", "right"];

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function installFetch(): void {
    globalThis.fetch = rs.fn(async () => new Response(sampleBytes));
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
}

function forefootCut(lengthMm: number, widthMm: number): AmputationPoint[] {
    const edge = (u: number) => outlineHalfWidth(u) * (widthMm / 2);
    const u0 = 0.58;
    return [
        { x: u0 * lengthMm, y: edge(u0) },
        { x: 0.78 * lengthMm, y: edge(0.78) * 0.4 },
        { x: 0.86 * lengthMm, y: 0 },
        { x: 0.78 * lengthMm, y: -edge(0.78) * 0.4 },
        { x: u0 * lengthMm, y: -edge(u0) },
    ];
}

function filler(lengthMm: number, widthMm: number): SideAmputation {
    return normalizeSideAmputation({
        enabled: true,
        points: forefootCut(lengthMm, widthMm),
        height: 15,
        filletInside: 10,
        filletOutside: 30,
        interfaceFillet: true,
    });
}

function arm(usMen: number, side: Side, cut: SideAmputation | null, sinks?: PlacedSink[]) {
    installFetch();
    const layout = insoleLayoutForUsMenSize(usMen);
    const design = createDesignWithStockPlaceholder({
        ...defaultDesign(),
        sizeSystem: "us",
        usMenSize: layout.usMenSize,
        footLengthMm: layout.footLengthMm,
        ...(cut ? { amputation: { [side]: cut } } : {}),
        ...(sinks ? { sinks: { [side]: sinks } } : {}),
    });
    useDesignStore.setState({
        design,
        viewer: {
            transparent: false,
            heightmap: false,
            showLeft: true,
            showRight: true,
            showScans: true,
            view: "iso",
            wallModel: "procedural",
            wallStyle: "straight",
        },
    });
    return { design, layout };
}

function posMd5(geometry: BufferGeometry): string {
    const attr = geometry.getAttribute("position");
    const view = attr.array as Float32Array;
    return createHash("md5")
        .update(Buffer.from(view.buffer, view.byteOffset, view.byteLength))
        .digest("hex");
}

function upwardBottoms(geometry: BufferGeometry): number {
    const pos = geometry.getAttribute("position")?.array as Float32Array | undefined;
    const idx = geometry.getIndex()?.array;
    if (!pos || !idx) return 0;
    let n = 0;
    for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f]!;
        const b = idx[f + 1]!;
        const c = idx[f + 2]!;
        const az = pos[a * 3 + 2]!;
        const bz = pos[b * 3 + 2]!;
        const cz = pos[c * 3 + 2]!;
        if (az > 0.3 || bz > 0.3 || cz > 0.3) continue;
        const ux = pos[b * 3]! - pos[a * 3]!;
        const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
        const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
        const vx = pos[c * 3]! - pos[a * 3]!;
        const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
        const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
        const nz = ux * vy - uy * vx;
        if (nz > 1e-6) n++;
    }
    return n;
}

function vertexDiff(a: BufferGeometry, b: BufferGeometry): number {
    const pa = a.getAttribute("position")?.array as Float32Array | undefined;
    const pb = b.getAttribute("position")?.array as Float32Array | undefined;
    if (!pa || !pb || pa.length !== pb.length) return Infinity;
    let max = 0;
    for (let i = 0; i < pa.length; i++) {
        const d = Math.abs(pa[i]! - pb[i]!);
        if (d > max) max = d;
    }
    return max;
}

describe("amputee filler mesh", () => {
    for (const usMen of SIZES) {
        for (const side of SIDES) {
            test(`US ${usMen} ${side} passes the solid gates`, async () => {
                const layout = insoleLayoutForUsMenSize(usMen);
                const cut = filler(layout.lengthMm, layout.widthMm);
                arm(usMen, side, null);
                const plain = await buildValidatedExportGeometry(side);
                const filledArm = arm(usMen, side, cut);
                const filled = await buildValidatedExportGeometry(side);
                try {
                    const report = validateManifold(filled);
                    const quality = shellQuality(filled);
                    const baseline = shellQuality(plain);
                    expect(report.isWatertight).toBe(true);
                    expect(report.eulerCharacteristic).toBe(2);
                    expect(upwardBottoms(filled)).toBe(0);
                    expect(quality.worstDihedralDeg).toBeLessThanOrEqual(60);
                    expect(quality.minEdgeMm + 1e-4).toBeGreaterThanOrEqual(baseline.minEdgeMm);
                    expect(quality.maxAspect).toBeLessThanOrEqual(baseline.maxAspect + 1e-3);
                    const plateau = plateauErrorMm(plain, filled);
                    // US 2's toe cap is only a few samples wide once the rise has
                    // faded out at the rim. The flat is still the requested height.
                    expect(plateau.plateauCount).toBeGreaterThanOrEqual(8);
                    expect(plateau.maxRise).toBeGreaterThanOrEqual(cut.height - 0.1);
                    expect(plateau.heelError).toBeLessThanOrEqual(0.05);

                    const field = baseModifierFieldAuthoritative(
                        filledArm.design,
                        side,
                        filledArm.design.thicknessMm,
                    );
                    const viewer = useDesignStore.getState().viewer;
                    const shared = printSolidOptions({
                        design: filledArm.design,
                        side,
                        field,
                        viewer,
                        trimline: null,
                        bottomPattern: null,
                    });
                    const native = await sampleTopFromArrayBuffer(sampleBytes.buffer.slice(0));
                    const preview = await reconstructProceduralPreview(native, shared);
                    const exported = await buildProceduralExportSolid(shared);
                    expect(vertexDiff(preview.geometry, exported.geometry)).toBe(0);
                    preview.geometry.dispose();
                    exported.geometry.dispose();

                    const saved = settingsEnvelopeForSave(filledArm.design);
                    const loaded = readStoredDesignSettings(saved);
                    expect(loaded).toBeTruthy();
                    const reopened = createDesignWithStockPlaceholder(loaded as never);
                    useDesignStore.setState({ design: reopened });
                    const again = await buildValidatedExportGeometry(side);
                    try {
                        expect(posMd5(again)).toBe(posMd5(filled));
                    } finally {
                        again.dispose();
                    }
                } finally {
                    plain.dispose();
                    filled.dispose();
                }
            }, 180_000);

            test(`US ${usMen} ${side} keeps a 2 mm sink floor on the filled surface`, async () => {
                const layout = insoleLayoutForUsMenSize(usMen);
                const cut = filler(layout.lengthMm, layout.widthMm);
                arm(usMen, side, cut);
                const filled = await buildValidatedExportGeometry(side);
                const sink: PlacedSink = {
                    id: "floor",
                    kind: "mpj1",
                    depthMm: 4,
                    u: 0.86,
                    v: 0.5,
                };
                arm(usMen, side, cut, [sink]);
                const sunk = await buildValidatedExportGeometry(side);
                try {
                    const report = validateManifold(sunk);
                    expect(report.isWatertight).toBe(true);
                    expect(report.eulerCharacteristic).toBe(2);
                    const a = filled.getAttribute("position").array as Float32Array;
                    const b = sunk.getAttribute("position").array as Float32Array;
                    const n = Math.min(a.length, b.length) / 3;
                    let cutThrough = 0;
                    let belowFloor = 0;
                    for (let i = 0; i < n; i++) {
                        const z0 = a[i * 3 + 2] ?? 0;
                        const z1 = b[i * 3 + 2] ?? 0;
                        // The sink may carve its own depth out of the filled surface.
                        // Deeper than that is a hole through the rise. The floor stays at 2 mm.
                        if (z1 < z0 - (sink.depthMm + 0.05)) cutThrough++;
                        if (z0 >= 2 && z1 < 2 - 1e-3) belowFloor++;
                    }
                    expect(cutThrough).toBe(0);
                    expect(belowFloor).toBe(0);
                } finally {
                    filled.dispose();
                    sunk.dispose();
                }
            }, 180_000);

            test(`US ${usMen} ${side} exports with Interface Fillet off`, async () => {
                const layout = insoleLayoutForUsMenSize(usMen);
                const cut = normalizeSideAmputation({
                    ...filler(layout.lengthMm, layout.widthMm),
                    interfaceFillet: false,
                });
                arm(usMen, side, null);
                const plain = await buildValidatedExportGeometry(side);
                arm(usMen, side, cut);
                const filled = await buildValidatedExportGeometry(side);
                try {
                    const report = validateManifold(filled);
                    expect(report.isWatertight).toBe(true);
                    expect(report.eulerCharacteristic).toBe(2);
                    expect(upwardBottoms(filled)).toBe(0);
                    const plateau = plateauErrorMm(plain, filled);
                    expect(plateau.maxRise).toBeGreaterThanOrEqual(cut.height - 0.1);
                    expect(plateau.heelError).toBeLessThanOrEqual(0.05);
                } finally {
                    plain.dispose();
                    filled.dispose();
                }
            }, 180_000);

            test(`US ${usMen} ${side} exports a self-crossing outside line`, async () => {
                const layout = insoleLayoutForUsMenSize(usMen);
                const edge = (u: number) => outlineHalfWidth(u) * (layout.widthMm / 2);
                const u0 = 0.58;
                const cut = normalizeSideAmputation({
                    enabled: true,
                    height: 15,
                    filletInside: 10,
                    filletOutside: 30,
                    interfaceFillet: true,
                    points: [
                        { x: u0 * layout.lengthMm, y: edge(u0) },
                        { x: 0.72 * layout.lengthMm, y: 400 },
                        { x: 0.9 * layout.lengthMm, y: edge(0.9) * 0.2 },
                        { x: 0.68 * layout.lengthMm, y: -edge(0.68) },
                        { x: u0 * layout.lengthMm, y: -edge(u0) },
                    ],
                });
                arm(usMen, side, cut);
                const filled = await buildValidatedExportGeometry(side);
                try {
                    const report = validateManifold(filled);
                    expect(report.isWatertight).toBe(true);
                    expect(report.eulerCharacteristic).toBe(2);
                    expect(upwardBottoms(filled)).toBe(0);
                } finally {
                    filled.dispose();
                }
            }, 180_000);
        }
    }
});

function plateauErrorMm(
    plain: BufferGeometry,
    filled: BufferGeometry,
): { plateauCount: number; heelError: number; maxRise: number } {
    const a = plain.getAttribute("position").array as Float32Array;
    const b = filled.getAttribute("position").array as Float32Array;
    const n = Math.min(
        (plain.userData as { topVertexCount?: number }).topVertexCount ?? a.length / 3,
        (filled.userData as { topVertexCount?: number }).topVertexCount ?? b.length / 3,
        a.length / 3,
        b.length / 3,
    );
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
        minX = Math.min(minX, a[i * 3]!);
        maxX = Math.max(maxX, a[i * 3]!);
        minY = Math.min(minY, a[i * 3 + 1]!);
        maxY = Math.max(maxY, a[i * 3 + 1]!);
    }
    const len = Math.max(1e-6, maxX - minX);
    const wid = Math.max(1e-6, maxY - minY);
    const halfW = (min: number, max: number) => (min + max) / 2;
    const yMid = halfW(minY, maxY);
    let plateauCount = 0;
    let heelError = 0;
    let maxRise = 0;
    for (let i = 0; i < n; i++) {
        const dx = Math.abs((a[i * 3] ?? 0) - (b[i * 3] ?? 0));
        const dy = Math.abs((a[i * 3 + 1] ?? 0) - (b[i * 3 + 1] ?? 0));
        if (dx > 0.05 || dy > 0.05) continue;
        const u = ((a[i * 3] ?? 0) - minX) / len;
        const dz = (b[i * 3 + 2] ?? 0) - (a[i * 3 + 2] ?? 0);
        if (dz > maxRise) maxRise = dz;
        if (Math.abs(dz - 15) <= 0.1) plateauCount++;
        if (u < 0.2) heelError = Math.max(heelError, Math.abs(dz));
    }
    void yMid;
    void wid;
    return { plateauCount, heelError, maxRise };
}

function regionRise(before: Float32Array, after: Float32Array, u0: number, u1: number): number {
    const n = Math.min(before.length, after.length) / 3;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < n; i++) {
        minX = Math.min(minX, before[i * 3] ?? 0);
        maxX = Math.max(maxX, before[i * 3] ?? 0);
    }
    const len = Math.max(1e-6, maxX - minX);
    let max = 0;
    for (let i = 0; i < n; i++) {
        const u = ((before[i * 3] ?? 0) - minX) / len;
        if (u < u0 || u > u1) continue;
        const dz = (after[i * 3 + 2] ?? 0) - (before[i * 3 + 2] ?? 0);
        if (dz > max) max = dz;
    }
    return max;
}

/** Highest vertex in an X-fraction band. Either end can be the toe, depending on the solid. */
function stlBandMaxZ(stl: ArrayBuffer, u0: number, u1: number): number {
    const view = new DataView(stl);
    const count = view.getUint32(80, true);
    let minX = Infinity;
    let maxX = -Infinity;
    let offset = 84;
    for (let i = 0; i < count; i++) {
        offset += 12;
        for (let v = 0; v < 3; v++) {
            const x = view.getFloat32(offset, true);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            offset += 12;
        }
        offset += 2;
    }
    const span = Math.max(1e-6, maxX - minX);
    const lo = minX + u0 * span;
    const hi = minX + u1 * span;
    offset = 84;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
        offset += 12;
        for (let v = 0; v < 3; v++) {
            const x = view.getFloat32(offset, true);
            const z = view.getFloat32(offset + 8, true);
            if (x >= lo && x <= hi && z > maxZ) maxZ = z;
            offset += 12;
        }
        offset += 2;
    }
    return maxZ;
}

describe("amputee draw on the design view", () => {
    test("confirming a drawn line raises the displayed sheet and the exported STL", async () => {
        const usMen = 12;
        const layout = insoleLayoutForUsMenSize(usMen);
        const { design } = arm(usMen, "left", null);
        expect(design.shoeWidth).toBe("medium");
        expect(design.corrections.linked).toBe(true);
        const native = await sampleTopFromArrayBuffer(sampleBytes.buffer.slice(0));
        const raw = native.clone();
        const shoeWidth = {
            width: "medium" as const,
            ballWidthMm: layout.widthMm,
            heelWidthMm: layout.widthMm * 0.62,
        };
        const plainLeft = await composeViewerPrintSolidTop({
            raw,
            sourceField: baseModifierField(design, "left", design.thicknessMm),
            shoeWidth,
        });
        const plainRight = await composeViewerPrintSolidTop({
            raw,
            sourceField: baseModifierField(design, "right", design.thicknessMm),
            shoeWidth,
        });
        const half = (u: number) => outlineHalfWidth(u) * (layout.widthMm / 2);
        const drawn = confirmAmputationDraw(
            forefootCut(layout.lengthMm, layout.widthMm),
            layout.lengthMm,
            layout.widthMm,
            half,
        );
        expect(drawn.rejected).toBe(false);
        useDesignStore.getState().updateAmputation("left", { enabled: true, points: drawn.points });
        const filled = useDesignStore.getState().design;
        expect(filled.amputation?.left?.height).toBe(15);
        expect(filled.amputation?.left?.filletInside).toBe(10);
        expect(filled.amputation?.left?.filletOutside).toBe(30);
        expect(filled.amputation?.right?.points).toEqual(filled.amputation?.left?.points);

        const leftBefore = Float32Array.from(plainLeft.getAttribute("position").array as Float32Array);
        const rightBefore = Float32Array.from(plainRight.getAttribute("position").array as Float32Array);
        const leftShown = plainLeft.clone();
        const rightShown = plainRight.clone();
        applyDisplayedAmputation(leftShown, baseModifierField(filled, "left", filled.thicknessMm));
        applyDisplayedAmputation(rightShown, baseModifierField(filled, "right", filled.thicknessMm));
        const leftAfter = leftShown.getAttribute("position").array as Float32Array;
        const rightAfter = rightShown.getAttribute("position").array as Float32Array;
        const leftToe = regionRise(leftBefore, leftAfter, 0.72, 0.9);
        const rightToe = regionRise(rightBefore, rightAfter, 0.72, 0.9);
        expect(leftToe).toBeGreaterThan(10);
        expect(regionRise(leftBefore, leftAfter, 0, 0.2)).toBeLessThan(0.05);
        expect(rightToe).toBeGreaterThan(10);

        const filledExport = await buildValidatedExportGeometry("left");
        const filledStl = geometryToBinarySTL(filledExport);
        useDesignStore.setState({ design });
        const plainExport = await buildValidatedExportGeometry("left");
        const plainStl = geometryToBinarySTL(plainExport);
        try {
            const toeEnd = stlBandMaxZ(filledStl, 0.8, 1) - stlBandMaxZ(plainStl, 0.8, 1);
            const heelEnd = stlBandMaxZ(filledStl, 0, 0.2) - stlBandMaxZ(plainStl, 0, 0.2);
            expect(Math.max(toeEnd, heelEnd)).toBeGreaterThan(1);
        } finally {
            native.dispose();
            raw.dispose();
            plainLeft.dispose();
            plainRight.dispose();
            leftShown.dispose();
            rightShown.dispose();
            plainExport.dispose();
            filledExport.dispose();
        }
    }, 180_000);
});
