// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { setProductType, useAfoStore } from "./afo-store";
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
        expect(useDesignStore.getState().design.afo?.print.edgeMm).toBe(2);
        expect(useDesignStore.getState().design.afo?.print.flareMm).toBe(1.5);
        expect(useDesignStore.getState().design.afo?.print.material).toBe("ApexVylon");
        expect(useDesignStore.getState().design.afo?.print).not.toHaveProperty("hideCast");
        expect(useDesignStore.getState().design.afo?.corrections).not.toHaveProperty("toeFlowMm");
        expect(useDesignStore.getState().design.afo?.cast.shinBox).toEqual({
            widthMm: 80,
            depthMm: 70,
            heightMm: 100,
            enabled: false,
        });
        expect(useDesignStore.getState().design.afo?.cast.removeCastMm).toBe(-2);
        expect(useDesignStore.getState().design.afo?.cast.shinOffsetMm).toBe(0);
        expect(useDesignStore.getState().design.afo?.reliefs.malleoli).toEqual({ mm: -3, on: true });
        expect(useDesignStore.getState().design.afo?.cast.toeBox).toEqual({
            widthMm: 80,
            depthMm: 90,
            heightMm: 50,
            heightPct: 100,
            thicknessMm: 0,
            extraLengthMm: 15,
            enabled: false,
        });
    });

    test("trim placement turns marker placement off", () => {
        useAfoStore.getState().resetSession();
        useAfoStore.getState().setPlacingClinicalId("fibular_head");
        useAfoStore.getState().setPlacingLandmarkIndex(1);
        useAfoStore.getState().setPlacingTrim(true);
        expect(useAfoStore.getState().placingTrim).toBe(true);
        expect(useAfoStore.getState().placingClinicalId).toBeNull();
        useAfoStore.getState().setPlacingLandmarkIndex(0);
        expect(useAfoStore.getState().placingTrim).toBe(false);
        expect(useAfoStore.getState().placingLandmarkIndex).toBe(0);
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
