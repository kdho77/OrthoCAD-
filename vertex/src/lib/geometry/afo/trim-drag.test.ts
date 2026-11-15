// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { afoViewportPlacementLayer } from "@/features/afo/afo-scan-markers";
import { getAfoState, patchAfoState, useAfoStore } from "@/stores/afo-store";
import { defaultDesign, useDesignStore } from "@/stores/design-store";
import { defaultAfoDesignState } from "./defaults";
import {
    AFO_TRIM_DRAG_THRESHOLD_PX,
    beginTrimPinPress,
    markTrimDragHistory,
    releaseTrimDragPointer,
    trimDragMovePlan,
    trimPinDragAllowed,
} from "./trim-drag";

describe("AFO trim drag gesture", () => {
    test("a drag starts only after 4 px, captures the pointer, and writes one undo step", () => {
        const pins = [
            { point: { x: 0, y: 0, z: 0 }, vertexIndex: 0 },
            { point: { x: 10, y: 0, z: 0 }, vertexIndex: 1 },
            { point: { x: 10, y: 10, z: 0 }, vertexIndex: 2 },
        ];
        useAfoStore.getState().resetSession();
        useDesignStore.setState({
            design: {
                ...defaultDesign(),
                productType: "afo",
                method: "printing_shell",
                afo: {
                    ...defaultAfoDesignState("left"),
                    trimPoints: pins,
                    trimClosed: true,
                    trimConfirmed: true,
                    shellReady: true,
                },
            },
            history: [],
            future: [],
        });
        const element = {
            captured: -1,
            released: -1,
            setPointerCapture(id: number) {
                this.captured = id;
            },
            releasePointerCapture(id: number) {
                this.released = id;
            },
            hasPointerCapture(id: number) {
                return this.captured === id && this.released !== id;
            },
        };
        const press = beginTrimPinPress({
            pinIndex: 1,
            trimConfirmed: true,
            scanPlacementActive: false,
            pointerId: 7,
            x: 100,
            y: 200,
            element,
        });
        expect(press.captured).toBe(true);
        expect(press.cameraEnabled).toBe(false);
        expect(element.captured).toBe(7);
        expect(trimPinDragAllowed({ pinIndex: 1, trimConfirmed: true, scanPlacementActive: false })).toBe(
            true,
        );
        const armed = press.gesture;
        if (!armed) throw new Error("pin press did not arm a drag");

        let gesture = armed;
        let writes = 0;
        const samples: Array<[number, number]> = [
            [100 + AFO_TRIM_DRAG_THRESHOLD_PX - 1, 200],
            [100 + 2, 201],
            [100 + AFO_TRIM_DRAG_THRESHOLD_PX + 2, 203],
            [130, 210],
            [160, 220],
        ];
        for (const [x, y] of samples) {
            const plan = trimDragMovePlan(gesture, x, y);
            gesture = plan.gesture;
            if (!plan.gesture.dragging) {
                expect(plan.writeHistory).toBe(false);
                continue;
            }
            const next = getAfoState().trimPoints.slice();
            next[1] = { point: { x: x, y, z: 1 }, vertexIndex: 4 };
            patchAfoState(
                { trimPoints: next, trimCurve: next.map((p) => p.point), shellReady: false },
                "afo-trim-drag",
                { history: plan.writeHistory },
            );
            if (plan.writeHistory) {
                writes += 1;
                gesture = markTrimDragHistory(gesture);
            }
        }
        expect(writes).toBe(1);
        expect(gesture.historyWritten).toBe(true);
        expect(useDesignStore.getState().history).toHaveLength(1);
        expect(getAfoState().trimConfirmed).toBe(true);
        expect(getAfoState().shellReady).toBe(false);
        expect(getAfoState().trimPoints[1]?.point.x).toBe(160);
        releaseTrimDragPointer(element, 7);
        expect(element.released).toBe(7);

        useDesignStore.getState().undo();
        expect(getAfoState().trimPoints[1]?.point).toEqual({ x: 10, y: 0, z: 0 });
        expect(getAfoState().shellReady).toBe(true);
        expect(getAfoState().trimConfirmed).toBe(true);
        useDesignStore.getState().redo();
        expect(getAfoState().shellReady).toBe(false);
        expect(getAfoState().trimPoints[1]?.point.x).toBe(160);
    });

    test("confirmed loops drag, and an active scan placement does not", () => {
        expect(trimPinDragAllowed({ pinIndex: 0, trimConfirmed: true, scanPlacementActive: false })).toBe(
            true,
        );
        expect(trimPinDragAllowed({ pinIndex: 0, trimConfirmed: false, scanPlacementActive: false })).toBe(
            true,
        );
        expect(trimPinDragAllowed({ pinIndex: 2, trimConfirmed: true, scanPlacementActive: true })).toBe(
            false,
        );
        expect(trimPinDragAllowed({ pinIndex: null, trimConfirmed: true, scanPlacementActive: false })).toBe(
            false,
        );
        const blocked = beginTrimPinPress({
            pinIndex: 0,
            trimConfirmed: true,
            scanPlacementActive: true,
            pointerId: 1,
            x: 0,
            y: 0,
            element: { setPointerCapture: () => undefined },
        });
        expect(blocked.gesture).toBeNull();
        expect(blocked.cameraEnabled).toBe(true);
        expect(blocked.captured).toBe(false);
    });

    test("a far-side trim pin ignores pointer-down and does not arm a drag", () => {
        expect(
            trimPinDragAllowed({
                pinIndex: 1,
                trimConfirmed: true,
                scanPlacementActive: false,
                facesCamera: false,
            }),
        ).toBe(false);
        const blocked = beginTrimPinPress({
            pinIndex: 1,
            trimConfirmed: true,
            scanPlacementActive: false,
            facesCamera: false,
            pointerId: 2,
            x: 10,
            y: 10,
            element: { setPointerCapture: () => undefined },
        });
        expect(blocked.gesture).toBeNull();
        expect(blocked.cameraEnabled).toBe(true);
        const allowed = beginTrimPinPress({
            pinIndex: 1,
            trimConfirmed: true,
            scanPlacementActive: false,
            facesCamera: true,
            pointerId: 3,
            x: 10,
            y: 10,
            element: { setPointerCapture: () => undefined },
        });
        expect(allowed.gesture).not.toBeNull();
    });

    test("trim drag is mounted on Design and Print whenever scan placement is idle", () => {
        expect(afoViewportPlacementLayer("design", true, false, false)).toBe("afo-design");
        expect(afoViewportPlacementLayer("design", true, true, true)).toBe("afo-design");
        expect(afoViewportPlacementLayer("print", true, true, false)).toBe("afo-design");
        expect(afoViewportPlacementLayer("print", true, false, true)).toBe("afo-scan");
        expect(afoViewportPlacementLayer("export", true, false, false)).toBe("afo-design");
        expect(afoViewportPlacementLayer("cast", false, false, false)).toBe("scan");
    });
});
