// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BELT_WELD_EPS_MM, classifyBeltRings, signedArea, stitchBeltLoops } from "./belt-stitch";
import type { Pt } from "./slicer";

function square(x0: number, y0: number, x1: number, y1: number): [Pt, Pt][] {
    return [
        [
            [x0, y0],
            [x1, y0],
        ],
        [
            [x1, y0],
            [x1, y1],
        ],
        [
            [x1, y1],
            [x0, y1],
        ],
        [
            [x0, y1],
            [x0, y0],
        ],
    ];
}

describe("stitchBeltLoops", () => {
    test("exposes weld epsilon 1e-4 mm", () => {
        expect(BELT_WELD_EPS_MM).toBe(1e-4);
    });

    test("closes a ring when segments arrive in shuffled order", () => {
        const segs = square(0, 0, 10, 8);
        const shuffled = [segs[2], segs[0], segs[3], segs[1]];
        const r = stitchBeltLoops(shuffled);
        expect(r.open.length).toBe(0);
        expect(r.closed.length).toBe(1);
        expect(r.closed[0].length).toBeGreaterThanOrEqual(4);
    });

    test("drops zero-length and duplicate segments", () => {
        const segs: [Pt, Pt][] = [
            ...square(0, 0, 4, 4),
            [
                [1, 1],
                [1, 1],
            ],
            [
                [0, 0],
                [4, 0],
            ],
        ];
        const r = stitchBeltLoops(segs);
        expect(r.closed.length).toBe(1);
        expect(r.open.length).toBe(0);
    });

    test("closes a U whose ends sit on the belt plane", () => {
        const segs: [Pt, Pt][] = [
            [
                [0, 0],
                [0, 3],
            ],
            [
                [0, 3],
                [5, 3],
            ],
            [
                [5, 3],
                [5, 0],
            ],
        ];
        const r = stitchBeltLoops(segs, { beltY: 0 });
        expect(r.open.length).toBe(0);
        expect(r.closed.length).toBe(1);
    });

    test("open chain off the belt is diagnostic, not closed", () => {
        const segs: [Pt, Pt][] = [
            [
                [0, 1],
                [0, 3],
            ],
            [
                [0, 3],
                [2, 3],
            ],
        ];
        const r = stitchBeltLoops(segs, { beltY: 0 });
        expect(r.closed.length).toBe(0);
        expect(r.open.length).toBe(1);
    });

    test("does not close a collinear belt-only polyline", () => {
        const segs: [Pt, Pt][] = [
            [
                [0, 0],
                [2, 0],
            ],
            [
                [2, 0],
                [4, 0],
            ],
        ];
        const r = stitchBeltLoops(segs, { beltY: 0 });
        expect(r.closed.length).toBe(0);
    });

    test("joins two surface chains at rim ends closer than half a local edge", () => {
        const top: [Pt, Pt][] = [
            [
                [0.05, 1],
                [4, 1],
            ],
            [
                [4, 1],
                [8, 1],
            ],
            [
                [8, 1],
                [10.05, 1],
            ],
        ];
        const bot: [Pt, Pt][] = [
            [
                [0, 1.4],
                [4, 2],
            ],
            [
                [4, 2],
                [8, 2],
            ],
            [
                [8, 2],
                [10, 1.4],
            ],
        ];
        const r = stitchBeltLoops([...top, ...bot]);
        expect(r.shellPairs.length).toBe(1);
        expect(r.closed.length).toBe(0);
        expect(r.open.length).toBe(0);
    });

    test("closes two shell-surface chains at the rims", () => {
        const top: [Pt, Pt][] = [
            [
                [0, 2.5],
                [5, 2.4],
            ],
            [
                [5, 2.4],
                [10, 2.5],
            ],
        ];
        const bot: [Pt, Pt][] = [
            [
                [0, 0],
                [5, 0.1],
            ],
            [
                [5, 0.1],
                [10, 0],
            ],
        ];
        const r = stitchBeltLoops([...top, ...bot]);
        expect(r.shellPairs.length).toBe(1);
        expect(r.closed.length).toBe(0);
        expect(r.open.length).toBe(0);
    });

    test("does not join rims 90 mm apart", () => {
        const segs: [Pt, Pt][] = [
            [
                [0, 1],
                [40, 1],
            ],
            [
                [40, 1],
                [90, 1],
            ],
        ];
        const r = stitchBeltLoops(segs);
        expect(r.closed.length).toBe(0);
    });

    test("splits a T-junction and still closes", () => {
        const segs: [Pt, Pt][] = [
            [
                [0, 0],
                [4, 0],
            ],
            [
                [4, 0],
                [4, 3],
            ],
            [
                [4, 3],
                [0, 3],
            ],
            [
                [0, 3],
                [0, 0],
            ],
            [
                [2, 0],
                [2, 1],
            ],
        ];
        const r = stitchBeltLoops(segs);
        expect(r.closed.length).toBeGreaterThanOrEqual(1);
    });
});

describe("classifyBeltRings", () => {
    test("nests a hole and an island", () => {
        const outer: Pt[] = [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
        ];
        const hole: Pt[] = [
            [2, 2],
            [4, 2],
            [4, 4],
            [2, 4],
        ];
        const island: Pt[] = [
            [2.5, 2.5],
            [3.5, 2.5],
            [3.5, 3.5],
            [2.5, 3.5],
        ];
        const rings = classifyBeltRings([hole, outer, island]);
        const byArea = [...rings].sort((a, b) => Math.abs(signedArea(b.loop)) - Math.abs(signedArea(a.loop)));
        expect(byArea[0].kind).toBe("outer");
        expect(byArea[0].depth).toBe(0);
        expect(signedArea(byArea[0].loop)).toBeGreaterThan(0);
        expect(byArea[1].kind).toBe("hole");
        expect(byArea[1].depth).toBe(1);
        expect(signedArea(byArea[1].loop)).toBeLessThan(0);
        expect(byArea[2].kind).toBe("outer");
        expect(byArea[2].depth).toBe(2);
        expect(signedArea(byArea[2].loop)).toBeGreaterThan(0);
    });
});
