// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import {
    applyBaseModifiers,
    BASE_BOTTOM_DELTA_TOLERANCE_MM,
    classifyBaseTopFactors,
    detectArchSideSign,
    validateBaseResult,
} from "./base-modifier";
import type { HeightFieldParams } from "./height-field";
import type { Side, SideCorrections } from "@/types";

// --- Synthetic base mesh -----------------------------------------------------
// A closed (watertight) insole-like slab: flat bottom at thickness 0, a domed
// top, length along a chosen axis. Mirrors the sample Rhino STL convention
// (length along Y) and supports an asymmetric arch for medial-side detection.

interface MakeBaseOptions {
    lengthMm?: number;
    widthMm?: number;
    thickMm?: number;
    nx?: number;
    ny?: number;
    /** Extra top height (mm) biased toward the +width half in the midfoot. */
    asym?: number;
    lengthAxis?: 0 | 1 | 2;
    widthAxis?: 0 | 1 | 2;
    thickAxis?: 0 | 1 | 2;
}

function makeBase(opts: MakeBaseOptions = {}): BufferGeometry {
    const {
        lengthMm = 260,
        widthMm = 90,
        thickMm = 20,
        nx = 40,
        ny = 16,
        asym = 0,
        lengthAxis = 1,
        widthAxis = 0,
        thickAxis = 2,
    } = opts;

    const positions: number[] = [];
    const topGrid: number[][] = [];
    const bottomGrid: number[][] = [];
    let v = 0;

    const setXYZ = (lengthCoord: number, widthCoord: number, thickCoord: number) => {
        const p = [0, 0, 0];
        p[lengthAxis] = lengthCoord;
        p[widthAxis] = widthCoord;
        p[thickAxis] = thickCoord;
        positions.push(p[0]!, p[1]!, p[2]!);
        return v++;
    };

    // Domed top contour: arch along length, plus optional medial-side bias.
    const topContour = (u: number, vNorm: number): number => {
        const arch = 6 * Math.sin(Math.PI * u) * (1 - 0.4 * Math.abs(vNorm));
        const bias = asym * Math.max(0, vNorm) * Math.sin(Math.PI * u);
        return thickMm + arch + bias;
    };

    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const topRow: number[] = [];
        const bottomRow: number[] = [];
        for (let j = 0; j <= ny; j++) {
            const vNorm = (j / ny) * 2 - 1;
            const lengthCoord = u * lengthMm;
            const widthCoord = vNorm * (widthMm / 2);
            topRow.push(setXYZ(lengthCoord, widthCoord, topContour(u, vNorm)));
            bottomRow.push(setXYZ(lengthCoord, widthCoord, 0));
        }
        topGrid.push(topRow);
        bottomGrid.push(bottomRow);
    }

    const indices: number[] = [];
    const quad = (a: number, b: number, c: number, d: number) => indices.push(a, b, c, a, c, d);

    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            quad(topGrid[i]![j]!, topGrid[i]![j + 1]!, topGrid[i + 1]![j + 1]!, topGrid[i + 1]![j]!);
            quad(
                bottomGrid[i]![j]!,
                bottomGrid[i + 1]![j]!,
                bottomGrid[i + 1]![j + 1]!,
                bottomGrid[i]![j + 1]!,
            );
        }
    }
    // Side walls (4 boundaries) close the slab into a watertight solid.
    for (let i = 0; i < nx; i++) {
        quad(topGrid[i]![0]!, topGrid[i + 1]![0]!, bottomGrid[i + 1]![0]!, bottomGrid[i]![0]!);
        quad(topGrid[i]![ny]!, bottomGrid[i]![ny]!, bottomGrid[i + 1]![ny]!, topGrid[i + 1]![ny]!);
    }
    for (let j = 0; j < ny; j++) {
        quad(topGrid[0]![j]!, bottomGrid[0]![j]!, bottomGrid[0]![j + 1]!, topGrid[0]![j + 1]!);
        quad(topGrid[nx]![j]!, topGrid[nx]![j + 1]!, bottomGrid[nx]![j + 1]!, bottomGrid[nx]![j]!);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function corrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 2,
        archHeightMm: 6,
        heelCupDepthMm: 0,
        heelCupHeightMm: 8,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function field(side: Side): HeightFieldParams {
    return {
        side,
        lengthMm: 260,
        widthMm: 95,
        // Default reference thickness ⇒ no directional thickness lift, so the
        // test isolates correction-driven top movement.
        thicknessMm: 3,
        corrections: corrections(),
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

describe("base-modifier top/bottom separation", () => {
    test("preserves the bottom while lifting the top (Y-length base, like the sample STL)", () => {
        const base = makeBase({ lengthAxis: 1, widthAxis: 0, thickAxis: 2 });
        const modified = applyBaseModifiers(base, field("right"), 0);
        const metrics = validateBaseResult(base, modified);

        // Bottom surface stays faithful to the original base.
        expect(metrics.maxBottomDeltaMm).toBeLessThan(BASE_BOTTOM_DELTA_TOLERANCE_MM);
        expect(metrics.bottomStable).toBe(true);
        // Top surface responds to corrections.
        expect(metrics.topVertexCount).toBeGreaterThan(0);
        expect(metrics.avgTopLiftMm).toBeGreaterThan(0.1);
        // Topology stays consistent (two-manifold ⇒ consistent normals).
        expect(metrics.normalsConsistent).toBe(true);
    });

    test("classifies a clear bottom sheet (not the null fallback)", () => {
        const base = makeBase();
        const factors = classifyBaseTopFactors(base);
        expect(factors).not.toBeNull();
        // Some vertices fully top, some fully bottom.
        let top = 0;
        let bottom = 0;
        for (const f of factors!) {
            if (f > 0.9) top++;
            if (f < 0.1) bottom++;
        }
        expect(top).toBeGreaterThan(0);
        expect(bottom).toBeGreaterThan(0);
    });

    test("bottom stays stable regardless of detected orientation (left + right)", () => {
        for (const side of ["left", "right"] as Side[]) {
            const base = makeBase({ asym: 4 });
            const modified = applyBaseModifiers(base, field(side), 1);
            const metrics = validateBaseResult(base, modified);
            expect(metrics.maxBottomDeltaMm).toBeLessThan(BASE_BOTTOM_DELTA_TOLERANCE_MM);
        }
    });
});

describe("base-modifier medial/lateral inference", () => {
    test("symmetric base ⇒ no flip", () => {
        const base = makeBase({ asym: 0 });
        expect(detectArchSideSign(base)).toBe(1);
    });

    test("arch taller on +width half ⇒ +1", () => {
        const base = makeBase({ asym: 4 });
        expect(detectArchSideSign(base)).toBe(1);
    });

    test("arch taller on -width half ⇒ -1", () => {
        const base = makeBase({ asym: -4 });
        expect(detectArchSideSign(base)).toBe(-1);
    });

    test("orientation works on a transposed (X-length) base too", () => {
        const base = makeBase({ lengthAxis: 0, widthAxis: 1, thickAxis: 2, asym: 4 });
        // Arch still detected on the +width half (now axis Y).
        expect(detectArchSideSign(base)).toBe(1);
        const modified = applyBaseModifiers(base, field("right"), 0);
        const metrics = validateBaseResult(base, modified);
        expect(metrics.maxBottomDeltaMm).toBeLessThan(BASE_BOTTOM_DELTA_TOLERANCE_MM);
    });
});
