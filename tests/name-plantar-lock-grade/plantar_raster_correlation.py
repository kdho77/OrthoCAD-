#!/usr/bin/env python3
"""Independent plantar-name chirality check.

Raster the belt-contact extrusions, turn them into the physical reading frame,
and compare that image with a rendered "JABBOUR" and with the same rendering
mirrored across the vertical axis. The decision is which template correlates
higher. This does not use the worker's glyph-loop fit, linear map, or J-hook test.

Reading frame (PM, 2026-11-24): belt G-code is right-handed, X across the belt,
Y height off the belt, Z along the belt. De-shear zt = Z - Y. From below, image
right is -X and image up is +zt when the heel cup is at high zt (toe-first).
A 90 degree turn puts the toe to the right and an upright cap toward +y.
Heel-first puts that cup at low zt; pass --heel-low so both axes flip together.
Which end is the heel comes from the frozen hand_classify.py rule, not from
this script. A left-right mirror flips only one axis, so the upright template loses.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

NAME = "JABBOUR"
CAP_MM = 12.0
TRACKING_MM = 0.6
BELT_Y_MM = 0.6
PX_MM = 0.4
# Upright must beat its mirror by this much, and clear this absolute score.
MARGIN = 0.04
MIN_SCORE = 0.12


def _font_path() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "vertex" / "public" / "fonts" / "Inter-Bold.ttf"
        if candidate.exists():
            return candidate
    raise FileNotFoundError("Inter-Bold.ttf")


FONT = _font_path()

NUM = re.compile(r"([XYZEF])(-?\d*\.?\d+)")


def extrusions(path: Path) -> list[tuple[float, float, float, float, float, float]]:
    """Return extruding segments (x0,y0,z0,x1,y1,z1). E is relative after M83."""
    x = y = z = 0.0
    rel_e = True
    last_e = 0.0
    segs: list[tuple[float, float, float, float, float, float]] = []
    with path.open(errors="replace") as handle:
        for line in handle:
            if line.startswith("M82"):
                rel_e = False
                continue
            if line.startswith("M83"):
                rel_e = True
                continue
            if not (line.startswith("G0") or line.startswith("G1")):
                continue
            px, py, pz = x, y, z
            ev = None
            for key, raw in NUM.findall(line.split(";", 1)[0]):
                val = float(raw)
                if key == "X":
                    x = val
                elif key == "Y":
                    y = val
                elif key == "Z":
                    z = val
                elif key == "E":
                    ev = val
            if ev is None:
                continue
            extruded = ev > 0 if rel_e else ev > last_e + 1e-9
            if not rel_e:
                last_e = ev
            if extruded and (px, py, pz) != (x, y, z):
                segs.append((px, py, pz, x, y, z))
    return segs


def reading_xy(x: float, y: float, z: float, heel_high: bool) -> tuple[float, float]:
    """Toe to +x, upright cap to +y.

    Toe-first (heel at high zt): from below, image right is -X and image up is
    +zt, then a 90 degree turn puts the toe to the right. Heel-first is that
    camera after a 180 degree belt turn, so both axes flip together. A mirror
    flips only one, and the upright template then loses.
    """
    zt = z - y
    if heel_high:
        return (-zt, -x)
    return (zt, x)


def raster_belt(path: Path, heel_high: bool) -> tuple[np.ndarray, float, float]:
    segs = extrusions(path)
    pts: list[tuple[float, float]] = []
    kept: list[tuple[float, float, float, float]] = []
    for x0, y0, z0, x1, y1, z1 in segs:
        if min(y0, y1) > BELT_Y_MM:
            continue
        a = reading_xy(x0, y0, z0, heel_high)
        b = reading_xy(x1, y1, z1, heel_high)
        kept.append((a[0], a[1], b[0], b[1]))
        pts.append(a)
        pts.append(b)
    if len(pts) < 50:
        raise RuntimeError(f"{path} has no belt-contact extrusions")
    arr = np.asarray(pts, dtype=np.float64)
    origin = arr.min(axis=0)
    span = np.maximum(arr.max(axis=0) - origin, 1.0)
    width = int(span[0] / PX_MM) + 3
    height = int(span[1] / PX_MM) + 3
    ink = np.zeros((height, width), dtype=np.float64)

    def pix(pt: tuple[float, float]) -> tuple[int, int]:
        return (
            int(round((pt[0] - origin[0]) / PX_MM)),
            int(round((pt[1] - origin[1]) / PX_MM)),
        )

    for x0, y0, x1, y1 in kept:
        c0, r0 = pix((x0, y0))
        c1, r1 = pix((x1, y1))
        steps = max(abs(c1 - c0), abs(r1 - r0), 1)
        for i in range(steps + 1):
            t = i / steps
            c = int(round(c0 + (c1 - c0) * t))
            r = int(round(r0 + (r1 - r0) * t))
            if 0 <= r < height and 0 <= c < width:
                ink[r, c] = 1.0
    # 1 mm extrusion width: a one-pixel dilation each way.
    dil = ink.copy()
    dil[1:, :] = np.maximum(dil[1:, :], ink[:-1, :])
    dil[:-1, :] = np.maximum(dil[:-1, :], ink[1:, :])
    dil[:, 1:] = np.maximum(dil[:, 1:], ink[:, :-1])
    dil[:, :-1] = np.maximum(dil[:, :-1], ink[:, 1:])
    return letter_voids(dil), float(origin[0]), float(origin[1])


def letter_voids(ink: np.ndarray) -> np.ndarray:
    """Enclosed gaps in the belt-contact fill. The engraved name is those gaps."""
    from collections import deque

    height, width = ink.shape
    empty = ink < 0.5
    exterior = np.zeros((height, width), dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        for y in (0, height - 1):
            if empty[y, x] and not exterior[y, x]:
                exterior[y, x] = True
                queue.append((y, x))
    for y in range(height):
        for x in (0, width - 1):
            if empty[y, x] and not exterior[y, x]:
                exterior[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < height and 0 <= nx < width and empty[ny, nx] and not exterior[ny, nx]:
                exterior[ny, nx] = True
                queue.append((ny, nx))
    holes = empty & ~exterior
    keep = np.zeros_like(ink)
    seen = np.zeros((height, width), dtype=bool)
    for y in range(height):
        for x in range(width):
            if not holes[y, x] or seen[y, x]:
                continue
            queue = deque([(y, x)])
            seen[y, x] = True
            cells: list[tuple[int, int]] = []
            while queue:
                cy, cx = queue.popleft()
                cells.append((cy, cx))
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < height and 0 <= nx < width and holes[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((ny, nx))
            # One glyph is tens of mm^2. Specks and the open sole are not.
            if 80 <= len(cells) <= 8000:
                for cy, cx in cells:
                    keep[cy, cx] = 1.0
    return keep


def _glyph(font: ImageFont.FreeTypeFont, ch: str) -> Image.Image:
    box = font.getbbox(ch)
    w = max(1, box[2] - box[0] + 2)
    h = max(1, box[3] - box[1] + 2)
    img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(img).text((-box[0] + 1, -box[1] + 1), ch, fill=255, font=font)
    return img


def render_word(mirror: bool) -> np.ndarray:
    """Filled Inter Bold word at CAP_MM, plus 0.6 mm tracking. Cap is the ink height."""
    probe = ImageFont.truetype(str(FONT), 200)
    cap_px = probe.getbbox("H")[3] - probe.getbbox("H")[1]
    size = max(12, int(round(200 * (CAP_MM / PX_MM) / cap_px)))
    font = ImageFont.truetype(str(FONT), size)
    gap = max(1, int(round(TRACKING_MM / PX_MM)))
    glyphs = [_glyph(font, ch) for ch in NAME]
    width = sum(g.width for g in glyphs) + gap * (len(glyphs) - 1)
    height = max(g.height for g in glyphs)
    canvas = Image.new("L", (width, height), 0)
    x = 0
    for glyph in glyphs:
        canvas.paste(glyph, (x, height - glyph.height))
        x += glyph.width + gap
    if mirror:
        canvas = canvas.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    arr = np.asarray(canvas, dtype=np.float64) / 255.0
    # Engrave removes the letter from the belt-contact layer, so the reference is the filled glyph.
    # Array row increases with reading +y, which is the cap. PIL draws the cap at row 0.
    return np.flipud((arr > 0.5).astype(np.float64))


def _window_sum(image: np.ndarray, h: int, w: int) -> np.ndarray:
    ii = np.pad(image, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    return ii[h:, w:] - ii[:-h, w:] - ii[h:, :-w] + ii[:-h, :-w]


def ncc_map(image: np.ndarray, template: np.ndarray) -> np.ndarray:
    h, w = template.shape
    if image.shape[0] < h or image.shape[1] < w:
        return np.zeros((1, 1), dtype=np.float64)
    t = template - float(template.mean())
    energy = float(np.sqrt(np.sum(t * t)))
    if energy < 1e-6:
        return np.zeros((1, 1), dtype=np.float64)
    fft_h = image.shape[0] + h - 1
    fft_w = image.shape[1] + w - 1
    spec = np.fft.rfft2(image, s=(fft_h, fft_w)) * np.fft.rfft2(t[::-1, ::-1], s=(fft_h, fft_w))
    corr = np.fft.irfft2(spec, s=(fft_h, fft_w))
    num = corr[h - 1 : h - 1 + image.shape[0] - h + 1, w - 1 : w - 1 + image.shape[1] - w + 1]
    area = float(h * w)
    sum_i = _window_sum(image, h, w)
    sum_sq = _window_sum(image * image, h, w)
    var = np.maximum(sum_sq - (sum_i * sum_i) / area, 0.0)
    return num / (np.sqrt(var) * energy + 1e-9)


def _save_peak(image: np.ndarray, template: np.ndarray, score: np.ndarray, tag: str) -> None:
    out = Path("/tmp/grade-corr")
    h, w = template.shape
    y, x = np.unravel_index(int(np.nanargmax(score)), score.shape)
    patch = image[y : y + h, x : x + w]
    view = np.zeros((h, w * 2 + 4), dtype=np.float64)
    view[:, :w] = patch
    view[:, w + 4 :] = template
    img = Image.fromarray((np.clip(view, 0, 1) * 255).astype(np.uint8), "L")
    img.save(out / f"{tag}.png")


def grade_file(path: Path, upright: np.ndarray, mirrored: np.ndarray, heel_high: bool) -> dict:
    image, ox, oy = raster_belt(path, heel_high)
    up = ncc_map(image, upright)
    mir = ncc_map(image, mirrored)
    if os.environ.get("PLANTAR_DEBUG"):
        tag = os.environ["PLANTAR_DEBUG"]
        Image.fromarray((np.clip(np.flipud(image), 0, 1) * 255).astype(np.uint8), "L").save(
            f"/tmp/grade-corr/{tag}-letters.png"
        )
        _save_peak(image, upright, up, f"{tag}-up")
        _save_peak(image, mirrored, mir, f"{tag}-mir")
    up_peak = float(np.nanmax(up))
    mir_peak = float(np.nanmax(mir))
    reads = up_peak >= mir_peak + MARGIN and up_peak >= MIN_SCORE
    return {
        "file": path.name,
        "heel_high": heel_high,
        "upright": round(up_peak, 4),
        "mirror": round(mir_peak, 4),
        "delta": round(up_peak - mir_peak, 4),
        "reads_correctly": reads,
        "letter_px": int(image.sum()),
        "template_px": [int(upright.shape[1]), int(upright.shape[0])],
    }


def main(argv: list[str]) -> int:
    args = argv[1:]
    heel_high = True
    if args and args[0] == "--heel-low":
        heel_high = False
        args = args[1:]
    elif args and args[0] == "--heel-high":
        args = args[1:]
    if not args:
        print(
            "usage: plantar_raster_correlation.py [--heel-high|--heel-low] FILE.gcode ...",
            file=sys.stderr,
        )
        return 2
    upright = render_word(False)
    mirrored = render_word(True)
    # The two templates are not the same picture.
    if upright.shape != mirrored.shape or np.allclose(upright, mirrored):
        raise SystemExit("JABBOUR rendering is symmetric; correlation cannot judge chirality")
    rows = [grade_file(Path(p), upright, mirrored, heel_high) for p in args]
    both = all(row["reads_correctly"] for row in rows)
    print(json.dumps({"pass": both, "feet": rows}, indent=2))
    return 0 if both else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
