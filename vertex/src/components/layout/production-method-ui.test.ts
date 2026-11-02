// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { PRINTING_SHELL_SELECTABLE_IN_UI, productionMethodDisabledInUi } from "./production-method-ui";

describe("Setup production method UI", () => {
    test("Printing — Shell is disabled until shells ship", () => {
        expect(PRINTING_SHELL_SELECTABLE_IN_UI).toBe(false);
        expect(productionMethodDisabledInUi("printing_shell")).toBe(true);
        expect(productionMethodDisabledInUi("printing_solid")).toBe(false);
        expect(productionMethodDisabledInUi("milling_3axis")).toBe(false);
    });
});
