// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { describe, expect, test } from "@rstest/core";
import { CLINICAL_STEPS, clinicalStepShort, useClinicalWorkflowStore } from "./clinical-workflow-store";

describe("clinical workflow steps", () => {
    test("Scan > Setup > Base > Corrections > Elements > Print > Export", () => {
        expect(CLINICAL_STEPS.map((s) => s.id)).toEqual([
            "scan",
            "setup",
            "base",
            "corrections",
            "elements",
            "print",
            "export",
        ]);
    });

    test("Print step is labeled Mill for milling_3axis", () => {
        expect(clinicalStepShort("print", "printing_solid")).toBe("Print");
        expect(clinicalStepShort("print", "printing_shell")).toBe("Print");
        expect(clinicalStepShort("print", "milling_3axis")).toBe("Mill");
        expect(clinicalStepShort("export", "milling_3axis")).toBe("Export");
    });

    test("pair assignment defaults Editing to Both", () => {
        useClinicalWorkflowStore.setState({
            elementPlacementFoot: "left",
            footSideExplicitlyChosen: false,
        });
        useClinicalWorkflowStore.getState().acknowledgePairAssignment();
        expect(useClinicalWorkflowStore.getState().elementPlacementFoot).toBe("both");
        expect(useClinicalWorkflowStore.getState().footSideExplicitlyChosen).toBe(true);
        const sticky = useClinicalWorkflowStore.getState().scanGateStickyReason;
        if (sticky) expect(sticky).not.toMatch(/Select Left, Right, or Pair/i);
    });

    test("blocked Next stays enabled and jumps to Scan", () => {
        useClinicalWorkflowStore.setState({
            step: "setup",
            footSideExplicitlyChosen: false,
            nextBlockReason: null,
        });
        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("scan");
        expect(useClinicalWorkflowStore.getState().nextBlockReason).toMatch(/Left, Right, or Pair/i);
    });
});
