// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { canDownloadSlicerGcode } from "./slicer-pay";
import { initialSlicerState, slicerReducer } from "./slicer-state";

function doneState() {
    let state = initialSlicerState();
    state = slicerReducer(state, { type: "set-material", material: "apex_core" });
    return slicerReducer(state, {
        type: "done",
        result: {
            downloads: [
                {
                    gcode: "G28\n",
                    filename: "insole_ApexCore_toefirst_1w.gcode",
                },
            ],
            stats: { printTimeSeconds: 60, filamentGrams: 1, filamentMeters: 1, layers: 10 },
            requestId: "r",
            material: "apex_core",
            printDirection: "toe_first",
            wallLoops: 1,
            infillDensity: 20,
        },
    });
}

describe("slicerReducer", () => {
    test("settings change after done marks the result out of date", () => {
        let state = doneState();
        expect(state.status).toBe("done");
        state = slicerReducer(state, { type: "set-direction", printDirection: "heel_first" });
        expect(state.status).toBe("outdated");
        expect(state.result?.downloads[0]?.filename).toBe("insole_ApexCore_toefirst_1w.gcode");
    });

    test("download is locked until pay succeeds", () => {
        let state = doneState();
        expect(state.paymentStatus).toBe("unpaid");
        expect(canDownloadSlicerGcode(state.paymentStatus)).toBe(false);
        state = slicerReducer(state, { type: "start-pay" });
        expect(state.paymentStatus).toBe("paying");
        expect(canDownloadSlicerGcode(state.paymentStatus)).toBe(false);
        state = slicerReducer(state, { type: "paid", paymentId: "mock_1" });
        expect(state.paymentStatus).toBe("paid");
        expect(state.paymentId).toBe("mock_1");
        expect(canDownloadSlicerGcode(state.paymentStatus)).toBe(true);
    });
});
