// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";

describe("outline edit leaves on step changes", () => {
    const confirm = window.confirm;

    afterEach(() => {
        window.confirm = confirm;
        useMeshEditStore.getState().resetEdits();
        useClinicalWorkflowStore.setState({
            step: "scan",
            nextBlockReason: null,
            scanGateStickyReason: null,
        });
    });

    test("a clean session exits without a prompt", () => {
        const prompts: string[] = [];
        window.confirm = (message?: string) => {
            prompts.push(String(message));
            return false;
        };
        useClinicalWorkflowStore.setState({ step: "base" });
        useMeshEditStore.getState().beginTrimlineEdit("left");
        useClinicalWorkflowStore.getState().setStep("corrections");
        expect(prompts).toEqual([]);
        expect(useClinicalWorkflowStore.getState().step).toBe("corrections");
        expect(useMeshEditStore.getState().trimlineEdit).toBeNull();
        expect(useMeshEditStore.getState().editMode).toBe("transform");
    });

    test("an unsaved draft blocks the step change until discard is confirmed", () => {
        useClinicalWorkflowStore.setState({ step: "base" });
        useMeshEditStore.getState().beginTrimlineEdit("left");
        useMeshEditStore
            .getState()
            .setTrimlineDraft([
                new THREE.Vector3(2, 0, 0),
                new THREE.Vector3(9, 0, 0),
                new THREE.Vector3(9, 5, 0),
            ]);
        const before = useDesignStore.getState().design.trimlines;
        window.confirm = () => false;
        useClinicalWorkflowStore.getState().setStep("elements");
        expect(useClinicalWorkflowStore.getState().step).toBe("base");
        expect(useMeshEditStore.getState().trimlineEdit).toBeTruthy();
        expect(useDesignStore.getState().design.trimlines).toBe(before);

        window.confirm = () => true;
        useClinicalWorkflowStore.getState().setStep("corrections");
        expect(useClinicalWorkflowStore.getState().step).toBe("corrections");
        expect(useMeshEditStore.getState().trimlineEdit).toBeNull();
        expect(useDesignStore.getState().design.trimlines).toBe(before);
    });
});
