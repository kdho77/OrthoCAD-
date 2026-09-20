// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { evaluateNextGate } from "@/lib/clinical/clinical-step-gates";
import { useDesignStore } from "@/stores/design-store";
import { useScanStore } from "@/stores/scan-store";

describe("clinical step gates", () => {
    test("scan Next blocked when base still loading", () => {
        useDesignStore.setState({ stockBaseLoading: true });
        const gate = evaluateNextGate("scan");
        expect(gate.ok).toBe(false);
        if (!gate.ok) expect(gate.reason).toMatch(/loading/i);
        useDesignStore.setState({ stockBaseLoading: false });
    });

    test("scan Next blocked when scans present but not registered", () => {
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
        useScanStore.setState({ scans: [] });
    });
});
