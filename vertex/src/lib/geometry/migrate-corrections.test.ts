// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { migrateSideCorrections } from "@/lib/geometry/migrate-corrections";

describe("migrateSideCorrections", () => {
    test("merges arch fill into arch height and clears posting deg into wedges", () => {
        const out = migrateSideCorrections({
            forefootPostingDeg: 0,
            rearfootPostingDeg: 4,
            medialSkiveMm: 0,
            lateralSkiveMm: 0,
            archFillMm: 3,
            archHeightMm: 5,
            archEaseMm: 0,
            heelCupDepthMm: 0,
            heelCupHeightMm: 0,
            heelCupWidthMm: 0,
            heelLiftMm: 0,
            apexMoveMm: 0,
            medialFlangeMm: 0,
            lateralFlangeMm: 0,
        });
        expect(out.archHeightMm).toBe(8);
        expect(out.archFillMm).toBe(0);
        expect(out.rearfootPostingDeg).toBe(0);
        expect(out.rearfootWedge).toEqual({ side: "lateral", value: 4, unit: "deg" });
    });
});
