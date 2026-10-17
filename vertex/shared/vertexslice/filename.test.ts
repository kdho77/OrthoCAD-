// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { slicerDownloadFilename } from "./filename";

describe("slicerDownloadFilename", () => {
    test("matches {model}_{material}_{toe|heel}first_{walls}w.gcode", () => {
        expect(
            slicerDownloadFilename({
                modelName: "insole.stl",
                material: "apex_core",
                printDirection: "toe_first",
                wallLoops: 1,
            }),
        ).toBe("insole_ApexCore_toefirst_1w.gcode");
        expect(
            slicerDownloadFilename({
                modelName: "pair left.3mf",
                material: "apex_light",
                printDirection: "heel_first",
                wallLoops: 4,
            }),
        ).toBe("pair_left_ApexLight_heelfirst_4w.gcode");
    });
});
