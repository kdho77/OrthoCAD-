// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { describe, expect, test } from "@rstest/core";
import { viewportModeFromWidth } from "./useViewportMode";

describe("viewportModeFromWidth", () => {
    test("phones are view-only, tablets are mid, desktops are full", () => {
        expect(viewportModeFromWidth(390)).toBe("phone");
        expect(viewportModeFromWidth(834)).toBe("tablet");
        expect(viewportModeFromWidth(1440)).toBe("desktop");
    });
});
