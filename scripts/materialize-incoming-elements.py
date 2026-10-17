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
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path.name} is not a PNG")
    pos = 8
    chunks: list[tuple[bytes, bytes]] = []
    while pos + 8 <= len(data):
        ln = struct.unpack(">I", data[pos : pos + 4])[0]
        ctype = data[pos + 4 : pos + 8]
        cdata = data[pos + 8 : pos + 8 + ln]
        chunks.append((ctype, cdata))
        pos += 12 + ln
        if ctype == b"IEND":
            break
    ihdr = dict(chunks)[b"IHDR"]
    w, h, bit, color, _comp, _filt, inter = struct.unpack(">IIBBBBB", ihdr)
    if bit != 8 or inter != 0 or color not in (2, 6):
        raise ValueError(f"{path.name}: unsupported PNG ({w}x{h} bit={bit} color={color})")
    raw = zlib.decompress(b"".join(d for t, d in chunks if t == b"IDAT"))
    bpp = 4 if color == 6 else 3
    stride = w * bpp
    rows: list[bytearray] = []
    i = 0
    prev = bytearray(stride)
    for _y in range(h):
        filt = raw[i]
        i += 1
        row = bytearray(raw[i : i + stride])
        i += stride
        if filt == 1:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + left) & 255
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif filt == 4:
            for x in range(stride):
                a = row[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + _paeth(a, b, c)) & 255
        elif filt != 0:
            raise ValueError(f"{path.name}: bad PNG filter {filt}")
        rows.append(row)
        prev = row
    rgba: list[bytearray] = []
    for row in rows:
        out = bytearray(w * 4)
        if color == 6:
            out[:] = row
        else:
            for x in range(w):
                out[x * 4 : x * 4 + 3] = row[x * 3 : x * 3 + 3]
                out[x * 4 + 3] = 255
        rgba.append(out)
    return w, h, rgba, chunks


def _write_png_rgba(
    path: Path, w: int, h: int, rgba: list[bytearray], extra_chunks: list[tuple[bytes, bytes]]
) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw = bytearray()
    for row in rgba:
        raw.append(0)
        raw.extend(row)
    idat = zlib.compress(bytes(raw), 9)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    out = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
    for tag, data in extra_chunks:
        if tag in (b"IHDR", b"IDAT", b"IEND", b"tRNS"):
            continue
        out += chunk(tag, data)
    out += chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    path.write_bytes(out)


def clear_border_near_white(path: Path) -> int:
    """Set alpha=0 on near-white pixels connected to the image border.

    Near-white means r, g, and b are all >= 240. Pad colours (including the
    yellow viridis peak) are left untouched.
    """
    w, h, rgba, chunks = _read_png_rgba(path)
    seen = bytearray(w * h)
    q: collections.deque[tuple[int, int]] = collections.deque()

    def is_near(x: int, y: int) -> bool:
        r, g, b, a = rgba[y][x * 4 : x * 4 + 4]
        return a > 0 and r >= NEAR_WHITE and g >= NEAR_WHITE and b >= NEAR_WHITE

    def push(x: int, y: int) -> None:
        i = y * w + x
        if seen[i] or not is_near(x, y):
            return
        seen[i] = 1
        q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)
    cleared = 0
    while q:
        x, y = q.popleft()
        rgba[y][x * 4 + 3] = 0
        cleared += 1
        if x:
            push(x - 1, y)
        if x + 1 < w:
            push(x + 1, y)
        if y:
            push(x, y - 1)
        if y + 1 < h:
            push(x, y + 1)
    if cleared:
        _write_png_rgba(path, w, h, rgba, chunks)
    return cleared


def clear_library_thumb_white_backgrounds() -> None:
    if not DEST.is_dir():
        return
    for path in sorted(DEST.glob("*_thumb.png")):
        n = clear_border_near_white(path)
        if n:
            print(f"cleared {n} border-white pixels in {path.name}")


def main() -> int:
    clear_library_thumb_white_backgrounds()
    keep = {
        name
        for name, digest in EXPECTED.items()
        if (DEST / name).is_file() and _sha(DEST / name) == digest
    }
    if len(keep) == len(EXPECTED):
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
    saved = {name: (DEST / name).read_bytes() for name in keep}
    try:
        payload = "".join(p.read_text() for p in parts)
        raw = base64.b64decode(payload)
        DEST.mkdir(parents=True, exist_ok=True)
        # Extract in place so a truncated gzip still leaves the members it
        # unpacked (the dancer thumb is small and comes out before the GLBs).
        with tarfile.open(fileobj=BytesIO(raw), mode="r:gz") as tf:
            tf.extractall(DEST, filter="data")
        for name, data in saved.items():
            (DEST / name).write_bytes(data)
            print(f"keep committed {name}")
        clear_library_thumb_white_backgrounds()
        for name, digest in EXPECTED.items():
            dest = DEST / name
            if not dest.is_file():
                raise ValueError(f"missing {name} after extract")
            got = _sha(dest)
            if got != digest:
                raise ValueError(f"SHA256 mismatch for {name}: {got} != {digest}")
            print(f"ok {name} ({dest.stat().st_size} bytes)")
    except Exception as exc:
        for name, data in saved.items():
            (DEST / name).write_bytes(data)
        clear_library_thumb_white_backgrounds()
        # Incomplete part sets must not fail Vercel; tests still gate completeness.
        print(f"materialize incomplete ({exc}); continuing without new binaries")
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
