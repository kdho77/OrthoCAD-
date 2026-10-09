// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { getImportSideChoice, setSharedFootSide } from "@/lib/clinical/active-foot-side";
import { evaluateScanStepGate, isFootSideExplicitlyKnown } from "@/lib/clinical/clinical-step-gates";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

beforeEach(() => {
    useClinicalWorkflowStore.setState({
        footSideExplicitlyChosen: false,
        importSideChoice: null,
        elementPlacementFoot: "left",
        completedSteps: [],
        scanGateStickyReason: null,
        nextBlockReason: null,
    });
    useDesignStore.setState({ stockBaseLoading: false, stockBaseError: null, exportSide: "left" });
});

describe("shared foot side state", () => {
    test("scan Next stays blocked until a side is chosen (no silent default)", () => {
        expect(getImportSideChoice()).toBeNull();
        expect(isFootSideExplicitlyKnown()).toBe(false);
        const gate = evaluateScanStepGate();
        expect(gate.ok).toBe(false);
        if (!gate.ok) expect(gate.reason).toMatch(/Select Left, Right, or Pair/i);
    });

    test("import selector and clinical foot bar write the same store field", () => {
        setSharedFootSide("right");
        expect(getImportSideChoice()).toBe("right");
        expect(isFootSideExplicitlyKnown()).toBe(true);
        expect(useClinicalWorkflowStore.getState().elementPlacementFoot).toBe("right");
        expect(useClinicalWorkflowStore.getState().importSideChoice).toBe("right");
        expect(useDesignStore.getState().exportSide).toBe("right");

        // Same writer the Scan step Left/Right/Pair buttons and ActiveFootSideBar use.
        setSharedFootSide("left");
        expect(getImportSideChoice()).toBe("left");
        expect(useClinicalWorkflowStore.getState().importSideChoice).toBe("left");
        expect(useClinicalWorkflowStore.getState().elementPlacementFoot).toBe("left");
        expect(useDesignStore.getState().exportSide).toBe("left");

        setSharedFootSide("pair");
        expect(getImportSideChoice()).toBe("pair");
        expect(isFootSideExplicitlyKnown()).toBe(true);
        expect(useClinicalWorkflowStore.getState().elementPlacementFoot).toBe("both");
        expect(useClinicalWorkflowStore.getState().importSideChoice).toBe("pair");
    });

    test("Scan step hosts import controls; left sidebar does not duplicate them", () => {
        const panel = readFileSync(
            resolve(process.cwd(), "vertex/src/features/clinical/ClinicalScanStepPanel.tsx"),
            "utf8",
        );
        const sidebar = readFileSync(
            resolve(process.cwd(), "vertex/src/components/layout/LeftSidebar.tsx"),
            "utf8",
        );
        const importSrc = readFileSync(
            resolve(process.cwd(), "vertex/src/features/scans/ScanImport.tsx"),
            "utf8",
        );
        expect(panel).toMatch(/<ScanImport/);
        expect(panel).not.toMatch(/ActiveFootSideBar/);
        expect(sidebar).not.toMatch(/<ScanImport/);
        expect(sidebar).toMatch(/Import scans in the Scan step/);
        expect(importSrc).toMatch(/setSharedFootSide/);
        expect(importSrc).toMatch(/useImportSideChoice/);
        expect(importSrc).not.toMatch(/useState<ImportSideChoice/);
    });
});
