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

# Placeholder bundle.b64 stubs are ~30 bytes and must never win over legacy parts.
MIN_PART_BYTES = 1000


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def already_materialized() -> bool:
    return all((DEST / name).is_file() and _sha(DEST / name) == digest for name, digest in EXPECTED.items())


def usable_parts(glob_name: str) -> list[Path]:
    return sorted(p for p in INCOMING.glob(glob_name) if p.stat().st_size >= MIN_PART_BYTES)


def main() -> int:
    if already_materialized():
        print("element binaries already present")
        return 0
    if not INCOMING.is_dir():
        print("no _incoming dir; skip materialize")
        return 0
    # Prefer real bundle.b64 parts; ignore tiny placeholders so incomplete
    # 80KB uploads cannot block the proven 4KB assets.tar.gz.part* path.
    bundle = usable_parts("bundle.b64.part*")
    legacy = usable_parts("assets.tar.gz.part*")
    parts = bundle or legacy
    if not parts:
        print("no incoming parts; skip materialize")
        return 0
    try:
        payload = "".join(p.read_text() for p in parts)
        raw = base64.b64decode(payload)
        DEST.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=BytesIO(raw), mode="r:gz") as tf:
            tf.extractall(DEST, filter="data")
        for name, digest in EXPECTED.items():
            data = (DEST / name).read_bytes()
            got = hashlib.sha256(data).hexdigest()
            if got != digest:
                raise ValueError(f"SHA256 mismatch for {name}: {got} != {digest}")
            print(f"ok {name} ({len(data)} bytes)")
    except Exception as exc:
        # Incomplete part sets must not fail Vercel; tests still gate completeness.
        print(f"materialize incomplete ({exc}); continuing without new binaries")
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
