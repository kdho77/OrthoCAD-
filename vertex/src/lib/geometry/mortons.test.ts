// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { heightAt, outlineHalfWidth, resolveOutlineHalfWidth } from "@/lib/geometry/height-field";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { defaultDesign, useDesignStore } from "@/stores/design-store";
import type { Side, SideCorrections } from "@/types";
import { designStateSchema } from "../../../server/src/lib/design-schema";
import { baseModifierField } from "./base-asset";
import { applyBaseModifiers, detectArchSideSign, getBaseFootprintFrame } from "./base-modifier";
import {
    clampMortonsAmount,
    MORTONS_EXTENSION_DEFAULT_MM,
    MORTONS_LATERAL_TAPER_MM,
    MORTONS_LATERAL_V,
    MORTONS_PROXIMAL_TAPER_MM,
    MORTONS_REVERSE_DEFAULT_MM,
    type MortonsSampleContext,
    mortonsFilletRadiusMm,
    mortonsLocalBaseThicknessMm,
    mortonsProximalBorderU,
    mortonsQuery,
    mortonsSpecV,
    mortonsTopDeltaAt,
    mortonsVSigned,
    sinkCutAfterMortons,
} from "./mortons";

const layout = insoleLayoutForUsMenSize(9);

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

function field(side: Side, thicknessMm: number): HeightFieldParams {
    return {
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm,
        corrections: zeroCorrections(),
        includeSkives: false,
        includeElements: false,
    };
}

/** Constant width so the lateral border is a straight line and signed distance is exact. */
function ctx(side: Side, mode: "extension" | "reverse", amountMm: number): MortonsSampleContext {
    return {
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        mortons: { mode, amountMm },
        widthMmAt: () => layout.widthMm,
    };
}

function at(side: Side, u: number, specV: number, mode: "extension" | "reverse" = "extension", amountMm = 3) {
    return mortonsQuery(u, mortonsVSigned(specV, side), ctx(side, mode, amountMm));
}

/** spec v at a signed distance from the lateral border. Positive signed is medial (inside). */
function specVAtSigned(signedMm: number): number {
    return MORTONS_LATERAL_V - signedMm / layout.widthMm;
}

describe("Morton's region and Kendon's taper", () => {
    test("proximal arc dips to u 0.62 at v 0.20 and returns to 0.63", () => {
        expect(mortonsProximalBorderU(0)).toBeCloseTo(0.63, 8);
        expect(mortonsProximalBorderU(0.2)).toBeCloseTo(0.62, 8);
        expect(mortonsProximalBorderU(0.4)).toBeCloseTo(0.63, 8);
    });

    test("extension default raises the region center by 3 mm on both feet", () => {
        expect(MORTONS_EXTENSION_DEFAULT_MM).toBe(3);
        for (const side of ["left", "right"] as const) {
            const sample = ctx(side, "extension", 3);
            const delta = mortonsTopDeltaAt(0.85, mortonsVSigned(0.15, side), sample, 2);
            expect(delta).toBeCloseTo(3, 4);
            expect(at(side, 0.85, 0.15).weight).toBeCloseTo(1, 4);
        }
    });

    test("reverse default lowers the center by 2.5 mm and floors thickness", () => {
        expect(MORTONS_REVERSE_DEFAULT_MM).toBe(2.5);
        const sample = ctx("right", "reverse", 2.5);
        const v = mortonsVSigned(0.15, "right");
        expect(mortonsTopDeltaAt(0.85, v, sample, 3)).toBeCloseTo(-2.5, 4);
        expect(mortonsTopDeltaAt(0.85, v, sample, 2)).toBeCloseTo(-1.5, 4);
        expect(mortonsTopDeltaAt(0.85, v, ctx("right", "reverse", 3), 2)).toBeCloseTo(-1.5, 4);
    });

    test("lateral taper is a 3 mm smoothstep centered on v 0.40", () => {
        expect(MORTONS_LATERAL_TAPER_MM).toBe(3);
        const border = at("right", 0.88, MORTONS_LATERAL_V);
        expect(border.signedMm).toBeCloseTo(0, 2);
        expect(border.weight).toBeCloseTo(0.5, 2);
        expect(at("right", 0.88, specVAtSigned(1.5)).weight).toBeCloseTo(1, 2);
        expect(at("right", 0.88, specVAtSigned(-1.5)).weight).toBeCloseTo(0, 2);
        const oneMmInside = at("right", 0.88, specVAtSigned(1)).weight;
        expect(oneMmInside).toBeGreaterThan(0.85);
        expect(oneMmInside).toBeLessThan(0.98);
        expect(at("left", 0.88, MORTONS_LATERAL_V).weight).toBeCloseTo(border.weight, 4);
    });

    test("proximal taper blends 12 mm into the arch with a flat-ended C1 slope", () => {
        expect(MORTONS_PROXIMAL_TAPER_MM).toBe(12);
        const specV = 0.08;
        const uBorder = mortonsProximalBorderU(specV);
        expect(at("right", uBorder, specV).weight).toBeGreaterThan(0.97);
        expect(at("right", uBorder + 2 / layout.lengthMm, specV).weight).toBeCloseTo(1, 2);
        expect(at("right", uBorder - 6 / layout.lengthMm, specV).weight).toBeCloseTo(0.5, 1);
        expect(at("right", uBorder - 12 / layout.lengthMm, specV).weight).toBeLessThan(0.05);
        const amount = 3;
        const sample = ctx("right", "extension", amount);
        const v = mortonsVSigned(specV, "right");
        const stepMm = 0.05;
        let prev = mortonsTopDeltaAt(uBorder - 14 / layout.lengthMm, v, sample, 2);
        let maxSlope = 0;
        for (let s = -14 + stepMm; s <= 1.001; s += stepMm) {
            const delta = mortonsTopDeltaAt(uBorder + s / layout.lengthMm, v, sample, 2);
            maxSlope = Math.max(maxSlope, Math.abs(delta - prev) / stepMm);
            prev = delta;
        }
        // Cubic smoothstep peaks at 1.5/distance. Over 12 mm that is amount/8,
        // the lowest peak a blend that is flat at both ends can have.
        expect(maxSlope).toBeLessThanOrEqual((amount * 1.5) / MORTONS_PROXIMAL_TAPER_MM + 1e-4);
        expect(maxSlope).toBeGreaterThan(amount / 10);
    });

    test("medial and toe edges stay at full height", () => {
        expect(at("right", 0.85, 0).weight).toBeCloseTo(1, 3);
        expect(at("right", 1, 0.1).weight).toBeCloseTo(1, 3);
        expect(at("left", 1, 0.05).weight).toBeCloseTo(1, 3);
    });

    test("lateral border has no step and slope stays within the 3 mm smoothstep", () => {
        const step = 0.25;
        let prev = at("right", 0.88, specVAtSigned(-2)).weight;
        let maxSlope = 0;
        for (let signed = -2 + step; signed <= 2.001; signed += step) {
            const w = at("right", 0.88, specVAtSigned(signed)).weight;
            const slope = Math.abs(w - prev) / step;
            expect(Math.abs(w - prev)).toBeLessThan(0.2);
            expect(w + 1e-6).toBeGreaterThanOrEqual(prev);
            maxSlope = Math.max(maxSlope, slope);
            prev = w;
        }
        expect(maxSlope).toBeLessThanOrEqual(0.55);
        expect(maxSlope).toBeGreaterThan(0.4);
    });

    test("8 mm fillet puts the sharp corner outside and keeps the arc", () => {
        const sample = ctx("right", "extension", 3);
        expect(mortonsFilletRadiusMm(sample)).toBe(8);
        expect(at("right", 0.63, 0.4).signedMm).toBeLessThan(-0.4);
        const arc = at("right", 0.62, 0.2);
        expect(Math.abs(arc.signedMm)).toBeLessThan(1);
        expect(arc.weight).toBeGreaterThan(0.9);
    });

    test("left and right share a spec-v weight", () => {
        for (const specV of [0.05, 0.15, 0.4, 0.42]) {
            const right = at("right", 0.86, specV).weight;
            const left = at("left", 0.86, specV).weight;
            expect(left).toBeCloseTo(right, 5);
            expect(mortonsSpecV(mortonsVSigned(specV, "left"), "left")).toBeCloseTo(specV, 8);
        }
    });
});

describe("Morton's thickness floor and overlap", () => {
    test("reverse floor is depth + 0.5 at 2.5 and 3.0, only under the mask", () => {
        expect(mortonsLocalBaseThicknessMm(2.5, 0, 1)).toBeCloseTo(3, 6);
        expect(mortonsLocalBaseThicknessMm(3, 0, 1)).toBeCloseTo(3.5, 6);
        expect(mortonsLocalBaseThicknessMm(2.5, 2, 1)).toBeCloseTo(3, 6);
        expect(mortonsLocalBaseThicknessMm(3, 2, 1)).toBeCloseTo(3.5, 6);
        expect(mortonsLocalBaseThicknessMm(2.5, 2, 0)).toBeCloseTo(2, 6);
        expect(mortonsLocalBaseThicknessMm(3, 4, 1)).toBeCloseTo(4, 6);
    });

    test("1st MPJ sink and reverse Morton's: deepest wins", () => {
        expect(sinkCutAfterMortons(4, 2.5)).toBeCloseTo(1.5, 6);
        expect(sinkCutAfterMortons(2, 2.5)).toBe(0);
        expect(sinkCutAfterMortons(4, 0)).toBe(4);
    });

    test("amounts clamp at the clinical max", () => {
        expect(clampMortonsAmount("extension", 7)).toBe(6);
        expect(clampMortonsAmount("reverse", 5)).toBe(4);
        expect(clampMortonsAmount("extension", 3)).toBe(3);
    });
});

describe("Morton's off stays byte-identical", () => {
    test("heightAt matches when the spec is absent, undefined, or zero", () => {
        const base = field("right", 2);
        const absent = field("left", 3);
        for (let u = 0; u <= 1.001; u += 0.1) {
            for (const vSigned of [-0.8, -0.2, 0, 0.35, 0.9]) {
                const a = heightAt(u, vSigned, base);
                const b = heightAt(u, vSigned, { ...base, mortons: undefined });
                const c = heightAt(u, vSigned, {
                    ...base,
                    mortons: { mode: "extension", amountMm: 0 },
                });
                expect(b).toBe(a);
                expect(c).toBe(a);
                expect(heightAt(u, vSigned, { ...absent, mortons: undefined })).toBe(
                    heightAt(u, vSigned, absent),
                );
            }
        }
    });

    test("an active spec changes only the first-ray height", () => {
        const base = field("right", 2);
        const on = {
            ...base,
            mortons: { mode: "extension" as const, amountMm: 3 },
        };
        const center =
            heightAt(0.85, mortonsVSigned(0.15, "right"), on) -
            heightAt(0.85, mortonsVSigned(0.15, "right"), base);
        expect(center).toBeCloseTo(3, 3);
        const heel = heightAt(0.15, 0, on) - heightAt(0.15, 0, base);
        expect(heel).toBe(0);
    });

    test("modifier field omits mortons unless that foot is active", () => {
        const off = baseModifierField(defaultDesign(), "right", 2);
        expect("mortons" in off).toBe(false);
        const design = {
            ...defaultDesign(),
            mortons: { right: { mode: "extension" as const, amountMm: 3 } },
        };
        expect(baseModifierField(design, "right", 2).mortons).toEqual({ mode: "extension", amountMm: 3 });
        expect("mortons" in baseModifierField(design, "left", 2)).toBe(false);
        expect(
            "mortons" in
                baseModifierField(
                    { ...defaultDesign(), mortons: { right: { mode: "extension", amountMm: 0 } } },
                    "right",
                    2,
                ),
        ).toBe(false);
    });

    test("saved designs keep mortons and older designs still parse", () => {
        const bare = designStateSchema.parse(defaultDesign());
        expect(bare.mortons).toBeUndefined();
        const saved = designStateSchema.parse({
            ...defaultDesign(),
            mortons: { left: { mode: "reverse", amountMm: 2.5 }, right: { mode: "extension", amountMm: 3 } },
        });
        expect(saved.mortons?.left).toEqual({ mode: "reverse", amountMm: 2.5 });
        expect(saved.mortons?.right?.amountMm).toBe(3);
    });
});

describe("Morton's is top-only on the base mesh", () => {
    function slab(): { geometry: BufferGeometry; topCount: number } {
        const lengthMm = layout.lengthMm;
        const widthMm = layout.widthMm;
        const nx = 40;
        const ny = 20;
        const positions: number[] = [];
        for (let sheet = 0; sheet < 2; sheet++) {
            const z = sheet === 0 ? 4 : 0;
            for (let i = 0; i <= nx; i++) {
                for (let j = 0; j <= ny; j++) {
                    positions.push((j / ny - 0.5) * widthMm, (i / nx) * lengthMm, z);
                }
            }
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
        const topCount = (nx + 1) * (ny + 1);
        geometry.userData = { isMultiMeshBase: true, topVertexCount: topCount };
        return { geometry, topCount };
    }

    function sample(geometry: BufferGeometry, index: number, side: Side) {
        const pos = geometry.getAttribute("position")!.array as Float32Array;
        const lengthAxis = 1;
        const widthAxis = 0;
        const lenMin = 0;
        const lenSize = layout.lengthMm;
        const widSize = layout.widthMm;
        const medialSign = side === "left" ? -1 : 1;
        const widthSign = -(detectArchSideSign(geometry) * medialSign);
        const u = (pos[index * 3 + lengthAxis]! - lenMin) / lenSize;
        const vSigned = (widthSign * pos[index * 3 + widthAxis]!) / (widSize / 2);
        return { u, specV: mortonsSpecV(vSigned, side), z: pos[index * 3 + 2]! };
    }

    test("extension lifts the first ray and leaves the bottom flat", () => {
        const { geometry, topCount } = slab();
        const baseField = field("right", 2);
        const off = applyBaseModifiers(geometry, baseField, 0, { skipNormals: true });
        const on = applyBaseModifiers(
            geometry,
            { ...baseField, mortons: { mode: "extension", amountMm: 3 } },
            0,
            { skipNormals: true },
        );
        const offPos = off.getAttribute("position")!.array as Float32Array;
        const onPos = on.getAttribute("position")!.array as Float32Array;
        for (let i = topCount; i < offPos.length / 3; i++) {
            expect(onPos[i * 3 + 2]).toBe(offPos[i * 3 + 2]);
        }
        let best = 0;
        let bestScore = Infinity;
        for (let i = 0; i < topCount; i++) {
            const s = sample(geometry, i, "right");
            const score = Math.abs(s.u - 0.85) + Math.abs(s.specV - 0.15);
            if (score < bestScore) {
                bestScore = score;
                best = i;
            }
        }
        const center = sample(geometry, best, "right");
        expect(center.u).toBeGreaterThan(0.8);
        expect(center.specV).toBeGreaterThan(0.08);
        expect(center.specV).toBeLessThan(0.25);
        expect(onPos[best * 3 + 2]! - offPos[best * 3 + 2]!).toBeCloseTo(3, 2);
        geometry.dispose();
        off.dispose();
        on.dispose();
    });

    test("proximal band and medial rim have no step above 0.05 mm", () => {
        const lengthMm = layout.lengthMm;
        const widthMm = layout.widthMm;
        const nu = 26;
        const nv = 12;
        const positions: number[] = [];
        const uAt = (i: number) => i / nu;
        const yAt = (j: number) => (j / nv - 0.5) * widthMm;
        for (let i = 0; i <= nu; i++) {
            for (let j = 0; j <= nv; j++) positions.push(uAt(i) * lengthMm, yAt(j), 2);
        }
        const indices: number[] = [];
        const atIJ = (i: number, j: number) => i * (nv + 1) + j;
        for (let i = 0; i < nu; i++) {
            for (let j = 0; j < nv; j++) {
                const a = atIJ(i, j);
                const b = atIJ(i + 1, j);
                const d = atIJ(i + 1, j + 1);
                const c = atIJ(i, j + 1);
                indices.push(a, b, d, a, d, c);
            }
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
        geometry.setIndex(indices);
        const baseField = field("right", 2);
        const off = applyBaseModifiers(geometry, baseField, 0, { skipNormals: true });
        const on = applyBaseModifiers(
            geometry,
            { ...baseField, mortons: { mode: "extension", amountMm: 3 } },
            0,
            { skipNormals: true },
        );
        expect(off.getAttribute("position")!.count).toBe(geometry.getAttribute("position")!.count);
        expect(on.getAttribute("position")!.count).toBeGreaterThan(geometry.getAttribute("position")!.count);
        const pos = on.getAttribute("position")!.array as Float32Array;
        const index = on.getIndex()!.array as ArrayLike<number>;
        const onField = { ...baseField, mortons: { mode: "extension" as const, amountMm: 3 } };
        const sampleCtx = {
            ...ctx("right", "extension", 3),
            widthMmAt: (u: number) => resolveOutlineHalfWidth(u, onField) * layout.widthMm,
        };
        const frame = getBaseFootprintFrame(geometry, "right");
        const specOf = (i: number) => {
            const u = Math.max(
                0,
                Math.min(1, (pos[i * 3 + frame.lengthAxis]! - frame.lenMin) / frame.lenSize),
            );
            const vSigned = Math.max(
                -1,
                Math.min(
                    1,
                    (frame.widthSign * (pos[i * 3 + frame.widthAxis]! - frame.widCenter)) / (frame.widSize / 2),
                ),
            );
            return { u, specV: mortonsSpecV(vSigned, "right"), vSigned };
        };
        const deltaOf = (i: number) => {
            const s = specOf(i);
            return mortonsTopDeltaAt(s.u, s.vSigned, sampleCtx, 2);
        };
        let proximalEdges = 0;
        let rimEdges = 0;
        const edgeUse = new Map<string, number>();
        const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
        for (let t = 0; t < index.length; t += 3) {
            const tri = [index[t]!, index[t + 1]!, index[t + 2]!];
            const area =
                (pos[tri[1]! * 3]! - pos[tri[0]! * 3]!) * (pos[tri[2]! * 3 + 1]! - pos[tri[0]! * 3 + 1]!) -
                (pos[tri[1]! * 3 + 1]! - pos[tri[0]! * 3 + 1]!) * (pos[tri[2]! * 3]! - pos[tri[0]! * 3]!);
            expect(area).toBeGreaterThan(1e-6);
            for (let e = 0; e < 3; e++) {
                const a = tri[e]!;
                const b = tri[(e + 1) % 3]!;
                edgeUse.set(edgeKey(a, b), (edgeUse.get(edgeKey(a, b)) ?? 0) + 1);
            }
        }
        for (const [k, n] of edgeUse) {
            const [as, bs] = k.split(":");
            const a = Number(as);
            const b = Number(bs);
            const sa = specOf(a);
            const sb = specOf(b);
            const dA = deltaOf(a);
            const dB = deltaOf(b);
            const jump = Math.abs(dA - dB);
            const midU = (sa.u + sb.u) * 0.5;
            const midV = (sa.specV + sb.specV) * 0.5;
            // The lip row (specV < 0.08) is checked on its rim edges below.
            // Its radial edges stay coarse so the wall lip tangent does not flip.
            const proximal = midV >= 0.08 && midV < 0.22 && midU < 0.72 && midU > 0.5 && Math.min(dA, dB) < 2.9;
            if (proximal) {
                proximalEdges++;
                expect(jump).toBeLessThanOrEqual(0.05 + 1e-4);
            }
            if (n === 1 && midV < 0.08 && midU > 0.7) {
                rimEdges++;
                expect(jump).toBeLessThanOrEqual(0.05 + 1e-4);
            }
        }
        expect(proximalEdges).toBeGreaterThan(8);
        expect(rimEdges).toBeGreaterThan(4);
        geometry.dispose();
        off.dispose();
        on.dispose();
    });
});

describe("outline-aware height matches the centered taper", () => {
    test("real outline still centers the lateral taper and fills the first ray", () => {
        const side: Side = "right";
        const base = field(side, 2);
        const on: HeightFieldParams = { ...base, mortons: { mode: "extension", amountMm: 3 } };
        const widthAt = (u: number) => outlineHalfWidth(u) * layout.widthMm;
        const vBorder = mortonsVSigned(MORTONS_LATERAL_V, side);
        const border = heightAt(0.88, vBorder, on) - heightAt(0.88, vBorder, base);
        expect(border).toBeGreaterThan(1.2);
        expect(border).toBeLessThan(1.8);
        const half = MORTONS_LATERAL_TAPER_MM / 2 / widthAt(0.88);
        const inside = mortonsVSigned(MORTONS_LATERAL_V - half, side);
        const outside = mortonsVSigned(MORTONS_LATERAL_V + half, side);
        const dIn = heightAt(0.88, inside, on) - heightAt(0.88, inside, base);
        const dOut = heightAt(0.88, outside, on) - heightAt(0.88, outside, base);
        expect(dIn).toBeGreaterThan(2.7);
        expect(dOut).toBeLessThan(0.3);
        expect(widthAt(0.88)).toBeGreaterThan(40);
    });
});

describe("Morton's store", () => {
    beforeEach(() => {
        localStorage.removeItem("vertex-design-session");
        useDesignStore.setState({
            design: structuredClone(useDesignStore.getInitialState().design),
            pendingSessionDesign: null,
            history: [],
            future: [],
        });
    });

    test("a new design has no mortons key", () => {
        expect(useDesignStore.getState().design.mortons).toBeUndefined();
        expect("mortons" in defaultDesign()).toBe(false);
    });

    test("linked feet share one mode and off clears both", () => {
        expect(useDesignStore.getState().design.corrections.linked).toBe(true);
        useDesignStore.getState().setMortons("left", { mode: "extension", amountMm: 3 });
        const linked = useDesignStore.getState().design.mortons;
        expect(linked?.left).toEqual({ mode: "extension", amountMm: 3 });
        expect(linked?.right).toEqual({ mode: "extension", amountMm: 3 });
        useDesignStore.getState().setMortons("right", null);
        expect(useDesignStore.getState().design.mortons).toBeUndefined();
    });

    test("unlinked feet keep separate modes", () => {
        useDesignStore.getState().setLinked(false);
        useDesignStore.getState().setMortons("left", { mode: "extension", amountMm: 3 });
        useDesignStore.getState().setMortons("right", { mode: "reverse", amountMm: 2.5 });
        const d = useDesignStore.getState().design;
        expect(d.mortons?.left).toEqual({ mode: "extension", amountMm: 3 });
        expect(d.mortons?.right).toEqual({ mode: "reverse", amountMm: 2.5 });
        useDesignStore.getState().setLinked(true);
        const mirrored = useDesignStore.getState().design.mortons;
        expect(mirrored?.right).toEqual(mirrored?.left);
        expect(mirrored?.left?.mode).toBe("extension");
    });
});
