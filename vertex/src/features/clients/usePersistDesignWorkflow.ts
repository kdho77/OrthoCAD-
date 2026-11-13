// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect } from "react";
import { saveDesignWorkflowSession } from "@/features/clients/design-workflow-session";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";

/** Persist clinical rail position per design while the editor is open. */
export function usePersistDesignWorkflow(designId: string, enabled: boolean): void {
    useEffect(() => {
        if (!enabled) return;
        return useClinicalWorkflowStore.subscribe((state) => {
            saveDesignWorkflowSession(designId, {
                step: state.step,
                completedSteps: state.completedSteps,
                footSideExplicitlyChosen: state.footSideExplicitlyChosen,
                designStartPath: state.designStartPath,
            });
        });
    }, [designId, enabled]);
}
