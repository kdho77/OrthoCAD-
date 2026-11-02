// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ClinicalStepId, InsoleDesignStartPath } from "@/stores/clinical-workflow-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";

export type { InsoleDesignStartPath };

export function landingStepForStartPath(path: InsoleDesignStartPath): ClinicalStepId {
    return path === "scan" ? "scan" : "setup";
}

export function isOptionalScanWorkflow(path: InsoleDesignStartPath | null): boolean {
    return path === "template" || path === "ai";
}

export function parseDesignEntryParam(raw: string | null): InsoleDesignStartPath | null {
    if (raw === "scan" || raw === "template" || raw === "ai") return raw;
    return null;
}

/** Reset workflow rail for a newly opened design (UI routing only). */
export function beginInsoleDesignSession(startPath: InsoleDesignStartPath): void {
    useClinicalWorkflowStore.setState({
        step: landingStepForStartPath(startPath),
        designStartPath: startPath,
        completedSteps: [],
        footSideExplicitlyChosen: false,
        scanGateStickyReason: null,
        nextBlockReason: null,
        elementPlacementFoot: "both",
        pendingCorrectionSections: [],
        correctionPresetOrigin: null,
    });
}
