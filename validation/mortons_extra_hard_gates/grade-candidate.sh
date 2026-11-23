#!/usr/bin/env bash
# Run the frozen gates on the candidate commit. Does not commit or push there.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CANDIDATE="${1:-e5d2e410edbb91faed8a6fc5422cf09f5b4e6fe0}"
WT="${TMPDIR:-/tmp}/mortons-gates-candidate"
LOG="${2:-/tmp/mortons-candidate-gates.log}"

git -C "$ROOT" fetch --quiet origin "pull/400/head"
FETCHED="$(git -C "$ROOT" rev-parse FETCH_HEAD)"
if [[ "$FETCHED" != "$CANDIDATE" ]]; then
    echo "PR 400 head is ${FETCHED}, expected ${CANDIDATE}" >&2
    exit 2
fi

git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true
rm -rf "$WT"
git -C "$ROOT" worktree add --detach "$WT" "$CANDIDATE"
ln -s "$ROOT/node_modules" "$WT/node_modules"
ln -s "$ROOT/vertex/node_modules" "$WT/vertex/node_modules"
mkdir -p "$WT/validation"
cp -a "$ROOT/validation/mortons_extra_hard_gates" "$WT/validation/"

set +e
(cd "$WT" && "$ROOT/node_modules/.bin/rstest" --config validation/mortons_extra_hard_gates/rstest.config.ts) >"$LOG" 2>&1
code=$?
set -e
echo "candidate ${CANDIDATE} gates exited ${code}"
echo "log: ${LOG}"
exit "$code"
