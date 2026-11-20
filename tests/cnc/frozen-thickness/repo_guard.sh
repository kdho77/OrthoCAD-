#!/usr/bin/env bash
# FROZEN repo guard (OrthoCAD PM 2026-11-20). Do not edit.
# The PR may change ONLY the allow-listed paths below relative to base a7ef6ed9.
set -euo pipefail
BASE=a7ef6ed98fd8d6ceba7d6d8d5039e2587300f036
git cat-file -e "$BASE^{commit}" 2>/dev/null || git fetch --no-tags --depth=1 origin "$BASE"
ALLOW='^(vertex/src/lib/cnc/compose\.ts|tests/cnc/catalog-shell-thickness\.test\.ts|tests/cnc/frozen-thickness/(cnc-thickness\.optional\.test\.ts|peavy-6236d861\.settings\.json|run_cnc_thickness_gates\.sh|repo_guard\.sh|ci_step\.yml)|\.github/workflows/main\.yml)$'
bad=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if ! [[ "$f" =~ $ALLOW ]]; then echo "GUARD FAIL: path not allowed: $f"; bad=1; fi
done < <(git diff --name-only "$BASE" -- . ; git ls-files --others --exclude-standard)
# main.yml: the only change is the frozen ci_step.yml block, inserted right before the
# "Require unit shards and isolated PostgreSQL acceptance" step of test-and-deploy.
base_yml=$(mktemp); git show "$BASE:.github/workflows/main.yml" > "$base_yml"
python3 - "$base_yml" .github/workflows/main.yml tests/cnc/frozen-thickness/ci_step.yml <<'PY' || bad=1
import sys
base, cand, step = (open(p).read() for p in sys.argv[1:4])
anchor = "            - name: Require unit shards and isolated PostgreSQL acceptance\n"
if base.count(anchor) != 1:
    print("GUARD FAIL: anchor missing in base main.yml"); sys.exit(1)
want = base.replace(anchor, step + "\n" + anchor)
if cand != want:
    print("GUARD FAIL: .github/workflows/main.yml differs from base + frozen ci_step.yml block"); sys.exit(1)
print("GUARD main.yml: OK (only the frozen step block)")
PY
# compose.ts must not touch the shared loader or print code paths: no edits to base-asset/loaders/print-solid imports' implementations (enforced by the allow-list above).
if [ "$bad" -ne 0 ]; then echo "REPO GUARD: FAIL"; exit 1; fi
echo "REPO GUARD: PASS"
