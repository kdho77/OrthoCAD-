# Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

"""The image packages the shared hardness table without changing percentages."""

from __future__ import annotations

import unittest
from pathlib import Path


class PackagedHardnessTableTests(unittest.TestCase):
    def test_packaged_json_matches_shared_table(self) -> None:
        service_root = Path(__file__).resolve().parents[1]
        packaged = service_root / "shared" / "print-recipe" / "hardness-to-infill-pct.json"
        canonical = (
            service_root.parent
            / "vertex"
            / "shared"
            / "print-recipe"
            / "hardness-to-infill-pct.json"
        )
        self.assertTrue(canonical.is_file(), canonical)
        self.assertEqual(packaged.read_bytes(), canonical.read_bytes())


if __name__ == "__main__":
    unittest.main()
