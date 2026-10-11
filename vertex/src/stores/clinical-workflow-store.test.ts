// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { CLINICAL_STEPS } from "./clinical-workflow-store";

describe("clinical workflow steps", () => {
    test("Scan > Shape > Corrections > Elements > Hardness > Print", () => {
        expect(CLINICAL_STEPS.map((s) => s.id)).toEqual([
            "scan",
            "shape",
            "corrections",
            "elements",
            "hardness",
            "print",
        ]);
    });
});
