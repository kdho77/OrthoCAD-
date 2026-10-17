#!/usr/bin/env python3
"""Decode staged base64 parts into the CAD-approved element binaries."""

from __future__ import annotations

import base64
import collections
import hashlib
import struct
import sys
import tarfile
import zlib
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INCOMING = ROOT / "vertex/public/elements/_incoming"
DEST = ROOT / "vertex/public/elements"

EXPECTED = {
    "new_element_2.right.glb": "89409da09102312713c32e1193cba6c13adb367dc24e8fdfb58889cbe892001c",
    "new_element_2_thumb.png": "e7a216ec4932a2d70321ca87d1c167c48e155a15cf5c9ddd1f512fa61fc506fd",
    "cluffy_wedge_1.right.glb": "caa1ee866f47def61c4c592fdc6dd1ff2fc552c166ecf0381aac4bec5eeb9b76",
    "cluffy_wedge_1_thumb.png": "4e63548131ef7a415da63311ebe842a1db097dedbbda58066fd5f2bb79e761d2",
}

# Placeholder bundle.b64 stubs are ~30 bytes and must never win over legacy parts.
MIN_PART_BYTES = 1000
NEAR_WHITE = 240


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def already_materialized() -> bool:
    return all((DEST / name).is_file() and _sha(DEST / name) == digest for name, digest in EXPECTED.items())


def usable_parts(glob_name: str) -> list[Path]:
    return sorted(p for p in INCOMING.glob(glob_name) if p.stat().st_size >= MIN_PART_BYTES)


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def _read_png_rgba(path: Path) -> tuple[int, int, list[bytearray], list[tuple[bytes, bytes]]]:
    data = path.read_bytes()
    if data[:8] != b"\\x89PNG\\r\\n\\x1a\\n":
        raise ValueError(f"{path.name} is not a PNG")
