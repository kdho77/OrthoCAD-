// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { formatCaseSummaryLine } from "@/lib/clinical/case-summary";
import { defaultDesign } from "@/stores/design-store";

describe("case summary", () => {
    test("includes size, width, method, and pattern", () => {
        const design = defaultDesign();
        design.shoeWidth = "wide";
        expect(formatCaseSummaryLine(design)).toBe("US M9 · Wide · Printing solid · Full Contact");
    });
});
