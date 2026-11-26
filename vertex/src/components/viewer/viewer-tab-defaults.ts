// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ClinicalStepId } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

/** Design-phase tabs default to heatmap; Print / Export default to solid. */
export function defaultHeightmapForClinicalStep(step: ClinicalStepId): boolean {
    return step !== "print" && step !== "export";
}

/** Apply per-tab viewport defaults (user can still toggle Heatmap afterward). */
export function applyViewerDefaultsForClinicalStep(step: ClinicalStepId): void {
    useDesignStore.getState().setViewer({ heightmap: defaultHeightmapForClinicalStep(step) });
}
