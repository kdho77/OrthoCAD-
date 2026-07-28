// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
