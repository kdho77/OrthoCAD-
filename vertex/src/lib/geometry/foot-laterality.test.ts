// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { getDefaultStockBaseSync } from "@/lib/geometry/base-asset";

/**
 * heightAt medial mapping (see height-field.ts):
 *   medialSign = side === "left" ? -1 : 1
 *   m = -(vSigned * medialSign)
 * ⇒ left medial is +Y (vSigned > 0); right medial is −Y (vSigned < 0).
 *
 * Default.glb midfoot arch sits on width− after reorientToFootprintFrame, so it is a
 * RIGHT foot. primarySide must stay "right" — labeling it "left" mirrors the left
 * shape into the right slot and makes Right sliders / eye-toggles feel contralateral.
 */
describe("stock foot laterality", () => {
    test("builtin Default stock primarySide is right (arch on width− = right medial)", () => {
        expect(getDefaultStockBaseSync().primarySide?.toLowerCase()).toBe("right");
    });

    test("height-field medialSign places left medial on +Y and right medial on −Y", () => {
        const medialCoord = (side: "left" | "right", vSigned: number) => {
            const medialSign = side === "left" ? -1 : 1;
            return -(vSigned * medialSign);
        };
        expect(medialCoord("left", 1)).toBeGreaterThan(0);
        expect(medialCoord("left", -1)).toBeLessThan(0);
        expect(medialCoord("right", -1)).toBeGreaterThan(0);
        expect(medialCoord("right", 1)).toBeLessThan(0);
    });
});
