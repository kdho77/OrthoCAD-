// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { initialSlicerState, slicerReducer } from "./slicer-state";

describe("slicerReducer", () => {
    test("settings change after done marks the result out of date", () => {
        let state = initialSlicerState();
        state = slicerReducer(state, { type: "set-material", material: "apex_core" });
        state = slicerReducer(state, {
            type: "done",
            result: {
                gcode: "G28\n",
                filename: "insole_ApexCore_toefirst_1w.gcode",
                stats: { printTimeSeconds: 60, filamentGrams: 1, filamentMeters: 1, layers: 10 },
                requestId: "r",
                material: "apex_core",
                printDirection: "toe_first",
                wallLoops: 1,
                infillDensity: 20,
            },
        });
        expect(state.status).toBe("done");
        state = slicerReducer(state, { type: "set-direction", printDirection: "heel_first" });
        expect(state.status).toBe("outdated");
        expect(state.result?.filename).toBe("insole_ApexCore_toefirst_1w.gcode");
    });
});
