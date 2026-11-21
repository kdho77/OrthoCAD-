#!/usr/bin/env bash
# FROZEN gate runner (OrthoCAD PM 2026-11-20). Do not edit. Its own sha256 is pinned in the brief.
# 1) frozen files verbatim  2) main reference rebuilt from base a7ef6ed9 and sha-checked  3) gates on this tree. (repo_guard.sh was scoped to PR #389 only; not run on later commits, 2026-11-21.)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
ROOT=$PWD
D=tests/cnc/frozen-thickness
BASE=a7ef6ed98fd8d6ceba7d6d8d5039e2587300f036
sha256sum -c - <<SUMS
670f215337bef1400ba4b8d07cd46e2a4c89823e8a1abaae423a5cc8fa907bc1  tests/cnc/frozen-thickness/cnc-thickness.optional.test.ts
c729e87a00405f951d4dfe07d646f95aa3957b781603f3e7b6379d8f3939a5ca  tests/cnc/frozen-thickness/peavy-6236d861.settings.json
692d6c079620f3009ae73601df32e94d47e6e4a3cea0fea5c588836fc43b490e  tests/cnc/frozen-thickness/repo_guard.sh
ffee1c0433dd445b27c070b526a41c6ad5d562f50bd0979fe0337931ca261526  tests/cnc/frozen-thickness/ci_step.yml
SUMS
git cat-file -e "$BASE^{commit}" 2>/dev/null || git fetch --no-tags --depth=1 origin "$BASE"
WT=$(mktemp -d); REF=$(mktemp -d)
trap 'git worktree remove --force "$WT" >/dev/null 2>&1 || true' EXIT
git worktree add --detach "$WT" "$BASE" >/dev/null
ln -s "$ROOT/node_modules" "$WT/node_modules"
ln -s "$ROOT/vertex/node_modules" "$WT/vertex/node_modules"
mkdir -p "$WT/$D"
cp "$D/cnc-thickness.optional.test.ts" "$D/peavy-6236d861.settings.json" "$WT/$D/"
(cd "$WT" && CNC_GATE_DUMP="$REF" npx rstest --config rstest.optional.config.ts "$D/cnc-thickness.optional.test.ts")
(cd "$REF" && sha256sum -c - <<REFSUMS
d2f574e8e0305f5bf352bb2e677d47b6ae663944972dd87e4da765a086395c83  main-ref.json
7386ff09e8a8dc1a9be796607d26f3c3b4ce8b600108c6e86881309711ad7b8e  default4.gcode
699826affaa1492589b5016b4f952a079dfcd6fc66579a1d446f2e705da6e51b  default2.gcode
b56ecef4a1cbf552caf8bc664dba7110ff257c7dfb23964be464e6ed00216df9  peavy4.gcode
REFSUMS
)
REPORT="${CNC_GATE_REPORT:-$REF/cnc-thickness-gates.json}"
rm -f "$REPORT"
set +e
CNC_GATE_REF_DIR="$REF" CNC_GATE_REPORT="$REPORT" npx rstest --config rstest.optional.config.ts "$D/cnc-thickness.optional.test.ts"
RT=$?
set -e
[ -f "$REPORT" ] || { echo "FAIL: gate report not written (rstest exit $RT)"; exit 1; }
echo "gate report: $REPORT"
python3 - "$REPORT" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
for g in r:
    print(("PASS " if g["pass"] else "FAIL ") + g["gate"] + " | measured " + str(g["measured"]) + " | bar " + str(g["bar"]))
bad = [g for g in r if not g["pass"]]
print("%d/%d PASS" % (len(r) - len(bad), len(r)))
sys.exit(1 if bad else 0)
PY
exit $RT
