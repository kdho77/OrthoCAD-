// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { assertGcodeHandedness, detectGcodeFoot, GcodeHandednessError } from "./gcode-handedness.js";
import { passingBeltGcode } from "./gcode-handedness-sample.js";

describe("detectGcodeFoot", () => {
    test("synthetic belt clouds match the requested foot", () => {
        expect(detectGcodeFoot(passingBeltGcode("left")).foot).toBe("left");
        expect(detectGcodeFoot(passingBeltGcode("right")).foot).toBe("right");
    });

    test("a mismatch names the requested side and the detected foot", () => {
        expect(() => assertGcodeHandedness(passingBeltGcode("right"), "left")).toThrow(GcodeHandednessError);
        try {
            assertGcodeHandedness(passingBeltGcode("right"), "left");
        } catch (error) {
            expect(error).toBeInstanceOf(GcodeHandednessError);
            expect((error as GcodeHandednessError).code).toBe("GCODE_HANDEDNESS_MISMATCH");
            expect((error as Error).message).toBe(
                "Handedness check failed: requested left, G-code is a physical right foot. File not delivered.",
            );
        }
    });

    test("inconclusive G-code throws for the requested side", () => {
        const tiny = "M83\nG1 X10 Y0.2 Z10 E0.1\n";
        expect(detectGcodeFoot(tiny).foot).toBe("inconclusive");
        expect(() => assertGcodeHandedness(tiny, "right")).toThrow(/requested right/);
        expect(() => assertGcodeHandedness(tiny, "right")).toThrow(/inconclusive/);
    });

    test("a 3 MB G-code is classified in under 1.5 s", () => {
        const line = "G1 X1.00 Y0.20 Z10.00 E0.100\n";
        const bytes = 3 * 1024 * 1024;
        const gcode = line.repeat(Math.ceil(bytes / line.length));
        expect(gcode.length).toBeGreaterThanOrEqual(bytes);
        const started = performance.now();
        const detected = detectGcodeFoot(gcode);
        const elapsedMs = performance.now() - started;
        console.log(
            `handedness guard ${gcode.length} bytes in ${elapsedMs.toFixed(1)} ms (${detected.foot})`,
        );
        expect(elapsedMs).toBeLessThan(1500);
    });
});
