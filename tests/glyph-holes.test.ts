// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { loadTextFont } from "@/lib/geometry/text-marking/font";

describe("glyph counter holes after inflate / union", () => {
    test("single-counter glyphs keep one hole", async () => {
        const font = await loadTextFont();
        const oneHole = ["O", "A", "D", "P", "R", "Q", "0", "4", "6", "9"] as const;
        for (const ch of oneHole) {
            const flat = flattenText(font, ch, 12, 0.6, true);
            const holes = flat.groups.reduce((n, g) => n + g.holes.length, 0);
            expect(holes).toBe(1);
        }
    });

    test("B and 8 keep two holes", async () => {
        const font = await loadTextFont();
        for (const ch of ["B", "8"] as const) {
            const flat = flattenText(font, ch, 12, 0.6, true);
            const holes = flat.groups.reduce((n, g) => n + g.holes.length, 0);
            expect(holes).toBe(2);
        }
    });
});
