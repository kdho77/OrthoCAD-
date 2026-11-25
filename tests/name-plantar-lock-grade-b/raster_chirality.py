#!/usr/bin/env python3
"""Independent plantar-name chirality.

Raster the belt-contact extrusions, recover letter holes, and score them by
normalized correlation against a rendered "JABBOUR" and its mirrors.

This is not the worker's loop-to-font linear map. The only shared geometry is
the physical belt frame from the 2026-11-24 calibration: X across the belt,
Y off the belt, zt = Z - Y, heel = the taller end fifth.
"""

from __future__ import annotations

import json
import math
import re
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

CONTACT_Y = 0.6
PX_MM = 0.45
NAME = "JABBOUR"
FONT = "/usr/share/fonts/truetype/macos/Inter-Bold.ttf"
WORD = re.compile(r"([XYZE])(-?\d*\.?\d+(?:e[-+]?\d+)?)", re.I)


def parse_extrusions(path: Path):
    x = y = z = e = 0.0
    abs_xyz = True
    rel_e = False
    segs = []
    for raw in path.read_text(errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith(";"):
            continue
        code = line.split(";", 1)[0].strip()
        if code.startswith("G90"):
            abs_xyz = True
            continue
        if code.startswith("G91"):
            abs_xyz = False
            continue
        if code.startswith("M82"):
            rel_e = False
            continue
        if code.startswith("M83"):
            rel_e = True
            continue
        if not (code.startswith("G0") or code.startswith("G1")):
            continue
        nx, ny, nz, ne = x, y, z, e
        has_e = False
        for key, val in WORD.findall(code):
            key = key.upper()
            val = float(val)
            if key == "X":
                nx = val if abs_xyz else x + val
            elif key == "Y":
                ny = val if abs_xyz else y + val
            elif key == "Z":
                nz = val if abs_xyz else z + val
            elif key == "E":
                has_e = True
                ne = e + val if rel_e else val
        if code.startswith("G1") and has_e and ne > e + 1e-9:
            segs.append((x, y, z, nx, ny, nz))
        x, y, z, e = nx, ny, nz, ne
    return segs


def heel_end(segs):
    """Taller end fifth is the heel cup. Returns heel_at_high_zt, delta_mm."""
    pts = []
    for x0, y0, z0, x1, y1, z1 in segs:
        if y0 <= CONTACT_Y:
            pts.append((x0, y0, z0))
        if y1 <= CONTACT_Y:
            pts.append((x1, y1, z1))
    if len(pts) < 200:
        return None, 0.0
    zt = [p[2] - p[1] for p in pts]
    z0, z1 = min(zt), max(zt)
    length = z1 - z0
    if length < 80:
        return None, 0.0
    all_pts = []
    for ax, ay, az, bx, by, bz in segs:
        all_pts.append((ay, az - ay))
        all_pts.append((by, bz - by))

    def end_max(a, b):
        best = -1e9
        for y, t in all_pts:
            u = (t - z0) / length
            if a <= u < b and y > best:
                best = y
        return best

    lo = end_max(0.0, 0.2)
    hi = end_max(0.8, 1.0001)
    delta = hi - lo
    if abs(delta) < 5:
        return None, float(delta)
    return bool(delta > 0), float(delta)


def reading(x, y, z, heel_high: bool):
    zt = z - y
    sign = -1.0 if heel_high else 1.0
    return sign * zt, sign * x


def raster_holes(segs, heel_high: bool):
    contact = []
    for x0, y0, z0, x1, y1, z1 in segs:
        if max(y0, y1) > CONTACT_Y:
            continue
        contact.append((*reading(x0, y0, z0, heel_high), *reading(x1, y1, z1, heel_high)))
    if len(contact) < 50:
        return None
    xs = [v for s in contact for v in (s[0], s[2])]
    ys = [v for s in contact for v in (s[1], s[3])]
    minx, maxx = min(xs) - 2, max(xs) + 2
    miny, maxy = min(ys) - 2, max(ys) + 2
    w = int((maxx - minx) / PX_MM) + 3
    h = int((maxy - miny) / PX_MM) + 3
    ink = np.zeros((h, w), dtype=np.uint8)

    def pix(x, y):
        return int((x - minx) / PX_MM), int((y - miny) / PX_MM)

    for x0, y0, x1, y1 in contact:
        length = math.hypot(x1 - x0, y1 - y0)
        steps = max(1, int(length / (PX_MM * 0.45)))
        for i in range(steps + 1):
            t = i / steps
            c, r = pix(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
            if 0 <= r < h and 0 <= c < w:
                ink[r, c] = 1
                if r + 1 < h:
                    ink[r + 1, c] = 1
                if c + 1 < w:
                    ink[r, c + 1] = 1

    # Close hairline gaps so the sole outline holds ink, without filling a letter.
    closed = ink.copy()
    closed[1:, :] |= ink[:-1, :]
    closed[:-1, :] |= ink[1:, :]
    closed[:, 1:] |= ink[:, :-1]
    closed[:, :-1] |= ink[:, 1:]

    outside = np.zeros_like(closed, dtype=np.uint8)
    q = deque()
    for c in range(w):
        q.append((0, c))
        q.append((h - 1, c))
    for r in range(h):
        q.append((r, 0))
        q.append((r, w - 1))
    while q:
        r, c = q.popleft()
        if r < 0 or c < 0 or r >= h or c >= w or closed[r, c] or outside[r, c]:
            continue
        outside[r, c] = 1
        q.append((r + 1, c))
        q.append((r - 1, c))
        q.append((r, c + 1))
        q.append((r, c - 1))

    holes = (closed == 0) & (outside == 0)
    return holes, ink


def components(mask: np.ndarray):
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=np.uint8)
    found = []
    for r in range(h):
        cols = np.flatnonzero(mask[r] & ~seen[r])
        for c in cols:
            if seen[r, c]:
                continue
            q = deque([(r, c)])
            seen[r, c] = 1
            cells = []
            r0 = r1 = r
            c0 = c1 = c
            huge = False
            while q:
                y, x = q.popleft()
                if not huge:
                    cells.append((y, x))
                    if len(cells) > 2500:
                        huge = True
                        cells = []
                if y < r0:
                    r0 = y
                if y > r1:
                    r1 = y
                if x < c0:
                    c0 = x
                if x > c1:
                    c1 = x
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = 1
                        q.append((ny, nx))
            if huge or not cells:
                continue
            found.append(
                {
                    "n": len(cells),
                    "r0": r0,
                    "r1": r1,
                    "c0": c0,
                    "c1": c1,
                    "cy": (r0 + r1) / 2,
                    "cx": (c0 + c1) / 2,
                    "h": (r1 - r0 + 1) * PX_MM,
                    "w": (c1 - c0 + 1) * PX_MM,
                    "cells": cells,
                }
            )
    return found


def letter_row(comps):
    letters = [
        c
        for c in comps
        if 4.0 <= c["h"] <= 18.0 and 1.5 <= c["w"] <= 18.0 and 12 <= c["n"] <= 900
    ]
    if len(letters) < 7:
        return None
    letters.sort(key=lambda c: c["cy"])
    best = None
    for i, seed in enumerate(letters):
        band = [c for c in letters if abs(c["cy"] - seed["cy"]) <= 6.0 / PX_MM]
        band.sort(key=lambda c: c["cx"])
        # Keep one component per x-slot so a double-counted hole does not split a letter.
        picked = []
        for c in band:
            if picked and c["cx"] - picked[-1]["cx"] < 3.0 / PX_MM:
                if c["n"] > picked[-1]["n"]:
                    picked[-1] = c
                continue
            picked.append(c)
        if len(picked) < 7:
            continue
        # The name is seven letters. Slide a window across a longer row.
        for start in range(0, len(picked) - 6):
            window = picked[start : start + 7]
            span = (window[-1]["cx"] - window[0]["cx"]) * PX_MM
            if span < 40:
                continue
            score = span
            if best is None or score > best[0]:
                best = (score, window)
    return None if best is None else best[1]


def render_word(width_px: int, height_px: int, flip_x: bool, flip_y: bool) -> np.ndarray:
    img = Image.new("L", (width_px, height_px), 0)
    draw = ImageDraw.Draw(img)
    # Cap height is most of the canvas. Search a font size that fills it.
    size = max(8, int(height_px * 0.92))
    font = ImageFont.truetype(FONT, size)
    bbox = draw.textbbox((0, 0), NAME, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    if tw > 0 and th > 0:
        size = max(8, int(size * min((width_px * 0.96) / tw, (height_px * 0.96) / th)))
        font = ImageFont.truetype(FONT, size)
        bbox = draw.textbbox((0, 0), NAME, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (width_px - tw) / 2 - bbox[0]
    y = (height_px - th) / 2 - bbox[1]
    draw.text((x, y), NAME, fill=255, font=font)
    arr = np.asarray(img) > 40
    if flip_x:
        arr = np.fliplr(arr)
    if flip_y:
        arr = np.flipud(arr)
    return arr


def ncc(obs: np.ndarray, tpl: np.ndarray) -> float:
    a = obs.astype(np.float64)
    b = tpl.astype(np.float64)
    if a.shape != b.shape:
        raise ValueError(a.shape)
    a -= a.mean()
    b -= b.mean()
    da = np.sqrt((a * a).sum())
    db = np.sqrt((b * b).sum())
    if da < 1e-9 or db < 1e-9:
        return 0.0
    return float((a * b).sum() / (da * db))


def observe(window, width_px: int, height_px: int) -> np.ndarray:
    r0 = min(c["r0"] for c in window)
    c0 = min(c["c0"] for c in window)
    r1 = max(c["r1"] for c in window)
    c1 = max(c["c1"] for c in window)
    pad_r = max(1, int((r1 - r0) * 0.15))
    pad_c = max(1, int((c1 - c0) * 0.05))
    r0 -= pad_r
    c0 -= pad_c
    h = (r1 + pad_r) - r0 + 1
    w = (c1 + pad_c) - c0 + 1
    mask = np.zeros((h, w), dtype=np.uint8)
    for comp in window:
        for r, c in comp["cells"]:
            rr, cc = r - r0, c - c0
            if 0 <= rr < h and 0 <= cc < w:
                mask[rr, cc] = 255
    # Raster row 0 is low reading-y. Cap (high y) belongs at the top of the picture.
    mask = np.flipud(mask)
    img = Image.fromarray(mask).resize((width_px, height_px), Image.Resampling.BOX)
    return np.asarray(img) > 40


def grade_file(path: Path) -> dict:
    segs = parse_extrusions(path)
    heel_high, delta = heel_end(segs)
    if heel_high is None:
        return {"file": path.name, "pass": False, "reason": "heel inconclusive", "deltaMm": delta}
    holes, _ink = raster_holes(segs, heel_high)
    comps = components(holes)
    window = letter_row(comps)
    if window is None:
        return {
            "file": path.name,
            "pass": False,
            "reason": "no 7-letter hole row",
            "heelHigh": heel_high,
            "deltaMm": round(delta, 2),
            "components": len(comps),
        }
    canvas_h, canvas_w = 96, 320
    obs = observe(window, canvas_w, canvas_h)
    scores = {
        "upright": ncc(obs, render_word(canvas_w, canvas_h, False, False)),
        "mirror_x": ncc(obs, render_word(canvas_w, canvas_h, True, False)),
        "mirror_y": ncc(obs, render_word(canvas_w, canvas_h, False, True)),
        "rot180": ncc(obs, render_word(canvas_w, canvas_h, True, True)),
    }
    winner = max(scores, key=scores.get)
    upright = scores["upright"]
    others = max(v for k, v in scores.items() if k != "upright")
    passed = winner == "upright" and upright > others + 0.02 and upright > 0.12
    return {
        "file": path.name,
        "pass": passed,
        "winner": winner,
        "scores": {k: round(v, 4) for k, v in scores.items()},
        "heelHigh": heel_high,
        "deltaMm": round(delta, 2),
        "spanMm": round((window[-1]["cx"] - window[0]["cx"]) * PX_MM, 1),
        "letterHmm": round(float(np.median([c["h"] for c in window])), 2),
    }


def main(argv):
    paths = [Path(p) for p in argv[1:]]
    rows = [grade_file(p) for p in paths]
    print(json.dumps(rows, indent=2))
    return 0 if all(r["pass"] for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
