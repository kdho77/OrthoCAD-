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
    archProfileCrestHold,
    archProfileEnvelope,
    archProfileValleyBlend,
    archProfileValleyBlendFraction,
    fairedMedialArchSection,
    measureAnatomicalApex,
    measureArchSection,
    measureLoadedArchApex,
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
        const apexU = measureAnatomicalApex(side, (uu, vv) => heightAt(uu, vv, field(side, {}))).u;
        const env = archProfileEnvelope(u, apexU);
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
        // s = 0.5 is still the pure crown. Past 0.52 the Hermite returns to the
        // crest, so those stations are not on the chord.
        for (const s of [0.2, 0.35, 0.5]) {
            for (const profile of [0, 25, 50, 75]) {
                expect(height(s, profile)).toBeCloseTo(onChord(s, profile), 2);
            }
        }
        const sCrest = (section.mCrest - section.mValley) / (section.mRim - section.mValley);
        const crestM =
            section.mValley + Math.min(Math.max(sCrest, 0), 0.999) * (section.mRim - section.mValley);
        expect(
            Math.abs(zAt(u, crestM, side, { archProfile: 0 }) - zAt(u, crestM, side, {})),
        ).toBeLessThanOrEqual(0.05);
        const crown = height(0.5, 0) - chordAt(0.5);
        const zCurMid = height(0.5, 100);
        const expectedCrown = (1 - env) * (zCurMid - chordAt(0.5)) + env * amp;
        expect(crown).toBeCloseTo(expectedCrown, 2);
        expect(crown).toBeLessThanOrEqual(ARCH_PROFILE_CAP_MM + 1e-6);
        expect(height(0.5, 0)).toBeGreaterThan(height(0.5, 50));
        expect(height(0.5, 0)).toBeGreaterThan(height(0.35, 0));
    });

    test("midspan rises from the chord to the dome as the slider leaves Neutral", () => {
        const u = measureAnatomicalApex("right", (uu, vv) =>
            heightAt(uu, vv, field("right", { archHeightMm: 8 })),
        ).u;
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
        // Shell sampling of the crest return sits a few thousandths under the
        // pure parabola. The crown is still the 4 mm amplitude, not a new shape.
        expect(Math.abs(zAtProfile(0) - chord - amp)).toBeLessThan(0.02);
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

    test("the longitudinal bell is broad, single-peaked, and ignores apex shift and elongation", () => {
        for (const apexU of [0.32, 0.4, 0.43, 0.5, 0.54]) {
            for (const u of [0.1, 0.2, 0.28, 0.58, 0.62, 0.8]) {
                expect(archProfileEnvelope(u, apexU)).toBe(0);
            }
            expect(archProfileEnvelope(apexU, apexU)).toBe(1);
            const bell = Array.from({ length: 121 }, (_, i) =>
                archProfileEnvelope(0.28 + (0.3 * i) / 120, apexU),
            );
            expect(bell[0]).toBe(0);
            expect(bell[bell.length - 1]).toBe(0);
            let peaks = 0;
            for (let i = 1; i < bell.length - 1; i++) {
                if (bell[i]! >= bell[i - 1]! && bell[i]! > bell[i + 1]!) peaks++;
            }
            expect(peaks).toBe(1);
            if (Math.abs(apexU - 0.43) < 1e-9) {
                const half = bell.map((e, i) => ({ e, u: 0.28 + (0.3 * i) / 120 })).filter((s) => s.e >= 0.5);
                const fwhm = half[half.length - 1]!.u - half[0]!.u;
                const legacyHalf = legacyBell(apexU).filter((s) => s.e >= 0.5);
                const legacyFwhm = legacyHalf[legacyHalf.length - 1]!.u - legacyHalf[0]!.u;
                const top = bell.map((e, i) => ({ e, u: 0.28 + (0.3 * i) / 120 })).filter((s) => s.e >= 0.9);
                const legacyTop = legacyBell(apexU).filter((s) => s.e >= 0.9);
                const w90 = top[top.length - 1]!.u - top[0]!.u;
                const legacy90 = legacyTop[legacyTop.length - 1]!.u - legacyTop[0]!.u;
                expect(fwhm).toBeGreaterThan(legacyFwhm * 1.2);
                expect(w90).toBeGreaterThan(legacy90 * 1.6);
            }
        }
        // Apex Shift and Arch Elongation do not move the profile peak. The
        // surface crest already includes an apex warp; adding the shift again
        // was the old uPeak formula.
        const stationary = measureAnatomicalApex("left", (u, v) =>
            heightAt(u, v, field("left", { archHeightMm: 8, apexMoveMm: 6, archElongationMm: 5 })),
        ).u;
        const unshifted = measureAnatomicalApex("left", (u, v) =>
            heightAt(u, v, field("left", { archHeightMm: 8 })),
        ).u;
        expect(Math.abs(archProfileEnvelope(stationary, stationary) - 1)).toBe(0);
        expect(stationary).not.toBeCloseTo(0.43 + 6 / layout.lengthMm + (5 / layout.lengthMm) * 0.35, 2);
        expect(Math.abs(stationary - unshifted) * layout.lengthMm).toBeGreaterThan(1);
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
            const apexU = measureAnatomicalApex("left", (uu, vv) =>
                heightAt(uu, vv, field("left", { archHeightMm, heelCupDepthMm: 12 }, 6)),
            ).u;
            const crest = sectionAt(apexU, "left", { archHeightMm, heelCupDepthMm: 12 }, 6);
            const amp = Math.min(ARCH_PROFILE_BULGE_MM, Math.max(0, (crest.zRim - crest.zValley) / 4));
            const mid = (crest.mValley + crest.mRim) / 2;
            const zMid = zAt(apexU, mid, "left", { archHeightMm, heelCupDepthMm: 12, archProfile: 0 }, 6);
            const chordMid = (crest.zValley + crest.zRim) / 2;
            expect(Math.abs(zMid - chordMid - amp)).toBeLessThan(0.02);
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
        // 14 mm on a 40 mm span is wider than the old 0.14 window, which was one facet.
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
            expect(Number.isFinite(dz)).toBe(true);
            if (u <= 0.28 || u >= 0.58) {
                expect(dz).toBe(0);
                continue;
            }
            if (Math.abs(dz) > risen) risen = Math.abs(dz);
            if (Math.abs(dz) <= 0.05) pinned++;
        }
        // A crested shell is lowered onto the chord, so the motion is not
        // only upward. The heel and forefoot stays put either way.
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
        // The crest return is a monotone bridge in absolute height. One bin
        // can still sit about 0.25 mm under its neighbor on this triangulation.
        expect(worstDip).toBeLessThan(0.25);
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
        // Medial of the held crest the shell is not reshaped, so its slope stays.
        expect(domedSlope).toBeGreaterThan(-0.05);
        expect(Math.abs(domedSlope - stockSlope)).toBeLessThan(0.02);
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
                // 14 mm C2 fillet on this triangulation: p95 dihedral stays near
                // 11°. A bin-polyline sawtooth creases the whole valley, so p95
                // and the count of edges steeper than 20° both jump.
                expect(stats.edges).toBeGreaterThan(200);
                expect(stats.p95Deg).toBeLessThan(13);
                expect(stats.edgesOver20).toBeLessThan(18);
                // One crest-return face on this sheet measures 25.1°. A sawtooth is far steeper.
                expect(stats.maxDeg).toBeLessThan(26);
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
                // One crest-return face on this sheet measures 25.1°. A sawtooth is far steeper.
                expect(stats.maxDeg).toBeLessThan(26);
            }
        }
    });

    test("SAMPLE_Top valley stays a continuous sheet across the slider", async () => {
        const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const group = await loadGlbFromBuffer(buffer);
        const merged = extractMergedGeometry(group);
        if (!merged) throw new Error("SAMPLE_Top.glb produced no geometry");
        const sheet = reorientToFootprintFrame(merged.geometry, { preserveAuthorZ: true });
        merged.geometry.dispose();

        // Native SAMPLE_Top is the left foot. The photographed insole is that
        // left sheet after mirrorGeometry, which is how a mirrored left load
        // reaches the slider. Both have to stay one opaque sheet.
        const feet: { label: string; geo: import("three").BufferGeometry; side: Side }[] = [
            { label: "native-left", geo: sheet, side: "left" },
            { label: "mirrored-left", geo: mirrorGeometry(sheet), side: "left" },
        ];
        const profiles: (number | undefined)[] = [undefined, 100, 0, 25, 50, 75];

        for (const foot of feet) {
            const indexAttr = foot.geo.getIndex();
            if (!indexAttr) throw new Error(`${foot.label} lost its index`);
            const index = indexAttr.array;
            const stockPos = foot.geo.getAttribute("position")!.array as Float32Array;
            const stockFaces = faceOrientation(stockPos, index);
            // The indexed buffer still carries per-corner copies. 7809 is the
            // welded position count; the copies are what a Laplacian tears.
            expect({
                label: foot.label,
                unique: uniquePositionCount(stockPos),
                tris: stockFaces.tris,
                down: stockFaces.down,
            }).toEqual({
                label: foot.label,
                unique: 7809,
                tris: 15170,
                down: 0,
            });

            const stamped = foot.geo.clone();
            const stampedPos = stamped.getAttribute("position")!.array as Float32Array;
            const donor = valleyDonor(stockPos, foot.side);
            const other = donor === 0 ? 1 : 0;
            stampedPos[other * 3] = stampedPos[donor * 3]!;
            stampedPos[other * 3 + 1] = stampedPos[donor * 3 + 1]!;
            stampedPos[other * 3 + 2] = stampedPos[donor * 3 + 2]!;
            const stampedOut = deformSample(stamped, foot.side, 0).getAttribute("position")!
                .array as Float32Array;
            expect(
                Math.hypot(
                    stampedOut[donor * 3]! - stampedOut[other * 3]!,
                    stampedOut[donor * 3 + 1]! - stampedOut[other * 3 + 1]!,
                    stampedOut[donor * 3 + 2]! - stampedOut[other * 3 + 2]!,
                ),
            ).toBeLessThan(1e-6);

            let omittedPrint: Float32Array | null = null;
            let omittedPrintGeo: import("three").BufferGeometry | null = null;
            for (const profile of profiles) {
                const shaped = deformSample(foot.geo, foot.side, profile);
                const preview = applyBaseModifiers(
                    foot.geo,
                    field(
                        foot.side,
                        profile == null ? {} : { archProfile: profile },
                        BASE_REFERENCE_THICKNESS_MM,
                    ),
                    0,
                    { skipNormals: true },
                );
                const shapedPos = shaped.getAttribute("position")!.array as Float32Array;
                const previewPos = preview.getAttribute("position")!.array as Float32Array;
                const printed = await composeViewerPrintSolidTop({
                    raw: foot.geo.clone(),
                    sourceField: field(
                        foot.side,
                        profile == null ? {} : { archProfile: profile },
                        BASE_REFERENCE_THICKNESS_MM,
                    ),
                });
                const printedPos = printed.getAttribute("position")!.array as Float32Array;
                const printedIndex = printed.getIndex()?.array ?? index;
                const name = `${foot.label}/${profile == null ? "omitted" : profile}`;
                const problems = sheetProblems(name, stockPos, shapedPos, index, shaped);
                if (!sameBuffer(previewPos, shapedPos))
                    problems.push(`${name}: preview positions differ from export`);
                const printFaces = faceOrientation(printedPos, printedIndex);
                if (printFaces.tris !== 15170 || printFaces.down !== 0) {
                    problems.push(
                        `${name}: print faces ${printFaces.tris}, downward ${printFaces.down}, min nz ${printFaces.minNz}`,
                    );
                }
                if (tornExact(stockPos, printedPos) !== 0)
                    problems.push(`${name}: print tore a coincident vertex`);
                const weld = nearWeldTears(stockPos, printedPos);
                if (weld.tears !== 0) {
                    problems.push(
                        `${name}: print opened ${weld.tears} near-weld cracks (max ${weld.maxExtra} mm)`,
                    );
                }
                if (profile == null) {
                    omittedPrint = printedPos;
                    omittedPrintGeo = printed;
                } else if (profile === 100) {
                    if (!omittedPrint || !sameBuffer(printedPos, omittedPrint)) {
                        problems.push(`${name}: print at 100 is not the omitted print`);
                    }
                } else if (omittedPrint && printedPos.length === omittedPrint.length) {
                    let maxDelta = 0;
                    for (let k = 2; k < printedPos.length; k += 3) {
                        const printDz = Math.abs(
                            printedPos[k]! - omittedPrint[k]! - (shapedPos[k]! - stockPos[k]!),
                        );
                        if (printDz > maxDelta) maxDelta = printDz;
                    }
                    // Zonal shell on the print sheet shifts the arch delta by a fraction
                    // of a millimetre. A torn valley would miss by millimetres.
                    if (maxDelta > 1)
                        problems.push(`${name}: print/preview arch delta differs by ${maxDelta} mm`);
                    if (omittedPrintGeo) {
                        const seam = valleySeamStats(omittedPrintGeo, printed, foot.side);
                        if (seam.edges < 80) problems.push(`${name}: print valley edges ${seam.edges}`);
                        if (seam.p95Deg >= 13) problems.push(`${name}: print valley p95 ${seam.p95Deg}`);
                        if (seam.edgesOver20 >= 18)
                            problems.push(`${name}: print edges over 20° ${seam.edgesOver20}`);
                        // One stock fillet edge already sits near 40° and the zonal shell
                        // moves it a few degrees. A folded patch is a much larger crease.
                        if (seam.maxDeg >= 70) problems.push(`${name}: print valley max ${seam.maxDeg}`);
                    }
                }
                if (profile !== 100 && profile != null) {
                    const seam = valleySeamStats(foot.geo, shaped, foot.side);
                    if (seam.edges < 80) problems.push(`${name}: valley edges ${seam.edges}`);
                    if (seam.p95Deg >= 13) problems.push(`${name}: valley p95 ${seam.p95Deg}`);
                    if (seam.edgesOver20 >= 18) problems.push(`${name}: edges over 20° ${seam.edgesOver20}`);
                    // Stay with the stock crease, or under the ~11° fillet. A new sawtooth clears both.
                    // The C2 return from the midspan crown to an inboard crest is a
                    // smooth face of about 20° on this triangulation. A fold is
                    // past 40°. p95 still has to stay under 13°, which is what
                    // catches a sawtooth along the fillet.
                    if (seam.maxDeg >= 40) {
                        problems.push(`${name}: valley max ${seam.maxDeg} vs stock ${seam.stockMaxDeg}`);
                    }
                    if (seam.roughnessMm >= 8) problems.push(`${name}: valley roughness ${seam.roughnessMm}`);
                }
                expect(problems).toEqual([]);
            }
        }
    });
});

describe("arch profile apex and support distribution", () => {
    const sizes = [5, 9, 13];
    const widths = [
        { id: "extra_narrow" as const, delta: -10 },
        { id: "medium" as const, delta: 0 },
        { id: "xx_wide" as const, delta: 15 },
    ];

    function apexOf(
        side: Side,
        lengthMm: number,
        widthMm: number,
        patch: Partial<SideCorrections>,
        thickness = 3,
    ) {
        const p = {
            side,
            lengthMm,
            widthMm,
            thicknessMm: thickness,
            corrections: zeros(patch),
            elements: [],
        };
        return measureAnatomicalApex(side, (u, v) => heightAt(u, v, p));
    }

    test("arch profile does not move the crest while height and elongation stay fixed", () => {
        let worstDu = 0;
        let worstDm = 0;
        let worstDz = 0;
        for (const size of sizes) {
            const layoutFor = insoleLayoutForUsMenSize(size);
            for (const width of widths) {
                const widthMm = layoutFor.widthMm + width.delta;
                for (const side of ["left", "right"] as const) {
                    for (const archHeightMm of [-10, 0, 8, 14]) {
                        for (const archElongationMm of [0, 5]) {
                            for (const apexMoveMm of [-12, 0, 12]) {
                                const patch = {
                                    archHeightMm,
                                    archElongationMm,
                                    apexMoveMm,
                                    heelCupDepthMm: 14,
                                };
                                const before = apexOf(side, layoutFor.lengthMm, widthMm, patch);
                                for (const profile of [0, 25, 50, 75, 100] as const) {
                                    const after = apexOf(side, layoutFor.lengthMm, widthMm, {
                                        ...patch,
                                        archProfile: profile,
                                    });
                                    const du = Math.abs(after.u - before.u) * layoutFor.lengthMm;
                                    const dm = Math.abs(after.m - before.m) * (widthMm / 2);
                                    const dz = Math.abs(after.z - before.z);
                                    if (du > worstDu) worstDu = du;
                                    if (dm > worstDm) worstDm = dm;
                                    if (dz > worstDz) worstDz = dz;
                                    if (du > 0.05 || dm > 0.05 || dz > 0.05) {
                                        throw new Error(
                                            `profile ${size} ${width.id} ${side} h${archHeightMm} el${archElongationMm} apx${apexMoveMm} p${profile} du ${du.toFixed(3)} dm ${dm.toFixed(3)} dz ${dz.toFixed(3)}`,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        expect(worstDu).toBeLessThanOrEqual(0.05);
        expect(worstDm).toBeLessThanOrEqual(0.05);
        expect(worstDz).toBeLessThanOrEqual(0.05);
    });

    test("arch height changes crest elevation and not its position", () => {
        let worstDu = 0;
        let worstDm = 0;
        for (const size of sizes) {
            const layoutFor = insoleLayoutForUsMenSize(size);
            for (const width of widths) {
                const widthMm = layoutFor.widthMm + width.delta;
                for (const side of ["left", "right"] as const) {
                    for (const archElongationMm of [0, 5]) {
                        for (const apexMoveMm of [-12, 0, 12]) {
                            for (const archProfile of [undefined, 0, 50, 100] as const) {
                                const heights = [-10, 0, 8, 14];
                                const crests = heights.map((archHeightMm) =>
                                    apexOf(side, layoutFor.lengthMm, widthMm, {
                                        archHeightMm,
                                        archElongationMm,
                                        apexMoveMm,
                                        heelCupDepthMm: 14,
                                        ...(archProfile == null ? {} : { archProfile }),
                                    }),
                                );
                                const origin = crests[1]!;
                                for (let i = 0; i < crests.length; i++) {
                                    const crest = crests[i]!;
                                    const du = Math.abs(crest.u - origin.u) * layoutFor.lengthMm;
                                    const dm = Math.abs(crest.m - origin.m) * (widthMm / 2);
                                    if (du > worstDu) worstDu = du;
                                    if (dm > worstDm) worstDm = dm;
                                    if (du > 0.05 || dm > 0.05) {
                                        throw new Error(
                                            `height ${size} ${width.id} ${side} h${heights[i]} el${archElongationMm} apx${apexMoveMm} p${archProfile ?? "omit"} du ${du.toFixed(3)} dm ${dm.toFixed(3)}`,
                                        );
                                    }
                                }
                                expect(crests[3]!.z).toBeGreaterThan(crests[2]!.z + 1);
                                expect(crests[2]!.z).toBeGreaterThan(crests[1]!.z + 1);
                                expect(crests[1]!.z).toBeGreaterThan(crests[0]!.z + 1);
                            }
                        }
                    }
                }
            }
        }
        expect(worstDu).toBeLessThanOrEqual(0.05);
        expect(worstDm).toBeLessThanOrEqual(0.05);
    });

    test("arch elongation lengthens support about a fixed crest", () => {
        let worstDu = 0;
        let worstDm = 0;
        for (const size of sizes) {
            const layoutFor = insoleLayoutForUsMenSize(size);
            for (const width of widths) {
                const widthMm = layoutFor.widthMm + width.delta;
                for (const side of ["left", "right"] as const) {
                    for (const archHeightMm of [8, 14]) {
                        for (const apexMoveMm of [-12, 0, 12]) {
                            for (const archProfile of [undefined, 0, 50] as const) {
                                const patch = {
                                    archHeightMm,
                                    apexMoveMm,
                                    heelCupDepthMm: 14,
                                    ...(archProfile == null ? {} : { archProfile }),
                                };
                                const rest = apexOf(side, layoutFor.lengthMm, widthMm, {
                                    ...patch,
                                    archElongationMm: 0,
                                });
                                const stretched = apexOf(side, layoutFor.lengthMm, widthMm, {
                                    ...patch,
                                    archElongationMm: 5,
                                });
                                const du = Math.abs(stretched.u - rest.u) * layoutFor.lengthMm;
                                const dm = Math.abs(stretched.m - rest.m) * (widthMm / 2);
                                const dz = Math.abs(stretched.z - rest.z);
                                if (du > worstDu) worstDu = du;
                                if (dm > worstDm) worstDm = dm;
                                if (du > 0.05 || dm > 0.05 || dz > 0.05) {
                                    throw new Error(
                                        `elong ${size} ${width.id} ${side} h${archHeightMm} apx${apexMoveMm} p${archProfile ?? "omit"} du ${du.toFixed(3)} dm ${dm.toFixed(3)} dz ${dz.toFixed(3)}`,
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
        expect(worstDu).toBeLessThanOrEqual(0.05);
        expect(worstDm).toBeLessThanOrEqual(0.05);
    });

    test("SAMPLE_Top keeps its measured apex across the profile slider", async () => {
        const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
        const sheet = await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        if (!sheet.boundingBox) sheet.computeBoundingBox();
        const box = sheet.boundingBox!;
        const min = [box.min.x, box.min.y, box.min.z];
        const size = [box.max.x - box.min.x || 1, box.max.y - box.min.y || 1, box.max.z - box.min.z || 1];
        const axes = [0, 1, 2].sort((a, b) => size[a]! - size[b]!) as [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
        const [thickAxis, widthAxis, lengthAxis] = axes;
        const frame = {
            side: "left" as const,
            lengthAxis,
            widthAxis,
            thickAxis,
            lenMin: min[lengthAxis]!,
            lenSize: size[lengthAxis]!,
            widCenter: min[widthAxis]! + size[widthAxis]! / 2,
            widSize: size[widthAxis]!,
            widthSign: -(detectArchSideSign(sheet) * -1),
            topVertexCount: 0,
        };
        const src = sheet.getAttribute("position")!.array as Float32Array;
        const stock = measureLoadedArchApex({ positions: src, ...frame });
        expect(stock).toBeTruthy();
        // The landmark is the vertex the fit landed on. Re-searching the
        // prominence after the dome would follow the crown, not this point.
        let landmark = 0;
        let bestD = Infinity;
        const halfW = frame.widSize / 2;
        for (let i = 0; i < src.length / 3; i++) {
            const u = (src[i * 3 + frame.lengthAxis]! - frame.lenMin) / frame.lenSize;
            const vNorm = (frame.widthSign * (src[i * 3 + frame.widthAxis]! - frame.widCenter)) / halfW;
            const du = (u - stock!.u) * frame.lenSize;
            const dm = (vNorm - stock!.m) * halfW;
            const d2 = du * du + dm * dm;
            if (d2 < bestD) {
                bestD = d2;
                landmark = i;
            }
        }
        expect(Math.sqrt(bestD)).toBeLessThan(2);
        const z0 = src[landmark * 3 + frame.thickAxis]!;
        for (const profile of [0, 25, 50, 75, 100] as const) {
            const shaped = deformSample(sheet, "left", profile);
            const pos = shaped.getAttribute("position")!.array as Float32Array;
            const dz = Math.abs(pos[landmark * 3 + frame.thickAxis]! - z0);
            const dx = Math.abs(
                pos[landmark * 3 + frame.lengthAxis]! - src[landmark * 3 + frame.lengthAxis]!,
            );
            const dy = Math.abs(pos[landmark * 3 + frame.widthAxis]! - src[landmark * 3 + frame.widthAxis]!);
            expect(dx, `p${profile} dx`).toBeLessThanOrEqual(0.05);
            expect(dy, `p${profile} dy`).toBeLessThanOrEqual(0.05);
            expect(dz, `p${profile} dz`).toBeLessThanOrEqual(0.05);
        }
    });

    test("only apex shift relocates the crest, and the profile does not add a second one", () => {
        const layoutFor = insoleLayoutForUsMenSize(9);
        const posterior = apexOf("left", layoutFor.lengthMm, layoutFor.widthMm, {
            archHeightMm: 8,
            apexMoveMm: -12,
        });
        const anterior = apexOf("left", layoutFor.lengthMm, layoutFor.widthMm, {
            archHeightMm: 8,
            apexMoveMm: 12,
        });
        // Both the baseline lobe and the kernel move with apex shift, so ±12 mm
        // travels the crest by the full 24 mm.
        expect((anterior.u - posterior.u) * layoutFor.lengthMm).toBeGreaterThan(20);
        expect((anterior.u - posterior.u) * layoutFor.lengthMm).toBeLessThan(28);
        for (const apexMoveMm of [-12, 12]) {
            const cradled = apexOf("left", layoutFor.lengthMm, layoutFor.widthMm, {
                archHeightMm: 8,
                apexMoveMm,
            });
            const domed = apexOf("left", layoutFor.lengthMm, layoutFor.widthMm, {
                archHeightMm: 8,
                apexMoveMm,
                archProfile: 0,
            });
            expect(Math.abs(domed.u - cradled.u) * layoutFor.lengthMm).toBeLessThanOrEqual(0.05);
            expect(Math.abs(domed.z - cradled.z)).toBeLessThanOrEqual(0.05);
        }
    });

    test("domed support is wider and less peaked than the PR 503 bell, with one crest", () => {
        const layoutFor = insoleLayoutForUsMenSize(9);
        const basePatch = { archHeightMm: 8, heelCupDepthMm: 12 };
        const before = apexOf("left", layoutFor.lengthMm, layoutFor.widthMm, basePatch, 4);
        const mCrown = before.m * 0.55;
        const samples: { u: number; delta: number; z: number }[] = [];
        for (let i = 0; i <= 160; i++) {
            const u = 0.2 + (0.55 * i) / 160;
            const z0 = zAt(u, mCrown, "left", basePatch, 4);
            const z = zAt(u, mCrown, "left", { ...basePatch, archProfile: 0 }, 4);
            samples.push({ u, delta: z - z0, z });
        }
        let peak = 0;
        for (const s of samples) if (s.delta > peak) peak = s.delta;
        expect(peak).toBeGreaterThan(1);
        const half = samples.filter((s) => s.delta >= peak * 0.5);
        const fwhmMm = (half[half.length - 1]!.u - half[0]!.u) * layoutFor.lengthMm;
        const legacy = legacyBell(before.u);
        const widthOf = (rows: { u: number; e: number }[], level: number) => {
            const band = rows.filter((s) => s.e >= level);
            return (band[band.length - 1]!.u - band[0]!.u) * layoutFor.lengthMm;
        };
        const legacyFwhmMm = widthOf(legacy, 0.5);
        const legacy90Mm = widthOf(legacy, 0.9);
        const above90 = samples.filter((s) => s.delta >= peak * 0.9);
        const w90Mm = (above90[above90.length - 1]!.u - above90[0]!.u) * layoutFor.lengthMm;
        expect(fwhmMm).toBeGreaterThan(legacyFwhmMm);
        expect(w90Mm).toBeGreaterThan(legacy90Mm * 1.4);

        const duMm = (samples[1]!.u - samples[0]!.u) * layoutFor.lengthMm;
        let maxCurv = 0;
        let legacyCurv = 0;
        for (let i = 1; i < samples.length - 1; i++) {
            const d2 =
                (samples[i - 1]!.delta - 2 * samples[i]!.delta + samples[i + 1]!.delta) / (duMm * duMm);
            maxCurv = Math.max(maxCurv, Math.abs(d2));
            const e0 = legacy[Math.round(((samples[i - 1]!.u - 0.28) / 0.3) * 120)]?.e ?? 0;
            const e1 = legacy[Math.round(((samples[i]!.u - 0.28) / 0.3) * 120)]?.e ?? 0;
            const e2 = legacy[Math.round(((samples[i + 1]!.u - 0.28) / 0.3) * 120)]?.e ?? 0;
            const ld2 = (peak * (e0 - 2 * e1 + e2)) / (duMm * duMm);
            legacyCurv = Math.max(legacyCurv, Math.abs(ld2));
        }
        expect(maxCurv).toBeLessThan(legacyCurv * 0.75);

        let bestI = 0;
        const along: number[] = [];
        for (let i = 0; i <= 80; i++) {
            const u = 0.3 + (0.26 * i) / 80;
            along.push(zAt(u, before.m, "left", { ...basePatch, archProfile: 0 }, 4));
            if (along[i]! > along[bestI]!) bestI = i;
        }
        const crestU = 0.3 + (0.26 * bestI) / 80;
        expect(Math.abs(crestU - before.u) * layoutFor.lengthMm).toBeLessThanOrEqual(
            (0.26 / 80) * layoutFor.lengthMm + 0.05,
        );
        let higher = 0;
        for (const z of along) if (z > along[bestI]! + 0.05) higher++;
        expect(higher).toBe(0);

        const section = sectionAt(before.u, "left", basePatch, 4);
        const sCrest = (section.mCrest - section.mValley) / (section.mRim - section.mValley);
        expect(
            archProfileCrestHold(0.5, sCrest, (section.mRim - section.mValley) * (layoutFor.widthMm / 2)),
        ).toBe(1);
        expect(archProfileCrestHold(sCrest, sCrest, 40)).toBe(0);
        const span = section.mRim - section.mValley;
        const zCrest = zAt(before.u, before.m, "left", { ...basePatch, archProfile: 0 }, 4);
        const zCrest0 = zAt(before.u, before.m, "left", basePatch, 4);
        expect(Math.abs(zCrest - zCrest0)).toBeLessThanOrEqual(0.05);
        let aboveCrest = 0;
        for (let i = 1; i < 20; i++) {
            const s = (i / 20) * sCrest;
            const m = section.mValley + s * span;
            const z = zAt(before.u, m, "left", { ...basePatch, archProfile: 0 }, 4);
            if (z > zCrest0 + 0.05) aboveCrest++;
        }
        expect(aboveCrest).toBe(0);
    });
});

/** PR #503 bell: quintic from 0.28 to 0.58, peak fixed at the given u, no shoulder broaden. */
function legacyBell(apexU: number): { u: number; e: number }[] {
    const q = (t: number) => {
        const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
        return x * x * x * (x * (x * 6 - 15) + 10);
    };
    const lo = 0.32;
    const hi = 0.54;
    let uPeak = apexU;
    if (uPeak < lo) uPeak = lo;
    if (uPeak > hi) uPeak = hi;
    const out: { u: number; e: number }[] = [];
    for (let i = 0; i <= 120; i++) {
        const u = 0.28 + (0.3 * i) / 120;
        let e = 0;
        if (u > 0.28 && u < 0.58) {
            e = u <= uPeak ? q((u - 0.28) / (uPeak - 0.28)) : 1 - q((u - uPeak) / (0.58 - uPeak));
        }
        out.push({ u, e });
    }
    return out;
}

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
    maxAbsDz = 2.5,
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
        return dz > 0.15 && dz < maxAbsDz;
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

function sameBuffer(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** Face nz in the footprint frame. A Z-only fold that turns a triangle over lands here. */
function faceOrientation(
    pos: Float32Array,
    index: ArrayLike<number>,
): { tris: number; down: number; minNz: number } {
    let tris = 0;
    let down = 0;
    let minNz = Infinity;
    for (let t = 0; t + 2 < index.length; t += 3) {
        tris++;
        const n = faceNormal(pos, index[t]!, index[t + 1]!, index[t + 2]!);
        const nz = n ? n[2] : 0;
        if (!(nz > 0)) down++;
        if (nz < minNz) minNz = nz;
    }
    return { tris, down, minNz };
}

/** Welded positions. Copies closer than 1e-6 mm are the same point. */
function uniquePositionCount(pos: Float32Array): number {
    const map = new Set<string>();
    const n = (pos.length / 3) | 0;
    for (let i = 0; i < n; i++) map.add(quantKey(pos, i, 1e6));
    return map.size;
}

function quantKey(pos: Float32Array, i: number, scale: number): string {
    return `${Math.round(pos[i * 3]! * scale)}:${Math.round(pos[i * 3 + 1]! * scale)}:${Math.round(pos[i * 3 + 2]! * scale)}`;
}

/** Vertices that matched before the slider must still match. A torn pair counts. */
function tornExact(before: Float32Array, after: Float32Array): number {
    if (before.length !== after.length) return 1;
    const map = new Map<string, number[]>();
    const n = (before.length / 3) | 0;
    for (let i = 0; i < n; i++) {
        const key = `${before[i * 3]},${before[i * 3 + 1]},${before[i * 3 + 2]}`;
        const list = map.get(key);
        if (list) list.push(i);
        else map.set(key, [i]);
    }
    let torn = 0;
    for (const ids of map.values()) {
        if (ids.length < 2) continue;
        const a = ids[0]!;
        for (let k = 1; k < ids.length; k++) {
            const b = ids[k]!;
            const gap = Math.hypot(
                after[b * 3]! - after[a * 3]!,
                after[b * 3 + 1]! - after[a * 3 + 1]!,
                after[b * 3 + 2]! - after[a * 3 + 2]!,
            );
            if (!(gap < 1e-6)) torn++;
        }
    }
    return torn;
}

/**
 * Vertices within 0.02 mm are the split copies a Laplacian would pull apart.
 * The arch field moves them together. A crack is a separation well past that.
 */
function nearWeldTears(
    before: Float32Array,
    after: Float32Array,
    tol = 0.02,
    extra = 0.05,
): { pairs: number; tears: number; maxExtra: number } {
    const scale = 1 / tol;
    const n = (before.length / 3) | 0;
    const grid = new Map<string, number[]>();
    const cellOf = (i: number) =>
        [
            Math.floor(before[i * 3]! * scale),
            Math.floor(before[i * 3 + 1]! * scale),
            Math.floor(before[i * 3 + 2]! * scale),
        ] as const;
    for (let i = 0; i < n; i++) {
        const [ix, iy, iz] = cellOf(i);
        const key = `${ix}:${iy}:${iz}`;
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
    }
    const dist = (pos: Float32Array, i: number, j: number) =>
        Math.hypot(
            pos[i * 3]! - pos[j * 3]!,
            pos[i * 3 + 1]! - pos[j * 3 + 1]!,
            pos[i * 3 + 2]! - pos[j * 3 + 2]!,
        );
    let pairs = 0;
    let tears = 0;
    let maxExtra = 0;
    for (let i = 0; i < n; i++) {
        const [ix, iy, iz] = cellOf(i);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const list = grid.get(`${ix + dx}:${iy + dy}:${iz + dz}`);
                    if (!list) continue;
                    for (const j of list) {
                        if (j <= i) continue;
                        const beforeGap = dist(before, i, j);
                        if (!(beforeGap <= tol)) continue;
                        pairs++;
                        const grew = dist(after, i, j) - beforeGap;
                        if (grew > maxExtra) maxExtra = grew;
                        if (grew > extra) tears++;
                    }
                }
            }
        }
    }
    return { pairs, tears, maxExtra };
}

function valleyDonor(pos: Float32Array, side: Side): number {
    const n = (pos.length / 3) | 0;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = pos[i * 3]!;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
    }
    const len = xMax - xMin || 1;
    for (let i = 0; i < n; i++) {
        const u = (pos[i * 3]! - xMin) / len;
        if (Math.abs(u - 0.42) > 0.015) continue;
        const y = pos[i * 3 + 1]!;
        if (side === "left" ? y < -2 && y > -16 : y > 2 && y < 16) return i;
    }
    throw new Error("no valley vertex to stamp");
}

/** How far a moved vertex drops under the undeformed floor at its station. */
function punchBelowFloorMm(stock: Float32Array, shaped: Float32Array): number {
    const n = (stock.length / 3) | 0;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = stock[i * 3]!;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
    }
    const len = xMax - xMin || 1;
    const bins = 32;
    const floor = new Array<number>(bins).fill(Infinity);
    for (let i = 0; i < n; i++) {
        const u = (stock[i * 3]! - xMin) / len;
        const bi = Math.min(bins - 1, Math.max(0, Math.floor(u * bins)));
        const z = stock[i * 3 + 2]!;
        if (z < floor[bi]!) floor[bi] = z;
    }
    const dilated = floor.slice();
    for (let i = 0; i < bins; i++) {
        dilated[i] = Math.min(floor[Math.max(0, i - 1)]!, floor[i]!, floor[Math.min(bins - 1, i + 1)]!);
    }
    let maxBelow = 0;
    for (let i = 0; i < n; i++) {
        const u = (stock[i * 3]! - xMin) / len;
        if (u <= 0.28 || u >= 0.58) continue;
        const bi = Math.min(bins - 1, Math.max(0, Math.floor(u * bins)));
        const below = dilated[bi]! - shaped[i * 3 + 2]!;
        if (below > maxBelow) maxBelow = below;
    }
    return maxBelow;
}

function sheetProblems(
    name: string,
    stock: Float32Array,
    shaped: Float32Array,
    index: ArrayLike<number>,
    shapedGeo: import("three").BufferGeometry,
): string[] {
    const problems: string[] = [];
    if (stock.length !== shaped.length) {
        problems.push(`${name}: vertex count changed`);
        return problems;
    }
    const faces = faceOrientation(shaped, index);
    if (faces.down !== 0) problems.push(`${name}: ${faces.down} downward faces, min nz ${faces.minNz}`);
    const normals = shapedGeo.getAttribute("normal");
    if (!normals) {
        problems.push(`${name}: vertex normals were not rebuilt`);
    } else {
        const arr = normals.array as Float32Array;
        let down = 0;
        let minNz = Infinity;
        const used = new Uint8Array((shaped.length / 3) | 0);
        for (let t = 0; t < index.length; t++) used[index[t]!] = 1;
        for (let i = 0; i < used.length; i++) {
            if (!used[i]) continue;
            const nz = arr[i * 3 + 2]!;
            const len = Math.hypot(arr[i * 3]!, arr[i * 3 + 1]!, nz);
            if (!(len > 1e-8)) continue;
            if (!(nz > 0)) down++;
            if (nz < minNz) minNz = nz;
        }
        if (down !== 0) problems.push(`${name}: ${down} downward vertex normals, min nz ${minNz}`);
    }
    const torn = tornExact(stock, shaped);
    if (torn !== 0) problems.push(`${name}: ${torn} coincident vertices split`);
    const weld = nearWeldTears(stock, shaped);
    if (weld.tears !== 0) {
        problems.push(`${name}: ${weld.tears} near-weld cracks, max extra ${weld.maxExtra} mm`);
    }
    let xyDrift = 0;
    let endDrift = 0;
    let identical = true;
    const n = (stock.length / 3) | 0;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = stock[i * 3]!;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (shaped[i * 3] !== stock[i * 3] || shaped[i * 3 + 1] !== stock[i * 3 + 1]) xyDrift++;
        if (
            shaped[i * 3] !== stock[i * 3] ||
            shaped[i * 3 + 1] !== stock[i * 3 + 1] ||
            shaped[i * 3 + 2] !== stock[i * 3 + 2]
        ) {
            identical = false;
        }
    }
    const len = xMax - xMin || 1;
    for (let i = 0; i < n; i++) {
        const u = (stock[i * 3]! - xMin) / len;
        if ((u <= 0.28 || u >= 0.58) && shaped[i * 3 + 2] !== stock[i * 3 + 2]) endDrift++;
    }
    if (xyDrift !== 0) problems.push(`${name}: ${xyDrift} vertices drifted in X/Y`);
    if (endDrift !== 0) problems.push(`${name}: ${endDrift} vertices outside the arch moved`);
    const cradled = name.endsWith("/100") || name.endsWith("/omitted");
    if (cradled && !identical) problems.push(`${name}: not byte-identical to the undeformed top`);
    const punch = punchBelowFloorMm(stock, shaped);
    if (punch > 0.5) problems.push(`${name}: surface drops ${punch} mm through the local floor`);
    return problems;
}
