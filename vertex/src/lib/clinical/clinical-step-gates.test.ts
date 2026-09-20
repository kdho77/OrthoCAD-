// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, test } from "@rstest/core";
import {
    evaluateNextGate,
    evaluateScanStepGate,
    evaluateStepComplete,
    isFootSideExplicitlyKnown,
} from "@/lib/clinical/clinical-step-gates";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useScanStore } from "@/stores/scan-store";

beforeEach(() => {
    useClinicalWorkflowStore.setState({
        footSideExplicitlyChosen: false,
        completedSteps: [],
        scanGateStickyReason: null,
    });
    useDesignStore.setState({ stockBaseLoading: false, stockBaseError: null });
    useScanStore.setState({ scans: [] });
});

describe("clinical step gates", () => {
    test("scan Next blocked when base still loading", () => {
        useClinicalWorkflowStore.setState({ footSideExplicitlyChosen: true });
        useDesignStore.setState({ stockBaseLoading: true });
        const gate = evaluateNextGate("scan");
        expect(gate.ok).toBe(false);
        if (!gate.ok) expect(gate.reason).toMatch(/loading/i);
    });

    test("scan Next blocked until explicit L/R foot choice", () => {
        expect(isFootSideExplicitlyKnown()).toBe(false);
        const gate = evaluateScanStepGate();
        expect(gate.ok).toBe(false);
        if (!gate.ok) expect(gate.reason).toMatch(/Select Left or Right/i);

        useClinicalWorkflowStore.getState().acknowledgeExplicitFootSide("right");
        expect(isFootSideExplicitlyKnown()).toBe(true);
    });

    test("scan Next blocked when scans present but not registered", () => {
        useClinicalWorkflowStore.setState({ footSideExplicitlyChosen: true });
        useScanStore.setState({
            scans: [
                {
                    id: "s1",
                    name: "foot.stl",
                    side: "left",
                    format: "stl",
                    triangleCount: 100,
                    geometry: null as never,
                    rawGeometry: null as never,
                    manifold: { isWatertight: false, openEdges: 1 },
                    visible: true,
                    display: null as never,
                    components: [],
                    keptComponentIds: [],
                    triangleComponentOf: null,
                    labelingMeta: null,
                    slicePlanes: [],
                    suggestedLandmarks: null,
                    cleanupMessage: null,
                    keepSetApproved: true,
                },
            ],
        });
        const gate = evaluateNextGate("scan");
        expect(gate.ok).toBe(false);
    });

    test("evaluateStepComplete does not auto-complete Shape from base load alone", () => {
        useClinicalWorkflowStore.setState({ footSideExplicitlyChosen: true });
        expect(evaluateStepComplete("shape", [])).toBe(false);
        expect(evaluateStepComplete("shape", ["shape"])).toBe(true);
        expect(evaluateStepComplete("elements", [])).toBe(false);
        expect(evaluateStepComplete("hardness", [])).toBe(false);
    });
});
