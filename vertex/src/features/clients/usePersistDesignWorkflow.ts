// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect } from "react";
import {
    clearDesignWorkflowSession,
    saveDesignWorkflowSession,
} from "@/features/clients/design-workflow-session";
import { useClientStore } from "@/stores/client-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";

/** Persist clinical rail position per design while the editor is open. */
export function usePersistDesignWorkflow(designId: string, enabled: boolean): void {
    const deletedAt = useClientStore(
        (state) => state.designs.find((design) => design.id === designId)?.deletedAt ?? null,
    );
    useEffect(() => {
        if (!enabled || deletedAt) {
            if (deletedAt) clearDesignWorkflowSession(designId);
            return;
        }
        return useClinicalWorkflowStore.subscribe((state) => {
            const design = useClientStore.getState().designs.find((row) => row.id === designId);
            if (design?.deletedAt) {
                clearDesignWorkflowSession(designId);
                return;
            }
            saveDesignWorkflowSession(designId, {
                step: state.step,
                completedSteps: state.completedSteps,
                footSideExplicitlyChosen: state.footSideExplicitlyChosen,
                designStartPath: state.designStartPath,
            });
        });
    }, [designId, enabled, deletedAt]);
}
