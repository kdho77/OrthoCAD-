// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { toeFirstOrientMatrix } from "./belt-orient";
import {
    applyAxisMap,
    BeltConfigError,
    type BeltTransformConfig,
    beltToMachine,
    extrusionPerMm,
    FLOW_ANCHOR_E,
    FLOW_ANCHOR_SEGMENT_MM,
    layerBeltZ,
    machineToBelt,
    orientationDeterminant,
    perpendicularThicknessMm,
    resolveBeltConfig,
    rotateBeltToSliceFrame,
    sliceFrameToMachine,
    slicePitchRotatedMm,
    TOE_FIRST_ORIENT_MATRIX,
} from "./belt-transform";
import { PRINTER_PRESETS } from "./presets";

function cfg(over: Partial<BeltTransformConfig> = {}): BeltTransformConfig {
    const apex = PRINTER_PRESETS.find((p) => p.id === "apex-belt-v2")!;
    return { ...resolveBeltConfig(apex), ...over };
}

describe("beltToMachine (R2)", () => {
    test("1 — origin maps to zeros", () => {
        const m = beltToMachine({ x: 0, y: 0, z: 0 }, cfg());
        expect(m.across).toBeCloseTo(0, 9);
        expect(m.gantry).toBeCloseTo(0, 9);
        expect(m.belt).toBeCloseTo(0, 9);
    });

    test("2 — (0,0,10) at 45° → gantry 10√2, belt 10", () => {
        const m = beltToMachine({ x: 0, y: 0, z: 10 }, cfg());
        expect(m.across).toBeCloseTo(0, 6);
        expect(m.gantry).toBeCloseTo(10 * Math.SQRT2, 6);
        expect(m.belt).toBeCloseTo(10, 6);
    });

    test("3 — (5,20,10) at 45° → across 5, gantry 10√2, belt 30", () => {
        const m = beltToMachine({ x: 5, y: 20, z: 10 }, cfg());
        expect(m.across).toBeCloseTo(5, 6);
        expect(m.gantry).toBeCloseTo(10 * Math.SQRT2, 6);
        expect(m.belt).toBeCloseTo(30, 6);
    });

    test("4 — machineToBelt(beltToMachine(p)) round-trip, 1000 points", () => {
        const c = cfg();
        for (let i = 0; i < 1000; i++) {
            const p = {
                x: ((i * 17) % 200) - 50,
                y: ((i * 31) % 300) - 20,
                z: (i * 13) % 80,
            };
            const back = machineToBelt(beltToMachine(p, c), c);
            expect(back.x).toBeCloseTo(p.x, 9);
            expect(back.y).toBeCloseTo(p.y, 9);
            expect(back.z).toBeCloseTo(p.z, 9);
        }
    });

    test("5 — θ = 30° and 60° match z/sinθ and y + z/tanθ", () => {
        for (const deg of [30, 60]) {
            const c = cfg({ beltGantryAngleDeg: deg });
            const t = (deg * Math.PI) / 180;
            const p = { x: 3, y: 8, z: 12 };
            const m = beltToMachine(p, c);
            expect(m.across).toBeCloseTo(3, 9);
            expect(m.gantry).toBeCloseTo(12 / Math.sin(t), 9);
            expect(m.belt).toBeCloseTo(8 + 12 / Math.tan(t), 9);
        }
    });

    test("6 — belt step is layerHeightMm; perp thickness = h·sinθ", () => {
        const c = cfg({ layerHeightMm: 0.65, beltGantryAngleDeg: 45 });
        expect(layerBeltZ(0, 0.65)).toBeCloseTo(0.65, 9);
        expect(layerBeltZ(1, 0.65)).toBeCloseTo(1.3, 9);
        expect(slicePitchRotatedMm(c)).toBeCloseTo(0.65 * Math.sin(Math.PI / 4), 5);
        expect(perpendicularThicknessMm(c)).toBeCloseTo(0.45962, 5);
        expect(slicePitchRotatedMm(c)).toBeCloseTo(0.45962, 5);
    });

    test("7 — beltLeanSign = −1 flips belt term only", () => {
        const p = { x: 4, y: 9, z: 6 };
        const pos = beltToMachine(p, cfg({ beltLeanSign: 1 }));
        const neg = beltToMachine(p, cfg({ beltLeanSign: -1 }));
        expect(neg.across).toBeCloseTo(pos.across, 9);
        expect(neg.gantry).toBeCloseTo(pos.gantry, 9);
        expect(neg.belt).toBeCloseTo(9 - 6, 9);
        expect(pos.belt).toBeCloseTo(9 + 6, 9);
    });

    test("8 — beltAxisMap permutation changes emitted letters", () => {
        const m = beltToMachine({ x: 1, y: 2, z: 3 }, cfg());
        const def = applyAxisMap(m, { across: "X", gantry: "Y", belt: "Z" });
        const perm = applyAxisMap(m, { across: "Y", gantry: "Z", belt: "X" });
        expect(def.X).toBeCloseTo(m.across, 9);
        expect(def.Y).toBeCloseTo(m.gantry, 9);
        expect(def.Z).toBeCloseTo(m.belt, 9);
        expect(perm.Y).toBeCloseTo(m.across, 9);
        expect(perm.Z).toBeCloseTo(m.gantry, 9);
        expect(perm.X).toBeCloseTo(m.belt, 9);
    });

    test("rotated-frame emit identity: sliceFrameToMachine(rotate(p)) == beltToMachine(p)", () => {
        const c = cfg();
        for (const p of [
            { x: 0, y: 0, z: 0 },
            { x: 5, y: 20, z: 10 },
            { x: -2, y: 3, z: 7 },
            { x: 11, y: 0, z: 4 },
        ]) {
            const got = sliceFrameToMachine(rotateBeltToSliceFrame(p, c), c);
            const exp = beltToMachine(p, c);
            expect(got.across).toBeCloseTo(exp.across, 9);
            expect(got.gantry).toBeCloseTo(exp.gantry, 9);
            expect(got.belt).toBeCloseTo(exp.belt, 9);
        }
        const c45 = cfg();
        const p = { x: 1, y: 2, z: 3 };
        const r = rotateBeltToSliceFrame(p, c45);
        const m = sliceFrameToMachine(r, c45);
        expect(m.gantry).toBeCloseTo(r.z - r.y, 9);
        expect(m.belt).toBeCloseTo(r.z * Math.SQRT2, 9);
    });

    test("θ outside (0, 90) is rejected", () => {
        expect(() => beltToMachine({ x: 0, y: 0, z: 1 }, cfg({ beltGantryAngleDeg: 0 }))).toThrow(
            BeltConfigError,
        );
        expect(() => beltToMachine({ x: 0, y: 0, z: 1 }, cfg({ beltGantryAngleDeg: 90 }))).toThrow(
            BeltConfigError,
        );
    });

    test("orientation determinant is +1 for both sides", () => {
        expect(orientationDeterminant(TOE_FIRST_ORIENT_MATRIX)).toBeCloseTo(1, 12);
        expect(orientationDeterminant(toeFirstOrientMatrix())).toBeCloseTo(1, 12);
    });

    test("flow anchor: 15.20 mm path → E = 1.38016 ± 0.0008", () => {
        const e = extrusionPerMm(cfg()) * FLOW_ANCHOR_SEGMENT_MM;
        expect(e).toBeGreaterThanOrEqual(FLOW_ANCHOR_E - 0.0008);
        expect(e).toBeLessThanOrEqual(FLOW_ANCHOR_E + 0.0008);
    });

    test("R4 — E scales as sinθ at 30° and 60°", () => {
        const e45 = extrusionPerMm(cfg({ beltGantryAngleDeg: 45 }));
        const e30 = extrusionPerMm(cfg({ beltGantryAngleDeg: 30 }));
        const e60 = extrusionPerMm(cfg({ beltGantryAngleDeg: 60 }));
        const s45 = Math.sin(Math.PI / 4);
        expect(e30 / e45).toBeCloseTo(Math.sin(Math.PI / 6) / s45, 9);
        expect(e60 / e45).toBeCloseTo(Math.sin(Math.PI / 3) / s45, 9);
    });
});
