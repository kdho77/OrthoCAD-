// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { describe, expect, test } from "@rstest/core";
import { skiveDerivedDisplayText } from "./skive-derived-display";

describe("T22 skive derived display", () => {
    test("derived Location is dash when depthMm = 0", () => {
        expect(skiveDerivedDisplayText("location", 0)).toEqual({ locationDisplayText: "—" });
    });

    test("derived Angle is dash when depthMm = 0", () => {
        expect(skiveDerivedDisplayText("angle", 0)).toEqual({ angleDisplayText: "—" });
    });

    test("no dash when depthMm > 0", () => {
        expect(skiveDerivedDisplayText("location", 4)).toEqual({});
        expect(skiveDerivedDisplayText("angle", 4)).toEqual({});
    });
});
