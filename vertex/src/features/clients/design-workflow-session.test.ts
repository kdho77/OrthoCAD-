// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { loadDesignWorkflowSession, saveDesignWorkflowSession } from "./design-workflow-session";

const DESIGN = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
    localStorage.removeItem("vertex-design-workflow");
});

describe("design workflow session", () => {
    test("round-trips step and completed steps for a design id", () => {
        saveDesignWorkflowSession(DESIGN, {
            step: "corrections",
            completedSteps: ["scan", "setup", "base"],
            footSideExplicitlyChosen: true,
            designStartPath: null,
        });
        const loaded = loadDesignWorkflowSession(DESIGN);
        expect(loaded?.step).toBe("corrections");
        // Retired id "base" loads as "setup" (normalizeClinicalStep on main).
        expect(loaded?.completedSteps).toEqual(["scan", "setup", "setup"]);
        expect(loaded?.footSideExplicitlyChosen).toBe(true);
    });

    test("normalizes legacy step ids on load", () => {
        saveDesignWorkflowSession(DESIGN, {
            step: "shape" as never,
            completedSteps: [],
            footSideExplicitlyChosen: false,
            designStartPath: "scan",
        });
        // Retired id "shape" loads as "setup", same normalizer as "base".
        expect(loadDesignWorkflowSession(DESIGN)?.step).toBe("setup");
    });
});
