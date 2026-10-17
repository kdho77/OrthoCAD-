// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { setProductType } from "./afo-store";
import { AFO_STEPS, useClinicalWorkflowStore } from "./clinical-workflow-store";
import { defaultDesign, useDesignStore } from "./design-store";

describe("AFO product workflow", () => {
    test("AFO steps are Scan > Cast > Corrections > Design > Print > Export", () => {
        expect(AFO_STEPS.map((s) => s.id)).toEqual([
            "scan",
            "cast",
            "corrections",
            "design",
            "print",
            "export",
        ]);
    });

    test("switching to AFO does not require SAMPLE_Top", () => {
        useDesignStore.setState({ design: defaultDesign() });
        setProductType("afo", "left");
        expect(useDesignStore.getState().design.productType).toBe("afo");
        expect(useDesignStore.getState().design.afo?.print.thicknessMm).toBe(5);
        expect(useDesignStore.getState().design.afo?.print.edgeMm).toBe(2.5);
        expect(useDesignStore.getState().design.afo?.print.flareMm).toBe(2);
    });

    test("AFO Next from Scan with no mesh is blocked", () => {
        useClinicalWorkflowStore.setState({
            productType: "afo",
            step: "scan",
            footSideExplicitlyChosen: true,
            nextBlockReason: null,
        });
        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("scan");
    });
});
