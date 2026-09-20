# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""Belt-plane loop stitching (racetrack / thin-shell fusion). Port of vertex belt-stitch.ts."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

Pt = tuple[float, float]
Seg = tuple[Pt, Pt]

BELT_WELD_EPS_MM = 1e-4


@dataclass
class BeltShellPair:
    a: list[Pt]
    b: list[Pt]


@dataclass
class BeltStitchResult:
    closed: list[list[Pt]]
    open: list[list[Pt]]
    shell_pairs: list[BeltShellPair]


@dataclass
class BeltClassifiedRing:
    loop: list[Pt]
    kind: Literal["outer", "hole"]
    depth: int


def collect_linked_belt_chains(segs: list[Seg], weld_eps: float = BELT_WELD_EPS_MM) -> list[list[Pt]]:
    clean = _split_t_junctions(_drop_duplicates(_drop_zero_length(segs, weld_eps), weld_eps), weld_eps)
    used = [False] * len(clean)
    degree = _endpoint_degrees(clean, weld_eps)
    start_order = _start_segment_order(clean, degree)
    raw: list[list[Pt]] = []
    for i in start_order:
        if used[i]:
            continue
        peel = min(degree[i * 2], degree[i * 2 + 1]) <= 1
        chain = _walk_chain(clean, used, i, weld_eps, peel)
        if len(chain) >= 3:
            raw.append(chain)
    for i in range(len(clean)):
        if used[i]:
            continue
        chain = _walk_chain(clean, used, i, weld_eps, False)
        if len(chain) >= 3:
            raw.append(chain)
    return _link_chain_ends(raw, weld_eps)


def stitch_belt_loops(
    segs: list[Seg],
    *,
    weld_eps: float = BELT_WELD_EPS_MM,
    belt_y: float | None = None,
) -> BeltStitchResult:
    linked = collect_linked_belt_chains(segs, weld_eps)
    closed: list[list[Pt]] = []
    open_chains: list[list[Pt]] = []
    hit = _find_thin_shell_pair(linked, weld_eps)
    if hit:
        fused = _fuse_thin_shell_pair(hit.pair.a, hit.pair.b)
        if fused:
            closed.append(fused)
        for i, chain in enumerate(linked):
            if i in (hit.ia, hit.ib):
                continue
            if _should_close(chain, weld_eps, belt_y):
                closed.append(chain)
            else:
                open_chains.append(chain)
        return BeltStitchResult(closed=closed, open=open_chains, shell_pairs=[hit.pair])
    for chain in linked:
        if _should_close(chain, weld_eps, belt_y):
            closed.append(chain)
        else:
            open_chains.append(chain)
    return BeltStitchResult(closed=closed, open=open_chains, shell_pairs=[])


def classify_belt_rings(loops: list[list[Pt]]) -> list[BeltClassifiedRing]:
    depths: list[int] = []
    for i, loop in enumerate(loops):
        depth = 0
        for j, other in enumerate(loops):
            if i == j:
                continue
            if _ring_contained_in(loop, other):
                depth += 1
        depths.append(depth)
    out: list[BeltClassifiedRing] = []
    for i, loop in enumerate(loops):
        depth = depths[i]
        kind: Literal["outer", "hole"] = "outer" if depth % 2 == 0 else "hole"
        area = signed_area(loop)
        if kind == "outer":
            wound = loop if area >= 0 else _reverse_ring(loop)
        else:
            wound = loop if area < 0 else _reverse_ring(loop)
        out.append(BeltClassifiedRing(loop=wound, kind=kind, depth=depth))
    return out


def signed_area(loop: list[Pt]) -> float:
    a = 0.0
    for i in range(len(loop)):
        p = loop[i]
        q = loop[(i + 1) % len(loop)]
        a += p[0] * q[1] - q[0] * p[1]
    return a / 2.0


def point_in_poly(loop: list[Pt], p: Pt) -> bool:
    inside = False
    j = len(loop) - 1
    for i in range(len(loop)):
        a = loop[i]
        b = loop[j]
        hit = (a[1] > p[1]) != (b[1] > p[1]) and p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
        if hit:
            inside = not inside
        j = i
    return inside


def detect_thin_shell_pair(chains: list[list[Pt]], weld_eps: float = BELT_WELD_EPS_MM) -> BeltShellPair | None:
    hit = _find_thin_shell_pair(chains, weld_eps)
    return hit.pair if hit else None


def _drop_zero_length(segs: list[Seg], eps: float) -> list[Seg]:
    return [s for s in segs if _hypot(s[0], s[1]) >= eps]


def _drop_duplicates(segs: list[Seg], eps: float) -> list[Seg]:
    out: list[Seg] = []
    for s in segs:
        dup = any(
            (_near(s[0], t[0], eps) and _near(s[1], t[1], eps))
            or (_near(s[0], t[1], eps) and _near(s[1], t[0], eps))
            for t in out
        )
        if not dup:
            out.append(s)
    return out


def _split_t_junctions(segs: list[Seg], eps: float) -> list[Seg]:
    cur = segs
    for _ in range(4):
        pts: list[Pt] = []
        for a, b in cur:
            pts.extend([a, b])
        nxt: list[Seg] = []
        split = False
        for a, b in cur:
            hits: list[tuple[float, Pt]] = []
            for p in pts:
                if _near(p, a, eps) or _near(p, b, eps):
                    continue
                t = _project_t(a, b, p)
                if t <= eps or t >= 1 - eps:
                    continue
                q: Pt = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                if _hypot(p, q) < eps:
                    hits.append((t, (p[0], p[1])))
            if not hits:
                nxt.append((a, b))
                continue
            split = True
            hits.sort(key=lambda h: h[0])
            uniq: list[tuple[float, Pt]] = []
            for h in hits:
                if not uniq or _hypot(uniq[-1][1], h[1]) >= eps:
                    uniq.append(h)
            prev = a
            for _, hp in uniq:
                if _hypot(prev, hp) >= eps:
                    nxt.append((prev, hp))
                prev = hp
            if _hypot(prev, b) >= eps:
                nxt.append((prev, b))
        cur = nxt
        if not split:
            break
    return cur


def _endpoint_degrees(segs: list[Seg], eps: float) -> list[int]:
    deg = [0] * (len(segs) * 2)
    for i, (a, b) in enumerate(segs):
        for e, p in enumerate((a, b)):
            for j, (c, d) in enumerate(segs):
                if j == i:
                    continue
                if _near(p, c, eps) or _near(p, d, eps):
                    deg[i * 2 + e] += 1
                    break
    return deg


def _start_segment_order(segs: list[Seg], degree: list[int]) -> list[int]:
    idx = list(range(len(segs)))
    idx.sort(key=lambda a: (min(degree[a * 2], degree[a * 2 + 1]), a))
    return idx


def _walk_chain(segs: list[Seg], used: list[bool], start: int, eps: float, stop_at_junction: bool) -> list[Pt]:
    used[start] = True
    pts: list[Pt] = [segs[start][0], segs[start][1]]
    grew = True
    while grew:
        grew = False
        tail_hit = _find_join(segs, used, pts[-1], eps, stop_at_junction)
        if tail_hit:
            used[tail_hit[0]] = True
            pts.append(tail_hit[1])
            grew = True
        head_hit = _find_join(segs, used, pts[0], eps, stop_at_junction)
        if head_hit:
            used[head_hit[0]] = True
            pts.insert(0, head_hit[1])
            grew = True
    return pts


def _find_join(
    segs: list[Seg], used: list[bool], pt: Pt, eps: float, stop_at_junction: bool
) -> tuple[int, Pt] | None:
    hits: list[tuple[int, Pt, float]] = []
    for j, (a, b) in enumerate(segs):
        if used[j]:
            continue
        d0 = _hypot(pt, a)
        d1 = _hypot(pt, b)
        if d0 <= eps:
            hits.append((j, b, d0))
        if d1 <= eps:
            hits.append((j, a, d1))
    if not hits:
        return None
    if stop_at_junction and len(hits) > 1:
        return None
    hits.sort(key=lambda h: (h[2], h[0]))
    j, other, _ = hits[0]
    return j, other


def _link_chain_ends(chains: list[list[Pt]], weld_eps: float) -> list[list[Pt]]:
    live = [c[:] for c in chains]

    def ends_of() -> list[dict]:
        out: list[dict] = []
        for ci, c in enumerate(live):
            if len(c) < 2:
                continue
            out.append({"ci": ci, "which": "head", "p": c[0], "edge": _hypot(c[0], c[1])})
            out.append(
                {
                    "ci": ci,
                    "which": "tail",
                    "p": c[-1],
                    "edge": _hypot(c[-1], c[-2]),
                }
            )
        return out

    progressed = True
    while progressed:
        progressed = False
        ends = ends_of()
        best: tuple[dict, dict, float] | None = None
        for i in range(len(ends)):
            for j in range(i + 1, len(ends)):
                a, b = ends[i], ends[j]
                if a["ci"] == b["ci"]:
                    continue
                d = _hypot(a["p"], b["p"])
                if d > _end_join_limit(a["edge"], b["edge"], weld_eps):
                    continue
                if best is None or d < best[2]:
                    best = (a, b, d)
        if not best:
            break
        _merge_chains(live, best[0], best[1])
        progressed = True
    return [c for c in live if len(c) >= 3]


def _end_join_limit(edge_a: float, edge_b: float, weld_eps: float) -> float:
    return max(2 * weld_eps, 0.5 * min(edge_a, edge_b))


def _fuse_thin_shell_pair(a: list[Pt], b: list[Pt]) -> list[Pt] | None:
    ends = [
        {"ci": 0, "which": "head", "p": a[0]},
        {"ci": 0, "which": "tail", "p": a[-1]},
        {"ci": 1, "which": "head", "p": b[0]},
        {"ci": 1, "which": "tail", "p": b[-1]},
    ]
    ends.sort(key=lambda x: (x["p"][0], x["p"][1]))
    if ends[0]["ci"] == ends[1]["ci"] or ends[2]["ci"] == ends[3]["ci"]:
        return None
    live = [a[:], b[:]]
    _merge_chains(live, ends[0], ends[1])
    for c in live:
        if len(c) >= 3:
            return c
    return None


@dataclass
class _ThinHit:
    pair: BeltShellPair
    ia: int
    ib: int


def _find_thin_shell_pair(chains: list[list[Pt]], weld_eps: float) -> _ThinHit | None:
    best: tuple[BeltShellPair, int, int, float] | None = None
    for i in range(len(chains)):
        for j in range(i + 1, len(chains)):
            if not _is_thin_shell_pair(chains[i], chains[j], weld_eps):
                continue
            gaps = _rim_gaps(chains[i], chains[j])
            score = gaps[0] + gaps[1]
            if best is None or score < best[3]:
                best = (BeltShellPair(a=chains[i], b=chains[j]), i, j, score)
    if not best:
        return None
    pair, ia, ib, _ = best
    return _ThinHit(pair=pair, ia=ia, ib=ib)


def _rim_gaps(a: list[Pt], b: list[Pt]) -> tuple[float, float]:
    ends = [{"ci": 0, "p": a[0]}, {"ci": 0, "p": a[-1]}, {"ci": 1, "p": b[0]}, {"ci": 1, "p": b[-1]}]
    ends.sort(key=lambda x: (x["p"][0], x["p"][1]))
    return _hypot(ends[0]["p"], ends[1]["p"]), _hypot(ends[2]["p"], ends[3]["p"])


def _is_thin_shell_pair(a: list[Pt], b: list[Pt], weld_eps: float) -> bool:
    ends = [{"ci": 0, "p": a[0]}, {"ci": 0, "p": a[-1]}, {"ci": 1, "p": b[0]}, {"ci": 1, "p": b[-1]}]
    ends.sort(key=lambda x: (x["p"][0], x["p"][1]))
    if ends[0]["ci"] == ends[1]["ci"] or ends[2]["ci"] == ends[3]["ci"]:
        return False
    left_gap = _hypot(ends[0]["p"], ends[1]["p"])
    right_gap = _hypot(ends[2]["p"], ends[3]["p"])
    span = 0.0
    for c in (a, b):
        lo = min(p[0] for p in c)
        hi = max(p[0] for p in c)
        span = max(span, hi - lo)
    if span < weld_eps:
        return False
    return left_gap <= 0.5 * span and right_gap <= 0.5 * span


def _merge_chains(live: list[list[Pt]], a: dict, b: dict) -> None:
    if a["ci"] == b["ci"]:
        return
    A = live[a["ci"]]
    B = live[b["ci"]]
    if a["which"] == "tail" and b["which"] == "head":
        left, right = A, B
    elif a["which"] == "head" and b["which"] == "tail":
        left, right = B, A
    elif a["which"] == "tail" and b["which"] == "tail":
        left, right = A, _reverse_ring(B)
    else:
        left, right = _reverse_ring(A), B
    tail = list(right[1:] if right and _near(left[-1], right[0], 1e-12) else right)
    merged = list(left) + tail
    live[a["ci"]] = merged
    live[b["ci"]] = []


def _should_close(chain: list[Pt], eps: float, belt_y: float | None) -> bool:
    a, b = chain[0], chain[-1]
    gap = _hypot(a, b)
    if _near(a, b, eps):
        return True
    if len(chain) >= 3:
        e0 = _hypot(chain[0], chain[1])
        e1 = _hypot(chain[-1], chain[-2])
        if gap <= _end_join_limit(e0, e1, eps):
            return True
    end_y = (a[1] + b[1]) / 2.0
    if abs(a[1] - b[1]) <= eps and any(abs(p[1] - end_y) > eps for p in chain):
        return True
    if belt_y is None:
        return False
    if abs(a[1] - belt_y) > eps or abs(b[1] - belt_y) > eps:
        return False
    return any(abs(p[1] - belt_y) > eps for p in chain)


def _ring_contained_in(inner: list[Pt], outer: list[Pt]) -> bool:
    if not inner:
        return False
    hits = sum(1 for p in inner if point_in_poly(outer, p))
    return hits > len(inner) / 2


def _reverse_ring(loop: list[Pt]) -> list[Pt]:
    return list(reversed(loop))


def _project_t(a: Pt, b: Pt, p: Pt) -> float:
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    den = dx * dx + dy * dy
    if den < 1e-24:
        return 0.0
    return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den


def _near(a: Pt, b: Pt, eps: float) -> bool:
    return abs(a[0] - b[0]) < eps and abs(a[1] - b[1]) < eps


def _hypot(a: Pt, b: Pt) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])
