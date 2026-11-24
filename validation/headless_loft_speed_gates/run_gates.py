#!/usr/bin/env python3
"""Run the frozen headless loft gates against a candidate SHA.

Always lofts baseline thresholds.baseline_sha and the candidate. Does not edit product code.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from checks import SPEED_MAX_RATIO, cases_distinct, log_gate, redact, speed_case, stl_identity

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
NODE = os.environ.get("NODE", shutil.which("node") or "node")
BASELINE_SHA = json.loads((HERE / "thresholds.json").read_text())["baseline_sha"]
MANIFEST = json.loads((HERE / "fixtures" / "manifest.json").read_text())
CASE_IDS = [case["id"] for case in MANIFEST["cases"]]


def run(cmd: list[str], cwd: Path, timeout: int = 180) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.pop("VERTEXSLICE_API_KEY", None)
    env.pop("VERTEXSLICE_SLICER_URL", None)
    return subprocess.run(
        cmd,
        cwd=cwd,
        text=True,
        capture_output=True,
        timeout=timeout,
        env=env,
        check=False,
    )


def redact_proc(proc: subprocess.CompletedProcess[str]) -> str:
    return redact((proc.stdout or "") + "\n" + (proc.stderr or ""))


def ensure_commit(sha: str) -> None:
    probe = run(["git", "cat-file", "-t", sha], REPO, timeout=30)
    if probe.returncode == 0:
        return
    fetched = run(["git", "fetch", "origin", sha], REPO, timeout=120)
    if fetched.returncode != 0:
        raise SystemExit(f"cannot resolve {sha}\n{redact_proc(fetched)}")


def ensure_worktree(sha: str) -> Path:
    ensure_commit(sha)
    dest = Path(f"/tmp/orthocad-gate-{sha[:12]}")
    git_marker = dest / ".git"
    if dest.exists() and not git_marker.exists():
        raise SystemExit(f"{dest} exists and is not a worktree")
    if not git_marker.exists():
        added = run(["git", "worktree", "add", "--detach", str(dest), sha], REPO, timeout=120)
        if added.returncode != 0:
            raise SystemExit(f"worktree add {sha} failed\n{redact_proc(added)}")
    else:
        head = run(["git", "rev-parse", "HEAD"], dest, timeout=30)
        if head.stdout.strip() != sha:
            raise SystemExit(f"{dest} is {head.stdout.strip()}, expected {sha}")
    modules = dest / "vertex" / "node_modules"
    source = REPO / "vertex" / "node_modules"
    if not modules.exists():
        if not source.exists():
            raise SystemExit(f"missing {source}")
        modules.symlink_to(source)
    bundled = run(["node", "scripts/bundle-canonical-export-loft.mjs"], dest / "vertex", timeout=180)
    if bundled.returncode != 0:
        raise SystemExit(f"bundle failed for {sha}\n{redact_proc(bundled)}")
    return dest


def loft_case(worktree: Path, case: dict, out_dir: Path) -> dict:
    settings = HERE / "fixtures" / case["settings"]
    stl_path = out_dir / f"{case['id']}.stl"
    meta_path = out_dir / f"{case['id']}.json"
    proc = run(
        [
            NODE,
            str(HERE / "harness" / "loft_one.mjs"),
            str(worktree),
            str(settings),
            case["side"],
            str(stl_path),
            str(meta_path),
        ],
        worktree / "vertex",
        timeout=300,
    )
    if proc.returncode != 0 or not stl_path.exists():
        return {
            "id": case["id"],
            "error": redact_proc(proc)[-4000:],
        }
    meta = json.loads(meta_path.read_text())
    meta["id"] = case["id"]
    meta["stl_path"] = str(stl_path)
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    return meta


def loft_tree(sha: str, out_dir: Path) -> list[dict]:
    worktree = ensure_worktree(sha)
    results = []
    for case in MANIFEST["cases"]:
        results.append(loft_case(worktree, case, out_dir))
    return results


def probe_logs(sha: str, out_dir: Path) -> dict:
    worktree = ensure_worktree(sha)
    report_path = out_dir / "log_probe.json"
    tsx = worktree / "vertex" / "node_modules" / ".bin" / "tsx"
    proc = run(
        [str(tsx), str(HERE / "harness" / "probe_logs.mjs"), str(worktree), str(report_path)],
        worktree / "vertex",
        timeout=120,
    )
    if not report_path.exists():
        return {"error": redact_proc(proc)[-4000:], "captured": ""}
    report = json.loads(report_path.read_text())
    report["captured"] = redact(report.get("captured", ""))
    report["probe_exit"] = proc.returncode
    if proc.returncode != 0 and "error" not in report:
        report["probe_stderr"] = redact_proc(proc)[-2000:]
    return report


def evaluate(candidate_sha: str, baseline_lofts: list[dict], candidate_lofts: list[dict], logs: dict) -> dict:
    by_base = {item["id"]: item for item in baseline_lofts if "id" in item and "error" not in item}
    by_cand = {item["id"]: item for item in candidate_lofts if "id" in item and "error" not in item}
    identity = []
    speed = []
    for case in MANIFEST["cases"]:
        case_id = case["id"]
        base = by_base.get(case_id)
        cand = by_cand.get(case_id)
        base_err = next((item.get("error") for item in baseline_lofts if item.get("id") == case_id), None)
        cand_err = next((item.get("error") for item in candidate_lofts if item.get("id") == case_id), None)
        if base is None or cand is None:
            identity.append(
                {
                    "id": case_id,
                    "pass": False,
                    "error": cand_err or base_err or "missing loft",
                }
            )
            speed.append({"id": case_id, "pass": False, "error": cand_err or base_err or "missing loft"})
            continue
        base_bytes = Path(base["stl_path"]).read_bytes()
        cand_bytes = Path(cand["stl_path"]).read_bytes()
        verdict = stl_identity(cand_bytes, base_bytes)
        verdict["id"] = case_id
        verdict["candidate_triangles"] = cand.get("uploadTriangles")
        verdict["baseline_triangles"] = base.get("uploadTriangles")
        identity.append(verdict)
        timed = speed_case(float(cand["loft_s"]), float(base["loft_s"]))
        timed["id"] = case_id
        speed.append(timed)
    hashes = {item["id"]: item.get("candidate_sha256") for item in identity if item.get("candidate_sha256")}
    distinct = cases_distinct(hashes) if len(hashes) == len(CASE_IDS) else {"pass": False, "hashes": hashes}
    log_verdict = log_gate(logs.get("captured", ""), "left")
    if logs.get("probe_exit") not in (0, None) and logs.get("error"):
        log_verdict = {"pass": False, "error": logs.get("error"), "seen": []}
    identity_pass = all(item.get("pass") for item in identity) and len(identity) == len(CASE_IDS)
    speed_pass = all(item.get("pass") for item in speed) and len(speed) == len(CASE_IDS)
    return {
        "baseline_sha": BASELINE_SHA,
        "candidate_sha": candidate_sha,
        "speed_max_ratio": SPEED_MAX_RATIO,
        "stl_identity": {"pass": identity_pass, "cases": identity},
        "cases_distinct": distinct,
        "speed": {"pass": speed_pass, "cases": speed},
        "logs": {
            "pass": bool(log_verdict.get("pass")),
            "probe_status": logs.get("status"),
            "materializeCalls": logs.get("materializeCalls"),
            "sliceCalls": logs.get("sliceCalls"),
            "accepted": log_verdict.get("accepted", []),
            "seen": log_verdict.get("seen", []),
            "error": logs.get("error") or logs.get("errorMessage") or log_verdict.get("error"),
        },
    }


def logs_absent_on_a_finished_foot(report: dict) -> bool:
    logs = report["logs"]
    return (
        logs["pass"] is False
        and logs.get("probe_status") == "succeeded"
        and logs.get("materializeCalls") == 1
        and logs.get("sliceCalls") == 1
        and not logs.get("error")
    )


def expectation_holds(report: dict, expect: str) -> bool:
    identity = report["stl_identity"]["pass"] and report["cases_distinct"]["pass"]
    speed = report["speed"]["pass"]
    logs = report["logs"]["pass"]
    if expect == "pass":
        return identity and speed and logs
    if expect == "noop":
        # Identity of main versus itself passes. Speed and logs must fail for a real reason:
        # the second loft is not 10% faster, and the execute path finished without loft_s/slice_s.
        return identity and not speed and logs_absent_on_a_finished_foot(report)
    raise SystemExit(f"unknown expect {expect}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-sha", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--expect", choices=("pass", "noop"), default="pass")
    parser.add_argument("--baseline-cache", default="")
    args = parser.parse_args()

    out_path = Path(args.out)
    work = Path(tempfile.mkdtemp(prefix="loft-gates-"))
    baseline_dir = Path(args.baseline_cache) if args.baseline_cache else work / "baseline"
    baseline_dir.mkdir(parents=True, exist_ok=True)
    candidate_dir = work / "candidate"
    candidate_dir.mkdir()
    try:
        cached = all((baseline_dir / f"{case_id}.stl").exists() for case_id in CASE_IDS)
        if cached and all((baseline_dir / f"{case_id}.json").exists() for case_id in CASE_IDS):
            baseline_lofts = []
            for case_id in CASE_IDS:
                item = json.loads((baseline_dir / f"{case_id}.json").read_text())
                item["id"] = case_id
                item["stl_path"] = str(baseline_dir / f"{case_id}.stl")
                baseline_lofts.append(item)
        else:
            baseline_lofts = loft_tree(BASELINE_SHA, baseline_dir)
        candidate_lofts = loft_tree(args.candidate_sha, candidate_dir)
        logs = probe_logs(args.candidate_sha, candidate_dir)
        report = evaluate(args.candidate_sha, baseline_lofts, candidate_lofts, logs)
        report["expect"] = args.expect
        report["expect_holds"] = expectation_holds(report, args.expect)
        report["baseline_dir"] = str(baseline_dir)
        report["candidate_dir"] = str(candidate_dir)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(report, indent=2) + "\n")
        summary = {
            "candidate_sha": args.candidate_sha,
            "expect": args.expect,
            "expect_holds": report["expect_holds"],
            "stl_identity": report["stl_identity"]["pass"],
            "cases_distinct": report["cases_distinct"]["pass"],
            "speed": report["speed"]["pass"],
            "logs": report["logs"]["pass"],
        }
        print(json.dumps(summary, indent=2))
        return 0 if report["expect_holds"] else 1
    finally:
        # Keep loft artifacts for RESULTS.md. The temp dir holds the candidate STLs.
        pass


if __name__ == "__main__":
    raise SystemExit(main())
