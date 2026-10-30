// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

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
