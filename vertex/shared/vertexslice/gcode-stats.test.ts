// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { formatPrintTime, parseGcodeStats } from "./gcode-stats";

describe("parseGcodeStats", () => {
    test("reads Orca header comments", () => {
        const gcode = [
            "; filament used [mm] = 12345.00",
            "; filament used [g] = 10.50",
            "; estimated printing time (normal mode) = 1h 2m 3s",
            "; total layers count = 42",
            "G28",
        ].join("\n");
        expect(parseGcodeStats(gcode)).toEqual({
            printTimeSeconds: 3723,
            filamentGrams: 10.5,
            filamentMeters: 12.345,
            layers: 42,
        });
    });

    test("formats print time", () => {
        expect(formatPrintTime(45)).toBe("45s");
        expect(formatPrintTime(125)).toBe("2m 5s");
        expect(formatPrintTime(3723)).toBe("1h 2m");
        expect(formatPrintTime(null)).toBe("—");
    });
});
