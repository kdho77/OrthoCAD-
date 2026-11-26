// Independent geometry grader for PR #462. Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { TubeGeometry, Vector3 } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import {
    buildProceduralViewerPattern,
    loadSampleTopGeometry,
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
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
import { extractMeshOutline, trimlineToCurve } from "@/lib/geometry/trimline";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");

/** PR #462 @ cdc0d30 — geometry + tests only (grader adds this file + shard). */
const PR462_CHANGED_FILES = [
    "ci/unit-test-shards.json",
    "vertex/src/components/viewer/BottomPatternEditTools.tsx",
    "vertex/src/hooks/useBaseInsoleGeometry.ts",
    "vertex/src/lib/geometry/bottom-planform-width.test.ts",
    "vertex/src/lib/geometry/procedural-wall/print-solid-compose.ts",
    "vertex/src/lib/geometry/shoe-width.ts",
] as const;

const GRADER_WIDTHS: ShoeWidthId[] = ["extra_narrow", "narrow", "wide", "extra_wide", "xx_wide"];
const GRADER_SIZES = [6, 10] as const;

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

function tubeClosedOutline(points: readonly { x: number; y: number; z?: number }[]) {
    const display = points.map((p) => new Vector3(p.x, p.y, (p.z ?? 0) + 1.5));
    const curve = trimlineToCurve(display, true);
    const tube = new TubeGeometry(curve, Math.max(48, display.length * 2), 0.35, 8, true);
    expect(tube.getAttribute("position").count).toBeGreaterThan(8);
    tube.dispose();
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

function refOpts(ref: ReturnType<typeof shoeWidthReferenceOfGeometry>) {
    return {
        ballWidthMm: ref.ballWidthMm,
        heelWidthMm: ref.heelWidthMm,
        minX: ref.frame.minX,
        lengthMm: ref.frame.lengthMm,
        yMid: ref.frame.yMid,
    };
}

function zeroField(): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: {
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
        },
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

describe("PR #462 grader G1 — one shared lateral s(u) for top and bottom", () => {
    test("G1: reference chords, shared affine, no legacy bottom-planform module", () => {
        expect(existsSync(join(REPO_ROOT, "vertex/src/lib/geometry/bottom-planform-width.ts"))).toBe(false);
        const compose = readFileSync(
            join(REPO_ROOT, "vertex/src/lib/geometry/procedural-wall/print-solid-compose.ts"),
            "utf8",
        );
        expect(compose).toContain("shoeWidthReferenceOfGeometry");
        const overlay = readFileSync(
            join(REPO_ROOT, "vertex/src/components/viewer/BottomPatternEditTools.tsx"),
            "utf8",
        );
        expect(overlay).not.toContain("applyShoeWidthToPoints");
    });

    test("G1: bottom pattern Y matches top mesh affine at sampled stations", async () => {
        const raw = await loadRaw();
        const ref = shoeWidthReferenceOfGeometry(raw);
        const opts = refOpts(ref);
        const pattern = buildProceduralViewerPattern(raw, "full_contact", {
            heelCupWidthMm: 0,
            forefootWidthMm: 0,
        });
        const failures: string[] = [];
        for (const width of GRADER_WIDTHS) {
            const bottom = applyShoeWidthToPoints(pattern, width, opts);
            for (let u = 0.05; u <= 0.95; u += 0.1) {
                const idx = pattern.findIndex((p) => {
                    const pu = (p.x - ref.frame.minX) / ref.frame.lengthMm;
                    return Math.abs(pu - u) < 0.04;
                });
                if (idx < 0) continue;
                const p = pattern[idx]!;
                const q = bottom[idx]!;
                const expected = shoeWidthAffineY(p.x, p.y, ref.frame.yMid, width, opts);
                if (Math.abs(q.y - expected) > 1e-4) {
                    failures.push(
                        `${width} u≈${u.toFixed(2)}: bottom y ${q.y.toFixed(4)} vs shared ${expected.toFixed(4)}`,
                    );
                }
            }
        }
        raw.dispose();
        expect(failures).toEqual([]);
    }, 120_000);
});

describe("PR #462 grader G2 — lateral (Y) only; length and height unchanged vs Medium", () => {
    test("G2: X and Z byte-stable on the sample top for every width class", async () => {
        const raw = await loadRaw();
        const ref = shoeWidthReferenceOfGeometry(raw);
        const opts = refOpts(ref);
        const src = raw.getAttribute("position");
        if (!src) throw new Error("no position");
        for (const width of GRADER_WIDTHS) {
            const top = applyShoeWidthToGeometry(raw, width, opts);
            const dst = top.getAttribute("position");
            if (!dst) throw new Error("scaled missing position");
            for (let i = 0; i < src.count; i++) {
                expect(dst.getX(i)).toBe(src.getX(i));
                expect(dst.getZ(i)).toBe(src.getZ(i));
            }
            if (top !== raw) top.dispose();
        }
        raw.dispose();
    }, 120_000);
});

describe("PR #462 grader G3 — forefoot nominal delta and smooth heelward taper", () => {
    test("G3: M6/M10 forefoot within 0.5 mm; monotonic s(u); heel below forefoot", async () => {
        const raw = await loadRaw();
        const ref = shoeWidthReferenceOfGeometry(raw);
        const outline = extractMeshOutline(raw, 80);
        if (!outline) throw new Error("no outline");
        const opts = refOpts(ref);
        const foreX = ref.frame.minX + ref.forefootU * ref.frame.lengthMm;
        const failures: string[] = [];

        for (const size of GRADER_SIZES) {
            const layout = insoleLayoutForUsMenSize(size);
            expect(Math.abs(layout.widthMm - ref.ballWidthMm)).toBeGreaterThan(1);

            for (const width of GRADER_WIDTHS) {
                const delta = SHOE_WIDTH_BALL_DELTA_MM[width];
                const top = applyShoeWidthToGeometry(raw, width, opts);
                const topOutline = extractMeshOutline(top, 80);
                const label = `M${size} ${width}`;
                if (!topOutline) {
                    failures.push(`${label}: no outline`);
                    top.dispose();
                    continue;
                }
                const foreMed = edgesAt(outline.points, foreX);
                const foreTop = edgesAt(topOutline.points, foreX);
                if (!foreMed || !foreTop) {
                    failures.push(`${label}: forefoot chord missing`);
                } else {
                    const foreChange = foreTop.width - foreMed.width;
                    if (Math.abs(foreChange - delta) > 0.5) {
                        failures.push(`${label}: forefoot Δ ${foreChange.toFixed(2)} vs nominal ${delta}`);
                    }
                }

                let prev = shoeWidthScaleAtU(0, ref.ballWidthMm, ref.heelWidthMm, width);
                for (let u = 0.02; u <= 1; u += 0.02) {
                    const s = shoeWidthScaleAtU(u, ref.ballWidthMm, ref.heelWidthMm, width);
                    if (delta > 0 ? s + 1e-9 < prev : s - 1e-9 > prev) {
                        failures.push(`${label}: s(u) not monotonic at u=${u.toFixed(2)}`);
                        break;
                    }
                    prev = s;
                }
                top.dispose();
            }
        }
        raw.dispose();
        expect(failures).toEqual([]);
    }, 180_000);
});

describe("PR #462 grader G4 — bottom planform inside top by ≤1 mm", () => {
    test("G4: rim containment and finite bottom tube at all stations", async () => {
        const raw = await loadRaw();
        const ref = shoeWidthReferenceOfGeometry(raw);
        const pattern = buildProceduralViewerPattern(raw, "full_contact", {
            heelCupWidthMm: 0,
            forefootWidthMm: 0,
        });
        const opts = refOpts(ref);
        const stations: number[] = [];
        for (let i = 1; i < 20; i++) stations.push(i / 20);
        const failures: string[] = [];

        for (const width of GRADER_WIDTHS) {
            const top = applyShoeWidthToGeometry(raw, width, opts);
            const bottom = applyShoeWidthToPoints(pattern, width, opts);
            const topOutline = extractMeshOutline(top, 80);
            if (!topOutline) {
                failures.push(`${width}: no top outline`);
                top.dispose();
                continue;
            }
            try {
                tubeClosedOutline(bottom);
            } catch {
                failures.push(`${width}: bottom pattern tube failed (self-intersection or NaN)`);
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
                        `${width} u=${u.toFixed(2)} bottom outside lo=${outsideLo.toFixed(2)} hi=${outsideHi.toFixed(2)}`,
                    );
                }
            }
            top.dispose();
        }
        raw.dispose();
        expect(failures).toEqual([]);
    }, 180_000);
});

describe("PR #462 grader G5 — Medium byte-identical vs main", () => {
    test("G5: Medium top mesh, bottom pattern, and print-solid top unchanged", async () => {
        const raw = await loadRaw();
        const ref = shoeWidthReferenceOfGeometry(raw);
        const opts = refOpts(ref);
        const pattern = buildProceduralViewerPattern(raw, "full_contact", {
            heelCupWidthMm: 0,
            forefootWidthMm: 0,
        });
        expect(applyShoeWidthToPoints(pattern, "medium", opts)).toBe(pattern);

        const mediumGeo = applyShoeWidthToGeometry(raw, "medium", opts);
        const src = raw.getAttribute("position")!.array as Float32Array;
        const med = mediumGeo.getAttribute("position")!.array as Float32Array;
        expect(med.length).toBe(src.length);
        for (let i = 0; i < src.length; i++) expect(med[i]).toBe(src[i]);

        const refSw = shoeWidthReferenceOfGeometry(raw);
        const noWidth = await composePrintSolidTop(raw, { sourceField: zeroField() });
        const mediumWidth = await composePrintSolidTop(raw, {
            sourceField: zeroField(),
            shoeWidth: {
                width: "medium",
                ballWidthMm: refSw.ballWidthMm,
                heelWidthMm: refSw.heelWidthMm,
            },
        });
        const a = noWidth.getAttribute("position")!.array as Float32Array;
        const b = mediumWidth.getAttribute("position")!.array as Float32Array;
        expect(b.length).toBe(a.length);
        for (let i = 0; i < a.length; i++) expect(b[i]).toBe(a[i]);

        noWidth.dispose();
        mediumWidth.dispose();
        mediumGeo.dispose();
        raw.dispose();
    }, 180_000);
});

describe("PR #462 grader G6 — heel width ±2 mm control", () => {
    test("G6: width-class heel still capped at ±2 mm; heelCupWidth override bypasses class heel", () => {
        const ball = 90.59;
        const heel = 58.91;
        for (const width of GRADER_WIDTHS) {
            const hs = shoeWidthHeelScale(heel, ball, width);
            expect(Math.abs(hs.deltaMm)).toBeLessThanOrEqual(SHOE_WIDTH_HEEL_CAP_MM + 1e-6);
            expect(shoeWidthScaleAtU(0.05, ball, heel, width)).toBeCloseTo(hs.scale, 5);
            expect(shoeWidthScaleAtU(0.7, ball, heel, width)).toBeCloseTo(
                (ball + SHOE_WIDTH_BALL_DELTA_MM[width]) / ball,
                5,
            );
        }
        const overridden = shoeWidthHeelScale(heel, ball, "wide", 2);
        expect(overridden.scale).toBe(1);
        expect(overridden.deltaMm).toBe(0);
        const pts = [
            { x: 5, y: 12 },
            { x: 200, y: -8 },
        ];
        const opts = { ballWidthMm: ball, heelWidthMm: heel, minX: 0, lengthMm: 260, heelOverrideMm: 2 };
        expect(() => applyShoeWidthToPoints(pts, "wide", opts)).not.toThrow();
    });
});

describe("PR #462 grader G7 — PR scope and grader CI", () => {
    const forbidden = /(\/afo\/|vertexslice|gcode|packages\/mcp\/test\/(?!.*width)|prisma\/migrations)/i;

    test("G7: changed files stay in shoe-width scaling + tests scope", () => {
        for (const file of PR462_CHANGED_FILES) {
            expect(file).not.toMatch(forbidden);
        }
        expect(PR462_CHANGED_FILES.length).toBe(6);
        const shoe = readFileSync(join(REPO_ROOT, "vertex/src/lib/geometry/shoe-width.ts"), "utf8");
        expect(shoe).toContain("shoeWidthReferenceOfGeometry");
        expect(shoe).not.toContain("bottom-planform-width");
    });
});
