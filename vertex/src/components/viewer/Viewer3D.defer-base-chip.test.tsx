// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { shouldDeferTopMeshLoad } from "@/features/clients/start-path";

const viewerSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "Viewer3D.tsx"),
    "utf8",
);

beforeEach(() => {
    useClinicalWorkflowStore.setState({
        step: "scan",
        designStartPath: "scan",
        completedSteps: [],
        footSideExplicitlyChosen: false,
    });
});

describe("Viewer3D deferred scan base chip", () => {
    test("scan-first Scan step defers top mesh per start-path helper", () => {
        const { step, designStartPath } = useClinicalWorkflowStore.getState();
        expect(shouldDeferTopMeshLoad(designStartPath, step)).toBe(true);
    });

    test("does not render base or parametric mode chip while deferring", () => {
        expect(viewerSource).toMatch(/deferTopMeshChip \? null/);
        expect(viewerSource).not.toMatch(
            /designMode\.mode === "base" && !deferTopMeshChip[\s\S]*Parametric mode/,
        );
    });
});
