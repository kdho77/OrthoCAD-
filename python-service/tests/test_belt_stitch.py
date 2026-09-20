# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""Regression tests for belt racetrack stitching (Vertex belt SOP port)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from app.services.belt_stitch import (
    BELT_WELD_EPS_MM,
    classify_belt_rings,
    signed_area,
    stitch_belt_loops,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def square(x0: float, y0: float, x1: float, y1: float):
    return [
        ((x0, y0), (x1, y0)),
        ((x1, y0), (x1, y1)),
        ((x1, y1), (x0, y1)),
        ((x0, y1), (x0, y0)),
    ]


class BeltStitchTests(unittest.TestCase):
    def test_weld_epsilon(self) -> None:
        self.assertEqual(BELT_WELD_EPS_MM, 1e-4)

    def test_closes_shuffled_square(self) -> None:
        segs = square(0, 0, 10, 8)
        shuffled = [segs[2], segs[0], segs[3], segs[1]]
        r = stitch_belt_loops(shuffled)
        self.assertEqual(len(r.open), 0)
        self.assertEqual(len(r.closed), 1)
        self.assertGreaterEqual(len(r.closed[0]), 4)

    def test_closes_u_on_belt_plane(self) -> None:
        segs = [((0, 0), (0, 3)), ((0, 3), (5, 3)), ((5, 3), (5, 0))]
        r = stitch_belt_loops(segs, belt_y=0.0)
        self.assertEqual(len(r.open), 0)
        self.assertEqual(len(r.closed), 1)

    def test_long_shell_pair_fuses_racetrack(self) -> None:
        top = [((0, 2), (1, 2)), ((1, 2), (89, 2)), ((89, 2), (90, 2))]
        bot = [((0, 5), (1, 5)), ((1, 5), (89, 5)), ((89, 5), (90, 5))]
        r = stitch_belt_loops(top + bot)
        self.assertEqual(len(r.shell_pairs), 1)
        self.assertEqual(len(r.closed), 1)
        self.assertEqual(len(r.open), 0)

    def test_fixture_thin_shell_segments(self) -> None:
        data = json.loads((FIXTURES / "belt_stitch_thin_shell.json").read_text())
        segs = [tuple(tuple(p) for p in s) for s in data["segments"]]
        r = stitch_belt_loops(segs)
        self.assertEqual(len(r.open), 0)
        self.assertGreaterEqual(len(r.closed) + len(r.shell_pairs), 1)

    def test_classify_nested_rings(self) -> None:
        outer = [(0, 0), (10, 0), (10, 10), (0, 10)]
        hole = [(2, 2), (4, 2), (4, 4), (2, 4)]
        island = [(2.5, 2.5), (3.5, 2.5), (3.5, 3.5), (2.5, 3.5)]
        rings = classify_belt_rings([hole, outer, island])
        by_area = sorted(rings, key=lambda r: abs(signed_area(r.loop)), reverse=True)
        self.assertEqual(by_area[0].kind, "outer")
        self.assertEqual(by_area[0].depth, 0)
        self.assertGreater(signed_area(by_area[0].loop), 0)
        self.assertEqual(by_area[1].kind, "hole")
        self.assertLess(signed_area(by_area[1].loop), 0)


if __name__ == "__main__":
    unittest.main()
