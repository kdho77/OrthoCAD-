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
import { gradeFootGcode, gradeReport } from "./grade-gcode";
import { SYNTHETIC_NAME } from "./thresholds";

const gcodeDir = process.env.NAME_PLANTAR_GCODE_DIR;

describe("plantar name on final belt G-code", () => {
    test("both feet read JABBOUR left to right on the physical plantar face", async () => {
        if (!gcodeDir) throw new Error("NAME_PLANTAR_GCODE_DIR is required");
        const font = await loadTextFont();
        const marking = defaultTextMarking("bottom");
        const flat = flattenText(font, SYNTHETIC_NAME, marking.capHeightMm, marking.letterSpacingMm, true);
        const report: Record<string, ReturnType<typeof gradeReport>> = {};
        const grades = [];
        for (const side of ["left", "right"] as const) {
            const grade = gradeFootGcode(resolve(gcodeDir, `${side}.gcode`), flat.groups, SYNTHETIC_NAME);
            grades.push({ side, grade });
            report[side] = gradeReport(grade);
            process.stderr.write(`NAME_PLANTAR ${side} ${JSON.stringify(report[side])}\n`);
        }
        writeFileSync(resolve(gcodeDir, "grade.json"), `${JSON.stringify(report, null, 2)}\n`);
        for (const { side, grade } of grades) {
            expect(grade.failures, `${side} ${grade.failures.join("; ")}`).toEqual([]);
            expect(grade.pass, side).toBe(true);
            expect(grade.sequence, side).toBe(SYNTHETIC_NAME);
            expect(grade.hookLeft, side).toBe(true);
            expect(grade.advanceMm, side).toBeGreaterThan(20);
        }
    }, 180_000);
});
