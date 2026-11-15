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

    test("arch ease is ignored and elongation defaults to 0", () => {
        const out = migrateSideCorrections({
            forefootPostingDeg: 0,
            rearfootPostingDeg: 0,
            medialSkiveMm: 0,
            lateralSkiveMm: 0,
            archFillMm: 0,
            archHeightMm: 5,
            archEaseMm: 6,
            heelCupDepthMm: 0,
            heelCupHeightMm: 0,
            heelCupWidthMm: 0,
            heelLiftMm: 0,
            apexMoveMm: 0,
            medialFlangeMm: 0,
            lateralFlangeMm: 0,
        });
        expect(out.archEaseMm).toBe(0);
        expect(out.archElongationMm).toBe(0);
        expect(out.archHeightMm).toBe(5);
    });

    test("a stored elongation is kept and a non-finite one becomes 0", () => {
        const kept = migrateSideCorrections({
            forefootPostingDeg: 0,
            rearfootPostingDeg: 0,
            medialSkiveMm: 0,
            lateralSkiveMm: 0,
            archFillMm: 0,
            archHeightMm: 0,
            archEaseMm: 4,
            archElongationMm: 3.5,
            heelCupDepthMm: 0,
            heelCupHeightMm: 0,
            heelCupWidthMm: 0,
            heelLiftMm: 0,
            apexMoveMm: 0,
            medialFlangeMm: 0,
            lateralFlangeMm: 0,
        });
        expect(kept.archEaseMm).toBe(0);
        expect(kept.archElongationMm).toBe(3.5);

        const cleared = migrateSideCorrections({
            ...kept,
            archElongationMm: Number.NaN,
            archEaseMm: 2,
        });
        expect(cleared.archEaseMm).toBe(0);
        expect(cleared.archElongationMm).toBe(0);
    });
});
