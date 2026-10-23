// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { defaultSideShapeFinish } from "@/lib/geometry/shape-finish-modifiers";
import type { InsoleLayout } from "@/lib/geometry/shoe-size";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { buildTrimPresetCurve } from "@/lib/geometry/trim-presets";
import { extractMeshOutline, type TrimlineCurve } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side, SideCorrections } from "@/types";
import { pointInPoly } from "./cdt-band";
import { extractTopOnlyModel } from "./extract";
import {
    applyInsoleFootprintScale,
    applySharedSizeXY,
    hygieneBottomPattern,
    insoleFootprintAnchorFromBounds,
    PATTERN_HARD_OUTSIDE_MM,
    RIM_SUBSTITUTION_MAX_MM,
    referenceRimFromOutlineAndCut,
    type SignedInsetStats,
    sharedInsoleSizeTransform,
    sharedInsoleSizeTransformFromGeometry,
    signedInsetStats,
} from "./pattern-hygiene";
import { composePrintSolidTop, type DistalCutKind, sharedComposedRim } from "./print-solid-compose";
import {
    adoptFullBoundaryRim,
    patternOnComposedRim,
    reconstructProceduralPreview,
    SAMPLE_TOP_ASSET_ID,
    SAMPLE_TOP_NAME,
    sampleTopFromArrayBuffer,
} from "./sample-top-preview";
import { type CutSample, closestOnCut } from "./trim-curve";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

type Xy = { x: number; y: number; z: number };
type TopName = "full" | "34" | "sulcus" | "met_head";

function zero(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
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

function fieldFor(side: Side, layout: InsoleLayout, forefoot: boolean): HeightFieldParams {
    const shapeFinish = defaultSideShapeFinish("printing_solid");
    if (!forefoot) {
        shapeFinish.trimmableForefoot = false;
        shapeFinish.trimmableForefootExtraMm = 0;
    }
    return {
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zero(),
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
        shapeFinish,
    };
}

function loopStats(loop: Array<{ x: number; y: number }>) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of loop) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return {
        n: loop.length,
        minX: Number(minX.toFixed(3)),
        maxX: Number(maxX.toFixed(3)),
        length: Number((maxX - minX).toFixed(3)),
        minY: Number(minY.toFixed(3)),
        maxY: Number(maxY.toFixed(3)),
        width: Number((maxY - minY).toFixed(3)),
    };
}

function regionName(u: number): "heel" | "mid" | "fore" | "toe" {
    if (u < 0.2) return "heel";
    if (u < 0.5) return "mid";
    if (u < 0.8) return "fore";
    return "toe";
}

function roundStats(stats: SignedInsetStats) {
    return {
        min: Number(stats.min.toFixed(3)),
        max: Number(stats.max.toFixed(3)),
        p95: Number(stats.p95.toFixed(3)),
        n: stats.n,
    };
}

function meshRim(geo: BufferGeometry): Xy[] {
    const model = extractTopOnlyModel(geo, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
    adoptFullBoundaryRim(model);
    const pos = model.top.meshPositions ?? new Float32Array();
    const local = model.top.rimLocal ?? [];
    return local.map((i) => ({ x: pos[i * 3] ?? 0, y: pos[i * 3 + 1] ?? 0, z: 0 }));
}

/** Kept outline points stay bit-identical. Cut samples are inserted as-is. */
function assertKeptOutlineBitIdentical(outline: Xy[], rim: Xy[], cut: CutSample[]): void {
    for (const p of outline) {
        if (closestOnCut(p.x, p.y, cut).signed < -RIM_SUBSTITUTION_MAX_MM) continue;
        expect(rim.some((q) => q.x === p.x && q.y === p.y)).toBe(true);
    }
    for (const q of rim) {
        const onOutline = outline.some((p) => p.x === q.x && p.y === q.y);
        const onCut = cut.some((p) => p.x === q.x && p.y === q.y);
        expect(onOutline || onCut).toBe(true);
    }
}

describe("S1 size transform and composed rim", () => {
    test("composed top matches the size table at M1, M8.5 and M16", async () => {
        const raw = await loadSampleTop("right");
        const rows = [];
        try {
            raw.computeBoundingBox();
            const box = raw.boundingBox;
            if (!box) throw new Error("SAMPLE_Top has no bounds");
            const bounds = { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y };
            for (const men of [1, 8.5, 16]) {
                const layout = insoleLayoutForUsMenSize(men);
                const t = sharedInsoleSizeTransformFromGeometry(raw, layout.lengthMm, layout.widthMm);
                const again = sharedInsoleSizeTransform(bounds, layout.lengthMm, layout.widthMm);
                expect(t.sx).toBe(again.sx);
                expect(t.sy).toBe(again.sy);
                expect(t.x0).toBe(again.x0);
                expect(t.yMid).toBe(again.yMid);
                const anchor = insoleFootprintAnchorFromBounds(bounds);
                const sample = { x: box.max.x, y: box.max.y, z: 1 };
                const scaled = applyInsoleFootprintScale(
                    [sample],
                    anchor,
                    layout.lengthMm,
                    layout.widthMm,
                )[0]!;
                const q = applySharedSizeXY(sample.x, sample.y, t);
                expect(q.x).toBe(scaled.x);
                expect(q.y).toBe(scaled.y);
                const composed = await composePrintSolidTop(raw, {
                    sourceField: fieldFor("right", layout, false),
                    sizeTransform: t,
                    trimline: null,
                });
                try {
                    expect((composed.userData as { sizeTransform?: unknown }).sizeTransform).toBe(t);
                    composed.computeBoundingBox();
                    const out = composed.boundingBox;
                    if (!out) throw new Error("composed top has no bounds");
                    const length = out.max.x - out.min.x;
                    const width = out.max.y - out.min.y;
                    rows.push({
                        men,
                        targetLengthMm: layout.lengthMm,
                        targetWidthMm: layout.widthMm,
                        lengthMm: length,
                        widthMm: width,
                        sx: t.sx,
                        sy: t.sy,
                        x0: t.x0,
                        yMid: t.yMid,
                    });
                    expect(Math.abs(length - layout.lengthMm)).toBeLessThanOrEqual(0.2);
                    expect(Math.abs(width - layout.widthMm)).toBeLessThanOrEqual(0.2);
                } finally {
                    composed.dispose();
                }
            }
            const m85 = insoleLayoutForUsMenSize(8.5);
            expect(m85.lengthMm).toBeCloseTo(255.80645161290323, 6);
            console.log("[SIZE-GATE]", JSON.stringify(rows, null, 2));
            const t = sharedInsoleSizeTransformFromGeometry(raw, m85.lengthMm, m85.widthMm);
            let message = "";
            try {
                const bad = await composePrintSolidTop(raw, {
                    sourceField: fieldFor("right", m85, false),
                    sizeTransform: { ...t, lengthMm: t.lengthMm + 5 },
                    trimline: null,
                });
                bad.dispose();
            } catch (error) {
                message = error instanceof Error ? error.message : String(error);
            }
            expect(message).toContain("unscaled SAMPLE_Top");
        } finally {
            raw.dispose();
        }
    }, 180_000);

    test("inset stays non-negative and within 3 mm of the composed rim", async () => {
        const raw = await loadSampleTop("right");
        const rows = [];
        try {
            for (const men of [1, 8.5, 16]) {
                const layout = insoleLayoutForUsMenSize(men);
                const sizeTransform = sharedInsoleSizeTransformFromGeometry(
                    raw,
                    layout.lengthMm,
                    layout.widthMm,
                );
                for (const top of [
                    "full",
                    "34",
                    "sulcus",
                    "met_head",
                ] as const satisfies readonly TopName[]) {
                    const distalCut: DistalCutKind | null = top === "full" ? null : top;
                    const field = fieldFor("right", layout, false);
                    const composed = await composePrintSolidTop(raw, {
                        sourceField: field,
                        sizeTransform,
                        distalCut,
                        trimline: null,
                    });
                    try {
                        expect((composed.userData as { sizeTransform?: unknown }).sizeTransform).toBe(
                            sizeTransform,
                        );
                        const stored = sharedComposedRim(composed);
                        const rim = stored ?? meshRim(composed);
                        if (stored) expect(rim).toBe(stored);
                        expect(rim.length).toBeGreaterThan(8);
                        if (distalCut) {
                            const ud = composed.userData as {
                                referenceOutline?: Xy[];
                                distalCut?: CutSample[];
                            };
                            const outline = ud.referenceOutline ?? [];
                            const cut = ud.distalCut ?? [];
                            expect(outline.length).toBeGreaterThan(8);
                            expect(cut.length).toBeGreaterThan(2);
                            const again = referenceRimFromOutlineAndCut(outline, cut);
                            expect(again.maxSubstitutionMm).toBe(0);
                            expect(again.rim.length).toBe(rim.length);
                            for (let i = 0; i < rim.length; i++) {
                                const a = again.rim[i];
                                const b = rim[i];
                                expect(a?.x).toBe(b?.x);
                                expect(a?.y).toBe(b?.y);
                            }
                            assertKeptOutlineBitIdentical(outline, rim, cut);
                        }
                        const pattern = patternOnComposedRim(rim, "full_contact", "right");
                        const hygiened = hygieneBottomPattern(pattern, {
                            rimPlan: rim,
                            requireInsideRim: true,
                            clearanceMm: 0,
                            source: "synthetic",
                            resampleN: Math.max(160, pattern.length, rim.length),
                            keepFair: true,
                            sizeLabel: `US M${men}`,
                            rimHardOutsideMm: PATTERN_HARD_OUTSIDE_MM,
                            codePath: "export:composed-rim",
                        });
                        const loop = hygiened.loop;
                        const rimBox = loopStats(rim);
                        expect(rimBox.minY).toBeLessThan(0);
                        expect(rimBox.maxY).toBeGreaterThan(0);
                        if (top !== "full") expect(rimBox.maxX).toBeLessThan(layout.lengthMm - 10);
                        let minX = Infinity;
                        let maxX = -Infinity;
                        for (const p of rim) {
                            if (p.x < minX) minX = p.x;
                            if (p.x > maxX) maxX = p.x;
                        }
                        const span = Math.max(1e-6, maxX - minX);
                        const buckets: Record<"heel" | "mid" | "fore" | "toe", Xy[]> = {
                            heel: [],
                            mid: [],
                            fore: [],
                            toe: [],
                        };
                        for (const p of loop) buckets[regionName((p.x - minX) / span)].push(p);
                        const regions = {
                            heel: roundStats(signedInsetStats(buckets.heel, rim)),
                            mid: roundStats(signedInsetStats(buckets.mid, rim)),
                            fore: roundStats(signedInsetStats(buckets.fore, rim)),
                            toe: roundStats(signedInsetStats(buckets.toe, rim)),
                            all: roundStats(signedInsetStats(loop, rim)),
                        };
                        rows.push({ men, top, rim: rimBox, regions });
                        const all = signedInsetStats(loop, rim);
                        expect(all.min).toBeGreaterThan(-4.2);
                        expect(all.min).toBeGreaterThanOrEqual(-1e-4);
                        expect(all.min).toBeLessThanOrEqual(3);
                    } finally {
                        composed.dispose();
                    }
                }
            }
            console.log("[INSET-GATE]", JSON.stringify(rows, null, 2));
        } finally {
            raw.dispose();
        }
    }, 900_000);
});

test("shorter-top trim polygon still covers both sides of the foot", async () => {
    const raw = await loadSampleTop("right");
    const outline = extractMeshOutline(raw);
    if (!outline) throw new Error("SAMPLE_Top outline missing");
    const layout = insoleLayoutForUsMenSize(9);
    const sulcus = buildTrimPresetCurve("sulcus", {
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        baseCurve: outline,
    });
    const met = buildTrimPresetCurve("met_head", {
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        baseCurve: outline,
    });
    const inside = (curve: TrimlineCurve, x: number, y: number) =>
        pointInPoly(
            x,
            y,
            curve.points.map((p) => ({ x: p.x, y: p.y, z: 0 })),
        );
    expect(inside(sulcus, 80, -30)).toBe(true);
    expect(inside(sulcus, 80, 30)).toBe(true);
    expect(inside(met, 80, -30)).toBe(true);
    expect(inside(met, 80, 30)).toBe(true);
    raw.dispose();
});

test("forefoot extension is inside the composed rim it stretches", async () => {
    const layout = insoleLayoutForUsMenSize(9);
    const raw = await loadSampleTop("right");
    const rawBox = loopStats(await rimOf(raw));
    const variants: Array<{ name: string; forefoot: boolean }> = [
        { name: "forefoot-only", forefoot: true },
        { name: "no-forefoot", forefoot: false },
    ];
    const rows = [];
    for (const variant of variants) {
        const field = fieldFor("right", layout, variant.forefoot);
        const composed = await composePrintSolidTop(raw, { sourceField: field, trimline: null });
        const live = loopStats(await rimOf(composed));
        const exported = variant.forefoot ? await runPath(raw, field) : { error: null as string | null };
        rows.push({
            variant: variant.name,
            rawMaxX: rawBox.maxX,
            liveMaxX: live.maxX,
            deltaMaxXMm: Number((live.maxX - rawBox.maxX).toFixed(3)),
            exportError: exported.error,
        });
        composed.dispose();
    }
    raw.dispose();
    console.log("[FOREFOOT-RIM]", JSON.stringify(rows, null, 2));
    const forefoot = rows.find((row) => row.variant === "forefoot-only");
    const plain = rows.find((row) => row.variant === "no-forefoot");
    expect(forefoot?.exportError ?? null).toBeNull();
    expect(forefoot?.deltaMaxXMm).toBe(5);
    expect(plain?.deltaMaxXMm).toBe(0);
}, 240_000);

async function rimOf(geo: BufferGeometry): Promise<Xy[]> {
    const { extractTopOnlyModel } = await import("./extract");
    const { SAMPLE_TOP_ASSET_ID, SAMPLE_TOP_NAME } = await import("./sample-top-preview");
    const model = extractTopOnlyModel(geo, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
    const pos = model.top.meshPositions ?? new Float32Array();
    const rim = model.top.rimLocal ?? [];
    return rim.map((i) => ({ x: pos[i * 3] ?? 0, y: pos[i * 3 + 1] ?? 0, z: 0 }));
}

async function runPath(
    raw: BufferGeometry,
    sourceField: HeightFieldParams,
): Promise<{ error: string | null }> {
    try {
        const preview = await reconstructProceduralPreview(raw, {
            corrections: sourceField.corrections,
            thicknessMm: BASE_REFERENCE_THICKNESS_MM,
            stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
            wallStyle: "straight",
            scanPattern: "full_contact",
            side: "right",
            sourceField,
            composedTop: true,
            trimline: null,
        });
        preview.geometry.dispose();
        return { error: null };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}
