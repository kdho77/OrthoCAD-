// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { countJunctionBandSlivers } from "./metrics";
import { repairInvertedBottomFaces, splitAcuteTriangles } from "./reconstruct";

function edgeUses(indices: number[]): Map<string, number> {
    const use = new Map<string, number>();
    const bump = (a: number, b: number): void => {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        use.set(key, (use.get(key) ?? 0) + 1);
    };
    for (let t = 0; t < indices.length; t += 3) {
        bump(indices[t]!, indices[t + 1]!);
        bump(indices[t + 1]!, indices[t + 2]!);
        bump(indices[t + 2]!, indices[t]!);
    }
    return use;
}

function ribbonMesh(): { positions: number[]; indices: number[]; band: Set<number> } {
    // 20×1 last strip plus plantar on B-B and an upper strip on P-P.
    const B0 = 0;
    const B1 = 1;
    const P0 = 2;
    const P1 = 3;
    const S = 4;
    const U0 = 5;
    const U1 = 6;
    const positions = [0, 0, 0, 20, 0, 0, 0, 0, 1, 20, 0, 1, 10, 5, 0, 0, 0, 2, 20, 0, 2];
    const indices = [P0, B1, P1, P0, B0, B1, B0, B1, S, U0, P1, U1, U0, P0, P1];
    return { positions, indices, band: new Set([B0, B1]) };
}

describe("splitAcuteTriangles", () => {
    test("splits the 20:1 last-strip ribbon so junction min-angle is at least 5deg", () => {
        const { positions, indices, band } = ribbonMesh();
        const before = new BufferGeometry();
        before.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
        before.setIndex(indices.slice());
        expect(countJunctionBandSlivers(before, band, 20, 5)).toBeGreaterThan(0);

        splitAcuteTriangles(positions, indices, 0, band);

        const after = new BufferGeometry();
        after.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
        after.setIndex(indices);
        expect(countJunctionBandSlivers(after, band, 20, 5)).toBe(0);
        for (const [key, n] of edgeUses(indices)) {
            const [a, b] = key.split(",").map(Number);
            if ((a ?? 0) >= 7 || (b ?? 0) >= 7) expect(n).toBe(2);
        }
        before.dispose();
        after.dispose();
    });
});

describe("repairInvertedBottomFaces", () => {
    test("retiles an upward bottom ear with its neighbor and leaves a clean disk alone", () => {
        // A(0,0) B(1,0) C(0.5,0.05) is a thin CCW ear. Neighbor B-A-S points down.
        const positions = [0, 0, 0, 1, 0, 0, 0.5, 0.05, 0, 0.5, 1, 0];
        const indices = [0, 1, 2, 1, 0, 3];
        const before = indices.slice();
        const n = repairInvertedBottomFaces(positions, indices);
        expect(n).toBe(1);
        expect(indices).not.toEqual(before);
        for (let t = 0; t < indices.length; t += 3) {
            const a = indices[t]!;
            const b = indices[t + 1]!;
            const c = indices[t + 2]!;
            const nz =
                (positions[b * 3]! - positions[a * 3]!) * (positions[c * 3 + 1]! - positions[a * 3 + 1]!) -
                (positions[b * 3 + 1]! - positions[a * 3 + 1]!) * (positions[c * 3]! - positions[a * 3]!);
            expect(nz).toBeLessThan(0);
        }
        const use = edgeUses(indices);
        let twice = 0;
        let once = 0;
        for (const nUse of use.values()) {
            expect(nUse).toBeLessThanOrEqual(2);
            if (nUse === 2) twice++;
            if (nUse === 1) once++;
        }
        expect(twice).toBe(1);
        expect(once).toBe(4);

        const clean = [0, 3, 1, 3, 2, 1];
        const cleanPos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
        const copy = clean.slice();
        expect(repairInvertedBottomFaces(cleanPos, copy)).toBe(0);
        expect(copy).toEqual(clean);
    });

    test("replaces an inverted three-face cap with its downward base", () => {
        // C sits on the wrong side of triangle A-B-S2. The star A-B-C, B-S2-C, C-S2-A
        // sums to the base, and every single-edge flip leaves one upward triangle.
        // Neighbor B-A-S of edge A-B must stay.
        const A = [266.955658, -19.797298, 0];
        const B = [266.921661, -19.735203, 0];
        const C = [266.862488, -19.760811, 0];
        const S = [266.595398, -19.599426, 0];
        const S2 = [266.977631, -19.741913, 0];
        const positions = [...A, ...B, ...C, ...S, ...S2];
        const indices = [
            1,
            0,
            3, // B A S
            1,
            4,
            2, // B S2 C
            2,
            4,
            0, // C S2 A
            0,
            1,
            2, // A B C upward
        ];
        const n = repairInvertedBottomFaces(positions, indices);
        expect(n).toBe(1);
        expect(indices.length).toBe(6);
        const nzOf = (t: number) => {
            const a = indices[t]!;
            const b = indices[t + 1]!;
            const c = indices[t + 2]!;
            return (
                (positions[b * 3]! - positions[a * 3]!) * (positions[c * 3 + 1]! - positions[a * 3 + 1]!) -
                (positions[b * 3 + 1]! - positions[a * 3 + 1]!) * (positions[c * 3]! - positions[a * 3]!)
            );
        };
        expect(nzOf(0)).toBeLessThan(0);
        expect(nzOf(3)).toBeLessThan(0);
        const used = new Set(indices);
        expect(used.has(2)).toBe(false);
        const use = edgeUses(indices);
        expect(use.get("0,1")).toBe(2);
        for (const nUse of use.values()) expect(nUse).toBeLessThanOrEqual(2);
    });
});
