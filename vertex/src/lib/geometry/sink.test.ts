// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { evaluateSinkConstraints } from "@/lib/geometry/clinical-constraints";
import { type HeightFieldParams, heightAt } from "@/lib/geometry/height-field";
import { migrateDesignSinks } from "@/lib/geometry/migrate-corrections";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { effectiveOutlineHalfWidth } from "@/lib/geometry/trimline";
import type { DesignState, PlacedElement, PlacedSink, Side, SideCorrections, SinkKind } from "@/types";
import {
    applyAnalyticSinkToLoftedSolid,
    applyFloorGuard,
    applyStyloidWallRelief,
    BLEND_LEN_MM,
    ellipseOffsetDistance,
    FLOOR_MIN_MM,
    FOREFOOT_THICKNESS_CLEARANCE_MM,
    forefootThicknessPlan,
    guardedRimLowering,
    LATERAL_WALL_MIN_MM,
    MPJ1_PROXIMAL_SHIFT_MM,
    MPJ5_LATERAL_SHIFT_MM,
    SINK_DEFAULT_DEPTH_MM,
    SINK_KIND_ORDER,
    SINK_PROFILES,
    type SinkSurfaceContext,
    sinkCutMm,
    sinkDepthWarnings,
    sinkFrame,
    sinksActive,
    sinkThicknessAt,
    smootherstep01,
    smoothstep01,
    specVFromVSigned,
    styloidWallReliefAt,
    vSignedFromSpecV,
} from "./sink";

const SIZES = [1, 9, 16] as const;
const SIDES: Side[] = ["left", "right"];

function zeroCorrections(): SideCorrections {
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

function placed(kind: SinkKind, depthMm: number, id = kind): PlacedSink {
    return { id, kind, depthMm };
}

function surface(menSize: number, side: Side, sinks: PlacedSink[], thicken = false): SinkSurfaceContext {
    const layout = insoleLayoutForUsMenSize(menSize);
    return {
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        sinks,
        sinkStyloidThicken: thicken,
    };
}

function field(ctx: SinkSurfaceContext, sinks: PlacedSink[] | undefined): HeightFieldParams {
    return {
        side: ctx.side,
        lengthMm: ctx.lengthMm,
        widthMm: ctx.widthMm,
        thicknessMm: 4,
        corrections: zeroCorrections(),
        sinks,
        sinkStyloidThicken: ctx.sinkStyloidThicken,
        includeSkives: false,
        includeElements: false,
    };
}

describe("sink scalar field", () => {
    test("named profile table matches the clinical spec", () => {
        expect(SINK_PROFILES.mpj1).toMatchObject({
            u: 0.71,
            v: 0.15,
            lengthMm: 22,
            widthMm: 20,
            blendMm: 8,
            maxDepthMm: 4,
            deepestProximalMm: MPJ1_PROXIMAL_SHIFT_MM,
        });
        expect(SINK_PROFILES.mpj2.maxDepthMm).toBe(3);
        expect(SINK_PROFILES.mpj5).toMatchObject({
            lengthMm: 18,
            widthMm: 16,
            maxDepthMm: 4,
            deepestLateralMm: MPJ5_LATERAL_SHIFT_MM,
            lateralWallFade: true,
        });
        expect(SINK_PROFILES.styloid).toMatchObject({
            label: "5th Met Base (Styloid)",
            u: 0.42,
            v: 0.95,
            lengthMm: 20,
            widthMm: 14,
            blendMm: 8,
            maxDepthMm: 3,
        });
        expect(SINK_DEFAULT_DEPTH_MM).toBe(2);
        expect(FOREFOOT_THICKNESS_CLEARANCE_MM).toBe(0.5);
        expect(BLEND_LEN_MM).toBe(25);
        expect(FLOOR_MIN_MM).toBe(2);
        expect(LATERAL_WALL_MIN_MM).toBe(3);
    });

    test("no sinks is a no-op, including styloid thicken alone", () => {
        const ctx = surface(9, "right", []);
        expect(sinksActive(undefined)).toBe(false);
        expect(sinksActive([])).toBe(false);
        expect(sinkThicknessAt(0.7, 0, { ...ctx, sinks: undefined })).toBe(0);
        expect(sinkCutMm(180, 0, ctx).mm).toBe(0);
        const base = field(ctx, undefined);
        const empty = field(ctx, []);
        const thickenOnly = { ...base, sinkStyloidThicken: true };
        for (const u of [0.13, 0.5, 0.72]) {
            const h = heightAt(u, 0.2, base);
            expect(heightAt(u, 0.2, empty)).toBe(h);
            expect(heightAt(u, 0.2, thickenOnly)).toBe(h);
        }
    });

    test("each sink, both depths, M1/M9/M16, L/R, thicken off and on", () => {
        for (const kind of SINK_KIND_ORDER) {
            const profile = SINK_PROFILES[kind];
            for (const depth of [SINK_DEFAULT_DEPTH_MM, profile.maxDepthMm]) {
                for (const size of SIZES) {
                    for (const side of SIDES) {
                        for (const thicken of [false, true]) {
                            const sink = placed(kind, depth);
                            const ctx = surface(size, side, [sink], thicken);
                            const frame = sinkFrame(sink, ctx);
                            expect(frame).toBeTruthy();
                            if (!frame) continue;
                            const shift = Math.hypot(frame.dx - frame.cx, frame.dy - frame.cy);
                            if (kind === "mpj1") {
                                expect(Math.abs(shift - MPJ1_PROXIMAL_SHIFT_MM)).toBeLessThan(0.5);
                            } else if (kind === "mpj5") {
                                expect(Math.abs(shift - MPJ5_LATERAL_SHIFT_MM)).toBeLessThan(0.5);
                            } else {
                                expect(shift).toBeLessThan(0.05);
                            }
                            const cut = sinkCutMm(frame.dx, frame.dy, ctx);
                            expect(Math.abs(cut.mm - depth)).toBeLessThan(0.05);
                            const added = sinkThicknessAt(
                                frame.dx / ctx.lengthMm,
                                vSignedFromSpecV(frame.v, side),
                                ctx,
                            );
                            if (profile.forefoot) {
                                expect(
                                    Math.abs(added - cut.mm - FOREFOOT_THICKNESS_CLEARANCE_MM),
                                ).toBeLessThan(0.05);
                            } else if (!thicken) {
                                expect(added).toBeLessThan(1e-6);
                            } else {
                                expect(
                                    Math.abs(added - cut.mm - FOREFOOT_THICKNESS_CLEARANCE_MM),
                                ).toBeLessThan(0.05);
                            }
                            expect(frame.blendMm).toBe(profile.blendMm);
                            expect(frame.depthMm).toBe(depth);
                        }
                    }
                }
            }
        }
    });

    test("axes scale with length and width; depth and blend do not", () => {
        const sink = placed("mpj2", 2);
        const m9 = sinkFrame(sink, surface(9, "right", [sink]))!;
        const m1 = sinkFrame(sink, surface(1, "left", [sink]))!;
        const m16 = sinkFrame(sink, surface(16, "right", [sink]))!;
        const l9 = insoleLayoutForUsMenSize(9).lengthMm;
        const l1 = insoleLayoutForUsMenSize(1).lengthMm;
        const l16 = insoleLayoutForUsMenSize(16).lengthMm;
        expect(Math.abs(m1.halfLengthMm / m9.halfLengthMm - l1 / l9)).toBeLessThan(1e-6);
        expect(Math.abs(m16.halfLengthMm / m9.halfLengthMm - l16 / l9)).toBeLessThan(1e-6);
        expect(m1.halfWidthMm).not.toBeCloseTo(m9.halfWidthMm, 2);
        expect(m1.blendMm).toBe(m9.blendMm);
        expect(m16.depthMm).toBe(m9.depthMm);
        expect(m1.aProx).toBeGreaterThan(0.5);
        expect(m1.bLat).toBeGreaterThan(0.5);
    });

    test("forefoot thickness is deepest + 0.5, full ahead of the ovals, zero in the rearfoot", () => {
        const sinks = SINK_KIND_ORDER.map((kind) => placed(kind, kind === "mpj1" ? 4 : 2));
        const ctx = surface(9, "left", sinks, false);
        const plan = forefootThicknessPlan(ctx)!;
        expect(plan.A).toBeCloseTo(4 + FOREFOOT_THICKNESS_CLEARANCE_MM, 6);
        const deep = { ...placed("mpj1", 4, "deep"), u: 0.8, v: 0.12 };
        const shallow = { ...placed("mpj2", 2, "shallow"), u: 0.8, v: 0.78 };
        const split = surface(9, "left", [deep, shallow], false);
        const shallowFrame = sinkFrame(shallow, split)!;
        const t2 = sinkThicknessAt(shallowFrame.dx / split.lengthMm, vSignedFromSpecV(0.78, "left"), split);
        const s2 = sinkCutMm(shallowFrame.dx, shallowFrame.dy, split).mm;
        expect(s2).toBeCloseTo(2, 1);
        expect(Math.abs(t2 - s2 - (4.5 - 2))).toBeLessThan(0.05);
        expect(sinkThicknessAt(plan.x0 / ctx.lengthMm - 1 / ctx.lengthMm, 0, ctx)).toBeLessThan(1e-6);
        expect(sinkThicknessAt(0.13, 0, ctx)).toBeLessThan(1e-6);
        const atFull = sinkThicknessAt(plan.xFull / ctx.lengthMm, 0.4, ctx);
        expect(Math.abs(atFull - plan.A)).toBeLessThan(0.01);
        const sample = (x: number) => sinkThicknessAt(x / ctx.lengthMm, 0, ctx);
        const jump = (x: number) => {
            const h = 0.05;
            const left = (sample(x) - sample(x - h)) / h;
            const right = (sample(x + h) - sample(x)) / h;
            return Math.abs(right - left);
        };
        expect(jump(plan.x0)).toBeLessThan(1e-3);
        expect(jump(plan.xFull)).toBeLessThan(1e-3);
    });

    test("profile is C1 across the oval boundary and the blend end", () => {
        for (const kind of SINK_KIND_ORDER) {
            const sink = placed(kind, SINK_PROFILES[kind].maxDepthMm);
            const ctx = surface(9, "right", [sink]);
            const frame = sinkFrame(sink, ctx)!;
            const cut = (s: number) => sinkCutMm(frame.dx + frame.tx * s, frame.dy + frame.ty * s, ctx).mm;
            const boundary = frame.aDist;
            const blendEnd = frame.aDist + frame.blendMm;
            const secant = (a: number, b: number) => (cut(b) - cut(a)) / (b - a);
            expect(
                Math.abs(secant(boundary - 0.05, boundary) - secant(boundary, boundary + 0.05)),
            ).toBeLessThan(0.02);
            expect(
                Math.abs(secant(blendEnd - 0.05, blendEnd) - secant(blendEnd, blendEnd + 0.05)),
            ).toBeLessThan(0.02);
        }
    });

    test("overlap is max, not a sum", () => {
        const a = { ...placed("mpj2", 2, "a"), u: 0.7, v: 0.4 };
        const b = { ...placed("mpj3", 3, "b"), u: 0.7, v: 0.4 };
        const ctx = surface(9, "right", [a, b]);
        const frame = sinkFrame(b, ctx)!;
        const cut = sinkCutMm(frame.dx, frame.dy, ctx);
        expect(cut.mm).toBeCloseTo(3, 2);
        expect(cut.mm).toBeLessThan(4);
    });

    test("depth above max warns and the cut clamps", () => {
        const sink = placed("mpj2", 9);
        const warnings = sinkDepthWarnings([sink]);
        expect(warnings.some((w) => w.code === "depth-max" && w.sinkId === "mpj2")).toBe(true);
        const ctx = surface(9, "right", [sink]);
        const frame = sinkFrame(sink, ctx)!;
        expect(frame.depthMm).toBe(SINK_PROFILES.mpj2.maxDepthMm);
        expect(sinkCutMm(frame.dx, frame.dy, ctx).mm).toBeCloseTo(3, 2);
    });

    test("floor guard holds 2 mm and the wall guard holds 3 mm", () => {
        const floor = applyFloorGuard(2.4, 1.2, "mpj1");
        expect(floor.cutMm).toBeCloseTo(0.4, 6);
        expect(floor.warning?.code).toBe("floor");
        const ok = applyFloorGuard(6, 2, "mpj1");
        expect(ok.cutMm).toBe(2);
        expect(ok.warning).toBeUndefined();
        const wall = guardedRimLowering(4, 2, 0);
        expect(wall.warning).toBe(true);
        expect(wall.lowering).toBeCloseTo(1, 6);
        // Crest stays LATERAL_WALL_MIN_MM above the local footbed, not above z=0.
        const aboveBed = guardedRimLowering(8, 4, 5);
        expect(aboveBed.warning).toBe(true);
        expect(aboveBed.lowering).toBeCloseTo(0, 6);
        const clearance = guardedRimLowering(10, 4, 6);
        expect(clearance.lowering).toBeCloseTo(1, 6);
    });

    test("wall relief keeps 3 mm above the inboard footbed", () => {
        const length = 260;
        const width = 95;
        const rimX = 0.42 * length;
        const rimY = 2;
        const half = width / 2;
        const centerY = width / 2;
        const mMesh = (rimY - centerY) / half;
        const v = specVFromVSigned(-mMesh, "right");
        const positions = [rimX, rimY, 8, rimX, 40, 5, rimX, rimY, 4];
        applyAnalyticSinkToLoftedSolid({
            positions,
            topCount: 2,
            nS: 1,
            nJ: 2,
            vertAt: (row) => (row === 0 ? 0 : 2),
            bounds: { minX: 0, maxX: length, minY: 0, maxY: width },
            medialYSign: 1,
            side: "right",
            sinks: [{ id: "sty", kind: "styloid", depthMm: 3, u: rimX / length, v }],
        });
        // A z=0 guard would drop the crest by the full 3 mm (8 → 5).
        expect(positions[2]).toBeCloseTo(8, 3);
        expect(positions[0]).toBeCloseTo(rimX, 6);
        expect(positions[1]).toBeCloseTo(rimY, 6);
    });

    test("5th MPJ is zero at the lateral rim; styloid is not", () => {
        const fifth = placed("mpj5", 4);
        const ctx = surface(9, "left", [fifth]);
        const frame = sinkFrame(fifth, ctx)!;
        expect(sinkCutMm(frame.dx, frame.dy, ctx).mm).toBeGreaterThan(3.9);
        expect(sinkCutMm(frame.cx, frame.cy, ctx, 0.95).mm).toBe(0);
        expect(sinkCutMm(frame.cx, frame.cy, ctx, 0.97).mm).toBe(0);
        const sty = placed("styloid", 2);
        const styCtx = surface(9, "left", [sty]);
        const styFrame = sinkFrame(sty, styCtx)!;
        expect(sinkCutMm(styFrame.dx, styFrame.dy, styCtx, 0.95).mm).toBeGreaterThan(1.9);
    });

    test("1st MPJ fades out before the medial rim and stays full at the deep point", () => {
        const first = placed("mpj1", 4);
        const ctx = surface(9, "left", [first]);
        const frame = sinkFrame(first, ctx)!;
        expect(sinkCutMm(frame.dx, frame.dy, ctx).mm).toBeGreaterThan(3.9);
        expect(sinkCutMm(frame.cx, frame.cy, ctx, 0.05).mm).toBe(0);
        expect(sinkCutMm(frame.cx, frame.cy, ctx, 0.02).mm).toBe(0);
        expect(sinkCutMm(frame.cx, frame.cy, ctx, 0.12).mm).toBeGreaterThan(3.9);
    });

    test("heightAt adds T and leaves the wedge term unchanged", () => {
        const sinks = [placed("mpj1", 2)];
        const ctx = surface(9, "right", sinks);
        const bare = field(ctx, undefined);
        const withSink = field(ctx, sinks);
        const wedge: SideCorrections = {
            ...zeroCorrections(),
            forefootWedge: { side: "lateral", value: 4, unit: "mm" },
        };
        const wedged = { ...bare, corrections: wedge };
        const wedgedSink = { ...withSink, corrections: wedge };
        const u = 0.72;
        const v = vSignedFromSpecV(0.15, "right");
        const t = sinkThicknessAt(u, v, ctx);
        expect(Math.abs(heightAt(u, v, withSink) - heightAt(u, v, bare) - t)).toBeLessThan(1e-6);
        const wedgeOnly = heightAt(u, v, wedged) - heightAt(u, v, bare);
        const wedgeWithSink = heightAt(u, v, wedgedSink) - heightAt(u, v, withSink);
        expect(Math.abs(wedgeOnly - wedgeWithSink)).toBeLessThan(1e-6);
    });

    test("a met pad keeps its contribution outside the sink footprint", () => {
        const sinks = [placed("mpj3", 2)];
        const ctx = surface(9, "right", sinks);
        const pad: PlacedElement = {
            id: "pad-1",
            kind: "met_pad",
            side: "right",
            position: { x: 0.9 * ctx.lengthMm - ctx.lengthMm / 2, y: -8 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 2.5,
        };
        const delta = (sinksOn: boolean, u: number, v: number) => {
            const base = field(ctx, sinksOn ? sinks : undefined);
            const withPad = { ...base, elements: [pad], includeElements: true };
            const noPad = { ...base, elements: [], includeElements: true };
            return heightAt(u, v, withPad) - heightAt(u, v, noPad);
        };
        const u = 0.9;
        const v = vSignedFromSpecV(0.2, "right");
        expect(sinkCutMm(u * ctx.lengthMm, 0, ctx, 0.2).weight).toBe(0);
        expect(Math.abs(delta(true, u, v) - delta(false, u, v))).toBeLessThan(0.01);
    });

    test("scan marker moves the centre onto the marker", () => {
        const sink = { ...placed("mpj4", 2), markerId: "mark" };
        const ctx = surface(9, "left", [sink]);
        const marker = { id: "mark", u: 0.55, v: 0.33 };
        const frame = sinkFrame(sink, { ...ctx, sinkMarkers: [marker] })!;
        const half = effectiveOutlineHalfWidth(marker.u, ctx.lengthMm, ctx.widthMm, null) * (ctx.widthMm / 2);
        expect(Math.abs(frame.cx - marker.u * ctx.lengthMm)).toBeLessThan(0.1);
        expect(Math.abs(frame.cy - (2 * marker.v - 1) * half)).toBeLessThan(0.1);
    });

    test("element and text overlap warnings use the brief wording", () => {
        const ctx = surface(9, "right", [{ ...placed("mpj2", 2, "s2"), u: 0.73, v: 0.32 }]);
        const half = effectiveOutlineHalfWidth(0.73, ctx.lengthMm, ctx.widthMm, null) * (ctx.widthMm / 2);
        const el: PlacedElement = {
            id: "el-9",
            kind: "met_pad",
            side: "right",
            position: { x: 0.73 * ctx.lengthMm - ctx.lengthMm / 2, y: (2 * 0.32 - 1) * half },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 2,
        };
        const warnings = evaluateSinkConstraints(ctx, [el], {
            text: "A",
            surface: "bottom",
            mode: "engrave",
            bold: true,
            capHeightMm: 4,
            depthMm: 0.4,
            heightMm: 4,
            letterSpacingMm: 0,
            rotationDeg: 0,
            placementU: 0.73,
            anchor: "forefoot",
            feet: "both",
            differentOnLR: false,
            textLeft: "",
            textRight: "",
            nudgeAlongMm: 0,
            nudgeAcrossMm: (0.32 - 0.5) * ctx.widthMm,
        });
        expect(warnings.some((w) => w.message === "sink overlaps element el-9")).toBe(true);
        expect(warnings.some((w) => w.code === "text-overlap")).toBe(true);
    });

    test("smoothstep and ellipse offset are C1 and exact on the major axis", () => {
        expect(smoothstep01(0)).toBe(0);
        expect(smoothstep01(1)).toBe(1);
        const h = 1e-4;
        expect(smoothstep01(h) / h).toBeLessThan(1e-3);
        expect((1 - smoothstep01(1 - h)) / h).toBeLessThan(1e-3);
        expect(smootherstep01(0)).toBe(0);
        expect(smootherstep01(1)).toBe(1);
        expect(ellipseOffsetDistance(8, 0, 5, 3)).toBeCloseTo(3, 1);
        expect(ellipseOffsetDistance(1, 0, 5, 3)).toBe(0);
    });

    test("styloid wall relief changes z only and fades below the floor", () => {
        expect(styloidWallReliefAt(10, 12, 2, 2)).toBeLessThan(0);
        expect(styloidWallReliefAt(12 - 2 - 4, 12, 2, 2)).toBeCloseTo(0, 5);
        const nS = 6;
        const nJ = 5;
        const length = 260;
        const width = 95;
        const positions: number[] = [];
        const xy: number[] = [];
        for (let row = 0; row < nJ; row++) {
            for (let s = 0; s < nS; s++) {
                const x = (0.42 * length * s) / (nS - 1);
                const y = 4.75;
                const z = row === nJ - 1 ? 0 : 12 * (1 - row / (nJ - 1));
                positions.push(x, y, z);
                xy.push(x, y);
            }
        }
        const before = positions.slice();
        applyStyloidWallRelief({
            positions,
            nS,
            nJ,
            vertAt: (row, station) => row * nS + station,
            rimZ: (s) => positions[s * 3 + 2]!,
            rimXY: (s) => ({ x: positions[s * 3]!, y: positions[s * 3 + 1]! }),
            bounds: { minX: 0, maxX: length, minY: 0, maxY: width },
            medialYSign: 1,
            side: "right",
            sinks: [placed("styloid", 2)],
            rimAlreadyLowered: false,
        });
        for (let i = 0; i < nS * nJ; i++) {
            expect(positions[i * 3]).toBe(xy[i * 2]);
            expect(positions[i * 3 + 1]).toBe(xy[i * 2 + 1]);
            if (i % nS === 0 || Math.floor(i / nS) === nJ - 1) {
                expect(positions[i * 3 + 2]).toBe(before[i * 3 + 2]);
            }
        }
        const moved = positions.some((z, i) => i % 3 === 2 && z !== before[i]);
        expect(moved).toBe(true);
    });

    test("migrateDesignSinks leaves a missing list and splits a legacy array per side", () => {
        const design = {} as DesignState;
        expect(migrateDesignSinks(design)).toBe(design);
        const kept = { sinks: { left: [placed("mpj1", 2)] } } as DesignState;
        expect(migrateDesignSinks(kept)).toBe(kept);
        const legacy = {
            sinks: [placed("mpj1", 2)],
            sinkStyloidThicken: true,
        } as unknown as DesignState;
        const migrated = migrateDesignSinks(legacy);
        expect(migrated.sinks?.left?.[0]?.kind).toBe("mpj1");
        expect(migrated.sinks?.right?.[0]?.kind).toBe("mpj1");
        expect(migrated.sinks?.left?.[0]).not.toBe(migrated.sinks?.right?.[0]);
        expect(migrated.sinkStyloidThicken).toEqual({ left: true, right: true });
    });
});
