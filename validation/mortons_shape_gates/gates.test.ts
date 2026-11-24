// Frozen Morton's shape gates, v2 (Kendon's foot-axis edge).
// Default mode (no-op proof): the new edge gates FAIL on this checkout; gates
// that should hold on main PASS; a deliberately broken copy FAIL the evaluator.
// MORTONS_GATE_MODE=grade records measured values and does not require the
// defect to still be present. Thresholds live in measure.ts and are not retuned.
// G4 at v = 0.3 is an accepted exception and does not fail the v2 scoreboard.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import * as baseAsset from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { defaultElementPose } from "@/lib/geometry/elements";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { analyzeManifold } from "@/lib/geometry/manifold";
import * as meshClose from "@/lib/geometry/mesh-close";
import { SAMPLE_TOP_PUBLIC_PATH } from "@/lib/geometry/procedural-wall/sample-top-id";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { DesignState, PlacedElement, Side } from "@/types";
import { clinicalFrame, frozenMedialSign, lateralOffset, medialOfMpj2BorderMm, pointAtUV, vAtPoint } from "./anatomy";
import {
    blendEndMetrics,
    BORDER_MEDIAL_MAX_MM,
    BORDER_MEDIAL_MIN_MM,
    countDifferingVertices,
    fitLine,
    G1_MAX_DEV_MM,
    G2_WIDTH_TOL_MM,
    G3_MIN_FRACTION,
    G4_MIN_FRACTION,
    G5_MAX_RISE_MM,
    G6_MAX_POS_SLOPE,
    G7_MAX_SECOND_DIFF,
    G7_MAX_SLOPE_JUMP,
    G8_MAX_SLOPE_AT_3MM,
    G11_MAX_ABS_MM,
    lineDeviationMm,
    maxSmoothedSlope,
    MPJ2_MAX_ADDED_MM,
    riseAfterLocalMinMm,
    s5Verdict,
    S1_MAX_AXIS_DEG,
    scoreFootAxisEdge,
    widthSpreadMm,
} from "./measure";
import { SAMPLE_TOP_SHA256, STL_PINS } from "./pins";
import {
    addedHeight,
    contourDeviation,
    measureMesh,
    measureShape,
    type ShapeMetrics,
    sampleTopBytes,
} from "./product";
import { guardVerdict, scopeVerdict } from "./scope";

const GRADE = process.env.MORTONS_GATE_MODE === "grade";
const SAMPLE_FIXTURE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const TEMPLATE_GLB = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");

const previewKernel = {
    name: "three-procedural",
    ready: true,
    tier: "preview" as const,
    buildInsole: buildInsoleGeometry,
    buildInsoleSolid(params: Parameters<typeof buildInsoleGeometry>[0]) {
        const geometry = buildInsoleGeometry(params);
        const mesh = analyzeManifold(geometry);
        return { geometry, manifold: { ...mesh, solidClosed: false, isWatertight: mesh.isWatertight } };
    },
    buildFromBase(base: BufferGeometry) {
        const geometry = base.clone();
        const mesh = analyzeManifold(geometry);
        return { geometry, manifold: { ...mesh, solidClosed: false, isWatertight: mesh.isWatertight } };
    },
    async exportSTL(geometry: BufferGeometry) {
        const { geometryToBinarySTL } = await import("@/lib/geometry/stl");
        return geometryToBinarySTL(geometry);
    },
};

rs.mock("@/lib/geometry/geometry-kernel", () => ({
    getKernel: () => previewKernel,
    isAuthoritativeKernel: () => false,
    isKernelInitFailed: () => false,
    ensureKernelReady: async () => false,
}));

function sha256(bytes: Buffer | ArrayBuffer): string {
    const buf = bytes instanceof ArrayBuffer ? Buffer.from(bytes) : bytes;
    return createHash("sha256").update(buf).digest("hex");
}

describe("evaluator rejects a deliberately broken copy", () => {
    test("straight contour passes and a 1 mm bulge fails G1", () => {
        const straight = Array.from({ length: 40 }, (_, i) => ({ x: 160 + i, y: 10 + 0.01 * i }));
        expect(lineDeviationMm(straight)).toBeLessThan(G1_MAX_DEV_MM);
        const bulged = straight.map((p, i) => ({ ...p, y: p.y + (i === 20 ? 1 : 0) }));
        expect(lineDeviationMm(bulged)).toBeGreaterThan(G1_MAX_DEV_MM);
    });

    test("constant bevel width passes and a 1 mm drift fails G2", () => {
        expect(widthSpreadMm([6, 6, 6.1, 5.9]).spread).toBeLessThanOrEqual(G2_WIDTH_TOL_MM);
        expect(widthSpreadMm([6, 6, 7.2]).spread).toBeGreaterThan(G2_WIDTH_TOL_MM);
    });

    test("a dip then a rise fails G5 and a ridge fails G6", () => {
        const flat = Array.from({ length: 30 }, () => 12);
        expect(riseAfterLocalMinMm(flat)).toBeLessThanOrEqual(G5_MAX_RISE_MM);
        const dipped = flat.map((h, i) => (i > 10 && i < 18 ? h - 0.4 : h));
        expect(riseAfterLocalMinMm(dipped)).toBeGreaterThan(G5_MAX_RISE_MM);
        const xs = flat.map((_, i) => i);
        expect(maxSmoothedSlope(xs, flat, 4)).toBeLessThanOrEqual(G6_MAX_POS_SLOPE);
        const ridge = flat.map((h, i) => h + (i > 14 ? 0.5 : 0));
        expect(maxSmoothedSlope(xs, ridge, 4)).toBeGreaterThan(G6_MAX_POS_SLOPE);
    });

    test("a slope kink fails G7 and a 2 mm bevel at 3 mm fails G8", () => {
        const kink = (x: number) => (x < 0 ? 0 : x * 0.2);
        const end = blendEndMetrics(kink, 0, 1);
        expect(end.slopeJump).toBeGreaterThan(G7_MAX_SLOPE_JUMP);
        const steep: { t: number; h: number }[] = [];
        for (let t = 0; t <= 2; t += 0.25) steep.push({ t, h: 3 * (1 - t / 2) });
        let peak = 0;
        for (let i = 1; i < steep.length; i++) {
            peak = Math.max(peak, Math.abs((steep[i]!.h - steep[i - 1]!.h) / 0.25));
        }
        expect(peak).toBeGreaterThan(G8_MAX_SLOPE_AT_3MM);
    });

    test("a moved vertex outside the band fails the byte-exact gate", () => {
        const before = new Float32Array([0, 0, 1, 10, 0, 1]);
        const after = new Float32Array(before);
        after[2] = 1.5;
        const differ = countDifferingVertices(before, after, (i) => i === 0);
        expect(differ).toBe(1);
        const same = countDifferingVertices(before, before, () => true);
        expect(same).toBe(0);
    });

    test("preview/export mismatch above 1e-6 fails G11", () => {
        expect(Math.abs(1.0000002 - 1)).toBeLessThanOrEqual(G11_MAX_ABS_MM);
        expect(Math.abs(3.01 - 3)).toBeGreaterThan(G11_MAX_ABS_MM);
    });

    test("empty diff passes scope; hardness, slicer, and a deleted guard fail", () => {
        expect(scopeVerdict([]).pass).toBe(true);
        expect(scopeVerdict(["validation/mortons_shape_gates/measure.ts"]).pass).toBe(true);
        const hard = scopeVerdict(["vertex/src/lib/hardness/recipe.ts"]);
        expect(hard.pass).toBe(false);
        expect(hard.denied.length).toBe(1);
        const slice = scopeVerdict(["vertex/src/lib/slicer/profile.ts"]);
        expect(slice.pass).toBe(false);
        expect(guardVerdict(" context\n-    const floor = softFloor(h, 0.8);\n").pass).toBe(false);
        expect(guardVerdict(" context\n+    const note = 1;\n").pass).toBe(true);
    });

    test("a foot-axis edge scores, and the old slant and a v=0.3 miss do not fail the wrong checks", () => {
        const pass = scoreFootAxisEdge({
            s1_angle_deg: 0,
            s1_border_medial_mm: 0.9,
            mpj2_added_mm: 0,
            g3_fraction: 1,
            g4: [
                { v: 0.1, fraction: 1 },
                { v: 0.2, fraction: 1 },
                { v: 0.3, fraction: 0 },
            ],
            g5_rise: 0,
            g6_slope: 0,
            outsideDiffer: 0,
        });
        expect(pass.s1).toBe(true);
        expect(pass.g3).toBe(true);
        expect(pass.g4).toBe(true);
        expect(pass.g4_v03_accepted).toBe(true);
        expect(pass.g5).toBe(true);
        expect(pass.g6).toBe(true);
        expect(pass.g10).toBe(true);

        const slant = scoreFootAxisEdge({
            s1_angle_deg: 9.56,
            s1_border_medial_mm: 0.9,
            mpj2_added_mm: 0,
            g3_fraction: 0,
            g4: [
                { v: 0.1, fraction: 1 },
                { v: 0.2, fraction: 1 },
                { v: 0.3, fraction: 0 },
            ],
            g5_rise: 0,
            g6_slope: 0,
            outsideDiffer: 42,
        });
        expect(slant.s1_angle).toBe(false);
        expect(slant.s1).toBe(false);
        expect(slant.g3).toBe(false);
        expect(slant.g10).toBe(false);
        expect(slant.g4).toBe(true);

        const liftedHead = scoreFootAxisEdge({
            s1_angle_deg: 0,
            s1_border_medial_mm: 2.5,
            mpj2_added_mm: 0.2,
            g3_fraction: 1,
            g4: [
                { v: 0.1, fraction: 1 },
                { v: 0.2, fraction: 0.5 },
                { v: 0.3, fraction: 0 },
            ],
            g5_rise: 0.4,
            g6_slope: 0.08,
            outsideDiffer: 0,
        });
        expect(liftedHead.s1_border).toBe(false);
        expect(liftedHead.s1_mpj2).toBe(false);
        expect(liftedHead.g4).toBe(false);
        expect(liftedHead.g5).toBe(false);
        expect(liftedHead.g6).toBe(false);
        expect(S1_MAX_AXIS_DEG).toBe(2);
        expect(BORDER_MEDIAL_MIN_MM).toBe(0);
        expect(BORDER_MEDIAL_MAX_MM).toBe(2);
        expect(MPJ2_MAX_ADDED_MM).toBeLessThanOrEqual(G11_MAX_ABS_MM);
        expect(G4_MIN_FRACTION).toBe(0.99);
    });

    test("S5 fails when the 6 mm residual is unreported or the blend was replaced", () => {
        const quiet = s5Verdict({ g5mm6: 0.8, g6mm6: 0.1, source: "quintic", reportText: "no comment" });
        expect(quiet.pass).toBe(false);
        const swapped = s5Verdict({
            g5mm6: 0.8,
            g6mm6: 0.1,
            source: "return smoothMax(pad, archTangent)",
            reportText: "G5 rise at 6 mm and G6 slope were not replaced",
        });
        expect(swapped.pass).toBe(false);
        const reported = s5Verdict({
            g5mm6: 0.8,
            g6mm6: 0.1,
            source: "quintic01 smoothstep over 25 mm",
            reportText: "G5 rise and G6 slope fail at 6 mm. The blend was not replaced.",
        });
        expect(reported.pass).toBe(true);
        const clean = s5Verdict({ g5mm6: 0, g6mm6: 0, source: "quintic", reportText: "" });
        expect(clean.pass).toBe(true);
    });

    test("flipping one byte of SAMPLE_Top fails the untouched-mesh gate", () => {
        const bytes = Buffer.from(sampleTopBytes());
        bytes[128] = bytes[128]! ^ 0xff;
        expect(sha256(bytes)).not.toBe(SAMPLE_TOP_SHA256);
        expect(sha256(sampleTopBytes())).toBe(SAMPLE_TOP_SHA256);
    });

    test("a warped copy of the real pad fails the straight-contour gate", () => {
        const real = addedHeight("left", 3);
        const straightish = contourDeviation("left", real, 0.95, 3);
        const broken = (x: number, y: number) => real(x, y + 4 * Math.sin(x / 12));
        const warped = contourDeviation("left", broken, 0.95, 3);
        expect(warped).toBeGreaterThan(G1_MAX_DEV_MM);
        expect(Number.isFinite(straightish)).toBe(true);
    });
});

describe("anatomy pins", () => {
    test("left medial is -Y, right medial is +Y, intermetatarsal v is near 0.255", () => {
        expect(frozenMedialSign("left")).toBe(-1);
        expect(frozenMedialSign("right")).toBe(1);
        const left = clinicalFrame("left");
        const right = clinicalFrame("right");
        expect(left.mpj1.y).toBeLessThan(0);
        expect(right.mpj1.y).toBeGreaterThan(0);
        expect(left.lateral.y).toBeGreaterThan(0);
        expect(right.lateral.y).toBeLessThan(0);
        const vMid = vAtPoint(left.mid.x, left.mid.y, "left");
        expect(vMid).toBeGreaterThan(0.24);
        expect(vMid).toBeLessThan(0.27);
        expect(left.dir).toEqual({ x: 1, y: 0 });
        expect(right.dir).toEqual({ x: 1, y: 0 });
        expect(left.lateral).toEqual({ x: 0, y: 1 });
        expect(right.lateral).toEqual({ x: 0, y: -1 });
        const lineAtHead = { x: left.mpj2.x, y: left.mid.y };
        const referenceMedial = medialOfMpj2BorderMm(left, lineAtHead);
        expect(referenceMedial).toBeGreaterThanOrEqual(BORDER_MEDIAL_MIN_MM);
        expect(referenceMedial).toBeLessThanOrEqual(BORDER_MEDIAL_MAX_MM);
        expect(lateralOffset(left, left.mid)).toBe(0);
        expect(pointAtUV(0.67, 0, "left").y).toBeLessThan(pointAtUV(0.67, 1, "left").y);
    });
});

function round(n: number): number {
    return Math.round(n * 1e6) / 1e6;
}

describe("product shape on the checkout under test", () => {
    test("G1-G8 and mesh byte gates", async () => {
        const shapes: ShapeMetrics[] = [];
        for (const side of ["left", "right"] as const) {
            for (const heightMm of [3, 6] as const) {
                shapes.push(await measureShape(side, heightMm));
            }
        }
        const meshes = [];
        for (const side of ["left", "right"] as const) {
            for (const heightMm of [3, 6] as const) {
                meshes.push(await measureMesh(side, heightMm));
            }
        }
        const stockFixture = sha256(sampleTopBytes());
        const stockTemplate = sha256(readFileSync(TEMPLATE_GLB));
        const report = {
            shapes: shapes.map((s) => ({
                ...s,
                g7_start: {
                    slopeJump: round(s.g7_start.slopeJump),
                    secondDiff: round(s.g7_start.secondDiff),
                },
                g7_end: { slopeJump: round(s.g7_end.slopeJump), secondDiff: round(s.g7_end.secondDiff) },
                g1_95: round(s.g1_95),
                g1_05: round(s.g1_05),
                g2_spread: round(s.g2_spread),
                g2_median: round(s.g2_median),
                g3_fraction: round(s.g3_fraction),
                g5_rise: round(s.g5_rise),
                g6_slope: round(s.g6_slope),
                g8_peak: round(s.g8_peak),
                s1_angle_deg: round(s.s1_angle_deg),
                s1_border_medial_mm: round(s.s1_border_medial_mm),
                mpj2_added_mm: round(s.mpj2_added_mm),
                s1_mid_dist_mm: round(s.s1_mid_dist_mm),
                maxAdded: round(s.maxAdded),
            })),
            meshes,
            stockFixture,
            stockTemplate,
        };
        const scores = shapes.map((s, i) =>
            scoreFootAxisEdge({
                s1_angle_deg: s.s1_angle_deg,
                s1_border_medial_mm: s.s1_border_medial_mm,
                mpj2_added_mm: s.mpj2_added_mm,
                g3_fraction: s.g3_fraction,
                g4: s.g4,
                g5_rise: s.g5_rise,
                g6_slope: s.g6_slope,
                outsideDiffer: meshes[i]!.outsideDiffer,
            }),
        );
        const axis = clinicalFrame("left");
        const referenceBorderMedialMm = medialOfMpj2BorderMm(axis, { x: axis.mpj2.x, y: axis.mid.y });
        const full = {
            ...report,
            scores,
            edge: {
                dir: axis.dir,
                referenceBorderMedialMm: round(referenceBorderMedialMm),
                note: "Scored edge is the heel-to-toe axis through the 1st/2nd midpoint. referenceBorderMedialMm is how far that line sits medial of the 2nd met head medial border.",
            },
        };
        const payload = `MORTONS_GATE_JSON_BEGIN${JSON.stringify(full)}MORTONS_GATE_JSON_END`;
        console.log(payload);
        if (process.env.MORTONS_GATE_OUT)
            writeFileSync(process.env.MORTONS_GATE_OUT, JSON.stringify(full, null, 2));
        if (GRADE) return;

        expect(stockFixture, "SAMPLE_Top fixture").toBe(SAMPLE_TOP_SHA256);
        expect(stockTemplate, "SAMPLE_Top template").toBe(SAMPLE_TOP_SHA256);

        for (const s of shapes) {
            const tag = `${s.side} ${s.heightMm} mm`;
            const score = scores[shapes.indexOf(s)]!;
            expect(s.maxAdded, `${tag} reaches nominal`).toBeGreaterThan(s.heightMm * 0.98);
            expect(s.arch_hits / s.arch_queries, `${tag} arch samples`).toBeGreaterThan(0.5);
            expect(s.g1_95_n, `${tag} 95% stations`).toBeGreaterThan(20);
            expect(s.g1_95, `${tag} G1 95%`).toBeGreaterThan(G1_MAX_DEV_MM);
            expect(s.g1_05, `${tag} G1 5%`).toBeGreaterThan(G1_MAX_DEV_MM);
            expect(s.g2_spread, `${tag} G2`).toBeGreaterThan(G2_WIDTH_TOL_MM);
            expect(s.g3_fraction, `${tag} G3`).toBeLessThan(G3_MIN_FRACTION);
            expect(score.g3, `${tag} G3 score`).toBe(false);
            for (const row of s.g4) {
                if (row.v === 0.3) continue;
                expect(row.fraction, `${tag} G4 v=${row.v}`).toBeLessThan(G4_MIN_FRACTION);
            }
            expect(score.g4, `${tag} G4 v=0.1 and v=0.2`).toBe(false);
            expect(score.g4_v03_accepted, `${tag} G4 v=0.3 accepted`).toBe(true);
            expect(s.g5_rise, `${tag} G5`).toBeGreaterThan(G5_MAX_RISE_MM);
            expect(s.g6_slope, `${tag} G6`).toBeGreaterThan(G6_MAX_POS_SLOPE);
            expect(score.g5, `${tag} G5 score`).toBe(false);
            expect(score.g6, `${tag} G6 score`).toBe(false);
            expect(s.s2_bevel_over_8, `${tag} bevel wider than 8 mm`).toBe(true);
            expect(s.s1_angle_deg, `${tag} S1 angle to foot axis`).toBeGreaterThan(S1_MAX_AXIS_DEG);
            expect(score.s1_angle, `${tag} S1 angle score`).toBe(false);
            expect(score.s1_border, `${tag} border offset`).toBe(false);
            expect(s.mpj2_added_mm, `${tag} 2nd met head`).toBeGreaterThan(MPJ2_MAX_ADDED_MM);
            expect(score.s1_mpj2, `${tag} 2nd met head score`).toBe(false);
            expect(score.s1, `${tag} S1`).toBe(false);
            expect(s.s4_at_line / s.heightMm, `${tag} S4 plateau`).toBeLessThan(0.99);
            expect(Math.max(s.g7_start.slopeJump, s.g7_end.slopeJump), `${tag} G7 slope`).toBeLessThanOrEqual(
                G7_MAX_SLOPE_JUMP,
            );
            expect(
                Math.max(s.g7_start.secondDiff, s.g7_end.secondDiff),
                `${tag} G7 curvature`,
            ).toBeLessThanOrEqual(G7_MAX_SECOND_DIFF);
        }
        for (const m of meshes) {
            expect(m.planDiffer, `${m.side} ${m.heightMm} planform`).toBe(0);
            expect(m.outsideDiffer, `${m.side} ${m.heightMm} outside band`).toBeGreaterThan(0);
            expect(scores[meshes.indexOf(m)]!.g10, `${m.side} ${m.heightMm} G10 score`).toBe(false);
            expect(m.g11n, `${m.side} ${m.heightMm} lifted vertices`).toBeGreaterThan(10);
            expect(m.g11MaxMm, `${m.side} ${m.heightMm} G11`).toBeLessThanOrEqual(G11_MAX_ABS_MM);
            expect(m.g11Miss, `${m.side} ${m.heightMm} G11 misses`).toBe(0);
        }
        const at3 = shapes.filter((s) => s.heightMm === 3);
        for (const s of at3) {
            expect(s.g8_peak, `${s.side} G8`).toBeLessThanOrEqual(G8_MAX_SLOPE_AT_3MM);
        }
    }, 180_000);
});

function designAt(
    usMen: number,
    element?: { kind: "reverse_mortons"; side: Side; heightMm: number },
): DesignState {
    const layout = insoleLayoutForUsMenSize(usMen);
    const design = createDesignWithStockPlaceholder({
        ...defaultDesign(),
        method: "printing_solid",
        sizeSystem: "us",
        usMenSize: layout.usMenSize,
        footLengthMm: layout.footLengthMm,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
    });
    if (!element) return design;
    const pose = defaultElementPose(element.kind, element.side, layout.lengthMm, layout.widthMm);
    const placed: PlacedElement = {
        id: `gate-${element.kind}-${element.side}`,
        kind: element.kind,
        side: element.side,
        position: pose.position,
        rotationDeg: pose.rotationDeg,
        scale: pose.scale,
        heightMm: element.heightMm,
    };
    return { ...design, elements: [placed] };
}

describe("export STL identity hooks", () => {
    test("no-Morton's and reverse Morton's STL hashes are stable on this checkout", async () => {
        const originalLoad = baseAsset.loadBaseGeometry;
        rs.spyOn(meshClose, "assertClosedSolidAcceptable").mockImplementation(() => undefined);
        rs.spyOn(baseAsset, "loadBaseGeometry").mockImplementation(async (base, options) => {
            return originalLoad.call(baseAsset, base, options);
        });
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.includes("SAMPLE_Top") || url === SAMPLE_TOP_PUBLIC_PATH) {
                const buf = readFileSync(SAMPLE_FIXTURE);
                return new Response(buf, { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof fetch;
        resetSampleTopGeometryCache();
        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const hashes: Record<string, string> = {};
        for (const us of [9] as const) {
            for (const side of ["left", "right"] as const) {
                useDesignStore.setState({
                    design: designAt(us),
                    stockBaseLoading: false,
                    stockBaseResolutionState: "resolved",
                });
                hashes[`none-${us}-${side}`] = sha256(
                    await buildExportStl(side, { exportMode: "manufacturing" }),
                );
                useDesignStore.setState({
                    design: designAt(us, { kind: "reverse_mortons", side, heightMm: 3 }),
                    stockBaseLoading: false,
                    stockBaseResolutionState: "resolved",
                });
                hashes[`reverse-${us}-${side}`] = sha256(
                    await buildExportStl(side, { exportMode: "manufacturing" }),
                );
            }
        }
        console.log(`MORTONS_STL_JSON_BEGIN${JSON.stringify(hashes)}MORTONS_STL_JSON_END`);
        if (process.env.MORTONS_STL_OUT)
            writeFileSync(process.env.MORTONS_STL_OUT, JSON.stringify(hashes, null, 2));
        expect(hashes["none-9-left"]).toMatch(/^[0-9a-f]{64}$/);
        expect(hashes["reverse-9-left"]).not.toBe(hashes["none-9-left"]);
        for (const [key, pin] of Object.entries(STL_PINS)) {
            expect(hashes[key], key).toBe(pin);
        }
        expect("00".repeat(32)).not.toBe(STL_PINS["none-9-left"]);
        rs.restoreAllMocks();
    }, 180_000);
});
