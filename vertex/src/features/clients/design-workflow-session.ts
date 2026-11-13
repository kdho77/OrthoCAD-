// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ClinicalStepId, InsoleDesignStartPath } from "@/stores/clinical-workflow-store";
import { normalizeClinicalStep } from "@/stores/clinical-workflow-store";

const STORAGE_KEY = "vertex-design-workflow";

export interface DesignWorkflowSession {
    step: ClinicalStepId;
    completedSteps: ClinicalStepId[];
    footSideExplicitlyChosen: boolean;
    designStartPath: InsoleDesignStartPath | null;
}

function readMap(): Record<string, DesignWorkflowSession> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, DesignWorkflowSession>;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function writeMap(map: Record<string, DesignWorkflowSession>): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        // Storage can be blocked; reopening falls back to Scan.
    }
}

export function loadDesignWorkflowSession(designId: string): DesignWorkflowSession | null {
    const row = readMap()[designId];
    if (!row) return null;
    return {
        step: normalizeClinicalStep(row.step),
        completedSteps: row.completedSteps.map((s) => normalizeClinicalStep(s)),
        footSideExplicitlyChosen: row.footSideExplicitlyChosen === true,
        designStartPath:
            row.designStartPath === "scan" ||
            row.designStartPath === "template" ||
            row.designStartPath === "ai"
                ? row.designStartPath
                : null,
    };
}

export function saveDesignWorkflowSession(designId: string, session: DesignWorkflowSession): void {
    const map = readMap();
    map[designId] = session;
    writeMap(map);
}
