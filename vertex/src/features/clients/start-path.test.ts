// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import {
    beginInsoleDesignSession,
    isOptionalScanWorkflow,
    landingStepForStartPath,
    parseDesignEntryParam,
    shouldDeferTopMeshLoad,
} from "./start-path";

beforeEach(() => {
    useClinicalWorkflowStore.setState({
        step: "scan",
        designStartPath: null,
        completedSteps: [],
        footSideExplicitlyChosen: false,
    });
});

describe("insole start path routing", () => {
    test("template and AI land on Setup with optional Scan skipped", () => {
        expect(landingStepForStartPath("template")).toBe("setup");
        expect(landingStepForStartPath("ai")).toBe("setup");
        expect(landingStepForStartPath("scan")).toBe("scan");
        expect(isOptionalScanWorkflow("template")).toBe(true);
        expect(isOptionalScanWorkflow("scan")).toBe(false);
    });

    test("beginInsoleDesignSession lands template designs on Setup", () => {
        beginInsoleDesignSession("template");
        expect(useClinicalWorkflowStore.getState().step).toBe("setup");
        expect(useClinicalWorkflowStore.getState().designStartPath).toBe("template");
        expect(useClinicalWorkflowStore.getState().completedSteps).toEqual([]);
    });

    test("beginInsoleDesignSession lands AI designs on Setup", () => {
        beginInsoleDesignSession("ai");
        expect(useClinicalWorkflowStore.getState().step).toBe("setup");
        expect(useClinicalWorkflowStore.getState().designStartPath).toBe("ai");
    });

    test("beginInsoleDesignSession opens scan workflow on Scan step", () => {
        beginInsoleDesignSession("scan");
        expect(useClinicalWorkflowStore.getState().step).toBe("scan");
        expect(useClinicalWorkflowStore.getState().designStartPath).toBe("scan");
        expect(useClinicalWorkflowStore.getState().completedSteps).toEqual([]);
    });

    test("parseDesignEntryParam accepts known entry query values", () => {
        expect(parseDesignEntryParam("template")).toBe("template");
        expect(parseDesignEntryParam("ai")).toBe("ai");
        expect(parseDesignEntryParam("scan")).toBe("scan");
        expect(parseDesignEntryParam("bogus")).toBeNull();
    });

    test("start-from-3D scan defers top mesh only on Scan", () => {
        expect(shouldDeferTopMeshLoad("scan", "scan")).toBe(true);
        expect(shouldDeferTopMeshLoad("scan", "setup")).toBe(false);
        expect(shouldDeferTopMeshLoad("template", "setup")).toBe(false);
        expect(shouldDeferTopMeshLoad("ai", "setup")).toBe(false);
        expect(shouldDeferTopMeshLoad(null, "scan")).toBe(false);
        expect(shouldDeferTopMeshLoad(null, "corrections")).toBe(false);
    });
});
