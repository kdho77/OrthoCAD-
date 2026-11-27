// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    applyBaseModifiers,
    BASE_REFERENCE_THICKNESS_MM,
    hasActiveModifiers,
} from "@/lib/geometry/base-modifier";
import { constrainSideCorrections } from "@/lib/geometry/clinical-constraints";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { migrateSideCorrections } from "@/lib/geometry/migrate-corrections";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import type { DesignState, Side, SideCorrections } from "@/types";
import {
    ARCH_PROFILE_BULGE_MM,
    ARCH_PROFILE_CAP_MM,
    type ArchSection,
    archProfileEnvelope,
    archProfilePinWindow,
    medialCoordinate,
    sampleMedialArchSection,
    vSignedFromMedial,
} from "./arch-profile";
import { type HeightFieldParams, heightAt } from "./height-field";

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
    const section = sampleMedialArchSection(u, side, (uu, vv) => heightAt(uu, vv, cradled));
    if (!section) throw new Error(`no arch section at u=${u}`);
    return section;
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

        // Inboard foot of the stock shell is below the chord (the cradled sweep).
        const inboardDev = height(0.2, undefined) - chordAt(0.2);
        expect(inboardDev).toBeLessThan(-0.3);
        // Neutral lays that station on the chord; Domed lifts it further. Monotone.
        const inboard = [100, 75, 50, 25, 0].map((profile) => height(0.2, profile));
        for (let i = 1; i < inboard.length; i++) {
            const prev = inboard[i - 1] ?? 0;
            const next = inboard[i] ?? 0;
            expect(next).toBeGreaterThan(prev + 0.05);
        }
        expect(Math.abs(height(0.5, 50) - chordAt(0.5))).toBeLessThan(0.02);
        expect(Math.abs(height(0.2, 50) - chordAt(0.2))).toBeLessThan(0.02);
        const crown = height(0.5, 0) - chordAt(0.5);
        expect(crown).toBeGreaterThan(ARCH_PROFILE_BULGE_MM - 0.05);
        expect(crown).toBeLessThan(ARCH_PROFILE_BULGE_MM + 0.05);
        // Domed crown sits above its neighbours. Neutral is the straight chord.
        const domeMid = height(0.5, 0);
        expect(domeMid).toBeGreaterThan((height(0.35, 0) + height(0.65, 0)) / 2 + 0.2);
        expect(Math.abs(height(0.35, 50) + height(0.65, 50) - 2 * height(0.5, 50))).toBeLessThan(0.05);
    });

    test("midspan height rises monotonically as the slider moves toward Domed", () => {
        const section = sectionAt(0.42, "right", { archHeightMm: 8 });
        const midM = (section.mValley + section.mRim) / 2;
        let prev = -Infinity;
        for (const profile of [100, 75, 50, 25, 0]) {
            const z = zAt(0.42, midM, "right", { archHeightMm: 8, archProfile: profile });
            expect(z).toBeGreaterThan(prev + 1e-4);
            prev = z;
        }
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
        expect(archProfileEnvelope(0.42, 0, layout.lengthMm, 0)).toBe(1);
    });

    test("domed crown stays at 4 mm and never exceeds 5 mm above the chord", () => {
        for (const archHeightMm of [0, 8, 14]) {
            let maxAbove = 0;
            let peakAtCrest = 0;
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
            const crest = sectionAt(0.42, "left", { archHeightMm, heelCupDepthMm: 12 }, 6);
            const mid = (crest.mValley + crest.mRim) / 2;
            const zMid = zAt(0.42, mid, "left", { archHeightMm, heelCupDepthMm: 12, archProfile: 0 }, 6);
            const chordMid = (crest.zValley + crest.zRim) / 2;
            peakAtCrest = zMid - chordMid;
            expect(maxAbove).toBeLessThanOrEqual(ARCH_PROFILE_CAP_MM + 1e-6);
            expect(peakAtCrest).toBeGreaterThan(ARCH_PROFILE_BULGE_MM - 0.05);
            expect(peakAtCrest).toBeLessThanOrEqual(ARCH_PROFILE_BULGE_MM + 0.05);
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
            // A crease would jump by millimetres between 1/40 of the span. The crown is a broad sine.
            expect(maxSecond).toBeLessThan(1.25);
        }
        expect(medialCoordinate(0.4, "left")).toBeCloseTo(medialCoordinate(-0.4, "right"), 9);
        expect(archProfilePinWindow(0)).toBe(0);
        expect(archProfilePinWindow(1)).toBe(0);
        expect(archProfilePinWindow(0.5)).toBe(1);
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
});
