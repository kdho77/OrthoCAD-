// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { viewportModeFromWidth } from "./useViewportMode";

describe("viewportModeFromWidth", () => {
    test("phones are view-only, tablets are mid, desktops are full", () => {
        expect(viewportModeFromWidth(390)).toBe("phone");
        expect(viewportModeFromWidth(834)).toBe("tablet");
        expect(viewportModeFromWidth(1440)).toBe("desktop");
    });
});
