// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    applyBaseModifiers,
    BASE_REFERENCE_THICKNESS_MM,
    getBaseFootprintFrame,
    vertexFootprintAt,
} from "@/lib/geometry/base-modifier";
import { ensureTopEdgeAvProfile } from "@/lib/geometry/element-assets/apply-elements";
import {
    loadTransformedAssetPositions,
    resolvePlacedAssetContexts,
} from "@/lib/geometry/element-assets/element-asset";
import { sampleGridBilinear } from "@/lib/geometry/element-assets/height-grid";
import { anchorMmFromPlacement } from "@/lib/geometry/element-assets/no-flow-blend";
import { defaultElementPose } from "@/lib/geometry/elements";
import { meshYForAnatomicalSide } from "@/lib/geometry/handedness";
import { type HeightFieldParams, heightAt } from "@/lib/geometry/height-field";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { ElementKind, PlacedElement, Side, SideCorrections } from "@/types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const TRIMLINE_R = 0.98;
const MATCH_MM = 0.2;

function zero(): SideCorrections {
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

async function loadSampleTop(side: Side): Promise<BufferGeometry> {
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

function fieldFor(
    raw: BufferGeometry,
    side: Side,
    elements: PlacedElement[],
    corrections: SideCorrections,
): HeightFieldParams {
    const frame = getBaseFootprintFrame(raw, side);
    return {
        side,
        lengthMm: frame.lenSize,
        widthMm: frame.widSize,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections,
        elements,
        includeSkives: false,
        includeElements: true,
        trimline: null,
    };
}

/** Worst |solid lift − authored preview height| on vertices at the sheet edge. */
async function trimlineGapMm(
    raw: BufferGeometry,
    placed: PlacedElement,
): Promise<{ n: number; worst: number }> {
    const field = fieldFor(raw, placed.side, [placed], zero());
    ensureTopEdgeAvProfile(field, raw);
    const neutral = await composePrintSolidTop(raw, {
        sourceField: { ...field, elements: [], includeElements: false },
    });
    const solid = await composePrintSolidTop(raw, { sourceField: field });
    try {
        const ctx = await resolvePlacedAssetContexts(
            [placed],
            placed.side,
            field.lengthMm,
            field.widthMm,
            raw,
        );
        const { grid } = await loadTransformedAssetPositions(ctx[0]!.assetId, ctx[0]!.transform);
        const anchor = anchorMmFromPlacement(raw, placed.side, placed.position.x, placed.position.y);
        const frame = anchor.frame;
        const pos = raw.getAttribute("position")!.array as Float32Array;
        const na = neutral.getAttribute("position")!.array as Float32Array;
        const sa = solid.getAttribute("position")!.array as Float32Array;
        const ta = frame.thickAxis;
        let n = 0;
        let worst = 0;
        for (let i = 0; i < pos.length / 3; i++) {
            const authored = sampleGridBilinear(grid, pos[i * 3]! - anchor.x, pos[i * 3 + 1]! - anchor.y);
            if (authored < 0.2) continue;
            const { u, vSigned } = vertexFootprintAt(frame, pos, i);
            const avEdge = field.topEdgeAvProfile?.(u, vSigned) ?? 0;
            if (!(avEdge > 1e-6) || Math.abs(vSigned) / avEdge < TRIMLINE_R) continue;
            const lift = sa[i * 3 + ta]! - na[i * 3 + ta]!;
            n++;
            worst = Math.max(worst, Math.abs(authored - lift));
        }
        return { n, worst };
    } finally {
        neutral.dispose();
        solid.dispose();
    }
}

describe("element height at the trimline", () => {
    test("flow library elements match the design preview on both feet within 0.2 mm", async () => {
        const kinds: ElementKind[] = ["cluffy_wedge", "met_bar", "toe_crest", "cuboid_pad"];
        for (const side of ["right", "left"] as const) {
            const raw = await loadSampleTop(side);
            const frame = getBaseFootprintFrame(raw, side);
            try {
                for (const kind of kinds) {
                    const pose = defaultElementPose(kind, side, frame.lenSize, frame.widSize);
                    const placed: PlacedElement = { id: `${kind}-${side}`, kind, side, ...pose };
                    const gap = await trimlineGapMm(raw, placed);
                    expect(gap.n, `${kind} ${side} reaches the trimline`).toBeGreaterThan(20);
                    expect(gap.worst, `${kind} ${side}`).toBeLessThanOrEqual(MATCH_MM);
                }
                const pose = defaultElementPose("met_pad", side, frame.lenSize, frame.widSize);
                const placed: PlacedElement = {
                    id: `met-pad-${side}`,
                    kind: "met_pad",
                    side,
                    ...pose,
                    position: {
                        ...pose.position,
                        y: meshYForAnatomicalSide(side, "lateral", frame.widSize * 0.42),
                    },
                };
                const gap = await trimlineGapMm(raw, placed);
                expect(gap.n, `met_pad ${side} reaches the trimline`).toBeGreaterThan(10);
                expect(gap.worst, `met_pad ${side}`).toBeLessThanOrEqual(MATCH_MM);
            } finally {
                raw.dispose();
            }
        }
    }, 180_000);

    test("forefoot lateral wedge matches the height field at the trimline on both feet", async () => {
        const wedge = { side: "lateral" as const, value: 6, unit: "mm" as const };
        for (const side of ["right", "left"] as const) {
            const raw = await loadSampleTop(side);
            const frame = getBaseFootprintFrame(raw, side);
            const corrections = { ...zero(), forefootWedge: wedge };
            const field = fieldFor(raw, side, [], corrections);
            const neutralField = fieldFor(raw, side, [], zero());
            ensureTopEdgeAvProfile(field, raw);
            const plain = applyBaseModifiers(raw, { ...neutralField, includeElements: false }, 0);
            const wedged = applyBaseModifiers(raw, { ...field, includeElements: false }, 0);
            try {
                const pos = raw.getAttribute("position")!.array as Float32Array;
                const pa = plain.getAttribute("position")!.array as Float32Array;
                const wa = wedged.getAttribute("position")!.array as Float32Array;
                const ta = frame.thickAxis;
                const lateralSign = side === "right" ? 1 : -1;
                let n = 0;
                let worst = 0;
                for (let i = 0; i < pos.length / 3; i++) {
                    const { u, vSigned } = vertexFootprintAt(frame, pos, i);
                    if (u < 0.7 || u > 0.95 || vSigned * lateralSign <= 0) continue;
                    const avEdge = field.topEdgeAvProfile?.(u, vSigned) ?? 0;
                    if (!(avEdge > 1e-6) || Math.abs(vSigned) / avEdge < TRIMLINE_R) continue;
                    const mesh = wa[i * 3 + ta]! - pa[i * 3 + ta]!;
                    const analytic = heightAt(u, vSigned, field) - heightAt(u, vSigned, neutralField);
                    n++;
                    worst = Math.max(worst, Math.abs(mesh - analytic));
                }
                expect(n, side).toBeGreaterThan(20);
                expect(worst, side).toBeLessThanOrEqual(MATCH_MM);
            } finally {
                plain.dispose();
                wedged.dispose();
                raw.dispose();
            }
        }
    }, 120_000);

    test("lofted met bar keeps the trimline height and stays watertight", async () => {
        const side: Side = "right";
        const raw = await loadSampleTop(side);
        const frame = getBaseFootprintFrame(raw, side);
        const pose = defaultElementPose("met_bar", side, frame.lenSize, frame.widSize);
        const placed: PlacedElement = { id: "met-bar", kind: "met_bar", side, ...pose };
        const field = fieldFor(raw, side, [placed], zero());
        ensureTopEdgeAvProfile(field, raw);
        const composed = await composePrintSolidTop(raw, { sourceField: field });
        const loft = await reconstructProceduralPreview(raw, {
            sourceField: field,
            side,
            wallStyle: "round",
            composedTop: true,
        });
        try {
            const report = validateManifold(loft.geometry);
            expect(report.isWatertight).toBe(true);
            expect(report.nonManifoldEdges).toBe(0);
            const pos = raw.getAttribute("position")!.array as Float32Array;
            const ca = composed.getAttribute("position")!.array as Float32Array;
            const la = loft.geometry.getAttribute("position")!.array as Float32Array;
            const ta = frame.thickAxis;
            let n = 0;
            let worst = 0;
            for (let i = 0; i < pos.length / 3; i++) {
                const { u, vSigned } = vertexFootprintAt(frame, pos, i);
                const avEdge = field.topEdgeAvProfile?.(u, vSigned) ?? 0;
                if (!(avEdge > 1e-6) || Math.abs(vSigned) / avEdge < TRIMLINE_R) continue;
                const x = pos[i * 3]!;
                const y = pos[i * 3 + 1]!;
                const z = ca[i * 3 + ta]!;
                const maxD2 = 0.5 * 0.5;
                let best = maxD2;
                let bz = z;
                for (let v = 0; v < la.length / 3; v++) {
                    const d = (la[v * 3]! - x) ** 2 + (la[v * 3 + 1]! - y) ** 2;
                    if (d < best) {
                        best = d;
                        bz = la[v * 3 + 2]!;
                    }
                }
                if (best >= maxD2) continue;
                n++;
                worst = Math.max(worst, Math.abs(bz - z));
            }
            expect(n).toBeGreaterThan(30);
            expect(worst).toBeLessThanOrEqual(MATCH_MM);
        } finally {
            composed.dispose();
            loft.geometry.dispose();
            raw.dispose();
        }
    }, 180_000);
});
