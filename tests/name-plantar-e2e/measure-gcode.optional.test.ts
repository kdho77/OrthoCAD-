// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// End-to-end chirality of the final belt G-code. Run by the plantar-name CI job
// after VertexSlice. Not part of the unit shards (no slicer there).

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { loadTextFont } from "@/lib/geometry/text-marking/font";
import { gradeFootGcode, gradeReport, type PrintDirection } from "./grade-gcode";
import { SYNTHETIC_NAME } from "./thresholds";

const gcodeDir = process.env.NAME_PLANTAR_GCODE_DIR;

/** apex_core ignores a heel-first request. apex_light honours print_direction. */
const CELLS: Array<{
    material: "apex_core" | "apex_light";
    direction: PrintDirection;
    side: "left" | "right";
}> = [
    { material: "apex_core", direction: "toe_first", side: "left" },
    { material: "apex_core", direction: "toe_first", side: "right" },
    { material: "apex_light", direction: "toe_first", side: "left" },
    { material: "apex_light", direction: "toe_first", side: "right" },
    { material: "apex_light", direction: "heel_first", side: "left" },
    { material: "apex_light", direction: "heel_first", side: "right" },
];

describe("plantar name on final belt G-code", () => {
    test("both feet read JABBOUR left to right in both print directions", async () => {
        if (!gcodeDir) throw new Error("NAME_PLANTAR_GCODE_DIR is required");
        const font = await loadTextFont();
        const marking = defaultTextMarking("bottom");
        const flat = flattenText(font, SYNTHETIC_NAME, marking.capHeightMm, marking.letterSpacingMm, true);
        const report: Record<string, ReturnType<typeof gradeReport>> = {};
        const grades = [];
        for (const cell of CELLS) {
            const key = `${cell.material}_${cell.direction}_${cell.side}`;
            const grade = gradeFootGcode(
                resolve(gcodeDir, `${key}.gcode`),
                flat.groups,
                SYNTHETIC_NAME,
                cell.direction,
            );
            grades.push({ key, grade });
            report[key] = gradeReport(grade);
            process.stderr.write(`NAME_PLANTAR ${key} ${JSON.stringify(report[key])}\n`);
        }
        writeFileSync(resolve(gcodeDir, "grade.json"), `${JSON.stringify(report, null, 2)}\n`);
        for (const { key, grade } of grades) {
            expect(grade.failures, `${key} ${grade.failures.join("; ")}`).toEqual([]);
            expect(grade.pass, key).toBe(true);
            expect(grade.sequence, key).toBe(SYNTHETIC_NAME);
            expect(grade.hookLeft, key).toBe(true);
            expect(grade.advanceMm, key).toBeGreaterThan(20);
            if (grade.printDirection === "heel_first") expect(grade.heelHigh, key).toBe(false);
            if (grade.printDirection === "toe_first") expect(grade.heelHigh, key).toBe(true);
        }
    }, 180_000);

    test("0d3db1c0 and ad1e0cc5 path variants read JABBOUR from the plantar face", async () => {
        if (!gcodeDir) throw new Error("NAME_PLANTAR_GCODE_DIR is required");
        const font = await loadTextFont();
        const marking = defaultTextMarking("bottom");
        const flat = flattenText(font, SYNTHETIC_NAME, marking.capHeightMm, marking.letterSpacingMm, true);
        const variants = [
            "d0-pair-left",
            "d0-pair-right",
            "d0-single-left",
            "d0-single-right",
            "ad-pair-left",
            "ad-pair-right",
            "ad-name-left",
            "ad-name-right",
        ];
        for (const name of variants) {
            const key = `apex_core_toe_first_${name}`;
            const grade = gradeFootGcode(
                resolve(gcodeDir, `${key}.gcode`),
                flat.groups,
                SYNTHETIC_NAME,
                "toe_first",
            );
            process.stderr.write(`NAME_PLANTAR ${key} ${JSON.stringify(gradeReport(grade))}\n`);
            expect(grade.failures, `${key} ${grade.failures.join("; ")}`).toEqual([]);
            expect(grade.pass, key).toBe(true);
            expect(grade.sequence, key).toBe(SYNTHETIC_NAME);
            expect(grade.hookLeft, key).toBe(true);
            expect(grade.advanceMm, key).toBeGreaterThan(20);
            expect(grade.heelHigh, key).toBe(true);
        }
    }, 180_000);
});
