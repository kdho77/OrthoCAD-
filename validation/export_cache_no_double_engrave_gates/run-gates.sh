#!/usr/bin/env bash
# Run the frozen gates against the current worktree.
# Usage: run-gates.sh [results.jsonl]
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
OUT="${1:-/tmp/export-cache-gates-results.jsonl}"
: >"$OUT"
export GATE_RESULTS="$OUT"
npx rstest run \
    --config validation/export_cache_no_double_engrave_gates/rstest.gates.config.ts \
    --pool.maxWorkers 1 \
    validation/export_cache_no_double_engrave_gates
echo "results: $OUT"
