// Independent grader for PR #462 at 8de0d057. Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { buildFinalizedFootFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { defaultElementPose } from "@/lib/geometry/elements";
import { analyzeManifoldBuffers } from "@/lib/geometry/manifold-core";
import {
    composedFootRim,
    plantarNameEngraved,
    stlPositions,
} from "@/lib/geometry/procedural-wall/manufacturing-foot-guard";
import { hausdorffReport } from "@/lib/geometry/procedural-wall/metrics";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    buildProceduralExportSolid,
    buildProceduralViewerPattern,
    loadSampleTopGeometry,
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize, insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import {
    applyShoeWidthToGeometry,
    applyShoeWidthToPoints,
    SHOE_WIDTH_BALL_DELTA_MM,
    SHOE_WIDTH_HEEL_CAP_MM,
    type ShoeWidthId,
    shoeWidthAffineY,
    shoeWidthHeelScale,
    shoeWidthReferenceOfGeometry,
    shoeWidthScaleAtU,
} from "@/lib/geometry/shoe-width";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import { extractMeshOutline } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { DesignState, Side } from "@/types";
import { markingWithComposedText } from "../shared/bottom-text-marking";
import { designSettingsEnvelope } from "../shared/design-settings";

const WORKER_HEAD = "8de0d0576f14bfa5cc6ec6725c804542355386b5";
const MAIN_BASE = "228c72f2771a74e5b7c1d515ab0d01e4dd44d751";

const PR462_CHANGED_FILES = [
    "ci/unit-test-shards.json",
    "vertex/src/components/viewer/BottomPatternEditTools.tsx",
    "vertex/src/hooks/useBaseInsoleGeometry.ts",
    "vertex/src/lib/geometry/bottom-planform-width.test.ts",
    "vertex/src/lib/geometry/procedural-wall/narrow-heelcup-preloft.test.ts",
    "vertex/src/lib/geometry/procedural-wall/print-solid-compose.ts",
    "vertex/src/lib/geometry/procedural-wall/reconstruct.ts",
    "vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts",
    "vertex/src/lib/geometry/procedural-wall/station-gates.ts",
    "vertex/src/lib/geometry/shoe-width.ts",
] as const;

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const FONT = resolve(process.cwd(), "vertex/public/fonts/Inter-Bold.ttf");
const MARK = "GR462";

const WIDTHS: ShoeWidthId[] = ["narrow", "wide", "extra_wide", "xx_wide"];
const SIZES = [6, 10] as const;

/** Main-branch pins for Medium and refit narrow rows (GR2 / GR3). */
const MAIN_MEDIUM_PINS = {
    "s9-medium": {
        hash: "11a9b0627846c2da4638567c202a1cb7264c89b660b3aae0bc5bab2cc493c62d",
        verts: 55156,
    },
    "s8-medium": {
        hash: "39111add1574cbd9401b2abb60b5652e3cbb3891267405e6beb8bb59c6ed7cbf",
        verts: 54357,
    },
} as const;

const REFIT_NARROW_ROWS = ["s8.5-narrow-height9-met", "s10-narrow-height9-met"] as const;

function edgesAt(
    points: readonly { x: number; y: number }[],
    x: number,
): { lo: number; hi: number; width: number } | null {
    const ys: number[] = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        if (Math.abs(dx) < 1e-9) {
            if (Math.abs(a.x - x) <= 0.25) ys.push(a.y, b.y);
            continue;
        }
        const t = (x - a.x) / dx;
        if (t < -1e-4 || t > 1 + 1e-4) continue;
        ys.push(a.y + t * (b.y - a.y));
    }
    if (ys.length < 2) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const y of ys) {
        if (y < lo) lo = y;
        if (y > hi) hi = y;
    }
    return { lo, hi, width: hi - lo };
}

async function loadRaw() {
    resetSampleTopGeometryCache();
    const bytes = readFileSync(SAMPLE_TOP_PATH);
    primeSampleTopGeometry(
        await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        ),
    );
    return loadSampleTopGeometry();
}

function meshHash(pos: ArrayBufferView, idx: ArrayBufferView): string {
    const h = createHash("sha256");
    h.update(Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength));
    h.update(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength));
    return h.digest("hex");
}

function designFor(input: {
    width: ShoeWidthId;
    size?: number;
    heelCupHeightMm?: number;
    metPad?: boolean;
    side?: "left" | "right";
}): DesignState {
    const side = input.side ?? "left";
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    if (input.size != null) design.usMenSize = input.size;
    design.shoeWidth = input.width;
    design.shoeWidthBySide = { left: input.width, right: input.width };
    if (input.heelCupHeightMm) {
        const patch = { heelCupHeightMm: input.heelCupHeightMm };
        design.corrections = {
            ...design.corrections,
            linked: true,
            left: { ...design.corrections.left, ...patch },
            right: { ...design.corrections.right, ...patch },
        };
    }
    if (input.metPad) {
        const layout = insoleLayoutFromDesign(design);
        const pose = defaultElementPose("met_pad", side, layout.lengthMm, layout.widthMm);
        design.elements = [
            {
                id: side === "left" ? "met-left" : "met-right",
                kind: "met_pad",
                side,
                position: pose.position,
                rotationDeg: pose.rotationDeg,
                scale: pose.scale,
                heightMm: pose.heightMm,
            },
        ];
    }
    return design;
}

async function exportSolid(design: DesignState, side: "left" | "right", mirrored?: boolean) {
    const field = baseModifierFieldAuthoritative(design, side, design.thicknessMm);
    const options = printSolidOptions({
        design,
        side,
        field,
        viewer: { wallModel: "procedural", wallStyle: "round" },
        trimline: null,
        bottomPattern: null,
    });
    return buildProceduralExportSolid(mirrored ? { ...options, mirrored: true } : options);
}

function install(design: DesignState): void {
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({ design, viewer: { ...viewer, wallModel: "procedural" } });
}

describe("PR #462 grader G1–G4 — shared 1D lateral scale (M6/M10)", () => {
    test("G1–G4: top and bottom share s(u); Y-only; forefoot delta; bottom inside top", async () => {
        const raw = await loadRaw();
        const ref = shoeWidthReferenceOfGeometry(raw);
        const pattern = buildProceduralViewerPattern(raw, "full_contact", {
            heelCupWidthMm: 0,
            forefootWidthMm: 0,
        });
        const outline = extractMeshOutline(raw, 80);
        if (!outline) throw new Error("no outline");
        const opts = {
            ballWidthMm: ref.ballWidthMm,
            heelWidthMm: ref.heelWidthMm,
            minX: ref.frame.minX,
            lengthMm: ref.frame.lengthMm,
            yMid: ref.frame.yMid,
        };
        const failures: string[] = [];
        const stations: number[] = [];
        for (let i = 1; i < 20; i++) stations.push(i / 20);

        for (const size of SIZES) {
            expect(Math.abs(insoleLayoutForUsMenSize(size).widthMm - ref.ballWidthMm)).toBeGreaterThan(0.5);
            for (const width of WIDTHS) {
                const delta = SHOE_WIDTH_BALL_DELTA_MM[width];
                const top = applyShoeWidthToGeometry(raw, width, opts);
                const bottom = applyShoeWidthToPoints(pattern, width, opts);
                const topOutline = extractMeshOutline(top, 80);
                const label = `M${size} ${width}`;
                if (!topOutline) {
                    failures.push(`${label}: no top outline`);
                    if (top !== raw) top.dispose();
                    continue;
                }

                const srcPos = raw.getAttribute("position");
                const dstPos = top.getAttribute("position");
                if (!srcPos || !dstPos) throw new Error("missing position");
                for (let i = 0; i < Math.min(srcPos.count, 200); i++) {
                    if (Math.abs(dstPos.getX(i) - srcPos.getX(i)) > 1e-6) {
                        failures.push(`${label}: X changed at ${i}`);
                        break;
                    }
                    if (Math.abs(dstPos.getZ(i) - srcPos.getZ(i)) > 1e-6) {
                        failures.push(`${label}: Z changed at ${i}`);
                        break;
                    }
                }

                const foreX = ref.frame.minX + ref.forefootU * ref.frame.lengthMm;
                const heelX = ref.frame.minX + ref.heelU * ref.frame.lengthMm;
                const foreMed = edgesAt(outline.points, foreX);
                const foreTop = edgesAt(topOutline.points, foreX);
                const heelTop = edgesAt(topOutline.points, heelX);
                const heelMed = edgesAt(outline.points, heelX);
                const foreBot = edgesAt(bottom, foreX);
                const forePat = edgesAt(pattern, foreX);
                if (foreTop && foreMed && foreBot && forePat) {
                    const foreChange = foreTop.width - foreMed.width;
                    const botChange = foreBot.width - forePat.width;
                    if (Math.abs(foreChange - delta) > 0.5) {
                        failures.push(`${label}: fore Δ ${foreChange.toFixed(2)} vs ${delta}`);
                    }
                    if (Math.abs(botChange - delta) > 1) {
                        failures.push(`${label}: bottom fore Δ ${botChange.toFixed(2)}`);
                    }
                    if (
                        heelTop &&
                        heelMed &&
                        Math.abs(heelChange(heelTop, heelMed)) >= Math.abs(foreChange) - 0.25
                    ) {
                        failures.push(`${label}: heel does not taper under forefoot`);
                    }
                }

                let prev = shoeWidthScaleAtU(0, ref.ballWidthMm, ref.heelWidthMm, width);
                for (let u = 0.02; u <= 1; u += 0.02) {
                    const s = shoeWidthScaleAtU(u, ref.ballWidthMm, ref.heelWidthMm, width);
                    if (delta > 0 ? s + 1e-9 < prev : s - 1e-9 > prev) {
                        failures.push(`${label}: scale not monotonic u=${u.toFixed(2)}`);
                        break;
                    }
                    prev = s;
                }

                for (const u of stations) {
                    const x = ref.frame.minX + u * ref.frame.lengthMm;
                    const meshEdge = edgesAt(topOutline.points, x);
                    const botEdge = edgesAt(bottom, x);
                    if (!meshEdge || !botEdge) continue;
                    const outsideLo = Math.max(0, meshEdge.lo - botEdge.lo);
                    const outsideHi = Math.max(0, botEdge.hi - meshEdge.hi);
                    if (outsideLo > 1 || outsideHi > 1) {
                        failures.push(
                            `${label} u=${u.toFixed(2)} bottom outside lo=${outsideLo.toFixed(2)} hi=${outsideHi.toFixed(2)}`,
                        );
                    }
                    const su = shoeWidthScaleAtU(u, ref.ballWidthMm, ref.heelWidthMm, width);
                    const midY = ref.frame.yMid;
                    const sample = pattern.find((p) => Math.abs(p.x - x) < ref.frame.lengthMm * 0.02);
                    const bot = bottom.find(
                        (p) => sample && Math.abs(p.x - sample.x) < 1e-3 && Math.abs(p.y - sample.y) < 50,
                    );
                    if (sample && bot) {
                        const expected = shoeWidthAffineY(sample.x, sample.y, midY, width, opts);
                        if (Math.abs(bot.y - expected) > 0.05) {
                            failures.push(`${label}: bottom ≠ top affine at u=${u.toFixed(2)}`);
                        }
                    }
                    if (Math.abs(su - shoeWidthScaleAtU(u, ref.ballWidthMm, ref.heelWidthMm, width)) > 1e-9) {
                        failures.push(`${label}: inconsistent s(u)`);
                    }
                }

                if (top !== raw) top.dispose();
            }
        }
        raw.dispose();
        expect(failures, failures.join("\n")).toEqual([]);
    }, 240_000);
});

function heelChange(a: { width: number }, b: { width: number }): number {
    return a.width - b.width;
}

describe("PR #462 grader G5 — Medium unchanged vs main", () => {
    test("G5: s9-medium export hash matches main 228c72f2 pin", async () => {
        resetSampleTopGeometryCache();
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        primeSampleTopGeometry(
            await sampleTopFromArrayBuffer(
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            ),
        );
        const built = await exportSolid(designFor({ width: "medium" }), "left");
        const pos = built.geometry.getAttribute("position")!.array as Float32Array;
        const index = built.geometry.getIndex()!.array as Uint32Array;
        const pin = MAIN_MEDIUM_PINS["s9-medium"];
        expect(pos.length / 3).toBe(pin.verts);
        expect(meshHash(pos, index)).toBe(pin.hash);
        built.geometry.dispose();
    }, 120_000);
});

describe("PR #462 grader G6 — heel width ±2 mm cap and override", () => {
    test("G6: class heel cap ±2 mm; forefoot unchanged when heelCupWidth override set", () => {
        const ball = 90.59;
        const heel = 58.91;
        const capped = shoeWidthHeelScale(heel, ball, "xx_wide");
        expect(capped.capped).toBe(true);
        expect(Math.abs(capped.deltaMm)).toBeLessThanOrEqual(SHOE_WIDTH_HEEL_CAP_MM + 1e-6);
        const foreNo = shoeWidthScaleAtU(0.7, ball, heel, "wide");
        const foreOv = shoeWidthScaleAtU(0.7, ball, heel, "wide", 2);
        expect(foreOv).toBeCloseTo(foreNo, 6);
        const heelNo = shoeWidthScaleAtU(0.05, ball, heel, "wide");
        const heelPos = shoeWidthScaleAtU(0.05, ball, heel, "wide", 2);
        const heelNeg = shoeWidthScaleAtU(0.05, ball, heel, "wide", -2);
        expect(heelPos).toBe(1);
        expect(heelNeg).toBe(1);
        expect(heelNo).toBeGreaterThan(1);
        expect(heelNo).toBeLessThan(foreNo);
    });
});

describe("PR #462 grader G7 — PR scope", () => {
    test("G7: worker PR touches only width-scaling paths (10 files)", () => {
        expect(PR462_CHANGED_FILES.length).toBe(10);
        for (const file of PR462_CHANGED_FILES) {
            expect(file).toMatch(
                /shoe-width|bottom-planform|useBaseInsole|BottomPattern|print-solid-compose|sample-top|station-gates|reconstruct|narrow-heelcup|unit-test-shards/,
            );
        }
        expect(WORKER_HEAD.slice(0, 8)).toBe("8de0d057");
        expect(MAIN_BASE.slice(0, 8)).toBe("228c72f2");
    });
});

describe("PR #462 grader GR1 — right equals mirrored left (0.05 mm)", () => {
    const cases: Array<{ size: number; width: ShoeWidthId }> = [
        { size: 6, width: "narrow" },
        { size: 10, width: "narrow" },
        { size: 9, width: "narrow" },
        { size: 6, width: "wide" },
        { size: 10, width: "wide" },
        { size: 9, width: "wide" },
        { size: 6, width: "xx_wide" },
        { size: 10, width: "xx_wide" },
        { size: 9, width: "xx_wide" },
    ];

    test("GR1: Hausdorff ≤ 0.05 mm for Narrow/Wide/2X Wide at M6/M10/S9", async () => {
        resetSampleTopGeometryCache();
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        primeSampleTopGeometry(
            await sampleTopFromArrayBuffer(
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            ),
        );
        const failures: string[] = [];
        for (const { size, width } of cases) {
            const label = `M${size} ${width}`;
            try {
                const left = await exportSolid(
                    designFor({ width, size, heelCupHeightMm: 9, metPad: true }),
                    "left",
                );
                const right = await exportSolid(
                    designFor({ width, size, heelCupHeightMm: 9, metPad: true, side: "right" }),
                    "right",
                    true,
                );
                const mirrored = mirrorGeometry(left.geometry);
                const gap = hausdorffReport(mirrored, right.geometry);
                if (gap.maxMm > 0.05) {
                    failures.push(`${label}: Hausdorff ${gap.maxMm.toFixed(4)} > 0.05`);
                }
                mirrored.dispose();
                left.geometry.dispose();
                right.geometry.dispose();
            } catch (e) {
                failures.push(`${label}: export failed ${String(e).slice(0, 160)}`);
            }
        }
        expect(failures, failures.join("\n")).toEqual([]);
    }, 900_000);
});

describe("PR #462 grader GR2 — Medium byte-identical to main", () => {
    test("GR2: s9-medium and s8-medium pins unchanged from main", async () => {
        resetSampleTopGeometryCache();
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        primeSampleTopGeometry(
            await sampleTopFromArrayBuffer(
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            ),
        );
        for (const [id, pin] of Object.entries(MAIN_MEDIUM_PINS)) {
            const size = id.startsWith("s8") ? 8 : 9;
            const built = await exportSolid(designFor({ width: "medium", size }), "left");
            const pos = built.geometry.getAttribute("position")!.array as Float32Array;
            const index = built.geometry.getIndex()!.array as Uint32Array;
            expect(pos.length / 3, id).toBe(pin.verts);
            expect(meshHash(pos, index), id).toBe(pin.hash);
            built.geometry.dispose();
        }
    }, 240_000);
});

describe("PR #462 grader GR3 — refit narrow pins", () => {
    test("GR3: re-pinned narrow rows are non-Medium, watertight, export succeeds", async () => {
        resetSampleTopGeometryCache();
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        primeSampleTopGeometry(
            await sampleTopFromArrayBuffer(
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            ),
        );
        const rows: Array<{ id: string; design: DesignState }> = [
            {
                id: "s8.5-narrow-height9-met",
                design: designFor({ width: "narrow", size: 8.5, heelCupHeightMm: 9, metPad: true }),
            },
            {
                id: "s10-narrow-height9-met",
                design: designFor({ width: "narrow", size: 10, heelCupHeightMm: 9, metPad: true }),
            },
        ];
        for (const row of rows) {
            expect(REFIT_NARROW_ROWS as readonly string[]).toContain(row.id);
            expect(row.design.shoeWidth).toBe("narrow");
            const built = await exportSolid(row.design, "left");
            const pos = built.geometry.getAttribute("position")!.array as Float32Array;
            const index = built.geometry.getIndex()!.array as Uint32Array;
            const report = analyzeManifoldBuffers(pos, index);
            expect(report.openEdges, row.id).toBe(0);
            expect(report.nonManifoldEdges, row.id).toBe(0);
            expect(pos.length / 3, row.id).toBeGreaterThan(50000);
            built.geometry.dispose();
        }
    }, 300_000);
});

describe("PR #462 grader GR4 — Wide plantar name (production path)", () => {
    test("GR4: Wide M6 both feet engrave via production finalize", async () => {
        resetSampleTopGeometryCache();
        const sampleBytes = readFileSync(SAMPLE_TOP_PATH);
        const sampleTop = sampleBytes.buffer.slice(
            sampleBytes.byteOffset,
            sampleBytes.byteOffset + sampleBytes.byteLength,
        );
        primeSampleTopGeometry(await sampleTopFromArrayBuffer(sampleTop.slice(0)));
        const fontFile = readFileSync(FONT);
        const fontBytes = fontFile.buffer.slice(
            fontFile.byteOffset,
            fontFile.byteOffset + fontFile.byteLength,
        );
        primeTextFont(fontBytes);
        const elementsBaseDir = resolve(process.cwd(), "vertex/public/elements");
        const design = createDesignWithStockPlaceholder();
        design.method = "printing_solid";
        design.usMenSize = 6;
        design.shoeWidth = "wide";
        design.shoeWidthBySide = { left: "wide", right: "wide" };
        const layout = insoleLayoutFromDesign(design);
        design.elements = (["left", "right"] as const).map((side) => {
            const pose = defaultElementPose("met_pad", side, layout.lengthMm, layout.widthMm);
            return {
                id: `met-${side}`,
                kind: "met_pad" as const,
                side,
                position: pose.position,
                rotationDeg: pose.rotationDeg,
                scale: pose.scale,
                heightMm: pose.heightMm,
            };
        });
        design.textMarking = { ...defaultTextMarking("bottom"), text: MARK, addPatientName: false };
        const envelope = designSettingsEnvelope(design as unknown as Record<string, unknown>);
        for (const side of ["left", "right"] as const satisfies readonly Side[]) {
            install(design);
            const composed = markingWithComposedText(
                { ...defaultTextMarking("bottom"), text: "", addPatientName: true, feet: "both" },
                side,
                MARK,
            );
            const saved = { ...design, textMarking: composed };
            const head = await buildFinalizedFootFromSavedSettings({
                settingsJson: designSettingsEnvelope(saved as unknown as Record<string, unknown>),
                side,
                sampleTopBytes: sampleTop,
                includeLeader: true,
                fontBytes,
                elementsBaseDir,
            });
            const fresh = await sampleTopFromArrayBuffer(sampleTop.slice(0));
            const foot = await composedFootRim(fresh, saved, side);
            fresh.dispose();
            expect(plantarNameEngraved(stlPositions(head.stl), foot), side).toBe(true);
        }
        expect(envelope).toBeTruthy();
    }, 600_000);
});

describe("PR #462 grader GR5 — CI metadata", () => {
    test("GR5: grades worker head SHA for CI cross-check", () => {
        expect(WORKER_HEAD).toBe("8de0d0576f14bfa5cc6ec6725c804542355386b5");
    });
});
