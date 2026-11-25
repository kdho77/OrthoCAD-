// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// G-code grade of the two canonical production paths after the live #52 image.
// Same grader and thresholds as the #442 cells. Not part of the unit shards.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { loadTextFont } from "@/lib/geometry/text-marking/font";
import { gradeFootGcode, gradeReport } from "./grade-gcode";
import { SYNTHETIC_NAME } from "./thresholds";

const gcodeDir = process.env.NAME_PLANTAR_GCODE_DIR;
const PATHS = ["0d3db1c0", "ad1e0cc5"] as const;
const SIDES = ["left", "right"] as const;

describe("production-path plantar name on final belt G-code", () => {
    test("0d3db1c0 and ad1e0cc5 read JABBOUR on apex_core toe-first", async () => {
        if (!gcodeDir) throw new Error("NAME_PLANTAR_GCODE_DIR is required");
        const font = await loadTextFont();
        const marking = defaultTextMarking("bottom");
        const flat = flattenText(font, SYNTHETIC_NAME, marking.capHeightMm, marking.letterSpacingMm, true);
        const report: Record<string, ReturnType<typeof gradeReport>> = {};
        const grades = [];
        for (const path of PATHS) {
            for (const side of SIDES) {
                const key = `${path}_apex_core_toe_first_${side}`;
                const grade = gradeFootGcode(resolve(gcodeDir, `${key}.gcode`), flat.groups, SYNTHETIC_NAME, "toe_first");
                grades.push({ key, grade });
                report[key] = gradeReport(grade);
                process.stderr.write(`NAME_PLANTAR ${key} ${JSON.stringify(report[key])}\n`);
            }
        }
        writeFileSync(resolve(gcodeDir, "production-grade.json"), `${JSON.stringify(report, null, 2)}\n`);
        for (const { key, grade } of grades) {
            expect(grade.failures, `${key} ${grade.failures.join("; ")}`).toEqual([]);
            expect(grade.pass, key).toBe(true);
            expect(grade.sequence, key).toBe(SYNTHETIC_NAME);
            expect(grade.hookLeft, key).toBe(true);
            expect(grade.advanceMm, key).toBeGreaterThan(20);
            expect(grade.heelHigh, key).toBe(true);
        }
    }, 180_000);
});
