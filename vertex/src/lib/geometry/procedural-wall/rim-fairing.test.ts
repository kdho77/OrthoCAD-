// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    fairRim01,
    RIM_FAIR_MAX_MM,
    RIM_TURN_EXEMPT_DEG,
    rimTurningDeg,
    stationsOnTaggedRim,
    tagStaircaseRim,
} from "./rim-fairing";

describe("rim fairing", () => {
    test("tags source-rim vertices that turn more than 15°", () => {
        const pts = [
            { x: 0, y: 0, z: 4 },
            { x: 1, y: 0, z: 4 },
            { x: 1.1, y: 1, z: 4 },
            { x: 2.1, y: 1, z: 4 },
            { x: 3, y: 0.2, z: 4 },
            { x: 2, y: -0.2, z: 4 },
        ];
        const tagged = tagStaircaseRim(pts);
        expect(RIM_TURN_EXEMPT_DEG).toBe(15);
        expect(tagged.some(Boolean)).toBe(true);
        for (let i = 0; i < pts.length; i++) {
            expect(tagged[i]).toBe(rimTurningDeg(pts, i) > 15);
        }
    });

    test("fair01 stays within 0.1 mm of the source rim", () => {
        const src = [
            { x: 0, y: 0, z: 5 },
            { x: 1, y: 0.3, z: 5 },
            { x: 2, y: 0, z: 5 },
            { x: 2, y: 1, z: 5 },
            { x: 0, y: 1, z: 5 },
        ];
        const faired = fairRim01(src, RIM_FAIR_MAX_MM);
        expect(RIM_FAIR_MAX_MM).toBe(0.1);
        for (let i = 0; i < src.length; i++) {
            const d = Math.hypot(
                faired[i]!.x - src[i]!.x,
                faired[i]!.y - src[i]!.y,
                faired[i]!.z - src[i]!.z,
            );
            expect(d).toBeLessThanOrEqual(RIM_FAIR_MAX_MM + 1e-9);
            expect(faired[i]!.z).toBe(src[i]!.z);
        }
    });

    test("stationsOnTaggedRim matches source staircase verts", () => {
        const tagged = [{ x: 1, y: 2, z: 3 }];
        const stations = [{ rim: { x: 1, y: 2, z: 3 } }, { rim: { x: 8, y: 8, z: 8 } }];
        expect(stationsOnTaggedRim(stations, tagged)).toEqual([true, false]);
    });
});
