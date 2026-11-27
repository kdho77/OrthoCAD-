// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import {
    applyBaseModifiers,
    BASE_REFERENCE_THICKNESS_MM,
    classifyBaseTopFactors,
    detectArchSideSign,
    hasActiveModifiers,
} from "@/lib/geometry/base-modifier";
import { constrainSideCorrections } from "@/lib/geometry/clinical-constraints";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { migrateSideCorrections } from "@/lib/geometry/migrate-corrections";
import { composeViewerPrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import {
    extractMergedGeometry,
    loadGlbFromBuffer,
    mirrorGeometry,
    reorientToFootprintFrame,
} from "@/lib/library/loaders";
import type { DesignState, Side, SideCorrections } from "@/types";
import {
    ARCH_PROFILE_BULGE_MM,
    ARCH_PROFILE_CAP_MM,
    ARCH_PROFILE_VALLEY_BLEND_MM,
    type ArchSection,
    archProfileEnvelope,
    archProfileValleyBlend,
    archProfileValleyBlendFraction,
    fairedMedialArchSection,
    measureArchSection,
    medialCoordinate,
    vSignedFromMedial,
} from "./arch-profile";
import { type HeightFieldParams, heightAt, outlineHalfWidth } from "./height-field";

const layout = insoleLayoutForUsMenSize(9);

function zeros(patch: Partial<SideCorrections> = {}): SideCorrections {
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
        ...patch,
    };
}

function field(side: Side, patch: Partial<SideCorrections>, thicknessMm = 3): HeightFieldParams {
    return {
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm,
        corrections: zeros(patch),
        elements: [],
    };
}

function sectionAt(u: number, side: Side, patch: Partial<SideCorrections>, thicknessMm = 3): ArchSection {
    const cradled = field(side, { ...patch, archProfile: undefined }, thicknessMm);
    const section = fairedMedialArchSection(u, side, (uu, vv) => heightAt(uu, vv, cradled));
    if (!section) throw new Error(`no arch section at u=${u}`);
    return section;
}

/** Physical valley-to-trimline span. Matches the half-width `heightAt` passes in. */
function spanMmOf(u: number, section: ArchSection): number {
    return (section.mRim - section.mValley) * outlineHalfWidth(u) * (layout.widthMm / 2);
}

function zAt(u: number, m: number, side: Side, patch: Partial<SideCorrections>, thicknessMm = 3): number {
    return heightAt(u, vSignedFromMedial(m, side), field(side, patch, thicknessMm));
}

describe("arch profile slider", () => {
    test("100 and undefined leave the height field unchanged", () => {
        for (const side of ["left", "right"] as const) {
            for (let ui = 0; ui <= 20; ui++) {
                for (let vi = 0; vi <= 16; vi++) {
                    const u = ui / 20;
                    const v = vi / 8 - 1;
                    const params = field(side, { archHeightMm: 6, heelCupDepthMm: 14, apexMoveMm: 4 });
                    const omitted = heightAt(u, v, params);
                    const cradled = heightAt(u, v, {
                        ...params,
                        corrections: { ...params.corrections, archProfile: 100 },
                    });
                    expect(cradled).toBe(omitted);
                }
            }
        }
    });

    test("transverse profile at u=0.42 goes cradled → chord → domed", () => {
        const side: Side = "left";
        const u = 0.42;
        const section = sectionAt(u, side, {});
        const mAt = (s: number) => section.mValley + s * (section.mRim - section.mValley);
        const chordAt = (s: number) => (1 - s) * section.zValley + s * section.zRim;
        const height = (s: number, profile: number | undefined) =>
            zAt(u, mAt(s), side, profile == null ? {} : { archProfile: profile });

        const dzRim = section.zRim - section.zValley;
        const amp = Math.min(ARCH_PROFILE_BULGE_MM, Math.max(0, dzRim / 4));
        const env = archProfileEnvelope(u, 0, layout.lengthMm, 0);
        const onChord = (s: number, profile: number) => {
            const zCur = height(s, 100);
            const chord = chordAt(s);
            const bulge = 4 * amp * s * (1 - s);
            const w = archProfileValleyBlend(s, spanMmOf(u, section));
            if (profile >= 50) {
                const t = (100 - profile) / 50;
                return zCur + env * t * (chord - zCur) * w;
            }
            const c = (50 - profile) / 50;
            return zCur + env * w * (chord - zCur + c * bulge);
        };
        for (const s of [0.2, 0.35, 0.5, 0.65]) {
            for (const profile of [0, 25, 50, 75]) {
                expect(height(s, profile)).toBeCloseTo(onChord(s, profile), 2);
            }
        }
        const dome = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95].map((s) => height(s, 0));
        for (let i = 1; i < dome.length; i++) {
            expect(dome[i]!).toBeGreaterThan(dome[i - 1]!);
        }
        const crown = height(0.5, 0) - chordAt(0.5);
        const zCurMid = height(0.5, 100);
        const expectedCrown = (1 - env) * (zCurMid - chordAt(0.5)) + env * amp;
        expect(crown).toBeCloseTo(expectedCrown, 2);
        expect(crown).toBeLessThanOrEqual(ARCH_PROFILE_CAP_MM + 1e-6);
        expect(height(0.5, 0)).toBeGreaterThan(height(0.5, 50));
        expect(height(0.5, 0)).toBeGreaterThan((height(0.35, 0) + height(0.65, 0)) / 2);
    });

    test("midspan rises from the chord to the dome as the slider leaves Neutral", () => {
        const u = 0.43;
        const section = sectionAt(u, "right", { archHeightMm: 8 });
        const midM = (section.mValley + section.mRim) / 2;
        const zAtProfile = (profile: number) =>
            zAt(u, midM, "right", { archHeightMm: 8, archProfile: profile });
        const chord = (section.zValley + section.zRim) / 2;
        expect(Math.abs(zAtProfile(50) - chord)).toBeLessThan(0.02);
        let prev = zAtProfile(50);
        for (const profile of [25, 0]) {
            const z = zAtProfile(profile);
            expect(z).toBeGreaterThan(prev + 1e-3);
            prev = z;
        }
        const amp = Math.min(ARCH_PROFILE_BULGE_MM, Math.max(0, (section.zRim - section.zValley) / 4));
        expect(zAtProfile(0) - chord).toBeCloseTo(amp, 2);
    });

    test("valley floor and medial rim stay fixed, and the heel and forefoot do not move", () => {
        for (const side of ["left", "right"] as const) {
            const patch = { archHeightMm: 8, heelCupDepthMm: 14, thicknessMm: 4 };
            const section = sectionAt(0.42, side, { archHeightMm: 8, heelCupDepthMm: 14 }, 4);
            for (const profile of [0, 50, 100]) {
                const moved = { archHeightMm: 8, heelCupDepthMm: 14, archProfile: profile };
                expect(zAt(0.42, section.mValley, side, moved, 4)).toBe(
                    zAt(0.42, section.mValley, side, patch, 4),
                );
                expect(zAt(0.42, section.mRim, side, moved, 4)).toBe(zAt(0.42, section.mRim, side, patch, 4));
                expect(Math.abs(zAt(0.42, 0, side, moved, 4) - zAt(0.42, 0, side, patch, 4))).toBeLessThan(
                    0.05,
                );
                expect(
                    Math.abs(zAt(0.42, -0.6, side, moved, 4) - zAt(0.42, -0.6, side, patch, 4)),
                ).toBeLessThan(0.05);
                for (const u of [0.05, 0.15, 0.28, 0.58, 0.62, 0.75]) {
                    for (const m of [-0.4, 0, 0.45, 0.8]) {
                        expect(zAt(u, m, side, moved, 4)).toBe(zAt(u, m, side, patch, 4));
                    }
                }
            }
            // Nominal rim height still tracks arch height; the slider does not add to it.
            const lowRim = sectionAt(0.42, side, { archHeightMm: 0 }, 4).zRim;
            const highRim = sectionAt(0.42, side, { archHeightMm: 8 }, 4).zRim;
            expect(highRim).toBeGreaterThan(lowRim + 1);
        }
    });

    test("apex shift and elongation stay inside the heel cup and the 1st MPJ", () => {
        for (const apexMoveMm of [-12, 0, 12]) {
            for (const archElongationMm of [0, 5]) {
                for (const u of [0.1, 0.2, 0.28, 0.58, 0.62, 0.8]) {
                    expect(archProfileEnvelope(u, apexMoveMm, layout.lengthMm, archElongationMm)).toBe(0);
                    const base = zAt(u, 0.5, "left", { apexMoveMm, archElongationMm, archHeightMm: 6 });
                    const domed = zAt(u, 0.5, "left", {
                        apexMoveMm,
                        archElongationMm,
                        archHeightMm: 6,
                        archProfile: 0,
                    });
                    expect(domed).toBe(base);
                }
            }
        }
        const bell = Array.from({ length: 61 }, (_, i) =>
            archProfileEnvelope(0.28 + (0.3 * i) / 60, 0, layout.lengthMm, 0),
        );
        expect(bell[0]).toBe(0);
        expect(bell[bell.length - 1]).toBe(0);
        expect(archProfileEnvelope(0.43, 0, layout.lengthMm, 0)).toBe(1);
        expect(archProfileEnvelope(0.38, 0, layout.lengthMm, 0)).toBeLessThan(0.9);
        expect(archProfileEnvelope(0.48, 0, layout.lengthMm, 0)).toBeLessThan(0.9);
        let peaks = 0;
        for (let i = 1; i < bell.length - 1; i++) {
            if (bell[i]! >= bell[i - 1]! && bell[i]! > bell[i + 1]!) peaks++;
        }
        expect(peaks).toBe(1);
    });

    test("domed crown is the parabola amplitude and never exceeds 5 mm above the chord", () => {
        for (const archHeightMm of [0, 8, 14]) {
            let maxAbove = -Infinity;
            for (let ui = 0; ui <= 30; ui++) {
                const u = 0.28 + (0.3 * ui) / 30;
                const section = sectionAt(u, "left", { archHeightMm, heelCupDepthMm: 12 }, 6);
                for (let i = 1; i < 24; i++) {
                    const s = i / 24;
                    const m = section.mValley + s * (section.mRim - section.mValley);
                    const z = zAt(u, m, "left", { archHeightMm, heelCupDepthMm: 12, archProfile: 0 }, 6);
                    const chord = (1 - s) * section.zValley + s * section.zRim;
                    maxAbove = Math.max(maxAbove, z - chord);
                }
            }
            const crest = sectionAt(0.43, "left", { archHeightMm, heelCupDepthMm: 12 }, 6);
            const amp = Math.min(ARCH_PROFILE_BULGE_MM, Math.max(0, (crest.zRim - crest.zValley) / 4));
            const mid = (crest.mValley + crest.mRim) / 2;
            const zMid = zAt(0.43, mid, "left", { archHeightMm, heelCupDepthMm: 12, archProfile: 0 }, 6);
            const chordMid = (crest.zValley + crest.zRim) / 2;
            expect(zMid - chordMid).toBeCloseTo(amp, 2);
            expect(amp).toBeLessThanOrEqual(ARCH_PROFILE_BULGE_MM);
            expect(zMid - chordMid).toBeLessThanOrEqual(ARCH_PROFILE_CAP_MM + 1e-6);
            expect(maxAbove).toBeGreaterThan(0);
        }
    });

    test("left and right match, and the transverse section stays smooth", () => {
        for (const profile of [0, 50, 100]) {
            let maxSecond = 0;
            for (let ui = 0; ui <= 12; ui++) {
                const u = 0.3 + (0.26 * ui) / 12;
                const left = sectionAt(u, "left", { archProfile: profile, archHeightMm: 4 });
                for (let i = 0; i <= 20; i++) {
                    const m = left.mValley + (i / 20) * (left.mRim - left.mValley);
                    const zl = zAt(u, m, "left", { archProfile: profile, archHeightMm: 4 });
                    const zr = zAt(u, m, "right", { archProfile: profile, archHeightMm: 4 });
                    expect(Math.abs(zl - zr)).toBeLessThan(1e-6);
                }
                const zs: number[] = [];
                for (let i = 0; i <= 40; i++) {
                    const m = left.mValley + (i / 40) * (left.mRim - left.mValley);
                    zs.push(zAt(u, m, "left", { archProfile: profile, archHeightMm: 4 }));
                }
                for (let i = 1; i < zs.length - 1; i++) {
                    maxSecond = Math.max(maxSecond, Math.abs(zs[i - 1]! - 2 * zs[i]! + zs[i + 1]!));
                }
            }
            // A crease would jump by millimetres between 1/40 of the span.
            expect(maxSecond).toBeLessThan(1.25);
        }
        expect(medialCoordinate(0.4, "left")).toBeCloseTo(medialCoordinate(-0.4, "right"), 9);
        const spanMm = 40;
        expect(archProfileValleyBlend(0, spanMm)).toBe(0);
        expect(archProfileValleyBlend(1, spanMm)).toBe(1);
        const blendS = archProfileValleyBlendFraction(spanMm);
        expect(blendS * spanMm).toBeCloseTo(ARCH_PROFILE_VALLEY_BLEND_MM, 6);
        expect(archProfileValleyBlend(blendS, spanMm)).toBeCloseTo(1, 8);
        expect(archProfileValleyBlend(blendS * 0.5, spanMm)).toBeGreaterThan(0.05);
        expect(archProfileValleyBlend(blendS * 0.5, spanMm)).toBeLessThan(0.95);
        // 12 mm on a 40 mm span is wider than the old 0.14 window, which was one facet.
        expect(archProfileValleyBlend(0.14, spanMm)).toBeLessThan(0.5);
        const h = 1e-4;
        const d1 = archProfileValleyBlend(h, spanMm) - archProfileValleyBlend(0, spanMm);
        const d2 =
            archProfileValleyBlend(0, spanMm) -
            2 * archProfileValleyBlend(h, spanMm) +
            archProfileValleyBlend(2 * h, spanMm);
        expect(Math.abs(d1)).toBeLessThan(1e-6);
        expect(Math.abs(d2)).toBeLessThan(1e-6);
    });

    test("procedural solids stay watertight across the slider", () => {
        const combos: Partial<SideCorrections>[] = [
            {},
            { archHeightMm: 8 },
            { heelCupDepthMm: 14 },
            { archHeightMm: 8, heelCupDepthMm: 14 },
        ];
        for (const side of ["left", "right"] as const) {
            for (const profile of [0, 25, 50, 75, 100]) {
                for (const patch of combos) {
                    for (const thicknessMm of [2, 4]) {
                        const geometry = buildInsoleGeometry({
                            side,
                            lengthMm: layout.lengthMm,
                            widthMm: layout.widthMm,
                            thicknessMm,
                            corrections: zeros({ ...patch, archProfile: profile }),
                            segmentsX: 36,
                            segmentsY: 18,
                        });
                        const mesh = analyzeManifold(geometry);
                        expect(mesh.isWatertight).toBe(true);
                        expect(mesh.openEdges).toBe(0);
                        expect(mesh.nonManifoldEdges).toBe(0);
                    }
                }
            }
        }
    });

    test("preview and export meshes match, and a base sheet domes without moving the pinned ends", () => {
        const baseParams = {
            side: "left" as const,
            lengthMm: layout.lengthMm,
            widthMm: layout.widthMm,
            thicknessMm: BASE_REFERENCE_THICKNESS_MM,
            corrections: zeros(),
            segmentsX: 36,
            segmentsY: 18,
        };
        const preview = buildInsoleGeometry({ ...baseParams, corrections: zeros({ archProfile: 0 }) });
        const again = buildInsoleGeometry({ ...baseParams, corrections: zeros({ archProfile: 0 }) });
        const previewPos = preview.getAttribute("position")!.array as Float32Array;
        const againPos = again.getAttribute("position")!.array as Float32Array;
        for (let i = 0; i < previewPos.length; i++) expect(againPos[i]).toBe(previewPos[i]);

        const stock = buildInsoleGeometry(baseParams);
        const modifierField = (profile: number | undefined) =>
            field("left", profile == null ? {} : { archProfile: profile }, BASE_REFERENCE_THICKNESS_MM);
        const cradled = applyBaseModifiers(stock, modifierField(undefined), 0);
        const explicit = applyBaseModifiers(stock, modifierField(100), 0);
        const domed = applyBaseModifiers(stock, modifierField(0), 0, { skipNormals: true });
        const domedExport = applyBaseModifiers(stock, modifierField(0), 0);
        const cradledPos = cradled.getAttribute("position")!.array as Float32Array;
        const explicitPos = explicit.getAttribute("position")!.array as Float32Array;
        const domedPos = domed.getAttribute("position")!.array as Float32Array;
        const exportPos = domedExport.getAttribute("position")!.array as Float32Array;
        for (let i = 0; i < cradledPos.length; i++) {
            expect(explicitPos[i]).toBe(cradledPos[i]);
            expect(exportPos[i]).toBe(domedPos[i]);
        }

        const pos = stock.getAttribute("position")!.array as Float32Array;
        let risen = 0;
        let pinned = 0;
        const len = layout.lengthMm;
        for (let i = 0; i < pos.length / 3; i++) {
            const u = pos[i * 3]! / len;
            const dz = domedPos[i * 3 + 2]! - cradledPos[i * 3 + 2]!;
            if (u <= 0.28 || u >= 0.58) {
                expect(dz).toBe(0);
                continue;
            }
            if (dz > risen) risen = dz;
            if (Math.abs(dz) <= 0.05) pinned++;
        }
        expect(risen).toBeGreaterThan(1);
        expect(pinned).toBeGreaterThan(10);
        const mesh = analyzeManifold(domedExport);
        expect(mesh.isWatertight).toBe(true);
    });

    test("default profile is not an active modifier, and constraints keep an omitted value omitted", () => {
        const design = {
            corrections: {
                unit: "mm",
                linked: true,
                left: zeros(),
                right: zeros({ archProfile: 100 }),
            },
            elements: [],
        } as unknown as DesignState;
        expect(hasActiveModifiers(design)).toBe(false);
        expect(
            hasActiveModifiers({
                ...design,
                corrections: { ...design.corrections, left: zeros({ archProfile: 0 }) },
            }),
        ).toBe(true);

        const kept = constrainSideCorrections(zeros(), 3);
        expect(kept.constrained.archProfile).toBeUndefined();
        const clamped = constrainSideCorrections(zeros({ archProfile: 140 }), 3);
        expect(clamped.constrained.archProfile).toBe(100);
        const domed = constrainSideCorrections(zeros({ archProfile: -4 }), 3);
        expect(domed.constrained.archProfile).toBe(0);

        const migrated = migrateSideCorrections(zeros({ archProfile: Number.NaN }));
        expect(migrated.archProfile).toBeUndefined();
        const stored = migrateSideCorrections(zeros({ archProfile: 40 }));
        expect(stored.archProfile).toBe(40);
    });

    test("SAMPLE_Top open sheet bows, and cradled is unchanged", async () => {
        const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
        const sheet = await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        expect(classifyBaseTopFactors(sheet)).toBeNull();
        const userData = sheet.userData as { isMultiMeshBase?: boolean; topVertexCount?: number };
        expect(userData.isMultiMeshBase ?? false).toBe(false);
        expect(userData.topVertexCount ?? 0).toBe(0);

        if (!sheet.boundingBox) sheet.computeBoundingBox();
        const box = sheet.boundingBox!;
        const min = [box.min.x, box.min.y, box.min.z];
        const size = [box.max.x - box.min.x || 1, box.max.y - box.min.y || 1, box.max.z - box.min.z || 1];
        const axes = [0, 1, 2].sort((a, b) => size[a]! - size[b]!);
        const thickAxis = axes[0]!;
        const widthAxis = axes[1]!;
        const lengthAxis = axes[2]!;
        const lenMin = min[lengthAxis]!;
        const lenSize = size[lengthAxis]!;
        const widCenter = min[widthAxis]! + size[widthAxis]! / 2;
        const halfW = size[widthAxis]! / 2;
        const medialSign = -1;
        const widthSign = -(detectArchSideSign(sheet) * medialSign);
        const src = sheet.getAttribute("position")!.array as Float32Array;

        const run = (profile: number | undefined) =>
            applyBaseModifiers(
                sheet,
                field("left", profile == null ? {} : { archProfile: profile }, BASE_REFERENCE_THICKNESS_MM),
                0,
                { skipNormals: true },
            ).getAttribute("position")!.array as Float32Array;
        const omitted = run(undefined);
        const cradled = run(100);
        const neutral = run(50);
        const domed = run(0);

        const count = (src.length / 3) | 0;
        const uOf = (pos: Float32Array, i: number) => (pos[i * 3 + lengthAxis]! - lenMin) / lenSize;
        const mOf = (pos: Float32Array, i: number) => {
            const vNorm = (widthSign * (pos[i * 3 + widthAxis]! - widCenter)) / halfW;
            const vSigned = vNorm < -1 ? -1 : vNorm > 1 ? 1 : vNorm;
            return -(vSigned * medialSign);
        };
        const zOf = (pos: Float32Array, i: number) => pos[i * 3 + thickAxis]!;

        for (let k = 0; k < src.length; k++) {
            expect(omitted[k]).toBe(src[k]);
            expect(cradled[k]).toBe(src[k]);
        }

        let moved = 0;
        let crownRise = 0;
        for (let i = 0; i < count; i++) {
            const u = uOf(src, i);
            const dzDomed = zOf(domed, i) - zOf(src, i);
            const dzNeutral = zOf(neutral, i) - zOf(src, i);
            if (u <= 0.28 || u >= 0.58) {
                expect(dzDomed).toBe(0);
                expect(dzNeutral).toBe(0);
                continue;
            }
            if (dzDomed > 0.2) moved++;
            if (dzDomed > crownRise) crownRise = dzDomed;
        }
        expect(moved).toBeGreaterThan(30);
        expect(crownRise).toBeGreaterThan(1);

        const band: { i: number; m: number; z: number }[] = [];
        for (let i = 0; i < count; i++) {
            if (Math.abs(uOf(src, i) - 0.42) > 0.008) continue;
            band.push({ i, m: mOf(src, i), z: zOf(src, i) });
        }
        expect(band.length).toBeGreaterThan(12);
        const edgeM = Math.max(...band.map((sample) => sample.m));
        const section = measureArchSection([...band].sort((a, b) => a.m - b.m));
        expect(section).toBeTruthy();
        expect(section!.mRim).toBeCloseTo(edgeM, 3);
        expect(section!.mRim).toBeGreaterThan(0.75);
        expect(section!.mRim).toBeLessThan(0.95);
        expect(section!.mValley).toBeGreaterThanOrEqual(0);
        expect(section!.mValley).toBeLessThan(0.06);
        const halfWidthMm = size[widthAxis]! / 2;
        let pinned = 0;
        let rimZ = -Infinity;
        let rimI = -1;
        for (const sample of band) {
            if (sample.m >= section!.mRim - 1e-4 && sample.z > rimZ) {
                rimZ = sample.z;
                rimI = sample.i;
            }
        }
        for (const sample of band) {
            const d0 = zOf(domed, sample.i) - sample.z;
            const d50 = zOf(neutral, sample.i) - sample.z;
            expect(zOf(cradled, sample.i) - sample.z).toBe(0);
            if (sample.m <= section!.mValley + 1e-6 || sample.i === rimI) {
                expect(d0).toBe(0);
                expect(d50).toBe(0);
                pinned++;
            }
        }
        expect(pinned).toBeGreaterThan(0);
        expect(rimZ).toBeCloseTo(section!.zRim, 3);

        const slice: { i: number; m: number; z: number }[] = [];
        for (let i = 0; i < count; i++) {
            if (Math.abs(uOf(src, i) - 0.42) > 0.004) continue;
            slice.push({ i, m: mOf(src, i), z: zOf(src, i) });
        }
        expect(slice.length).toBeGreaterThan(8);
        const sliceSection = measureArchSection([...slice].sort((a, b) => a.m - b.m))!;
        const sliceSpan = sliceSection.mRim - sliceSection.mValley;
        const bins = 36;
        const topZ = (pos: Float32Array) => {
            const z = Array.from({ length: bins }, () => -Infinity);
            const mAt = Array.from({ length: bins }, () => 0);
            for (const sample of slice) {
                const s = (sample.m - sliceSection.mValley) / sliceSpan;
                if (s < 0 || s > 1) continue;
                const bi = Math.min(bins - 1, Math.max(0, Math.floor(s * (bins - 1))));
                const zHere = zOf(pos, sample.i);
                if (zHere > z[bi]!) {
                    z[bi] = zHere;
                    mAt[bi] = sample.m;
                }
            }
            return { z, mAt };
        };
        const stockTop = topZ(src);
        const domedTop = topZ(domed);
        let prev = -Infinity;
        let rises = 0;
        let worstDip = 0;
        for (let bi = 0; bi < bins; bi++) {
            if (!Number.isFinite(domedTop.z[bi])) continue;
            if (domedTop.z[bi]! < prev) worstDip = Math.max(worstDip, prev - domedTop.z[bi]!);
            if (domedTop.z[bi]! > prev + 0.15) rises++;
            prev = domedTop.z[bi]!;
        }
        expect(worstDip).toBeLessThan(0.15);
        expect(rises).toBeGreaterThan(8);

        let flatMm = 0;
        let runM0 = sliceSection.mValley;
        let runZ = stockTop.z.find((z) => Number.isFinite(z)) ?? 0;
        for (let bi = 0; bi < bins; bi++) {
            if (!Number.isFinite(domedTop.z[bi])) continue;
            if (Math.abs(domedTop.z[bi]! - runZ) < 0.15) {
                flatMm = Math.max(flatMm, (domedTop.mAt[bi]! - runM0) * halfWidthMm);
            } else {
                runM0 = domedTop.mAt[bi]!;
                runZ = domedTop.z[bi]!;
            }
        }
        expect(flatMm).toBeLessThan(6);

        const outer: number[] = [];
        for (let bi = 0; bi < bins; bi++) {
            const s = bi / (bins - 1);
            if (s > 0.82 && s < 0.98 && Number.isFinite(domedTop.z[bi]) && Number.isFinite(stockTop.z[bi])) {
                outer.push(bi);
            }
        }
        expect(outer.length).toBeGreaterThan(1);
        const slope = (z: number[], a: number, b: number) => {
            const dm = (domedTop.mAt[b]! - domedTop.mAt[a]!) * halfWidthMm;
            return dm > 0.2 ? (z[b]! - z[a]!) / dm : 0;
        };
        const a = outer[0]!;
        const b = outer[outer.length - 1]!;
        const stockSlope = slope(stockTop.z, a, b);
        const domedSlope = slope(domedTop.z, a, b);
        expect(domedSlope).toBeGreaterThan(-0.05);
        expect(domedSlope).toBeLessThan(stockSlope * 0.45);
    });

    test("faired valley isoline is C2 along the foot", () => {
        for (const side of ["left", "right"] as const) {
            const mValley: number[] = [];
            const zValley: number[] = [];
            const mRim: number[] = [];
            for (let i = 0; i <= 48; i++) {
                const u = 0.3 + (0.26 * i) / 48;
                const section = sectionAt(u, side, { archHeightMm: 6, heelCupDepthMm: 10 }, 4);
                mValley.push(section.mValley);
                zValley.push(section.zValley);
                mRim.push(section.mRim);
            }
            // 49 samples across 0.26 of the foot. A 24-bin hop of ~0.02 in m
            // has a second difference near 0.04. The faired curve must not.
            expect(maxAbsSecond(mValley)).toBeLessThan(0.0025);
            expect(maxAbsThird(mValley)).toBeLessThan(0.001);
            expect(maxAbsSecond(zValley)).toBeLessThan(0.05);
            expect(maxAbsThird(zValley)).toBeLessThan(0.02);
            expect(maxAbsSecond(mRim)).toBeLessThan(0.0025);
            for (let i = 0; i < mValley.length; i++) {
                expect(mRim[i]! - mValley[i]!).toBeGreaterThan(0.12);
            }
        }
    });

    test("SAMPLE_Top valley fillet has no sawtooth seam", async () => {
        const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const group = await loadGlbFromBuffer(buffer);
        const merged = extractMergedGeometry(group);
        if (!merged) throw new Error("SAMPLE_Top.glb produced no geometry");
        const sheet = reorientToFootprintFrame(merged.geometry, { preserveAuthorZ: true });
        merged.geometry.dispose();
        // Same bytes the production helper parses. Guards a drift in that helper.
        const viaHelper = await sampleTopFromArrayBuffer(buffer.slice(0));
        expect(viaHelper.getAttribute("position")!.count).toBe(sheet.getAttribute("position")!.count);

        const profiles = [0, 50] as const;
        for (const side of ["left", "right"] as const) {
            const source = side === "left" ? sheet : mirrorGeometry(sheet);
            for (const profile of profiles) {
                const cradled = deformSample(source, side, undefined);
                const shaped = deformSample(source, side, profile);
                const stats = valleySeamStats(cradled, shaped, side);
                // 12 mm C2 fillet on this triangulation: p95 dihedral stays near
                // 11°. A bin-polyline sawtooth creases the whole valley, so p95
                // and the count of edges steeper than 20° both jump.
                expect(stats.edges).toBeGreaterThan(200);
                expect(stats.p95Deg).toBeLessThan(13);
                expect(stats.edgesOver20).toBeLessThan(18);
                expect(stats.maxDeg).toBeLessThan(stats.stockMaxDeg + 3);
                expect(stats.roughnessMm).toBeLessThan(8);
            }
            if (side === "left") {
                const cradledMesh = await composeViewerPrintSolidTop({
                    raw: source.clone(),
                    sourceField: field("left", {}, BASE_REFERENCE_THICKNESS_MM),
                });
                const domedMesh = await composeViewerPrintSolidTop({
                    raw: source.clone(),
                    sourceField: field("left", { archProfile: 0 }, BASE_REFERENCE_THICKNESS_MM),
                });
                const stats = valleySeamStats(cradledMesh, domedMesh, "left");
                expect(stats.edges).toBeGreaterThan(200);
                expect(stats.p95Deg).toBeLessThan(13);
                expect(stats.edgesOver20).toBeLessThan(18);
                expect(stats.maxDeg).toBeLessThan(stats.stockMaxDeg + 3);
            }
        }
    });
});

function maxAbsSecond(values: number[]): number {
    let max = 0;
    for (let i = 1; i < values.length - 1; i++) {
        max = Math.max(max, Math.abs(values[i - 1]! - 2 * values[i]! + values[i + 1]!));
    }
    return max;
}

function maxAbsThird(values: number[]): number {
    let max = 0;
    for (let i = 1; i < values.length - 2; i++) {
        const a = values[i - 1]! - 2 * values[i]! + values[i + 1]!;
        const b = values[i]! - 2 * values[i + 1]! + values[i + 2]!;
        max = Math.max(max, Math.abs(b - a));
    }
    return max;
}

function deformSample(sheet: import("three").BufferGeometry, side: Side, profile: number | undefined) {
    return applyBaseModifiers(
        sheet,
        field(side, profile == null ? {} : { archProfile: profile }, BASE_REFERENCE_THICKNESS_MM),
        0,
    );
}

interface SeamStats {
    edges: number;
    maxDeg: number;
    p95Deg: number;
    edgesOver20: number;
    stockP95Deg: number;
    stockMaxDeg: number;
    roughnessMm: number;
}

/**
 * Dihedral and longitudinal roughness where the arch leaves the plantar floor.
 * Footprint frame: X length, Y width, Z height. Medial is −Y on the left.
 */
function valleySeamStats(
    stock: import("three").BufferGeometry,
    shaped: import("three").BufferGeometry,
    side: Side,
): SeamStats {
    const stockPos = stock.getAttribute("position")!.array as Float32Array;
    const pos = shaped.getAttribute("position")!.array as Float32Array;
    const index = shaped.getIndex()!.array;
    const count = (pos.length / 3) | 0;
    let lenMin = Infinity;
    let lenMax = -Infinity;
    for (let i = 0; i < count; i++) {
        const x = stockPos[i * 3]!;
        if (x < lenMin) lenMin = x;
        if (x > lenMax) lenMax = x;
    }
    const lenSize = lenMax - lenMin || 1;
    const uOf = (i: number) => (stockPos[i * 3]! - lenMin) / lenSize;
    const dzOf = (i: number) => pos[i * 3 + 2]! - stockPos[i * 3 + 2]!;
    // Medial is −Y on the left and +Y on the right. Keep a few mm past
    // centerline so a valley that sits on m ≈ 0 is inside the band.
    const onMedial = (y: number) => (side === "left" ? y < 8 : y > -8);
    const inBand = (i: number) => {
        const u = uOf(i);
        return u >= 0.36 && u <= 0.48 && onMedial(stockPos[i * 3 + 1]!);
    };
    // Lower arch: off the untouched floor, below the midspan crown.
    const inFillet = (i: number) => {
        if (!inBand(i)) return false;
        const dz = Math.abs(dzOf(i));
        return dz > 0.15 && dz < 2.5;
    };

    const angles: number[] = [];
    const stockAngles: number[] = [];
    let edgesOver20 = 0;
    // SAMPLE_Top keeps duplicate vertices along triangle edges, so index
    // adjacency misses the seam. Match edges that occupy the same stock segment.
    const edgeFaces = new Map<string, number[]>();
    const quant = (v: number) => Math.round(v * 20);
    const pointKey = (i: number) =>
        `${quant(stockPos[i * 3]!)}:${quant(stockPos[i * 3 + 1]!)}:${quant(stockPos[i * 3 + 2]!)}`;
    for (let t = 0; t + 2 < index.length; t += 3) {
        const tri = [index[t]!, index[t + 1]!, index[t + 2]!];
        const keys = tri.map(pointKey);
        for (let e = 0; e < 3; e++) {
            const ka = keys[e]!;
            const kb = keys[(e + 1) % 3]!;
            const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
            const list = edgeFaces.get(k);
            if (list) list.push(t);
            else edgeFaces.set(k, [t]);
        }
    }
    for (const faces of edgeFaces.values()) {
        if (faces.length !== 2) continue;
        const t0 = faces[0]!;
        const t1 = faces[1]!;
        const tri0 = [index[t0]!, index[t0 + 1]!, index[t0 + 2]!];
        if (!tri0.some(inFillet)) continue;
        const n1 = triNormal(pos, index, t0);
        const n2 = triNormal(pos, index, t1);
        if (!n1 || !n2) continue;
        const deg = normalAngleDeg(n1, n2);
        angles.push(deg);
        if (deg > 20) edgesOver20++;
        const s1 = triNormal(stockPos, index, t0);
        const s2 = triNormal(stockPos, index, t1);
        if (s1 && s2) stockAngles.push(normalAngleDeg(s1, s2));
    }

    angles.sort((p, q) => p - q);
    stockAngles.sort((p, q) => p - q);
    const p95 = (sorted: number[]) => {
        if (sorted.length === 0) return 0;
        return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
    };
    // Y of the vertex nearest |dz| = 0.4 mm. Mesh rows are a few millimetres
    // apart, so this only fails a multi-centimetre zigzag. The dihedral is
    // the crease check.
    const bins = 24;
    const bestGap = new Array<number>(bins).fill(Infinity);
    const bestY = new Array<number>(bins).fill(Number.NaN);
    for (let i = 0; i < count; i++) {
        const u = uOf(i);
        if (u < 0.36 || u > 0.48) continue;
        const y = stockPos[i * 3 + 1]!;
        // The valley sits near the centerline. The medial rim is much farther out
        // and would make this isoline jump between unrelated vertices.
        const nearValley = side === "left" ? y < 6 && y > -18 : y > -6 && y < 18;
        if (!nearValley) continue;
        const gap = Math.abs(Math.abs(dzOf(i)) - 0.4);
        if (gap > 0.35) continue;
        const bi = Math.min(bins - 1, Math.max(0, Math.floor(((u - 0.36) / 0.12) * bins)));
        if (gap < bestGap[bi]!) {
            bestGap[bi] = gap;
            bestY[bi] = stockPos[i * 3 + 1]!;
        }
    }
    const yAlong = bestY.filter((y) => Number.isFinite(y));
    let rough = 0;
    let roughN = 0;
    for (let i = 1; i < yAlong.length - 1; i++) {
        rough += (yAlong[i - 1]! - 2 * yAlong[i]! + yAlong[i + 1]!) ** 2;
        roughN++;
    }
    return {
        edges: angles.length,
        maxDeg: angles.length ? angles[angles.length - 1]! : 0,
        p95Deg: p95(angles),
        edgesOver20,
        stockP95Deg: p95(stockAngles),
        stockMaxDeg: stockAngles.length ? stockAngles[stockAngles.length - 1]! : 0,
        roughnessMm: roughN > 0 ? Math.sqrt(rough / roughN) : 0,
    };
}

function triNormal(
    pos: Float32Array,
    index: ArrayLike<number>,
    tri: number,
): [number, number, number] | null {
    return faceNormal(pos, index[tri]!, index[tri + 1]!, index[tri + 2]!);
}

function faceNormal(pos: Float32Array, ia: number, ib: number, ic: number): [number, number, number] | null {
    const ax = pos[ia * 3]!;
    const ay = pos[ia * 3 + 1]!;
    const az = pos[ia * 3 + 2]!;
    const bx = pos[ib * 3]! - ax;
    const by = pos[ib * 3 + 1]! - ay;
    const bz = pos[ib * 3 + 2]! - az;
    const cx = pos[ic * 3]! - ax;
    const cy = pos[ic * 3 + 1]! - ay;
    const cz = pos[ic * 3 + 2]! - az;
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-8)) return null;
    return [nx / len, ny / len, nz / len];
}

function normalAngleDeg(a: [number, number, number], b: [number, number, number]): number {
    const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    return (Math.acos(dot) * 180) / Math.PI;
}
