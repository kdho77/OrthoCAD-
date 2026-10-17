// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { generateCncJob } from "@/lib/cnc/export";
import { cloneProfile } from "@/lib/cnc/profile";
import { shippedStyleMetrics } from "@/lib/geometry/procedural-wall/shipped-pattern";
import { defaultDesign } from "@/stores/design-store";
import { syntheticWorkpiece } from "./helpers";

describe("CNC export does not change design or frozen STL hashes", () => {
    test("design JSON is unchanged around generateCncJob", () => {
        const design = defaultDesign();
        const before = JSON.stringify(design);
        const profile = cloneProfile();
        generateCncJob(profile, [syntheticWorkpiece(profile, "left")]);
        expect(JSON.stringify(design)).toBe(before);
        expect(design.elements).toEqual([]);
        expect(design.method).toBe("printing_solid");
    });

    test("frozen SAMPLE_Top style STL hashes are untouched", () => {
        const m = shippedStyleMetrics();
        expect(m.straight.stlMd5).toBe("a982e5847d9cecbf51e6c29c253bf150");
        expect(m.round.stlMd5).toBe("0000e90aecd13fff62b7d5d4f67d64ae");
        expect(m.hybrid.stlMd5).toBe("3b4bff78a92cd974bdbb51c90467d611");
    });
});
