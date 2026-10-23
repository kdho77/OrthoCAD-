// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { defaultElementPose } from "@/lib/geometry/elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { defaultSideShapeFinish } from "@/lib/geometry/shape-finish-modifiers";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { buildTrimPresetCurve } from "@/lib/geometry/trim-presets";
import { extractMeshOutline, type TrimlineCurve } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, Side, SideCorrections } from "@/types";
import { minDistToLoopXY, pointInPoly } from "./cdt-band";
import { extractTopOnlyModel } from "./extract";
import { composePrintSolidTop } from "./print-solid-compose";
import {
    buildFairedPatternFromTop,
    reconstructProceduralPreview,
    SAMPLE_TOP_ASSET_ID,
    SAMPLE_TOP_NAME,
    sampleTopFromArrayBuffer,
} from "./sample-top-preview";
import { rimMatchesShippedSampleTop } from "./shipped-pattern";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

/** Met-head is the shorter top in the trim panel (u = 0.66). Clinical 3/4 length. */
const TOPS = ["full", "sulcus", "met_head"] as const;

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

function dancer(side: Side, lengthMm: number, widthMm: number): PlacedElement {
    return {
        id: `dancer-${side}`,
        kind: "dancers_pad",
        side,
        hardnessClass: "Extra Soft",
        ...defaultElementPose("dancers_pad", side, lengthMm, widthMm),
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

function rimPlanOf(geo: BufferGeometry): Array<{ x: number; y: number; z: number }> {
    const model = extractTopOnlyModel(geo, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
    const pos = model.top.meshPositions ?? new Float32Array();
    const rim = model.top.rimLocal ?? [];
    return rim.map((i) => ({ x: pos[i * 3] ?? 0, y: pos[i * 3 + 1] ?? 0, z: 0 }));
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
        minX: Number(minX.toFixed(2)),
        maxX: Number(maxX.toFixed(2)),
        minY: Number(minY.toFixed(2)),
        maxY: Number(maxY.toFixed(2)),
    };
}

function directedHausdorff(a: Array<{ x: number; y: number }>, b: Array<{ x: number; y: number }>): number {
    let max = 0;
    for (const p of a) {
        const d = minDistToLoopXY(
            p.x,
            p.y,
            b.map((q) => ({ ...q, z: 0 })),
        );
        if (d > max) max = d;
    }
    return max;
}

function worstOutside(
    pattern: Array<{ x: number; y: number }>,
    rim: Array<{ x: number; y: number }>,
): { i: number; x: number; y: number; signedMm: number } | null {
    const rimZ = rim.map((p) => ({ ...p, z: 0 }));
    let worst: { i: number; x: number; y: number; signedMm: number } | null = null;
    for (let i = 0; i < pattern.length; i++) {
        const p = pattern[i];
        if (!p) continue;
        const d = minDistToLoopXY(p.x, p.y, rimZ);
        const signed = pointInPoly(p.x, p.y, rimZ) ? d : -d;
        if (!worst || signed < worst.signedMm) {
            worst = { i, x: p.x, y: p.y, signedMm: signed };
        }
    }
    return worst;
}

describe("S1-PATTERN toe station vs TopSheet rim", () => {
    test("US M9 Medium Full Contact dancers_pad Extra Soft stays inside full, sulcus, and 3/4 rims", async () => {
        const layout = insoleLayoutForUsMenSize(9);
        expect(layout.usMenSize).toBe(9);
        expect(layout.lengthMm).toBeCloseTo(260, 3);
        const reports: unknown[] = [];

        for (const side of ["right", "left"] as const) {
            const raw = await loadSampleTop(side);
            const outline = extractMeshOutline(raw);
            const element = dancer(side, layout.lengthMm, layout.widthMm);
            for (const top of TOPS) {
                const trim: TrimlineCurve | null =
                    top === "full" || !outline
                        ? null
                        : buildTrimPresetCurve(top, {
                              lengthMm: layout.lengthMm,
                              widthMm: layout.widthMm,
                              baseCurve: outline,
                          });
                const field: HeightFieldParams = {
                    side,
                    lengthMm: layout.lengthMm,
                    widthMm: layout.widthMm,
                    thicknessMm: BASE_REFERENCE_THICKNESS_MM,
                    corrections: zero(),
                    elements: [element],
                    includeSkives: false,
                    includeElements: true,
                    trimline: trim,
                    shapeFinish: defaultSideShapeFinish("printing_solid"),
                };
                const composed = await composePrintSolidTop(raw, {
                    sourceField: field,
                    shoeWidth: {
                        width: "medium",
                        ballWidthMm: layout.widthMm,
                        heelWidthMm: layout.widthMm * 0.62,
                    },
                    trimline: trim,
                });
                const rawRim = rimPlanOf(raw);
                const liveRim = rimPlanOf(composed);
                const pattern = buildFairedPatternFromTop(
                    extractTopOnlyModel(composed, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME }),
                    "full_contact",
                );
                const pre = worstOutside(pattern, rawRim);
                const preLive = worstOutside(pattern, liveRim);
                const exportResult = await runPath(raw, {
                    label: "export-main",
                    bottomPattern: pattern,
                    side,
                });
                const viewerResult = await runPath(raw, {
                    label: "viewer",
                    bottomPattern: pattern,
                    side,
                    sourceField: field,
                    trimline: trim,
                });
                reports.push({
                    side,
                    top,
                    element: "dancers_pad Extra Soft 16%",
                    rawRim: loopStats(rawRim),
                    liveRim: loopStats(liveRim),
                    shippedRim: rimMatchesShippedSampleTop(rawRim),
                    shippedLiveRim: rimMatchesShippedSampleTop(liveRim),
                    rimHausdorffMm: Number(
                        Math.max(
                            directedHausdorff(rawRim, liveRim),
                            directedHausdorff(liveRim, rawRim),
                        ).toFixed(3),
                    ),
                    pattern: loopStats(pattern),
                    patternVsRaw: pre && {
                        i: pre.i,
                        x: Number(pre.x.toFixed(2)),
                        y: Number(pre.y.toFixed(2)),
                        signedMm: Number(pre.signedMm.toFixed(3)),
                    },
                    patternVsLive: preLive && {
                        i: preLive.i,
                        x: Number(preLive.x.toFixed(2)),
                        y: Number(preLive.y.toFixed(2)),
                        signedMm: Number(preLive.signedMm.toFixed(3)),
                    },
                    export: exportResult,
                    viewer: viewerResult,
                });
                composed.dispose();
            }
            raw.dispose();
        }

        const body = JSON.stringify(reports, null, 2);
        console.log(body);
        const blocked = reports.filter((row) => {
            const r = row as { export: { error: string | null } };
            return r.export.error != null;
        });
        expect(blocked, body).toEqual([]);
    }, 420_000);
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
    // Midfoot, both sides of the centerline, must stay inside a shorter top.
    expect(inside(sulcus, 80, -30)).toBe(true);
    expect(inside(sulcus, 80, 30)).toBe(true);
    expect(inside(met, 80, -30)).toBe(true);
    expect(inside(met, 80, 30)).toBe(true);
    raw.dispose();
});

test("forefoot extension, not the dancer pad, moves the rim the pattern is fit to", async () => {
    const layout = insoleLayoutForUsMenSize(9);
    const raw = await loadSampleTop("right");
    const rawRim = rimPlanOf(raw);
    const variants: Array<{ name: string; element: boolean; forefoot: boolean }> = [
        { name: "pad+forefoot", element: true, forefoot: true },
        { name: "forefoot-only", element: false, forefoot: true },
        { name: "pad-only", element: true, forefoot: false },
    ];
    const rows = [];
    for (const variant of variants) {
        const finish = defaultSideShapeFinish("printing_solid");
        if (!variant.forefoot) {
            finish.trimmableForefoot = false;
            finish.trimmableForefootExtraMm = 0;
        }
        const field: HeightFieldParams = {
            side: "right",
            lengthMm: layout.lengthMm,
            widthMm: layout.widthMm,
            thicknessMm: BASE_REFERENCE_THICKNESS_MM,
            corrections: zero(),
            elements: variant.element ? [dancer("right", layout.lengthMm, layout.widthMm)] : [],
            includeSkives: false,
            includeElements: true,
            trimline: null,
            shapeFinish: finish,
        };
        const composed = await composePrintSolidTop(raw, { sourceField: field, trimline: null });
        const liveRim = rimPlanOf(composed);
        const pattern = buildFairedPatternFromTop(
            extractTopOnlyModel(composed, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME }),
            "full_contact",
        );
        const vsRaw = worstOutside(pattern, rawRim);
        const vsLive = worstOutside(pattern, liveRim);
        const exported = variant.forefoot
            ? await runPath(raw, { label: variant.name, bottomPattern: pattern, side: "right" })
            : { error: null, tris: null };
        rows.push({
            variant: variant.name,
            rawMaxX: loopStats(rawRim).maxX,
            liveMaxX: loopStats(liveRim).maxX,
            deltaMaxXMm: Number((loopStats(liveRim).maxX - loopStats(rawRim).maxX).toFixed(3)),
            rimXYHausdorffMm: Number(
                Math.max(directedHausdorff(rawRim, liveRim), directedHausdorff(liveRim, rawRim)).toFixed(3),
            ),
            outsideRawMm: vsRaw ? Number((-Math.min(0, vsRaw.signedMm)).toFixed(3)) : null,
            insideLiveMm: vsLive ? Number(vsLive.signedMm.toFixed(3)) : null,
            exportError: exported.error,
        });
        composed.dispose();
    }
    raw.dispose();
    console.log(JSON.stringify(rows, null, 2));
    const forefootOnly = rows.find((row) => row.variant === "forefoot-only");
    const padOnly = rows.find((row) => row.variant === "pad-only");
    expect(forefootOnly?.exportError).toContain("station 415 (244.41,-39.15)");
    expect(forefootOnly?.deltaMaxXMm).toBe(5);
    expect(padOnly?.outsideRawMm).toBe(0);
    expect(padOnly?.deltaMaxXMm).toBe(0);
}, 180_000);

async function runPath(
    raw: BufferGeometry,
    options: {
        label: string;
        bottomPattern: Array<{ x: number; y: number; z: number }>;
        side: Side;
        sourceField?: HeightFieldParams;
        trimline?: TrimlineCurve | null;
    },
): Promise<{ error: string | null; tris: number | null }> {
    try {
        const preview = await reconstructProceduralPreview(raw, {
            corrections: options.sourceField?.corrections,
            thicknessMm: BASE_REFERENCE_THICKNESS_MM,
            stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
            wallStyle: "straight",
            scanPattern: "full_contact",
            side: options.side,
            bottomPattern: options.bottomPattern,
            ...(options.sourceField
                ? { sourceField: options.sourceField, composedTop: true, trimline: options.trimline ?? null }
                : {}),
        });
        const index = preview.geometry.getIndex();
        const tris = index ? index.count / 3 : (preview.geometry.getAttribute("position")?.count ?? 0) / 3;
        preview.geometry.dispose();
        return { error: null, tris };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error), tris: null };
    }
}
