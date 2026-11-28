// Frozen heel-lift cup-depth gates.
// Live production compose path. Fails on BASE: the seat stays down and the cup deepens.
// Do not edit after the gates pull request is opened.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import type { Side } from "@/types";
import { buildProductionSolid, comparison, stlSha256 } from "./build-solid";
import { gradeHeelLift } from "./measure";

interface FrozenHashes {
    "right-0": string;
    "left-0": string;
}

function loadFrozen(): FrozenHashes {
    const path = resolve(process.cwd(), "validation/heel_lift_cup_regression_gates/frozen/stl-sha256.json");
    return JSON.parse(readFileSync(path, "utf8")) as FrozenHashes;
}

describe("heel-lift cup-depth gates (SAMPLE_Top US M11 medium, compose path)", () => {
    test("seat, cup, taper, belt, and zero-lift identity", async () => {
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

        // Left lift is built before either right zero so a cross-foot write shows up
        // in the right STL hash.
        await keep("left-12", "left", 12);
        const right0a = await keep("right-0-a", "right", 0);
        await keep("left-6", "left", 6);
        const right0b = await keep("right-0-b", "right", 0);
        const left0 = await keep("left-0", "left", 0);
        await keep("right-6", "right", 6);
        await keep("right-12", "right", 12);

        const expectHash = (label: string, geo: BufferGeometry, want: string) => {
            const got = stlSha256(geo);
            if (got === want) pass(`identity ${label} ${got}`);
            else fail(`identity ${label} ${got} != frozen ${want}`);
        };
        expectHash("right-0-after-left-12", right0a, frozen["right-0"]);
        expectHash("right-0-after-left-6", right0b, frozen["right-0"]);
        expectHash("left-0", left0, frozen["left-0"]);
        const rightA = stlSha256(right0a);
        const rightB = stlSha256(right0b);
        if (rightA === rightB) pass("identity right zero is stable across left lifts");
        else fail(`identity right zero changed between left lifts ${rightA} vs ${rightB}`);

        const cases: Array<{ side: Side; H: 6 | 12; zero: string; lift: string }> = [
            { side: "right", H: 6, zero: "right-0-a", lift: "right-6" },
            { side: "right", H: 12, zero: "right-0-a", lift: "right-12" },
            { side: "left", H: 6, zero: "left-0", lift: "left-6" },
            { side: "left", H: 12, zero: "left-0", lift: "left-12" },
        ];
        for (const c of cases) {
            const row = comparison(built.get(c.zero)!, built.get(c.lift)!, c.side);
            const grade = gradeHeelLift(c.H, row);
            const stations = row.stations.map((s) => `${s.u}:${s.added.toFixed(3)}`).join(" ");
            const detail =
                `${c.side} H=${c.H} dSeat=${row.dSeat.toFixed(3)} u=${row.seatU.toFixed(3)} ` +
                `dRim=${row.dRim.toFixed(3)} dCup=${row.dCup.toFixed(3)} ` +
                `beltN=${row.belt.count} beltMinZ=${row.belt.minZ.toFixed(3)} stations ${stations}`;
            if (grade.pass) pass(`clinical ${detail}`);
            else fail(`clinical ${detail} :: ${grade.failures.join(" | ")}`);
        }

        for (const geo of built.values()) geo.dispose();
        const report = lines.join("\n");
        console.error(report);
        const failed = lines.filter((line) => line.startsWith("FAIL"));
        expect(failed, report).toEqual([]);
    }, 300_000);
});
