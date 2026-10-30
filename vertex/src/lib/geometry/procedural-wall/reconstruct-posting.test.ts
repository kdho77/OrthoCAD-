// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { describe, expect, test } from "@rstest/core";
import { migrateSideCorrections } from "@/lib/geometry/migrate-corrections";
import { hasCurveOrTopModifiers } from "@/lib/geometry/procedural-wall/reconstruct";
import { wedgeDeltaAt } from "@/lib/geometry/wedge";

describe("reconstruct posting smoke", () => {
    test("legacy rearfootPostingDeg migrates and enables reconstruct modifiers", () => {
        const migrated = migrateSideCorrections({ rearfootPostingDeg: 4 });
        expect(migrated.rearfootWedge).toEqual({ side: "lateral", value: 4, unit: "deg" });
        expect(
            hasCurveOrTopModifiers({
                corrections: { rearfootPostingDeg: 4 },
            }),
        ).toBe(true);
        const params = { lengthMm: 266, widthMm: 95 };
        const dz = wedgeDeltaAt(0.1, 0.98, "right", migrated, params);
        expect(dz).toBeGreaterThan(0.2);
        const dzLeft = wedgeDeltaAt(0.1, -0.98, "left", migrated, params);
        expect(dzLeft).toBeGreaterThan(0.2);
    });
});
