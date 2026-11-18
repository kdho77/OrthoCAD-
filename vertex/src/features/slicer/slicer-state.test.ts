// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { classDensityPct, NAMED_HARDNESS_CLASSES } from "../../lib/hardness";
import { volumeSettingsFor } from "../../lib/hardness/report";
import { canDownloadSlicerGcode } from "./slicer-pay";
import {
    DEFAULT_SLICER_HARDNESS,
    initialSlicerState,
    PRODUCTION_WALL_LOOPS,
    slicerInfillPercent,
    slicerReducer,
} from "./slicer-state";

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

    test("the sacrificial leader defaults off and marks a finished slice out of date", () => {
        expect(initialSlicerState().includeLeader).toBe(false);
        let state = doneState();
        state = slicerReducer(state, { type: "set-leader", includeLeader: true });
        expect(state.includeLeader).toBe(true);
        expect(state.status).toBe("outdated");
        state = slicerReducer(state, { type: "set-leader", includeLeader: false });
        expect(state.includeLeader).toBe(false);
    });

    test("each hardness level sends the OrthoCAD export infill and the production wall count", () => {
        const initial = initialSlicerState();
        expect(initial.hardness).toBe(DEFAULT_SLICER_HARDNESS);
        expect(initial.hardness).toBe("Medium");
        expect(initial.infillOverridePct).toBe(null);
        expect(initial.wallLoops).toBe(PRODUCTION_WALL_LOOPS);
        expect(PRODUCTION_WALL_LOOPS).toBe(2);
        for (const level of NAMED_HARDNESS_CLASSES) {
            const exported = volumeSettingsFor({
                regionId: "insole",
                kind: "zone",
                hardnessClass: level,
                priority: 0,
                depth: { type: "full" },
                side: "left",
            });
            expect(slicerInfillPercent(level, null)).toBe(exported.densityPct);
            expect(slicerInfillPercent(level, null)).toBe(classDensityPct(level));
            let state = slicerReducer(initial, { type: "set-hardness", hardness: level });
            expect(slicerInfillPercent(state.hardness, state.infillOverridePct)).toBe(exported.densityPct);
            expect(state.wallLoops).toBe(2);
            state = slicerReducer(state, { type: "set-infill-override", infillOverridePct: 55 });
            expect(slicerInfillPercent(state.hardness, state.infillOverridePct)).toBe(55);
            state = slicerReducer(state, { type: "set-infill-override", infillOverridePct: null });
            expect(slicerInfillPercent(state.hardness, state.infillOverridePct)).toBe(exported.densityPct);
        }
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
