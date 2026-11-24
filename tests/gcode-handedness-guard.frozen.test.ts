// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// FROZEN gate H4 (OrthoCAD PM, 2026-11-24, P0 left/right swap). Do not edit; checked by tests/fixtures/handedness/SHA256SUMS.
// Kendon 2026-11-24 4:28 PM MT: automated handedness check on the final sliced G-code; mismatch or inconclusive fails the
// production; must work for heel-first and toe-first; regression test for both directions x left and right.
// Fixtures (tests/fixtures/handedness/*.gcode.gz) are compact extrusion-endpoint copies of the VertexSlice server output for
// the SAMPLE_Top LEFT design (Sample Patient, 2026-11-12). "main_left_request_*" is what main delivers for side=left: it
// is physically a RIGHT foot. "true_left_*" is the same file mirrored across the belt (a correct left). *_heel_first is
// the same part turned 180 degrees on the belt with the 45 degree shear kept. Calibration and rules: see
// validation/handedness_gates/hand_classify.py in kdho77/VertexSlice (frozen, same rules).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "@rstest/core";
import {
    assertGcodeHandedness,
    detectGcodeFoot,
    GcodeHandednessError,
} from "../vertex/server/src/lib/gcode-handedness";

const fx = (name: string): string =>
    gunzipSync(readFileSync(resolve(__dirname, "fixtures/handedness", `${name}.gcode.gz`))).toString("utf8");

const CASES = [
    { file: "main_left_request_toe_first", direction: "toe-first", physical: "right" },
    { file: "main_left_request_heel_first", direction: "heel-first", physical: "right" },
    { file: "true_left_toe_first", direction: "toe-first", physical: "left" },
    { file: "true_left_heel_first", direction: "heel-first", physical: "left" },
] as const;

describe("H4 G-code handedness guard (frozen)", () => {
    for (const c of CASES) {
        test(`${c.file}: detects a physical ${c.physical} foot (${c.direction})`, () => {
            expect(detectGcodeFoot(fx(c.file)).foot).toBe(c.physical);
        });
        for (const requested of ["left", "right"] as const) {
            const ok = requested === c.physical;
            test(`${c.file}: requested ${requested} ${ok ? "is accepted" : "fails the production"}`, () => {
                const run = () => assertGcodeHandedness(fx(c.file), requested);
                if (ok) {
                    expect(run).not.toThrow();
                } else {
                    expect(run).toThrow(GcodeHandednessError);
                    try {
                        run();
                    } catch (e) {
                        const msg = String((e as Error).message).toLowerCase();
                        expect(msg).toContain(requested);
                        expect(msg).toContain(c.physical);
                    }
                }
            });
        }
    }

    test("current main output for a LEFT request fails the left production (the 2026-11-23/24 bug)", () => {
        expect(() => assertGcodeHandedness(fx("main_left_request_toe_first"), "left")).toThrow(GcodeHandednessError);
    });

    test("inconclusive G-code fails for both sides", () => {
        const tiny = "M83\nG1 X10 Y0.2 Z10 E0.1\nG1 X20 Y0.2 Z20 E0.1\n";
        expect(detectGcodeFoot(tiny).foot).toBe("inconclusive");
        expect(() => assertGcodeHandedness(tiny, "left")).toThrow(GcodeHandednessError);
        expect(() => assertGcodeHandedness(tiny, "right")).toThrow(GcodeHandednessError);
    });
});
