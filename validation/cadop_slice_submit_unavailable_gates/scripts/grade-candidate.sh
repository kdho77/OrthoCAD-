#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BASE_SHA="${CADOP_GATES_BASE_SHA:-cc6482be37175bd7db3c25e3179e22753e5dd899}"
CANDIDATE_SHA="${CADOP_GATES_CANDIDATE_SHA:-675b690033da3b6e0d6d3f04ecec63924a99ecc1}"
WORKTREE="${CADOP_GATES_WORKTREE:-/tmp/cadop-gates-grade-437}"
rm -rf "$WORKTREE"
git worktree add --detach "$WORKTREE" "$CANDIDATE_SHA"
trap 'git worktree remove -f "$WORKTREE" 2>/dev/null || rm -rf "$WORKTREE"' EXIT
mkdir -p "$WORKTREE/validation/cadop_slice_submit_unavailable_gates"
mkdir -p "$WORKTREE/validation"
cp -a "$ROOT/validation/cadop_slice_submit_unavailable_gates" "$WORKTREE/validation/"
cd "$WORKTREE"
if [[ ! -d node_modules ]]; then
  npm install --ignore-scripts >/dev/null
fi
if [[ ! -d vertex/node_modules ]]; then
  (cd vertex && npm install --ignore-scripts >/dev/null)
fi
export CADOP_GATES_BASE_SHA="$BASE_SHA"
export CADOP_GATES_CANDIDATE_SHA="$CANDIDATE_SHA"
export CADOP_GATES_REPO_ROOT="$WORKTREE"
echo "grade: candidate $CANDIDATE_SHA in worktree $WORKTREE"
npm test -- --config validation/cadop_slice_submit_unavailable_gates/rstest.gates.config.ts
npm test -- --config validation/cadop_slice_submit_unavailable_gates/rstest.gates.config.ts \
  validation/cadop_slice_submit_unavailable_gates/gate-05-candidate-diff-scope.test.ts
echo "grade PASS: all gates green on candidate"