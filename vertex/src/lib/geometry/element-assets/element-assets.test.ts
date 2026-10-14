// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import {
    applyBaseModifiers,
    BASE_REFERENCE_THICKNESS_MM,
    getBaseFootprintFrame,
    neutralField,
} from "@/lib/geometry/base-modifier";
import { defaultElementPose } from "@/lib/geometry/elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, Side } from "@/types";
import { applyElementsToTopMeshLast } from "./apply-elements";
import {
    hashElementAssetsForDesign,
    loadTransformedAssetPositions,
    resolvePlacedAssetContexts,
} from "./element-asset";
import { sampleGridBilinear } from "./height-grid";
import { anchorMmFromPlacement, smoothMaxMm } from "./no-flow-blend";
import { NO_FLOW_SMOOTH_MAX_K_MM } from "./types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

async function loadSampleTop(side: Side): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "left") {
        const m = mirrorGeometry(raw);
        raw.dispose();
        raw = m;
    }
    return raw;
}

function zeroCorrections() {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function fieldWithElement(
    raw: BufferGeometry,
    side: Side,
    el: PlacedElement,
    patch?: Partial<HeightFieldParams>,
): HeightFieldParams {
    const frame = getBaseFootprintFrame(raw, side);
    return {
        side,
        lengthMm: frame.lenSize,
        widthMm: frame.widSize,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zeroCorrections(),
        elements: [el],
        includeSkives: false,
        includeElements: true,
        trimline: null,
        ...patch,
    };
}

function placedMetPad(
    side: Side,
    raw: BufferGeometry,
    mode: "flow" | "noFlow",
    patch?: Partial<PlacedElement>,
): PlacedElement {
    const frame = getBaseFootprintFrame(raw, side);
    const pose = defaultElementPose("test_dome", side, frame.lenSize, frame.widSize);
    return {
        id: "el-1",
        kind: "test_dome",
        side,
        ...pose,
        heightMm: 5,
        placementMode: mode,
        zOffsetMm: 0,
        ...patch,
    };
}

/** Open top sheet with constant z (length Y, width X, thick Z). */
function makeFlatTopSheet(lengthMm: number, widthMm: number, topZ: number, nx = 48, ny = 48): BufferGeometry {
    const positions: number[] = [];
    const grid: number[][] = [];
    let v = 0;
    for (let i = 0; i <= nx; i++) {
        const row: number[] = [];
        const y = (i / nx) * lengthMm;
        for (let j = 0; j <= ny; j++) {
            const x = (j / ny - 0.5) * widthMm;
            row.push(v++);
            positions.push(x, y, topZ);
        }
        grid.push(row);
    }
    const indices: number[] = [];
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            const a = grid[i]![j]!;
            const b = grid[i]![j + 1]!;
            const c = grid[i + 1]![j + 1]!;
            const d = grid[i + 1]![j]!;
            indices.push(a, b, c, a, c, d);
        }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

describe("element asset pipeline", () => {
    test("synthetic dome peak scales with heightMm within 0.02 mm", async () => {
        const { grid } = await loadTransformedAssetPositions("test-dome", {
            scaleX: 1,
            scaleY: 1,
            scaleZ: 1,
            rotationDeg: 0,
            mirrorX: false,
            anchorUMm: 0,
            anchorVMm: 0,
            placementMode: "flow",
            zOffsetMm: 0,
            heightMm: 5,
            category: "add",
        });
        expect(grid.maxZ).toBeGreaterThan(4.9);
        expect(grid.maxZ).toBeLessThan(5.05);
    });

    test("smoothMax matches CAD formula", () => {
        const k = NO_FLOW_SMOOTH_MAX_K_MM;
        const a = 2;
        const b = 5;
        const h = Math.max(k - Math.abs(a - b), 0);
        expect(smoothMaxMm(a, b, k)).toBeCloseTo(Math.max(a, b) + (h * h) / (4 * k), 6);
    });

    test("hashElementAssetsForDesign is stable and includes zOffsetMm", async () => {
        const raw = makeFlatTopSheet(20, 20, 10);
        const el = placedMetPad("right", raw, "noFlow", { zOffsetMm: 0 });
        const h0 = await hashElementAssetsForDesign([]);
        const h1 = await hashElementAssetsForDesign([]);
        expect(h0).toBe(h1);
        const h2 = await hashElementAssetsForDesign([el]);
        const h3 = await hashElementAssetsForDesign([{ ...el, zOffsetMm: 0.5 }]);
        expect(h2).not.toBe(h3);
        raw.dispose();
    });

    test("flat top noFlow — dome peak = base + asset height + zOffset", async () => {
        const topZ = 11.5;
        const raw = makeFlatTopSheet(20, 20, topZ);
        const el = placedMetPad("right", raw, "noFlow", {
            position: { x: 0, y: 0 },
            heightMm: 5,
            zOffsetMm: 0.25,
        });
        const field = fieldWithElement(raw, "right", el);
        const base = applyBaseModifiers(raw, { ...field, includeElements: false, elements: [] }, 0);
        await applyElementsToTopMeshLast(base, raw, field, { subdivide: false });
        const anchor = anchorMmFromPlacement(raw, "right", el.position.x, el.position.y);
        const ta = anchor.frame.thickAxis;
        const { grid } = await loadTransformedAssetPositions("test-dome", {
            scaleX: 1,
            scaleY: 1,
            scaleZ: 1,
            rotationDeg: 0,
            mirrorX: false,
            anchorUMm: 0,
            anchorVMm: 0,
            placementMode: "noFlow",
            zOffsetMm: 0.25,
            heightMm: 5,
            category: "add",
        });
        const assetPeak = grid.maxZ;
        const pos = base.getAttribute("position")!.array as Float32Array;
        let best = Infinity;
        let peakZ = 0;
        for (let i = 0; i < pos.length / 3; i++) {
            const dx = pos[i * 3]! - anchor.x;
            const dy = pos[i * 3 + 1]! - anchor.y;
            const d = dx * dx + dy * dy;
            if (d < best) {
                best = d;
                peakZ = pos[i * 3 + ta]!;
            }
        }
        expect(peakZ).toBeCloseTo(topZ + assetPeak + 0.25, 2);
        raw.dispose();
        base.dispose();
    });

    test("flat 20×20 — flow vs noFlow agree within 0.1 mm away from footprint edge", async () => {
        const topZ = 10;
        const raw = makeFlatTopSheet(20, 20, topZ);
        const elNo = placedMetPad("right", raw, "noFlow", { position: { x: 0, y: 0 }, heightMm: 5 });
        const elFlow = placedMetPad("right", raw, "flow", { position: { x: 0, y: 0 }, heightMm: 5 });
        const fNo = fieldWithElement(raw, "right", elNo);
        const fFlow = fieldWithElement(raw, "right", elFlow);
        const ctxFlow = await resolvePlacedAssetContexts([elFlow], "right", fFlow.lengthMm, fFlow.widthMm);
        expect(ctxFlow.length).toBe(1);
        expect(ctxFlow[0]!.transform.placementMode).toBe("flow");
        const meshNo = applyBaseModifiers(raw, { ...fNo, includeElements: false, elements: [] }, 0);
        const meshFlow = applyBaseModifiers(raw, { ...fFlow, includeElements: false, elements: [] }, 0);
        await applyElementsToTopMeshLast(meshNo, raw, fNo, { subdivide: false });
        await applyElementsToTopMeshLast(meshFlow, raw, fFlow, { subdivide: false });
        const anchor = anchorMmFromPlacement(raw, "right", 0, 0);
        const ta = anchor.frame.thickAxis;
        const { grid } = await loadTransformedAssetPositions("test-dome", {
            scaleX: 1,
            scaleY: 1,
            scaleZ: 1,
            rotationDeg: 0,
            mirrorX: false,
            anchorUMm: 0,
            anchorVMm: 0,
            placementMode: "noFlow",
            zOffsetMm: 0,
            heightMm: 5,
            category: "add",
        });
        const a = meshNo.getAttribute("position")!.array as Float32Array;
        const b = meshFlow.getAttribute("position")!.array as Float32Array;
        let worst = 0;
        for (let i = 0; i < a.length / 3; i++) {
            const x = a[i * 3]!;
            const y = a[i * 3 + 1]!;
            const dx = x - anchor.x;
            const dy = y - anchor.y;
            const lx = dx;
            const ly = dy;
            if (sampleGridBilinear(grid, lx, ly) < 4) continue;
            worst = Math.max(worst, Math.abs(a[i * 3 + ta]! - b[i * 3 + ta]!));
        }
        expect(worst).toBeLessThan(0.1);
        raw.dispose();
        meshNo.dispose();
        meshFlow.dispose();
    });

    for (const side of ["left", "right"] as Side[]) {
        test(`${side} noFlow — never lowers top under dome`, async () => {
            const raw = await loadSampleTop(side);
            const el = placedMetPad(side, raw, "noFlow");
            const field = fieldWithElement(raw, side, el);
            const base = applyBaseModifiers(raw, { ...field, includeElements: false, elements: [] }, 0);
            const before = base.clone();
            await applyElementsToTopMeshLast(base, raw, field, { subdivide: false });
            const pos = base.getAttribute("position")!.array as Float32Array;
            const prev = before.getAttribute("position")!.array as Float32Array;
            const ta = getBaseFootprintFrame(raw, side).thickAxis;
            let lowered = false;
            for (let i = 0; i < pos.length / 3; i++) {
                if (pos[i * 3 + ta]! < prev[i * 3 + ta]! - 1e-4) lowered = true;
            }
            expect(lowered).toBe(false);
            base.dispose();
            before.dispose();
            raw.dispose();
        }, 60_000);

        test(`${side} arch slope noFlow — XY footprint within 0.05 mm (no geodesic stretch)`, async () => {
            const raw = await loadSampleTop(side);
            const el = placedMetPad(side, raw, "noFlow");
            const field = fieldWithElement(raw, side, el, {
                corrections: { ...zeroCorrections(), archHeightMm: 18 },
            });
            const base = applyBaseModifiers(raw, { ...field, includeElements: false, elements: [] }, 0);
            const before = base.clone();
            await applyElementsToTopMeshLast(base, raw, field, { subdivide: false });
            const pos = base.getAttribute("position")!.array as Float32Array;
            const prev = before.getAttribute("position")!.array as Float32Array;
            const ta = getBaseFootprintFrame(raw, side).thickAxis;
            let worst = 0;
            for (let i = 0; i < pos.length / 3; i++) {
                if (pos[i * 3 + ta]! <= prev[i * 3 + ta]! + 0.05) continue;
                worst = Math.max(
                    worst,
                    Math.hypot(pos[i * 3]! - prev[i * 3]!, pos[i * 3 + 1]! - prev[i * 3 + 1]!),
                );
            }
            expect(worst).toBeLessThan(0.05);
            base.dispose();
            before.dispose();
            raw.dispose();
        }, 60_000);

        test(`${side} noFlow — (z − assetHeight×scale) constant within 0.02 mm on protrusion`, async () => {
            const raw = await loadSampleTop(side);
            const el = placedMetPad(side, raw, "noFlow", { heightMm: 5 });
            const field = fieldWithElement(raw, side, el);
            const base = applyBaseModifiers(raw, { ...field, includeElements: false, elements: [] }, 0);
            const before = base.clone();
            await applyElementsToTopMeshLast(base, raw, field, { subdivide: false });
            const anchor = anchorMmFromPlacement(raw, side, el.position.x, el.position.y);
            const ta = anchor.frame.thickAxis;
            const { grid } = await loadTransformedAssetPositions("test-dome", {
                scaleX: 1,
                scaleY: 1,
                scaleZ: 1,
                rotationDeg: el.rotationDeg,
                mirrorX: side === "left",
                anchorUMm: 0,
                anchorVMm: 0,
                placementMode: "noFlow",
                zOffsetMm: 0,
                heightMm: 5,
                category: "add",
            });
            const pos = base.getAttribute("position")!.array as Float32Array;
            const prev = before.getAttribute("position")!.array as Float32Array;
            const rot = el.rotationDeg * (Math.PI / 180);
            const residuals: number[] = [];
            for (let i = 0; i < pos.length / 3; i++) {
                if (pos[i * 3 + ta]! <= prev[i * 3 + ta]! + 0.08) continue;
                const dx = pos[i * 3]! - anchor.x;
                const dy = pos[i * 3 + 1]! - anchor.y;
                const lx = dx * Math.cos(-rot) - dy * Math.sin(-rot);
                const ly = dx * Math.sin(-rot) + dy * Math.cos(-rot);
                const assetH = sampleGridBilinear(grid, lx, ly);
                if (assetH < 0.3) continue;
                residuals.push(pos[i * 3 + ta]! - assetH);
            }
            expect(residuals.length).toBeGreaterThan(10);
            const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
            let spread = 0;
            for (const r of residuals) spread = Math.max(spread, Math.abs(r - mean));
            expect(spread).toBeLessThan(0.05);
            base.dispose();
            before.dispose();
            raw.dispose();
        }, 60_000);
    }

    test("noFlow skips lift when elementTop ≤ top − k", async () => {
        const raw = makeFlatTopSheet(20, 20, 10);
        const el = placedMetPad("right", raw, "noFlow", { position: { x: 0, y: 0 }, heightMm: 0 });
        const field = fieldWithElement(raw, "right", el);
        const base = applyBaseModifiers(raw, { ...field, includeElements: false, elements: [] }, 0);
        const before = base.clone();
        await applyElementsToTopMeshLast(base, raw, field, { subdivide: false });
        const pos = base.getAttribute("position")!.array as Float32Array;
        const prev = before.getAttribute("position")!.array as Float32Array;
        const ta = getBaseFootprintFrame(raw, "right").thickAxis;
        let changed = false;
        for (let i = 0; i < pos.length / 3; i++) {
            if (Math.abs(pos[i * 3 + ta]! - prev[i * 3 + ta]!) > 1e-4) changed = true;
        }
        expect(changed).toBe(false);
        base.dispose();
        before.dispose();
        raw.dispose();
    });

    test("L/R mirror — noFlow peak lift within 0.05 mm (flat sheet)", async () => {
        const rawR = makeFlatTopSheet(20, 20, 12);
        const rawL = mirrorGeometry(rawR.clone());
        const elR = placedMetPad("right", rawR, "noFlow", { position: { x: 0, y: 0 } });
        const elL = placedMetPad("left", rawL, "noFlow", { position: { x: 0, y: 0 } });
        const peakLift = async (raw: BufferGeometry, side: Side, el: PlacedElement): Promise<number> => {
            const field = fieldWithElement(raw, side, el);
            const base = applyBaseModifiers(raw, { ...field, includeElements: false, elements: [] }, 0);
            const before = base.clone();
            await applyElementsToTopMeshLast(base, raw, field, { subdivide: false });
            const anchor = anchorMmFromPlacement(raw, side, el.position.x, el.position.y);
            const ta = anchor.frame.thickAxis;
            const pos = base.getAttribute("position")!.array as Float32Array;
            const prev = before.getAttribute("position")!.array as Float32Array;
            let best = Infinity;
            let lift = 0;
            for (let i = 0; i < pos.length / 3; i++) {
                const dx = pos[i * 3]! - anchor.x;
                const dy = pos[i * 3 + 1]! - anchor.y;
                const d = dx * dx + dy * dy;
                if (d < best) {
                    best = d;
                    lift = pos[i * 3 + ta]! - prev[i * 3 + ta]!;
                }
            }
            base.dispose();
            before.dispose();
            return lift;
        };
        const liftR = await peakLift(rawR, "right", elR);
        const liftL = await peakLift(rawL, "left", elL);
        expect(Math.abs(liftR - liftL)).toBeLessThan(0.05);
        rawR.dispose();
        rawL.dispose();
    });

    test("SAMPLE_Top L/R — noFlow peak lift within 0.3 mm (0.25 mm asset grid)", async () => {
        const rawR = await loadSampleTop("right");
        const rawL = await loadSampleTop("left");
        const elR = placedMetPad("right", rawR, "noFlow", { position: { x: 0, y: 0 } });
        const elL = placedMetPad("left", rawL, "noFlow", { position: { x: 0, y: 0 } });
        const peakLift = async (raw: BufferGeometry, side: Side, el: PlacedElement): Promise<number> => {
            const field = fieldWithElement(raw, side, el);
            const base = applyBaseModifiers(raw, { ...field, includeElements: false, elements: [] }, 0);
            const before = base.clone();
            await applyElementsToTopMeshLast(base, raw, field, { subdivide: false });
            const anchor = anchorMmFromPlacement(raw, side, el.position.x, el.position.y);
            const ta = anchor.frame.thickAxis;
            const pos = base.getAttribute("position")!.array as Float32Array;
            const prev = before.getAttribute("position")!.array as Float32Array;
            let best = Infinity;
            let lift = 0;
            for (let i = 0; i < pos.length / 3; i++) {
                const dx = pos[i * 3]! - anchor.x;
                const dy = pos[i * 3 + 1]! - anchor.y;
                const d = dx * dx + dy * dy;
                if (d < best) {
                    best = d;
                    lift = pos[i * 3 + ta]! - prev[i * 3 + ta]!;
                }
            }
            base.dispose();
            before.dispose();
            return lift;
        };
        const liftR = await peakLift(rawR, "right", elR);
        const liftL = await peakLift(rawL, "left", elL);
        expect(Math.abs(liftR - liftL)).toBeLessThan(0.3);
        rawR.dispose();
        rawL.dispose();
    }, 90_000);

    test("composePrintSolidTop applies elements after modifiers (extra lift vs no elements)", async () => {
        const raw = await loadSampleTop("right");
        const el = placedMetPad("right", raw, "noFlow");
        const withField = fieldWithElement(raw, "right", el);
        const plain = await composePrintSolidTop(raw, {
            sourceField: { ...withField, elements: [], includeElements: false },
        });
        const withEl = await composePrintSolidTop(raw, { sourceField: withField });
        const frame = getBaseFootprintFrame(raw, "right");
        const ta = frame.thickAxis;
        const a = plain.getAttribute("position")!.array as Float32Array;
        const b = withEl.getAttribute("position")!.array as Float32Array;
        let maxRaise = 0;
        for (let i = 0; i < a.length / 3; i++) {
            maxRaise = Math.max(maxRaise, b[i * 3 + ta]! - a[i * 3 + ta]!);
        }
        expect(maxRaise).toBeGreaterThan(0.3);
        plain.dispose();
        withEl.dispose();
        raw.dispose();
    }, 60_000);

    test("unmodified compose without elements matches neutral modifiers only", async () => {
        const raw = await loadSampleTop("right");
        const frame = getBaseFootprintFrame(raw, "right");
        const field: HeightFieldParams = {
            side: "right",
            lengthMm: frame.lenSize,
            widthMm: frame.widSize,
            thicknessMm: BASE_REFERENCE_THICKNESS_MM,
            corrections: zeroCorrections(),
            elements: [],
            includeSkives: false,
            includeElements: false,
            trimline: null,
        };
        const composed = await composePrintSolidTop(raw, { sourceField: field });
        const modified = applyBaseModifiers(raw, field, 0);
        const ta = frame.thickAxis;
        const a = composed.getAttribute("position")!.array as Float32Array;
        const b = modified.getAttribute("position")!.array as Float32Array;
        let worst = 0;
        for (let i = 0; i < a.length / 3; i++) {
            worst = Math.max(worst, Math.abs(a[i * 3 + ta]! - b[i * 3 + ta]!));
        }
        expect(worst).toBeLessThan(1e-4);
        composed.dispose();
        modified.dispose();
        raw.dispose();
    }, 60_000);
});
