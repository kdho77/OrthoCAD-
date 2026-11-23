#!/usr/bin/env bash
# Deliberately break a detached copy of BASE and show the frozen gates fail.
# Does not edit the frozen gates. Does not touch the worker branch.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="268aac85847160b5b2703a05688721ea4cb93b24"
WT="${TMPDIR:-/tmp}/mortons-gates-bad"
RSTEST="$ROOT/node_modules/.bin/rstest"
CFG="validation/mortons_extra_hard_gates/rstest.config.ts"

cleanup() {
    git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
rm -rf "$WT"
git -C "$ROOT" worktree add --detach "$WT" "$BASE"
ln -s "$ROOT/node_modules" "$WT/node_modules"
ln -s "$ROOT/vertex/node_modules" "$WT/vertex/node_modules"
mkdir -p "$WT/validation"
cp -a "$ROOT/validation/mortons_extra_hard_gates" "$WT/validation/"

restore() {
    git -C "$WT" checkout -- .
}

expect_fail() {
    local name="$1"
    local filter="$2"
    local log="/tmp/mortons-bad-${name}.log"
    set +e
    (cd "$WT" && "$RSTEST" --config "$CFG" -t "$filter") >"$log" 2>&1
    local code=$?
    set -e
    if [[ $code -eq 0 ]]; then
        echo "BAD-CHANGE PROOF FAILED: ${name} passed on the broken copy"
        exit 1
    fi
    echo "bad-change ${name}: gate exited ${code} (expected non-zero)"
}

python3 - "$WT/vertex/shared/print-recipe/hardness-class-table.ts" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
old = '        sparseInfillDensityPct: 38,'
new = '        sparseInfillDensityPct: 99,'
if text.count(old) != 1:
    raise SystemExit(f"expected one Extra Hard density, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
PY
expect_fail table "pass-on-base TABLE-EXTRA-HARD"
restore

python3 - "$WT/vertex/src/lib/hardness/collect.ts" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
old = "    if (!el.hardnessClass) return null;\n"
new = "    if (!el.hardnessClass) el = { ...el, hardnessClass: \"Extra Hard\" };\n"
if old not in text:
    raise SystemExit("collect null-return not found")
path.write_text(text.replace(old, new, 1))
PY
expect_fail scope "pass-on-base T1-REVERSE|pass-on-base T1-MET-UNSET"
restore

python3 - "$WT/vertex/src/lib/hardness/collect.ts" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
old = "    if (!el.hardnessClass) return null;\n"
new = (
    "    if (!el.hardnessClass && el.kind === \"mortons_extension\") "
    "el = { ...el, hardnessClass: \"Soft\" };\n"
    "    if (!el.hardnessClass) return null;\n"
)
if old not in text:
    raise SystemExit("collect null-return not found")
path.write_text(text.replace(old, new, 1))
PY
expect_fail soft "defect-on-base T1-COLLECT"
restore

python3 - "$WT/vertex/shared/bottom-text-marking.ts" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
old = '        surface: "bottom",\n        mode: "engrave",\n        bold: true,'
new = '        surface: "bottom",\n        mode: "emboss",\n        bold: true,'
if text.count(old) != 1:
    raise SystemExit(f"default bottom marking not unique ({text.count(old)})")
path.write_text(text.replace(old, new, 1))
PY
expect_fail r5 "pass-on-base R5-TEXT"
restore

python3 - "$WT/vertex/server/src/lib/vertexslice-client.ts" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
old = '            form.append("infill_density", String(pct));\n'
new = old + '            form.append("seam_position", "top");\n'
if old not in text:
    raise SystemExit("infill form append not found")
path.write_text(text.replace(old, new, 1))
PY
expect_fail form "pass-on-base FORM-KEYS"
restore

python3 - "$WT/vertex/shared/vertexslice-regional-3mf.ts" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
old = "        bytes: args.stl,\n"
new = "        bytes: new Uint8Array([...args.stl, 1]),\n"
if text.count(old) != 1:
    raise SystemExit(f"stl return not unique ({text.count(old)})")
path.write_text(text.replace(old, new, 1))
PY
expect_fail upload "pass-on-base UPLOAD-EQUALS-STL"
restore

echo "bad-change proofs finished"
