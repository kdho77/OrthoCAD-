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
        expect(useDesignStore.getState().design.afo?.print.thicknessMm).toBe(4);
        expect(useDesignStore.getState().design.afo?.print.edgeMm).toBe(2.5);
        expect(useDesignStore.getState().design.afo?.print.flareMm).toBe(2.5);
        expect(useDesignStore.getState().design.afo?.print).not.toHaveProperty("hideCast");
        expect(useDesignStore.getState().design.afo?.corrections).not.toHaveProperty("toeFlowMm");
        expect(useDesignStore.getState().design.afo?.cast.shinBox).toEqual({
            widthMm: 80,
            depthMm: 70,
            heightMm: 220,
            enabled: false,
        });
        expect(useDesignStore.getState().design.afo?.cast.removeCastMm).toBe(0);
        expect(useDesignStore.getState().design.afo?.cast.shinOffsetMm).toBe(0);
        expect(useDesignStore.getState().design.afo?.reliefs.malleoli).toEqual({ mm: -3, on: true });
        expect(useDesignStore.getState().design.afo?.cast.toeBox).toEqual({
            widthMm: 80,
            depthMm: 90,
            heightMm: 50,
            heightPct: 100,
            enabled: false,
        });
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
