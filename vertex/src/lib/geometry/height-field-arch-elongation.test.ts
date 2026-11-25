// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import type { Side, SideCorrections } from "@/types";
import { type HeightFieldParams, heightAt } from "./height-field";

/** Height-field hash on main b18be414 with arch ease 0 (no elongation key). */
const MAIN_EASE_ZERO_HASH = 3677847511;

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

function sampleHash(patch: Partial<SideCorrections>): number {
    const layout = insoleLayoutForUsMenSize(9);
    const sets: SideCorrections[] = [
        zeros(patch),
        zeros({ ...patch, archHeightMm: 8 }),
        zeros({ ...patch, archHeightMm: 8, apexMoveMm: -6 }),
        zeros({ ...patch, archHeightMm: -4, heelCupDepthMm: 14, heelLiftMm: 3 }),
    ];
    let hash = 2166136261;
    for (const corrections of sets) {
        for (const side of ["left", "right"] as const) {
            for (let ui = 0; ui <= 20; ui++) {
                for (let vi = 0; vi <= 10; vi++) {
                    const value = heightAt(ui / 20, vi / 5 - 1, {
                        side,
                        lengthMm: layout.lengthMm,
                        widthMm: layout.widthMm,
                        thicknessMm: 3,
                        corrections,
                        elements: [],
                    });
                    const bits = new Uint32Array(new Float64Array([value]).buffer);
                    hash ^= bits[0]!;
                    hash = Math.imul(hash, 16777619);
                    hash ^= bits[1]!;
                    hash = Math.imul(hash, 16777619);
                }
            }
        }
    }
    return hash >>> 0;
}

function f64FromHex(hex: string): number {
    const buf = new ArrayBuffer(8);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < 8; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return new Float64Array(buf)[0]!;
}

interface DomeMeasure {
    peakMm: number;
    apexMm: number;
    spanMm: number;
    rearMm: number;
    foreMm: number;
    surfaceAtApexMm: number;
}

function measureDome(
    lengthMm: number,
    widthMm: number,
    side: Side,
    elongationMm: number,
    archHeightMm: number,
    apexMoveMm: number,
): DomeMeasure {
    const field = (archHeight: number, elongation: number): HeightFieldParams => ({
        side,
        lengthMm,
        widthMm,
        thicknessMm: 3,
        elements: [],
        corrections: zeros({
            archHeightMm: archHeight,
            archElongationMm: elongation,
            apexMoveMm,
        }),
    });
    const raised = field(archHeightMm, elongationMm);
    const flat = field(0, elongationMm);
    const dome = (u: number, v: number) => heightAt(u, v, raised) - heightAt(u, v, flat);
    const apexU = 0.42 + apexMoveMm / lengthMm;

    let bestV = side === "right" ? -0.55 : 0.55;
    let bestAtApex = -Infinity;
    for (let v = -0.95; v <= 0.95; v += 0.05) {
        const z = dome(apexU, v);
        if (z > bestAtApex) {
            bestAtApex = z;
            bestV = v;
        }
    }

    const stepMm = 0.05;
    const du = stepMm / lengthMm;
    let peakMm = -Infinity;
    let peakU = apexU;
    for (let u = 0.02; u <= 0.98; u += du) {
        const z = dome(u, bestV);
        if (z > peakMm) {
            peakMm = z;
            peakU = u;
        }
    }

    const half = peakMm * 0.5;
    let lo = 0.02;
    let hi = 0.98;
    let prevU = 0.02;
    let prevZ = dome(0.02, bestV);
    let foundLo = false;
    for (let u = 0.02 + du; u <= 0.98; u += du) {
        const z = dome(u, bestV);
        if (!foundLo && prevZ < half && z >= half) {
            const t = (half - prevZ) / (z - prevZ);
            lo = prevU + t * (u - prevU);
            foundLo = true;
        } else if (foundLo && prevZ >= half && z < half) {
            const t = (half - prevZ) / (z - prevZ);
            hi = prevU + t * (u - prevU);
            break;
        }
        prevU = u;
        prevZ = z;
    }

    const apexMm = peakU * lengthMm;
    const loMm = lo * lengthMm;
    const hiMm = hi * lengthMm;
    return {
        peakMm,
        apexMm,
        spanMm: hiMm - loMm,
        rearMm: apexMm - loMm,
        foreMm: hiMm - apexMm,
        surfaceAtApexMm: heightAt(apexU, bestV, raised),
    };
}

describe("arch elongation height field", () => {
    test("elongation 0 matches main with arch ease 0, and a stored ease does not move the surface", () => {
        expect(sampleHash({})).toBe(MAIN_EASE_ZERO_HASH);
        expect(sampleHash({ archElongationMm: 0 })).toBe(MAIN_EASE_ZERO_HASH);
        expect(sampleHash({ archEaseMm: 6 })).toBe(MAIN_EASE_ZERO_HASH);
        expect(sampleHash({ archEaseMm: 6, archElongationMm: 0 })).toBe(MAIN_EASE_ZERO_HASH);

        const layout = insoleLayoutForUsMenSize(9);
        const at = (u: number, v: number, archHeightMm: number) =>
            heightAt(u, v, {
                side: "right",
                lengthMm: layout.lengthMm,
                widthMm: layout.widthMm,
                thicknessMm: 3,
                elements: [],
                corrections: zeros({ archHeightMm }),
            });
        expect(at(0, -1, 0)).toBe(f64FromHex("0000000000002e40"));
        expect(at(0.42, -0.55, 8)).toBe(f64FromHex("f4a6d6fd85073140"));
    });

    test("5 mm elongation keeps the dome peak and apex and lengthens the half-peak span by about 5 mm", () => {
        for (const menSize of [9, 11.5]) {
            const layout = insoleLayoutForUsMenSize(menSize);
            for (const side of ["right", "left"] as const) {
                for (const apexMoveMm of [0, 4, -8]) {
                    const rest = measureDome(layout.lengthMm, layout.widthMm, side, 0, 8, apexMoveMm);
                    const stretched = measureDome(layout.lengthMm, layout.widthMm, side, 5, 8, apexMoveMm);
                    const over = measureDome(layout.lengthMm, layout.widthMm, side, 9, 8, apexMoveMm);
                    expect(
                        Math.abs(stretched.peakMm - rest.peakMm),
                        `${menSize} ${side} peak`,
                    ).toBeLessThanOrEqual(0.01);
                    expect(
                        Math.abs(stretched.apexMm - rest.apexMm),
                        `${menSize} ${side} apex`,
                    ).toBeLessThanOrEqual(0.01);
                    const growth = stretched.spanMm - rest.spanMm;
                    expect(growth, `${menSize} ${side} span growth ${growth}`).toBeGreaterThan(4.9);
                    expect(growth, `${menSize} ${side} span growth ${growth}`).toBeLessThanOrEqual(5.01);
                    expect(over.spanMm - rest.spanMm).toBeLessThanOrEqual(5.01);
                    expect(Math.abs(over.spanMm - stretched.spanMm)).toBeLessThan(0.02);
                    const rearGrowth = stretched.rearMm - rest.rearMm;
                    const foreGrowth = stretched.foreMm - rest.foreMm;
                    expect(rearGrowth).toBeGreaterThan(2.2);
                    expect(foreGrowth).toBeGreaterThan(2.2);
                    expect(Math.abs(rearGrowth - foreGrowth)).toBeLessThan(0.15);
                }
            }
        }
    });
});
