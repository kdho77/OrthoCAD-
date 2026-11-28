// Frozen rigid heel-lift cup-depth gates.
// Synthetic rejection proofs. These do not build a production solid.
// Do not edit after the gates pull request is opened.

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { IndexedPoint, LiftComparison } from "./measure";
import {
    assertIsLowestHeelSeat,
    compareLift,
    gradeHeelLift,
    sampleSheet,
    selectLowestHeelSeat,
} from "./measure";
import { CUP_DEPTH_TOL_MM, LIFT_MM, SEAT_TOL_MM } from "./thresholds";

const proofPath = resolve(process.cwd(), "validation/heel_lift_rigid_cup_gates/proofs/bad-sample.log");
function note(line: string) {
    appendFileSync(proofPath, `${line}\n`);
}

function plateFlat() {
    return { meshMinZ: 0, plantarAbsMaxZ: 0, zeroMeshMinZ: 0, zeroPlantarAbsMaxZ: 0 };
}

function beltFlat() {
    return { count: 2500, minZ: 0, maxZ: 4 };
}

function rigidRow(H: number, patch: Partial<LiftComparison> = {}): LiftComparison {
    return {
        seatU: 0.12,
        seatV: 0,
        seatZ0: 2,
        rimU: 0.12,
        rimZ0: 14,
        cupDepth0: 12,
        dSeat: H,
        dRim: H,
        dCup: 0,
        dMetMin: 0,
        dMetMax: 0,
        stations: [
            { u: 0.05, added: H },
            { u: 0.15, added: H * 0.9 },
            { u: 0.3, added: H * 0.6 },
            { u: 0.45, added: H * 0.4 },
            { u: 0.6, added: H * 0.2 },
        ],
        belt: beltFlat(),
        plate: plateFlat(),
        ...patch,
    };
}

function put(pos: Float32Array, i: number, x: number, y: number, z: number) {
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
}

/**
 * A sheet whose lowest heel vertex is not the higher midline point, and whose
 * forefoot is lower than the heel. The cup center is index 4.
 */
function cupSheet(): { pos: Float32Array; rim: number[]; seat: number; decoy: number } {
    const pos = new Float32Array(19 * 3);
    put(pos, 0, 0, -40, 8);
    put(pos, 1, 0, 40, 8);
    put(pos, 2, 100, -40, 8);
    put(pos, 3, 100, 40, 8);
    put(pos, 4, 12, 0, 2);
    put(pos, 5, 16, 0, 6.5);
    put(pos, 6, 12, 8, 9);
    put(pos, 7, 80, 0, 0.4);
    put(pos, 8, 5, 0, 4);
    put(pos, 9, 15, 0, 4);
    put(pos, 10, 30, 0, 4);
    put(pos, 11, 45, 0, 4);
    put(pos, 12, 60, 0, 4);
    put(pos, 13, 75.2, 0, 4);
    put(pos, 14, 75.8, 2, 4);
    put(pos, 15, 76.4, -2, 4);
    put(pos, 16, 77.0, 1, 4);
    put(pos, 17, 77.6, -1, 4);
    put(pos, 18, 12, 36, 14);
    return { pos, rim: [0, 1, 2, 3, 18], seat: 4, decoy: 5 };
}

describe("rigid heel-lift bad-change rejection", () => {
    test("the seat sample is the lowest heel point, not a higher or forefoot point", () => {
        const sheet = cupSheet();
        const sample = sampleSheet(sheet.pos, sheet.rim);
        expect(sample.seat.i).toBe(sheet.seat);
        expect(sample.seat.z).toBe(2);
        expect(sample.rim.i).toBe(18);
        assertIsLowestHeelSeat(sheet.pos, sheet.rim, sheet.seat);
        expect(() => assertIsLowestHeelSeat(sheet.pos, sheet.rim, sheet.decoy)).toThrow(/lowest heel-seat/);

        const higher: IndexedPoint = { i: 5, u: 0.16, v: 0, z: 6.5 };
        const lowest: IndexedPoint = { i: 4, u: 0.12, v: 0, z: 2 };
        expect(selectLowestHeelSeat([higher, lowest]).i).toBe(4);

        const lifted = new Float32Array(sheet.pos);
        lifted[sheet.decoy * 3 + 2] = 16.5;
        const row = compareLift(sample, sheet.pos, lifted, beltFlat(), plateFlat());
        const grade = gradeHeelLift(10, row);
        expect(row.dSeat).toBe(0);
        expect(grade.pass).toBe(false);
        expect(grade.failures.join("\n")).toContain("seat rise");
        const decoyRise =
            (lifted[sheet.decoy * 3 + 2] ?? Number.NaN) - (sheet.pos[sheet.decoy * 3 + 2] ?? Number.NaN);
        expect(decoyRise).toBe(10);
        note("PASS bad-sample: non-lowest seat measurement rejected");
    });

    test("seat-only, rim-only, belt, plate, met, and published BASE rows are rejected", () => {
        const seatOnly = gradeHeelLift(12, rigidRow(12, { dRim: 0, dCup: -12 }));
        expect(seatOnly.pass).toBe(false);
        expect(seatOnly.failures.join("\n")).toContain("cup depth");
        note("PASS bad-sample: seat-only raise rejected (cup shallower)");

        const rimOnly = gradeHeelLift(12, rigidRow(12, { dSeat: 0, dRim: 12, dCup: 12 }));
        expect(rimOnly.pass).toBe(false);
        expect(rimOnly.failures.join("\n")).toContain("seat rise");
        expect(rimOnly.failures.join("\n")).toContain("cup depth");
        note("PASS bad-sample: rim-only raise rejected (cup deeper)");

        const belt = gradeHeelLift(10, rigidRow(10, { belt: { count: 0, minZ: 1, maxZ: 1 } }));
        expect(belt.pass).toBe(false);
        expect(belt.failures.join("\n")).toContain("print/belt");
        note("PASS bad-sample: belt raise rejected");

        const mesh = gradeHeelLift(
            10,
            rigidRow(10, {
                plate: { meshMinZ: 1.2, plantarAbsMaxZ: 0, zeroMeshMinZ: 0, zeroPlantarAbsMaxZ: 0 },
            }),
        );
        expect(mesh.pass).toBe(false);
        expect(mesh.failures.join("\n")).toContain("meshMinZ");
        note("PASS bad-sample: meshMinZ change rejected");

        const plantar = gradeHeelLift(
            10,
            rigidRow(10, {
                plate: { meshMinZ: 0, plantarAbsMaxZ: 0.8, zeroMeshMinZ: 0, zeroPlantarAbsMaxZ: 0 },
            }),
        );
        expect(plantar.pass).toBe(false);
        expect(plantar.failures.join("\n")).toContain("plantarAbsMaxZ");
        note("PASS bad-sample: plantarAbsMaxZ change rejected");

        const met = gradeHeelLift(6, rigidRow(6, { dMetMin: 0, dMetMax: 0.5 }));
        expect(met.pass).toBe(false);
        expect(met.failures.join("\n")).toContain("met-head");
        note("PASS bad-sample: met-head rise rejected");

        const rising = gradeHeelLift(
            6,
            rigidRow(6, {
                dSeat: 6,
                stations: [
                    { u: 0.05, added: 1 },
                    { u: 0.15, added: 2 },
                    { u: 0.3, added: 3 },
                    { u: 0.45, added: 4 },
                    { u: 0.6, added: 5 },
                ],
            }),
        );
        expect(rising.pass).toBe(false);
        expect(rising.failures.join("\n")).toContain("added height rises");
        note("PASS bad-sample: non-monotonic taper rejected");

        const published12 = gradeHeelLift(12, rigidRow(12, { dSeat: 9.68, dRim: 7.96, dCup: 7.96 - 9.68 }));
        expect(published12.pass).toBe(false);
        expect(published12.failures.join("\n")).toContain("seat rise");
        expect(published12.failures.join("\n")).toContain("cup depth");
        const published6 = gradeHeelLift(6, rigidRow(6, { dSeat: 4.97, dRim: 3.98, dCup: 3.98 - 4.97 }));
        expect(published6.pass).toBe(false);
        expect(published6.failures.join("\n")).toContain("seat rise");
        expect(published6.failures.join("\n")).toContain("cup depth");
        note("PASS bad-sample: published BASE seat and cup measurements rejected");

        const edge = gradeHeelLift(10, rigidRow(10 + SEAT_TOL_MM - 0.01));
        expect(edge.pass, edge.failures.join(" | ")).toBe(true);
        const past = gradeHeelLift(10, rigidRow(10 + SEAT_TOL_MM + 0.01));
        expect(past.pass).toBe(false);
        expect(past.failures.join("\n")).toContain("seat rise");
        const cupPast = gradeHeelLift(
            10,
            rigidRow(10, { dRim: 10 + CUP_DEPTH_TOL_MM + 0.01, dCup: CUP_DEPTH_TOL_MM + 0.01 }),
        );
        expect(cupPast.pass).toBe(false);
        expect(cupPast.failures.join("\n")).toContain("cup depth");
        note("PASS bad-sample: ±0.3 mm seat and cup bounds hold");

        expect(LIFT_MM).toEqual([6, 10, 12]);
        const good = LIFT_MM.map((H) => gradeHeelLift(H, rigidRow(H)));
        expect(good.every((row) => row.pass)).toBe(true);
        note("PASS bad-sample: rigid lift accepted at H=6, 10, and 12");
    });
});
