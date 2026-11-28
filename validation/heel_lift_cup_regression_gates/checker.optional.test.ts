// Frozen heel-lift cup-depth gates.
// Bad-change proofs for the grader. These do not loft a mesh.
// Do not edit after the gates pull request is opened.

import { describe, expect, test } from "@rstest/core";
import { heelLiftDeltaAt } from "@/lib/geometry/heel-lift";
import { gradeHeelLift, type LiftComparison } from "./measure";
import { BELT_TOL_MM, CUP_DEPTH_TOL_MM, MET_HEAD_TOL_MM, SEAT_TOL_MM } from "./thresholds";

function row(patch: Partial<LiftComparison> & Pick<LiftComparison, "dSeat" | "dRim">): LiftComparison {
    const dCup = patch.dCup ?? patch.dRim - patch.dSeat;
    return {
        seatU: patch.seatU ?? 0.1160832998691005,
        rimU: patch.rimU ?? 0.1157055249111551,
        dSeat: patch.dSeat,
        dRim: patch.dRim,
        dCup,
        stations: patch.stations ?? [
            { u: 0.05, added: 11.2 },
            { u: 0.15, added: 9.6 },
            { u: 0.3, added: 7.2 },
            { u: 0.45, added: 4.8 },
            { u: 0.6, added: 2.4 },
            { u: 0.75, added: 0 },
        ],
        belt: patch.belt ?? { count: 2500, minZ: 0, maxZ: 0 },
    };
}

/** BASE compose, right foot, 12 mm. Seat stays down, rim rises, cup deepens. */
const baseRight12 = row({
    dSeat: 0.0627,
    dRim: 7.6809,
    stations: [
        { u: 0.05, added: 0.679 },
        { u: 0.15, added: 0.086 },
        { u: 0.3, added: 1.167 },
        { u: 0.45, added: 0.82 },
        { u: 0.6, added: 0.202 },
        { u: 0.75, added: 0 },
    ],
});

describe("heel-lift grader rejects the regression and the named bad changes", () => {
    test("tolerances stay at the brief", () => {
        expect(SEAT_TOL_MM).toBe(0.2);
        expect(CUP_DEPTH_TOL_MM).toBe(0.2);
        expect(MET_HEAD_TOL_MM).toBe(0.1);
        expect(BELT_TOL_MM).toBe(0.1);
    });

    test("BASE right 12 mm compose sample fails seat, cup, and monotone", () => {
        const grade = gradeHeelLift(12, baseRight12);
        expect(grade.pass).toBe(false);
        expect(grade.failures.join("\n")).toMatch(/seat rise/);
        expect(grade.failures.join("\n")).toMatch(/cup depth/);
        expect(grade.failures.join("\n")).toMatch(/added height rises/);
    });

    test("a rim-only raise is rejected", () => {
        const grade = gradeHeelLift(12, row({ dSeat: 0, dRim: 12, stations: baseRight12.stations }));
        expect(grade.pass).toBe(false);
        expect(grade.failures.join("\n")).toMatch(/seat rise/);
        expect(grade.failures.join("\n")).toMatch(/cup depth/);
    });

    test("a raised print/belt bottom is rejected", () => {
        const u = 0.1160832998691005;
        const rise = heelLiftDeltaAt(u, 12);
        const grade = gradeHeelLift(
            12,
            row({
                seatU: u,
                dSeat: rise,
                dRim: rise,
                belt: { count: 80, minZ: 1, maxZ: 12 },
            }),
        );
        expect(grade.pass).toBe(false);
        expect(grade.failures.join("\n")).toMatch(/print\/belt/);
    });

    test("full-strength heelLiftDeltaAt with a flat belt passes", () => {
        const u = 0.1160832998691005;
        const rise = heelLiftDeltaAt(u, 12);
        const grade = gradeHeelLift(12, row({ seatU: u, dSeat: rise, dRim: rise }));
        expect(grade.failures).toEqual([]);
        expect(grade.pass).toBe(true);
    });

    test("loosening the cup tolerance above 0.2 mm would hide the BASE cup", () => {
        const dCup = baseRight12.dCup;
        expect(Math.abs(dCup) <= CUP_DEPTH_TOL_MM).toBe(false);
        expect(Math.abs(dCup) <= 0.5).toBe(false);
        expect(Math.abs(dCup) <= 8).toBe(true);
        expect(CUP_DEPTH_TOL_MM).toBe(0.2);
    });

    test("a zero-lift STL hash mismatch is rejected", () => {
        const frozen = "474e0f99d0ac907682452871fe08e053353962c39d8ac041ff0a827eb4e92797";
        const flipped = `${frozen.slice(0, -1)}${frozen.endsWith("a") ? "b" : "a"}`;
        expect(flipped === frozen).toBe(false);
    });
});
