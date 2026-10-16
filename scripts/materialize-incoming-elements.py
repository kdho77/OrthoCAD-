#!/usr/bin/env python3
"""Decode staged base64 parts into the CAD-approved element binaries."""

from __future__ import annotations

import base64
import hashlib
import sys
import tarfile
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INCOMING = ROOT / "vertex/public/elements/_incoming"
DEST = ROOT / "vertex/public/elements"

EXPECTED = {
    "new_element_2.right.glb": "89409da09102312713c32e1193cba6c13adb367dc24e8fdfb58889cbe892001c",
    "new_element_2_thumb.png": "97e0113c28549cc22157379ed119886f12d1f70f5e859412bf5a9af6818b2356",
    "cluffy_wedge_1.right.glb": "caa1ee866f47def61c4c592fdc6dd1ff2fc552c166ecf0381aac4bec5eeb9b76",
    "cluffy_wedge_1_thumb.png": "4e63548131ef7a415da63311ebe842a1db097dedbbda58066fd5f2bb79e761d2",
}


def main() -> int:
    if not INCOMING.is_dir():
        print("no _incoming dir; nothing to materialize")
        return 0
    parts = sorted(INCOMING.glob("assets.tar.gz.part*"))
    if not parts:
        raise SystemExit("missing assets.tar.gz.part* chunks")
    payload = "".join(p.read_text() for p in parts)
    raw = base64.b64decode(payload)
    DEST.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=BytesIO(raw), mode="r:gz") as tf:
        tf.extractall(DEST, filter="data")
    for name, digest in EXPECTED.items():
        data = (DEST / name).read_bytes()
        got = hashlib.sha256(data).hexdigest()
        if got != digest:
            raise SystemExit(f"SHA256 mismatch for {name}: {got} != {digest}")
        print(f"ok {name} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
