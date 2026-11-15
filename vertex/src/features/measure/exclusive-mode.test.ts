// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import {
    markerPlacementBlocked,
    measurementOwnsPointer,
    trimEditBlocked,
} from "@/features/measure/exclusive-mode";
import { useAfoStore } from "@/stores/afo-store";
import { measureToolArmed, useMeasureStore } from "@/stores/measure-store";

describe("measurement click exclusivity", () => {
    beforeEach(() => {
        useMeasureStore.setState({
            panel: "view",
            tool: null,
            points: [],
            thickness: null,
            thicknessMm: null,
            notice: null,
        });
    });

    test("markers and trim yield the pointer only while a measure tool is armed", () => {
        expect(measurementOwnsPointer(false)).toBe(false);
        expect(markerPlacementBlocked(false)).toBe(false);
        expect(trimEditBlocked(false)).toBe(false);

        useMeasureStore.getState().arm("point");
        expect(measureToolArmed()).toBe(true);
        expect(markerPlacementBlocked(measureToolArmed())).toBe(true);
        expect(trimEditBlocked(measureToolArmed())).toBe(true);

        useMeasureStore.getState().arm("point");
        expect(measureToolArmed()).toBe(false);
        expect(markerPlacementBlocked(measureToolArmed())).toBe(false);
        expect(trimEditBlocked(measureToolArmed())).toBe(false);
    });

    test("leaving the Measurements tab disarms the click tool", () => {
        useMeasureStore.getState().arm("thickness");
        useMeasureStore.getState().setPanel("view");
        expect(measureToolArmed()).toBe(false);
        expect(markerPlacementBlocked(measureToolArmed())).toBe(false);
    });

    test("arming clears AFO trim placement and scan placement", () => {
        useAfoStore.setState({
            placingTrim: true,
            trimHover: { x: 1, y: 2, z: 3 },
            scanPlacement: { redo: "malleolus_medial" },
        });
        useMeasureStore.getState().arm("point");
        expect(useAfoStore.getState().placingTrim).toBe(false);
        expect(useAfoStore.getState().trimHover).toBeNull();
        expect(useAfoStore.getState().scanPlacement).toBeNull();
        useMeasureStore.getState().arm("point");
    });
});
