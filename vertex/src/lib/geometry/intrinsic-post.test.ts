// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { correctionDeltaAt } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    type IntrinsicPostParams,
    intrinsicPostDeltaAt,
    intrinsicPostMedialLateralDeltaMm,
} from "@/lib/geometry/intrinsic-post";
import { postSectionVSignedInset } from "@/lib/geometry/post-edge-fillet";
import type { SideCorrections } from "@/types";

const WIDTH_MM = 95;
const POST_FILLET = 2;

function neutralCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function postParams(): IntrinsicPostParams {
    return { widthMm: WIDTH_MM, postFilletMm: POST_FILLET };
}

function field(active: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 266,
        widthMm: WIDTH_MM,
        thicknessMm: 3,
        shellThicknessMode: "uniform",
        postFilletMm: POST_FILLET,
        corrections: { ...neutralCorrections(), ...active },
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

describe("intrinsic post (distinct from wedges)", () => {
    test("0 mm is bit-identical delta", () => {
        const base = field({});
        const tagged = field({ intrinsicPostRfMm: 0, intrinsicPostFfMm: 0 });
        expect(correctionDeltaAt(0.12, 0.5, tagged, base)).toBe(0);
    });

    test("gate: |Z_med − Z_lat| = prescribed |h| ±0.3 mm (fillet-inset section)", () => {
        const h = 4;
        const c = { intrinsicPostRfMm: h };
        const p = postParams();
        const vMed = postSectionVSignedInset(true, WIDTH_MM, POST_FILLET);
        const vLat = postSectionVSignedInset(false, WIDTH_MM, POST_FILLET);
        const ml = intrinsicPostMedialLateralDeltaMm(0.12, "left", c, vMed, vLat, p);
        expect(Math.abs(Math.abs(ml) - Math.abs(h))).toBeLessThanOrEqual(0.3);
    });

    test("−mm = lateral high (Bio LOCKED)", () => {
        const h = -4;
        const c = { intrinsicPostRfMm: h };
        const p = postParams();
        const vMed = postSectionVSignedInset(true, WIDTH_MM, POST_FILLET);
        const vLat = postSectionVSignedInset(false, WIDTH_MM, POST_FILLET);
        const ml = intrinsicPostMedialLateralDeltaMm(0.12, "left", c, vMed, vLat, p);
        expect(ml).toBeLessThan(-3);
    });

    test("postFilletMm zeros intrinsic on the raw trimline (av=1)", () => {
        const c = { intrinsicPostRfMm: 5 };
        const atEdge = intrinsicPostDeltaAt(0.12, 1, "left", c, postParams());
        expect(Math.abs(atEdge)).toBeLessThan(0.05);
    });

    test("extrinsic-only does not change top correction delta", () => {
        const base = field({});
        const ext = field({ extrinsicPostingRfMm: 6 });
        expect(correctionDeltaAt(0.12, 0.5, ext, base)).toBe(0);
    });

    test("ML intrinsic gate still passes with deg posting present (composed Rx)", () => {
        const h = 4;
        const c = { intrinsicPostRfMm: h, rearfootPostingDeg: 5 };
        const p = postParams();
        const vMed = postSectionVSignedInset(true, WIDTH_MM, POST_FILLET);
        const vLat = postSectionVSignedInset(false, WIDTH_MM, POST_FILLET);
        const ml = intrinsicPostMedialLateralDeltaMm(0.12, "left", c, vMed, vLat, p);
        expect(Math.abs(Math.abs(ml) - Math.abs(h))).toBeLessThanOrEqual(0.3);
    });

    test("intrinsic does not duplicate rearfootPostingDeg wedge", () => {
        const wedge = field({ rearfootPostingDeg: 4 });
        const intrinsic = field({ intrinsicPostRfMm: 4 });
        const dWedge = correctionDeltaAt(0.12, 0.6, wedge, field({}));
        const dInt = correctionDeltaAt(0.12, 0.6, intrinsic, field({}));
        expect(Math.abs(dWedge - dInt)).toBeGreaterThan(0.2);
    });
});
