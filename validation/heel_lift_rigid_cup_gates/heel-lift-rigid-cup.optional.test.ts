// Frozen rigid heel-lift cup-depth gates.
// Live production compose path. BASE fails: the cup center does not rise by the
// full H, and the cup depth changes. Do not edit after the gates pull request is opened.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import type { Side } from "@/types";
import { buildProductionSolid, comparison, stlSha256 } from "./build-solid";
import { gradeHeelLift, heelCupCandidates } from "./measure";
import { LIFT_MM } from "./thresholds";

interface FrozenHashes {
    base: string;
    "right-0": string;
    "left-0": string;
}

function loadFrozen(): FrozenHashes {
    const path = resolve(process.cwd(), "validation/heel_lift_rigid_cup_gates/frozen/stl-sha256.json");
    return JSON.parse(readFileSync(path, "utf8")) as FrozenHashes;
}

describe("rigid heel-lift cup-depth gates (SAMPLE_Top US M11 medium, compose path)", () => {
    test("seat, cup, taper, belt, and zero-lift identity at H=6, 10, and 12", async () => {
        const frozen = loadFrozen();
        const lines: string[] = [];
        const pass = (line: string) => lines.push(`PASS ${line}`);
        const fail = (line: string) => lines.push(`FAIL ${line}`);

        const built = new Map<string, BufferGeometry>();
        const keep = async (key: string, side: Side, heelLiftMm: number) => {
            const geo = await buildProductionSolid(side, heelLiftMm);
            built.set(key, geo);
            return geo;
        };

        // Left lifts are built before the right zero so a cross-foot write shows
        // up in the right STL hash.
        await keep("left-12", "left", 12);
        const right0a = await keep("right-0-a", "right", 0);
        await keep("left-10", "left", 10);
        const right0b = await keep("right-0-b", "right", 0);
        await keep("left-6", "left", 6);
        const left0 = await keep("left-0", "left", 0);
        for (const H of LIFT_MM) {
            await keep(`right-${H}`, "right", H);
        }

        const expectHash = (label: string, geo: BufferGeometry, want: string) => {
            const got = stlSha256(geo);
            if (got === want) pass(`identity ${label} ${got}`);
            else fail(`identity ${label} ${got} != frozen ${want}`);
        };
        expectHash("right-0-after-left-12", right0a, frozen["right-0"]);
        expectHash("right-0-after-left-10", right0b, frozen["right-0"]);
        expectHash("left-0", left0, frozen["left-0"]);
        const rightA = stlSha256(right0a);
        const rightB = stlSha256(right0b);
        if (rightA === rightB) pass("identity right zero is stable across left lifts");
        else fail(`identity right zero changed between left lifts ${rightA} vs ${rightB}`);

        for (const side of ["right", "left"] as const) {
            const zero = built.get(side === "right" ? "right-0-a" : "left-0");
            if (!zero) throw new Error(`missing ${side} lift 0`);
            const sheet = zero.userData.heelGateTop as Float32Array;
            const rim = zero.userData.heelGateRim as number[];
            const lowest = heelCupCandidates(sheet, rim).slice(0, 5);
            const brief = lowest
                .map((p) => `i=${p.i} u=${p.u.toFixed(3)} v=${p.v.toFixed(3)} z=${p.z.toFixed(3)}`)
                .join(" | ");
            lines.push(`INFO ${side} lowest heel-seat candidates ${brief}`);
        }

        for (const side of ["right", "left"] as const) {
            for (const H of LIFT_MM) {
                const zeroKey = side === "right" ? "right-0-a" : "left-0";
                const zero = built.get(zeroKey);
                const lift = built.get(`${side}-${H}`);
                if (!zero || !lift) throw new Error(`missing ${side} H=${H}`);
                const row = comparison(zero, lift, side);
                const grade = gradeHeelLift(H, row);
                const stations = row.stations.map((s) => `${s.u.toFixed(3)}:${s.added.toFixed(3)}`).join(" ");
                const detail =
                    `${side} H=${H} dSeat=${row.dSeat.toFixed(3)} u=${row.seatU.toFixed(3)} v=${row.seatV.toFixed(3)} ` +
                    `seatZ0=${row.seatZ0.toFixed(3)} dRim=${row.dRim.toFixed(3)} dCup=${row.dCup.toFixed(3)} ` +
                    `cupDepth0=${row.cupDepth0.toFixed(3)} dMet=${row.dMetMin.toFixed(3)}..${row.dMetMax.toFixed(3)} ` +
                    `beltN=${row.belt.count} beltMinZ=${row.belt.minZ.toFixed(3)} ` +
                    `meshMinZ=${row.plate.meshMinZ.toFixed(3)} plantarAbsMaxZ=${row.plate.plantarAbsMaxZ.toFixed(3)} ` +
                    `stations ${stations}`;
                if (grade.pass) pass(`clinical ${detail}`);
                else fail(`clinical ${detail} :: ${grade.failures.join(" | ")}`);
            }
        }

        for (const geo of built.values()) geo.dispose();
        const report = lines.join("\n");
        console.error(report);
        const failed = lines.filter((line) => line.startsWith("FAIL"));
        expect(failed, report).toEqual([]);
    }, 900_000);
});
