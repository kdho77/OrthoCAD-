// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";

const editingHeader = readFileSync(resolve("vertex/src/components/clinical/EditingStepHeader.tsx"), "utf8");

describe("EditingStepHeader", () => {
    test("foot-side gate copy lives in PanelHeading info, not inline amber hint", () => {
        expect(editingHeader).toContain("Pick Left, Right, or Pair");
        expect(editingHeader).not.toContain("text-amber");
    });
});
