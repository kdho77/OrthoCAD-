"""Frozen pass/fail checks for the headless loft speed gates.

Thresholds live in thresholds.json. Identity is full SHA-256 of the STL bytes.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
THRESHOLDS = json.loads((HERE / "thresholds.json").read_text())
SPEED_MAX_RATIO = float(THRESHOLDS["speed_max_ratio"])
SECRET_LINE = re.compile(r"api_key|token|bearer", re.IGNORECASE)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def redact(text: str) -> str:
    kept = []
    for line in text.splitlines():
        if SECRET_LINE.search(line):
            continue
        kept.append(line)
    return "\n".join(kept)


def stl_identity(candidate: bytes, baseline: bytes) -> dict:
    """Full-byte identity. Length and triangle count are not a substitute."""
    candidate_sha = sha256_bytes(candidate)
    baseline_sha = sha256_bytes(baseline)
    return {
        "pass": candidate == baseline and candidate_sha == baseline_sha,
        "candidate_sha256": candidate_sha,
        "baseline_sha256": baseline_sha,
        "candidate_bytes": len(candidate),
        "baseline_bytes": len(baseline),
    }


def cases_distinct(hashes: dict[str, str]) -> dict:
    values = [hashes[key] for key in hashes]
    unique = len(set(values)) == len(values) and len(values) >= 5
    return {"pass": unique, "hashes": hashes}


def speed_case(candidate_s: float, baseline_s: float) -> dict:
    ratio = candidate_s / baseline_s if baseline_s > 0 else math.inf
    return {
        "pass": math.isfinite(candidate_s)
        and math.isfinite(baseline_s)
        and baseline_s > 0
        and candidate_s <= baseline_s * SPEED_MAX_RATIO,
        "candidate_s": candidate_s,
        "baseline_s": baseline_s,
        "ratio": ratio,
        "max_ratio": SPEED_MAX_RATIO,
    }


def _finite_positive(value: object) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(value) and value > 0


def timing_logs(text: str) -> list[dict]:
    found: list[dict] = []
    for raw in text.splitlines():
        start = raw.find("{")
        if start < 0:
            continue
        try:
            obj = json.loads(raw[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and ("loft_s" in obj or "slice_s" in obj):
            found.append(obj)
    return found


def log_gate(text: str, side: str) -> dict:
    logs = timing_logs(text)
    accepted = [
        obj
        for obj in logs
        if _finite_positive(obj.get("loft_s"))
        and _finite_positive(obj.get("slice_s"))
        and obj.get("side") == side
    ]
    return {
        "pass": len(accepted) >= 1,
        "accepted": accepted,
        "seen": logs,
    }
