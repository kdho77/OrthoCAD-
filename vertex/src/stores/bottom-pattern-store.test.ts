// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { useBottomPatternStore } from "./bottom-pattern-store";
import { useDesignStore } from "./design-store";
import { useMeshEditStore } from "./mesh-edit-store";

describe("bottom pattern store", () => {
    test("edits do not write design.trimlines", () => {
        useBottomPatternStore.getState().clear();
        useDesignStore.setState({
            design: { ...useDesignStore.getState().design, trimlines: { left: [{ x: 1, y: 2, z: 0 }] } },
        });
        const before = useDesignStore.getState().design.trimlines?.left;
        useBottomPatternStore.getState().setPattern("left", {
            points: [new THREE.Vector3(10, 0, 0), new THREE.Vector3(11, 1, 0), new THREE.Vector3(12, 0, 0)],
        });
        expect(useDesignStore.getState().design.trimlines?.left).toEqual(before);
        expect(useBottomPatternStore.getState().getPattern("left")?.points).toHaveLength(3);
        useBottomPatternStore.getState().clear();
    });

    test("trimline edit and bottom-pattern edit are separate sessions", () => {
        useMeshEditStore.getState().resetEdits();
        useBottomPatternStore.getState().setPattern("left", {
            points: [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(10, 0, 0),
                new THREE.Vector3(10, 8, 0),
                new THREE.Vector3(0, 8, 0),
            ],
        });
        useMeshEditStore.getState().beginBottomPatternEdit("left");
        expect(useMeshEditStore.getState().editMode).toBe("edit-bottom-pattern");
        expect(useMeshEditStore.getState().trimlineEdit).toBeNull();
        useMeshEditStore.getState().beginTrimlineEdit("left");
        expect(useMeshEditStore.getState().editMode).toBe("edit-trimline");
        expect(useMeshEditStore.getState().bottomPatternEdit).toBeNull();
        useMeshEditStore.getState().resetEdits();
        useBottomPatternStore.getState().clear();
    });

    test("Full Contact / Prefab 3D / Flat clear generated B so SAMPLE_Top rebuilds", () => {
        useBottomPatternStore.getState().setPattern("left", {
            points: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 0, 0), new THREE.Vector3(2, 1, 0)],
        });
        expect(useBottomPatternStore.getState().getPattern("left")).toBeTruthy();
        useDesignStore.getState().setPattern("full_contact");
        expect(useBottomPatternStore.getState().getPattern("left")).toBeNull();
        useBottomPatternStore.getState().setPattern("left", {
            points: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 0, 0), new THREE.Vector3(2, 1, 0)],
        });
        useDesignStore.getState().setPattern("custom");
        expect(useBottomPatternStore.getState().getPattern("left")?.points).toHaveLength(3);
        useDesignStore.getState().setPattern("prefab_3d");
        expect(useBottomPatternStore.getState().getPattern("left")).toBeNull();
        useBottomPatternStore.getState().clear();
    });
});
