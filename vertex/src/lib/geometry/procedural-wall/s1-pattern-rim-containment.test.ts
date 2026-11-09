// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { mirrorGeometry } from "@/lib/library/loaders";
import { defaultDesign } from "@/stores/design-store";
import type { Side } from "@/types";
import { minDistToLoopXY, pointInPoly } from "./cdt-band";
import type { PolyPoint } from "./curves";
import { extractTopOnlyModel } from "./extract";
import { hygieneBottomPattern } from "./pattern-hygiene";
import { composePrintSolidTop, type PrintSolidShoeWidth } from "./print-solid-compose";
import {
    buildFairedPatternFromTop,
    reconstructProceduralPreview,
    SAMPLE_TOP_ASSET_ID,
    SAMPLE_TOP_NAME,
    sampleTopFromArrayBuffer,
    scaleBottomPatternToFootprint,
} from "./sample-top-preview";
import type { ProceduralWallStyle } from "./wall-style";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const GRINDS: ProceduralWallStyle[] = ["straight", "round", "hybrid"];

function shoeWidthFor(size: number): PrintSolidShoeWidth {
    const layout = insoleLayoutForUsMenSize(size);
    return { width: "medium", ballWidthMm: layout.widthMm, heelWidthMm: layout.widthMm * 0.62 };
}

async function loadSide(side: Side) {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "left") {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    return raw;
}

function scaleLoop(loop: PolyPoint[], center: { x: number; y: number }, scale: number): PolyPoint[] {
    return scaleBottomPatternToFootprint(loop, center, scale);
}

describe("S1 pattern stations stay inside the sized TopSheet rim", () => {
    test("US 8.5 Medium Full Contact projects the live pattern onto the scaled rim (L and R, Straight/Round/Hybrid)", async () => {
        for (const side of ["right", "left"] as const) {
            const raw = await loadSide(side);
            const design = defaultDesign();
            design.usMenSize = 8.5;
            const field = baseModifierField(design, side, design.thicknessMm);
            const layout = insoleLayoutForUsMenSize(8.5);
            const shoeWidth = shoeWidthFor(8.5);
            const composed = await composePrintSolidTop(raw, { sourceField: field, shoeWidth });
            const model = extractTopOnlyModel(composed, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
            const native = buildFairedPatternFromTop(model, "full_contact");
            raw.computeBoundingBox();
            const box = raw.boundingBox;
            expect(box).toBeTruthy();
            const center = { x: (box!.min.x + box!.max.x) / 2, y: (box!.min.y + box!.max.y) / 2 };
            const pos = model.top.meshPositions;
            const rimLocal = model.top.rimLocal ?? [];
            expect(pos).toBeTruthy();
            expect(rimLocal.length).toBeGreaterThan(8);
            const scaledRim = rimLocal.map((i) => ({
                x: center.x + ((pos![i * 3] ?? 0) - center.x) * layout.scale,
                y: center.y + ((pos![i * 3 + 1] ?? 0) - center.y) * layout.scale,
                z: 0,
            }));
            let worst = 0;
            let worstAt = native[0]!;
            for (const p of native) {
                const d = minDistToLoopXY(p.x, p.y, scaledRim);
                const inset = pointInPoly(p.x, p.y, scaledRim) ? d : -d;
                if (inset < worst) {
                    worst = inset;
                    worstAt = p;
                }
            }
            // Men's 9 live pattern vs the US 8.5 rim: at least one station is
            // outside (production: station 37 (170.47,-45.11), lateral forefoot).
            expect(worst).toBeLessThan(0);
            expect(Number.isFinite(worstAt.x + worstAt.y)).toBe(true);
            if (composed !== raw) composed.dispose();

            const heel = native.reduce((a, p) => (p.x < a.x ? p : a));
            for (const wallStyle of GRINDS) {
                const geo = raw.clone();
                const preview = await reconstructProceduralPreview(geo, {
                    wallStyle,
                    scanPattern: "full_contact",
                    side,
                    sourceField: field,
                    composedTop: true,
                    footprintScale: layout.scale,
                    shoeWidth,
                    bottomPattern: native,
                    thicknessMm: field.thicknessMm,
                    stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
                    corrections: field.corrections,
                });
                const usedHeel = preview.pattern.reduce((a, p) => (p.x < a.x ? p : a));
                expect(usedHeel.x).toBeCloseTo(center.x + (heel.x - center.x) * layout.scale, 2);
                expect(usedHeel.y).toBeCloseTo(center.y + (heel.y - center.y) * layout.scale, 2);
                preview.geometry.dispose();
                geo.dispose();
            }
            raw.dispose();
        }
    }, 300_000);

    test("US 1–15 L/R Straight, Round, and Hybrid do not throw S1-PATTERN", async () => {
        const sizes: number[] = [];
        for (let size = 1; size <= 15; size += 0.5) sizes.push(size);
        for (const side of ["right", "left"] as const) {
            const raw = await loadSide(side);
            const design = defaultDesign();
            const field = baseModifierField(design, side, design.thicknessMm);
            const shoeWidth = shoeWidthFor(9);
            const composed = await composePrintSolidTop(raw, { sourceField: field, shoeWidth });
            const model = extractTopOnlyModel(composed, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
            const native = buildFairedPatternFromTop(model, "full_contact");
            raw.computeBoundingBox();
            const box = raw.boundingBox!;
            const center = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
            const pos = model.top.meshPositions!;
            const nativeRim = (model.top.rimLocal ?? []).map((i) => ({
                x: pos[i * 3] ?? 0,
                y: pos[i * 3 + 1] ?? 0,
                z: 0,
            }));
            if (composed !== raw) composed.dispose();
            raw.dispose();
            for (const size of sizes) {
                const scale = insoleLayoutForUsMenSize(size).scale;
                const pattern = scaleLoop(native, center, scale);
                const rim = scaleLoop(nativeRim, center, scale);
                for (const wallStyle of GRINDS) {
                    try {
                        hygieneBottomPattern(pattern, {
                            rimPlan: rim,
                            requireInsideRim: true,
                            clearanceMm: 0,
                            keepFair: true,
                            source: "synthetic",
                            resampleN: Math.max(160, pattern.length, rim.length),
                        });
                    } catch (e) {
                        const message = e instanceof Error ? e.message : String(e);
                        throw new Error(`${side} US ${size} ${wallStyle}: ${message}`);
                    }
                }
            }
        }
    }, 180_000);
});
