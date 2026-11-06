// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import {
    AMPUTATION_CUT_COLOR,
    amputationPointFromMesh,
    layoutFootBounds,
    meshPointFromAmputation,
    strokeLocals,
} from "./amputation-draw";
import { useAmputationDrawStore } from "./amputation-draw-store";

const LENGTH = 260;
const WIDTH = 100;
const BOUNDS = { minX: 10, maxX: 270, minY: -50, maxY: 30, minZ: 0, maxZ: 6 };

afterEach(() => {
    useAmputationDrawStore.getState().cancel();
    useMeshEditStore.getState().resetEdits();
    useBottomPatternStore.getState().clear();
});

describe("amputation draw hit frame", () => {
    test("a sheet click round-trips and stays medial-positive on both feet", () => {
        for (const side of ["left", "right"] as const) {
            const localY = side === "left" ? 30 : -50;
            const hit = amputationPointFromMesh(140, localY, side, LENGTH, WIDTH, BOUNDS);
            expect(hit.x).toBeCloseTo(130, 5);
            expect(hit.y).toBeCloseTo(50, 5);
            const back = meshPointFromAmputation(hit.x, hit.y, side, LENGTH, WIDTH, BOUNDS);
            expect(back.x).toBeCloseTo(140, 5);
            expect(back.y).toBeCloseTo(localY, 5);
        }
    });

    test("heel and toe map to the ends of the cut frame", () => {
        const heel = amputationPointFromMesh(BOUNDS.minX, 0, "left", LENGTH, WIDTH, BOUNDS);
        const toe = amputationPointFromMesh(BOUNDS.maxX, 0, "left", LENGTH, WIDTH, BOUNDS);
        expect(heel.x).toBeCloseTo(0, 5);
        expect(toe.x).toBeCloseTo(LENGTH, 5);
    });
});

describe("amputation draw session", () => {
    test("starting Draw shows no cut and ignores a stored bottom pattern", () => {
        useBottomPatternStore.getState().setPattern("left", {
            points: [
                new THREE.Vector3(6, -8, 0),
                new THREE.Vector3(6.2, -4, 0),
                new THREE.Vector3(6.4, 0, 0),
                new THREE.Vector3(6.6, 4, 0),
            ],
        });
        useAmputationDrawStore.getState().start("left");
        expect(useAmputationDrawStore.getState().side).toBe("left");
        expect(useAmputationDrawStore.getState().points).toEqual([]);
        expect(strokeLocals([], "left", LENGTH, WIDTH, layoutFootBounds(LENGTH, WIDTH))).toEqual([]);
        expect(AMPUTATION_CUT_COLOR.toLowerCase()).not.toMatch(/fbbf24|f59e0b|facc15|eab308/);
    });

    test("starting Draw closes the trimline editor and the bottom-pattern editor", () => {
        useMeshEditStore.getState().beginTrimlineEdit("left");
        expect(useMeshEditStore.getState().editMode).toBe("edit-trimline");
        useAmputationDrawStore.getState().start("left");
        expect(useMeshEditStore.getState().editMode).not.toBe("edit-trimline");
        expect(useMeshEditStore.getState().trimlineEdit).toBeNull();

        useBottomPatternStore.getState().setPattern("right", {
            points: [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(10, 0, 0),
                new THREE.Vector3(10, 8, 0),
                new THREE.Vector3(0, 8, 0),
            ],
        });
        useMeshEditStore.getState().beginBottomPatternEdit("right");
        expect(useMeshEditStore.getState().editMode).toBe("edit-bottom-pattern");
        useAmputationDrawStore.getState().start("right");
        expect(useMeshEditStore.getState().bottomPatternEdit).toBeNull();
        expect(useMeshEditStore.getState().editMode).not.toBe("edit-bottom-pattern");
        expect(useAmputationDrawStore.getState().points).toEqual([]);
    });

    test("placed points are the only stroke, in order, and undo removes the last one", () => {
        useAmputationDrawStore.getState().start("left");
        useAmputationDrawStore.getState().place({ x: 180, y: 30, localX: 190, localY: 12 });
        useAmputationDrawStore.getState().place({ x: 220, y: 0, localX: 230, localY: -2 });
        const stroke = strokeLocals(useAmputationDrawStore.getState().points, "left", LENGTH, WIDTH, BOUNDS);
        expect(stroke).toEqual([
            { x: 190, y: 12 },
            { x: 230, y: -2 },
        ]);
        useAmputationDrawStore.getState().undo();
        expect(useAmputationDrawStore.getState().points).toHaveLength(1);
        expect(useAmputationDrawStore.getState().points[0]?.x).toBe(180);
    });
});
