// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

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
    PLATEAU_GAP_MM,
    plateauGapMm,
    RKW_MEDIAL_INSET_MM,
    SINK_DEFAULT_DEPTH_MM,
    SINK_KIND_ORDER,
    SINK_PROFILES,
    SINK_REFERENCE_LENGTH_MM,
    type SinkSurfaceContext,
    STYLOID_RIM_CLEAR_MM,
    STYLOID_RIM_HARD_MM,
    STYLOID_RIM_OVERRIDE_FLOOR_MM,
    STYLOID_ROTATION_DEG,
    sinkCutMm,
    sinkDepthWarnings,
    sinkFrame,
    sinkPlanScale,
    sinkRimWarnings,
    sinksActive,
    sinkThicknessAt,
    sinkThicknessMm,
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

/** Full-width rectangle in mesh Y, symmetric about 0. Anatomical medial is the smaller Y. */
function rectFoot(lengthMm: number, widthMm: number): { x: number; y: number }[] {
    const y0 = -widthMm / 2;
    const y1 = widthMm / 2;
    const n = 8;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) pts.push({ x: (lengthMm * i) / (n - 1), y: y0 });
    for (let i = n - 1; i >= 0; i--) pts.push({ x: (lengthMm * i) / (n - 1), y: y1 });
    return pts;
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
            u: 0.69,
            v: 0.145,
            lengthMm: 22,
            widthMm: 22,
            blendMm: 7,
            maxDepthMm: 4,
            rotationDeg: 0,
            deepestProximalMm: 3,
            deepestLateralMm: 0,
        });
        expect(SINK_PROFILES.mpj2).toMatchObject({
            u: 0.71,
            v: 0.365,
            lengthMm: 16,
            widthMm: 16,
            blendMm: 5,
            maxDepthMm: 3,
        });
        expect(SINK_PROFILES.mpj3).toMatchObject({
            u: 0.705,
            v: 0.55,
            lengthMm: 15,
            widthMm: 15,
            blendMm: 5,
        });
        expect(SINK_PROFILES.mpj4).toMatchObject({
            u: 0.69,
            v: 0.715,
            lengthMm: 13,
            widthMm: 13,
            blendMm: 5,
        });
        expect(SINK_PROFILES.mpj5).toMatchObject({
            u: 0.665,
            v: 0.88,
            lengthMm: 13,
            widthMm: 13,
            blendMm: 5,
            maxDepthMm: 4,
            rotationDeg: 0,
            lateralWallFade: true,
        });
        expect(SINK_PROFILES.rkw).toMatchObject({
            label: "Reverse kinetic wedge",
            u: 0.68,
            lengthMm: 40,
            widthMm: 23,
            blendMm: 6,
            maxDepthMm: 4,
            deepestProximalMm: 3,
            forefoot: true,
        });
        expect(SINK_PROFILES.styloid).toMatchObject({
            label: "5th IPJ (Styloid)",
            u: 0.42,
            v: 0.92,
            lengthMm: 20,
            widthMm: 14,
            blendMm: 8,
            maxDepthMm: 3,
            rotationDeg: STYLOID_ROTATION_DEG,
        });
        expect(SINK_DEFAULT_DEPTH_MM).toBe(2);
        expect(FOREFOOT_THICKNESS_CLEARANCE_MM).toBe(0.5);
        expect(BLEND_LEN_MM).toBe(25);
        expect(FLOOR_MIN_MM).toBe(2);
        expect(LATERAL_WALL_MIN_MM).toBe(2);
        expect(STYLOID_RIM_CLEAR_MM).toBe(4);
        expect(STYLOID_RIM_HARD_MM).toBe(3);
        expect(STYLOID_RIM_OVERRIDE_FLOOR_MM).toBe(2);
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
                            if (kind === "rkw" || kind === "mpj1") {
                                expect(shift).toBeCloseTo(profile.deepestProximalMm, 2);
                            } else expect(shift).toBeLessThan(0.05);
                            const rotation = Math.atan2(frame.ty, frame.tx) * (180 / Math.PI);
                            const expectedRot = side === "left" ? -profile.rotationDeg : profile.rotationDeg;
                            expect(rotation).toBeCloseTo(expectedRot, 5);
                            if (kind === "styloid" && !frame.rimBlocked) {
                                expect(frame.rimMarginMm).toBeGreaterThanOrEqual(STYLOID_RIM_CLEAR_MM - 1e-6);
                            }
                            const cut = sinkCutMm(frame.dx, frame.dy, ctx);
                            const added = sinkThicknessAt(
                                frame.dx / ctx.lengthMm,
                                vSignedFromSpecV(frame.v, side),
                                ctx,
                            );
                            if (frame.rimBlocked) {
                                expect(cut.mm).toBe(0);
                                expect(added).toBeLessThan(1e-6);
                            } else {
                                expect(Math.abs(cut.mm - depth)).toBeLessThan(0.05);
                                if (profile.forefoot || thicken) {
                                    expect(
                                        Math.abs(added - cut.mm - FOREFOOT_THICKNESS_CLEARANCE_MM),
                                    ).toBeLessThan(0.05);
                                } else {
                                    expect(added).toBeLessThan(1e-6);
                                }
                            }
                            expect(frame.blendMm).toBe(profile.blendMm);
                            expect(frame.depthMm).toBe(depth);
                        }
                    }
                }
            }
        }
    });

    test("axes scale with insole length; depth and blend do not", () => {
        const sink = placed("mpj2", 2);
        const m9 = sinkFrame(sink, surface(9, "right", [sink]))!;
        const m1 = sinkFrame(sink, surface(1, "left", [sink]))!;
        const m16 = sinkFrame(sink, surface(16, "right", [sink]))!;
        const l9 = insoleLayoutForUsMenSize(9).lengthMm;
        const l1 = insoleLayoutForUsMenSize(1).lengthMm;
        const l16 = insoleLayoutForUsMenSize(16).lengthMm;
        expect(m1.halfLengthMm / m9.halfLengthMm).toBeCloseTo(sinkPlanScale(l1) / sinkPlanScale(l9), 5);
        expect(m16.halfLengthMm / m9.halfLengthMm).toBeCloseTo(sinkPlanScale(l16) / sinkPlanScale(l9), 5);
        expect(m1.halfWidthMm / m9.halfWidthMm).toBeCloseTo(m1.halfLengthMm / m9.halfLengthMm, 5);
        expect(m1.halfWidthMm).not.toBeCloseTo(m9.halfWidthMm, 2);
        expect(sinkPlanScale(l1)).toBe(0.8);
        expect(m1.blendMm).toBe(m9.blendMm);
        expect(m16.depthMm).toBe(m9.depthMm);
        expect(m1.aProx).toBeGreaterThan(0.5);
        expect(m1.bLat).toBeGreaterThan(0.5);
    });

    test("forefoot thickness is local depth + 0.5, blended over 25 mm, and the floor stays at least 2 mm", () => {
        const sinks = SINK_KIND_ORDER.map((kind) => placed(kind, kind === "mpj1" ? 4 : 2));
        const ctx = surface(9, "left", sinks, false);
        const plan = forefootThicknessPlan(ctx)!;
        expect(plan.A).toBeCloseTo(4 + FOREFOOT_THICKNESS_CLEARANCE_MM, 6);
        const deep = { ...placed("mpj1", 4, "deep"), u: 0.8, v: 0.4 };
        const shallow = { ...placed("mpj2", 2, "shallow"), u: 0.55, v: 0.4 };
        const split = surface(9, "left", [deep, shallow], false);
        const deepFrame = sinkFrame(deep, split)!;
        const shallowFrame = sinkFrame(shallow, split)!;
        const tDeep = sinkThicknessAt(deepFrame.u, vSignedFromSpecV(deepFrame.v, "left"), split);
        const tShallow = sinkThicknessAt(shallowFrame.u, vSignedFromSpecV(shallowFrame.v, "left"), split);
        expect(tDeep).toBeCloseTo(4.5, 2);
        expect(tShallow).toBeCloseTo(2.5, 2);
        const shell = 2;
        expect(shell + tDeep - 4).toBeGreaterThanOrEqual(FLOOR_MIN_MM - 1e-6);
        expect(shell + tShallow - 2).toBeGreaterThanOrEqual(FLOOR_MIN_MM - 1e-6);
        const alone = surface(9, "left", [deep], false);
        const aloneFrame = sinkFrame(deep, alone)!;
        const uOut = (aloneFrame.cx - aloneFrame.halfLengthMm - BLEND_LEN_MM - 2) / alone.lengthMm;
        expect(sinkThicknessAt(uOut, vSignedFromSpecV(aloneFrame.v, "left"), alone)).toBeLessThan(1e-4);
        expect(sinkThicknessAt(0.13, 0, ctx)).toBeLessThan(1e-6);
        const sample = (s: number) =>
            sinkThicknessAt(
                (aloneFrame.cx + aloneFrame.tx * s) / alone.lengthMm,
                vSignedFromSpecV(aloneFrame.v, "left"),
                alone,
            );
        const edge = aloneFrame.halfLengthMm + BLEND_LEN_MM;
        const h = 0.05;
        const slope = (s: number) => (sample(s + h) - sample(s - h)) / (2 * h);
        expect(Math.abs(slope(aloneFrame.halfLengthMm))).toBeLessThan(0.02);
        expect(Math.abs(slope(edge))).toBeLessThan(0.02);
    });

    test("profile is C2 across the oval boundary and the blend end", () => {
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
            const h2 = Math.min(0.2, frame.blendMm * 0.025);
            const second = (s: number) => (cut(s + h2) - 2 * cut(s) + cut(s - h2)) / (h2 * h2);
            expect(Math.abs(second(boundary))).toBeLessThan(0.05);
            expect(Math.abs(second(blendEnd))).toBeLessThan(0.05);
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

    test("met-head diameters scale at 247 mm and 297 mm", () => {
        const diameters = [
            ["mpj1", 22],
            ["mpj2", 16],
            ["mpj3", 15],
            ["mpj4", 13],
            ["mpj5", 13],
        ] as const;
        for (const lengthMm of [247, 297]) {
            const s = lengthMm / SINK_REFERENCE_LENGTH_MM;
            expect(s).toBeGreaterThan(0.8);
            expect(s).toBeLessThan(1.3);
            for (const [kind, diameter] of diameters) {
                const sink = placed(kind, 2);
                const ctx = { side: "right" as const, lengthMm, widthMm: 95, sinks: [sink] };
                const frame = sinkFrame(sink, ctx)!;
                expect(frame.halfLengthMm * 2).toBeCloseTo(diameter * s, 4);
                expect(frame.halfWidthMm * 2).toBeCloseTo(diameter * s, 4);
                expect(frame.blendMm).toBe(SINK_PROFILES[kind].blendMm);
            }
        }
    });

    test("centres sit on both feet at two lengths, and the 1st MPJ is medial", () => {
        const centres = [
            ["mpj1", 0.69, 0.145],
            ["mpj2", 0.71, 0.365],
            ["mpj3", 0.705, 0.55],
            ["mpj4", 0.69, 0.715],
            ["mpj5", 0.665, 0.88],
        ] as const;
        const widthMm = 95;
        for (const lengthMm of [247, 297]) {
            const outline = rectFoot(lengthMm, widthMm);
            for (const side of SIDES) {
                for (const [kind, u, v] of centres) {
                    const sink = placed(kind, 2);
                    const ctx = { side, lengthMm, widthMm, sinks: [sink], footOutline: outline };
                    const frame = sinkFrame(sink, ctx)!;
                    expect(frame.u).toBeCloseTo(u, 5);
                    expect(frame.v).toBeCloseTo(v, 3);
                    expect(frame.cx).toBeCloseTo(u * lengthMm, 3);
                    const medial = -widthMm / 2;
                    expect(frame.cy).toBeCloseTo(medial + v * widthMm, 3);
                }
                const first = sinkFrame(placed("mpj1", 2), {
                    side,
                    lengthMm,
                    widthMm,
                    sinks: [placed("mpj1", 2)],
                    footOutline: outline,
                })!;
                expect(first.v).toBeLessThan(0.2);
                expect(first.cy).toBeLessThan(0);
            }
        }
    });

    test("plateau gap is at least 0.5 mm at 247 mm and 297 mm", () => {
        const kinds = ["mpj1", "mpj2", "mpj3", "mpj4", "mpj5"] as const;
        for (const lengthMm of [247, 297]) {
            const widthMm = 95;
            const s = lengthMm / SINK_REFERENCE_LENGTH_MM;
            const outline = rectFoot(lengthMm, widthMm);
            for (const side of SIDES) {
                const sinks = kinds.map((kind) => placed(kind, 2));
                const ctx = { side, lengthMm, widthMm, sinks, footOutline: outline };
                const frames = sinks.map((sink) => sinkFrame(sink, ctx)!);
                for (let i = 0; i < frames.length; i++) {
                    for (let j = i + 1; j < frames.length; j++) {
                        expect(plateauGapMm(frames[i]!, frames[j]!)).toBeGreaterThanOrEqual(
                            PLATEAU_GAP_MM - 1e-4,
                        );
                    }
                }
                const first = frames[0]!;
                expect(first.halfWidthMm * 2).toBeCloseTo(SINK_PROFILES.mpj1.widthMm * s, 4);
                expect(first.blendMm).toBe(SINK_PROFILES.mpj1.blendMm);
                for (const frame of frames) {
                    expect(frame.blendMm).toBe(SINK_PROFILES[frame.kind].blendMm);
                    expect(frame.depthMm).toBe(SINK_DEFAULT_DEPTH_MM);
                }
            }
        }
    });

    test("5th MPJ plateau stays inside the lateral edge", () => {
        for (const lengthMm of [247, 297]) {
            const widthMm = 95;
            const outline = rectFoot(lengthMm, widthMm);
            const lateral = widthMm / 2;
            for (const side of SIDES) {
                const row = (["mpj1", "mpj2", "mpj3", "mpj4", "mpj5"] as const).map((kind) =>
                    placed(kind, 2),
                );
                for (const sinks of [[placed("mpj5", 2)], row]) {
                    const ctx = { side, lengthMm, widthMm, sinks, footOutline: outline };
                    const frame = sinkFrame(sinks.find((sink) => sink.kind === "mpj5")!, ctx)!;
                    expect(frame.cy + frame.halfWidthMm).toBeLessThanOrEqual(lateral + 1e-6);
                    expect(frame.v).toBeCloseTo(SINK_PROFILES.mpj5.v, 3);
                }
            }
        }
    });

    test("reverse kinetic wedge sits 3 mm off the medial edge on both feet", () => {
        const widthMm = 95;
        for (const lengthMm of [247, 297]) {
            const s = lengthMm / SINK_REFERENCE_LENGTH_MM;
            const outline = rectFoot(lengthMm, widthMm);
            const medial = -widthMm / 2;
            const centres: number[] = [];
            for (const side of SIDES) {
                const sink = placed("rkw", 2);
                const ctx = { side, lengthMm, widthMm, sinks: [sink], footOutline: outline };
                const frame = sinkFrame(sink, ctx)!;
                expect(frame.halfLengthMm * 2).toBeCloseTo(40 * s, 4);
                expect(frame.halfWidthMm * 2).toBeCloseTo(23 * s, 4);
                expect(frame.cx).toBeCloseTo(0.68 * lengthMm, 3);
                expect(frame.cy - frame.halfWidthMm).toBeCloseTo(medial + RKW_MEDIAL_INSET_MM, 3);
                expect(frame.dx).toBeCloseTo(frame.cx - 3, 2);
                expect(frame.dy).toBeCloseTo(frame.cy, 2);
                expect(frame.rotationDeg).toBeCloseTo(0, 5);
                centres.push(frame.cy);
            }
            expect(centres[0]).toBeCloseTo(centres[1]!, 3);
        }
    });

    test("1st MPJ and the reverse kinetic wedge overlap by the deeper cut only", () => {
        const mpj = placed("mpj1", 4, "mpj");
        const wedge = placed("rkw", 2, "rkw");
        const outline = rectFoot(260, 95);
        const ctx = {
            side: "right" as const,
            lengthMm: 260,
            widthMm: 95,
            sinks: [mpj, wedge],
            footOutline: outline,
        };
        const frame = sinkFrame(mpj, ctx)!;
        const cut = sinkCutMm(frame.dx, frame.dy, ctx);
        expect(cut.mm).toBeCloseTo(4, 2);
        expect(cut.sinkId).toBe("mpj");
        const thick = sinkThicknessMm(frame.dx, frame.dy, ctx);
        expect(thick).toBeCloseTo(4.5, 2);
        expect(thick).toBeLessThan(6);
        const wedgeFrame = sinkFrame(wedge, ctx)!;
        const wedgeOnly = sinkCutMm(wedgeFrame.dx, wedgeFrame.dy, {
            ...ctx,
            sinks: [wedge],
        });
        expect(wedgeOnly.mm).toBeCloseTo(2, 2);
        const shared = sinkCutMm(wedgeFrame.dx, wedgeFrame.dy, ctx);
        expect(shared.mm).toBeCloseTo(4, 2);
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

    test("floor guard holds 2 mm and the wall guard holds 2 mm", () => {
        const floor = applyFloorGuard(2.4, 1.2, "mpj1");
        expect(floor.cutMm).toBeCloseTo(0.4, 6);
        expect(floor.warning?.code).toBe("floor");
        const ok = applyFloorGuard(6, 2, "mpj1");
        expect(ok.cutMm).toBe(2);
        expect(ok.warning).toBeUndefined();
        const wall = guardedRimLowering(4, 2, 0);
        expect(wall.warning).toBe(false);
        expect(wall.lowering).toBeCloseTo(2, 6);
        const aboveBed = guardedRimLowering(8, 4, 5);
        expect(aboveBed.warning).toBe(true);
        expect(aboveBed.lowering).toBeCloseTo(1, 6);
        const clearance = guardedRimLowering(10, 4, 6);
        expect(clearance.warning).toBe(true);
        expect(clearance.lowering).toBeCloseTo(2, 6);
    });

    test("wall relief keeps 2 mm above the inboard footbed", () => {
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
        expect(positions[2]).toBeGreaterThanOrEqual(5 + LATERAL_WALL_MIN_MM - 1e-3);
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
        expect(sinkCutMm(frame.cx, frame.cy, ctx, 0).mm).toBe(0);
        expect(sinkCutMm(frame.cx, frame.cy, ctx, 0.04).mm).toBeGreaterThan(3.9);
        expect(sinkCutMm(frame.cx, frame.cy, ctx, 0.1).mm).toBeGreaterThan(3.9);
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

    test("styloid wall relief fades below the floor and does not notch a cleared rim", () => {
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
        expect(moved).toBe(false);
    });

    test("styloid rim shifts medially to keep 4 mm and mirrors rotation on the left", () => {
        for (const side of SIDES) {
            const sink = placed("styloid", 2);
            const ctx = surface(9, side, [sink]);
            const frame = sinkFrame(sink, ctx)!;
            expect(frame.rimBlocked).toBe(false);
            expect(frame.rimMarginMm).toBeGreaterThanOrEqual(STYLOID_RIM_CLEAR_MM - 1e-4);
            expect(frame.rimMarginMm).toBeLessThan(STYLOID_RIM_CLEAR_MM + 0.05);
            expect(frame.rimShiftMm).toBeGreaterThan(1);
            expect(frame.v).toBeLessThan(0.95);
            expect(frame.rotationDeg).toBe(side === "left" ? -STYLOID_ROTATION_DEG : STYLOID_ROTATION_DEG);
            expect(vSignedFromSpecV(0.95, "left")).toBeCloseTo(-vSignedFromSpecV(0.95, "right"), 6);
            const cut = sinkCutMm(frame.dx, frame.dy, ctx);
            expect(cut.mm).toBeCloseTo(2, 2);
            expect(sinkRimWarnings(ctx)).toHaveLength(0);
        }
    });

    test("styloid rim warns under 4 mm and hard-stops under 3 mm unless overridden to 2 mm", () => {
        const sink = placed("styloid", 2);
        const wide = surface(9, "right", [sink]);
        const halfAt = (widthMm: number) => {
            const ctx = { ...wide, widthMm, sinks: [sink] };
            return sinkFrame(sink, ctx)!;
        };
        let warnWidth = 0;
        let stopWidth = 0;
        for (let width = 95; width >= 20; width -= 1) {
            const frame = halfAt(width);
            if (!warnWidth && frame.rimWarning?.code === "rim") warnWidth = width;
            if (!stopWidth && frame.rimBlocked) stopWidth = width;
        }
        expect(warnWidth).toBeGreaterThan(0);
        expect(stopWidth).toBeGreaterThan(0);
        expect(stopWidth).toBeLessThan(warnWidth);
        const warned = halfAt(warnWidth);
        expect(warned.rimBlocked).toBe(false);
        expect(warned.rimMarginMm).toBeLessThan(STYLOID_RIM_CLEAR_MM);
        expect(warned.rimMarginMm).toBeGreaterThanOrEqual(STYLOID_RIM_HARD_MM - 0.05);
        const stopped = halfAt(stopWidth);
        expect(stopped.rimMarginMm).toBeLessThan(STYLOID_RIM_HARD_MM);
        expect(sinkCutMm(stopped.dx, stopped.dy, { ...wide, widthMm: stopWidth, sinks: [sink] }).mm).toBe(0);
        const override = { ...sink, rimOverride: true };
        const overridden = sinkFrame(override, { ...wide, widthMm: stopWidth, sinks: [override] })!;
        if (overridden.rimMarginMm >= STYLOID_RIM_OVERRIDE_FLOOR_MM) {
            expect(overridden.rimBlocked).toBe(false);
            expect(
                sinkCutMm(overridden.dx, overridden.dy, { ...wide, widthMm: stopWidth, sinks: [override] })
                    .mm,
            ).toBeGreaterThan(1);
        }
        const tiny = sinkFrame(override, { ...wide, widthMm: 20, sinks: [override] })!;
        expect(tiny.rimMarginMm).toBeLessThan(STYLOID_RIM_OVERRIDE_FLOOR_MM);
        expect(tiny.rimBlocked).toBe(true);
        expect(tiny.rimWarning?.code).toBe("rim-hard-stop");
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
