#!/usr/bin/env bash
# FROZEN runner. Grades a SHA that is already in this clone. Does not push.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATES="$ROOT/validation/eva_cnc_gates"
BASE_SHA="4e2e196561bada8f2a4faf4ad174a716306d8c94"
CAND_SHA="3260b001686883fa74ea95b1833df42100bfc656"
RSTEST="$ROOT/node_modules/.bin/rstest"
MODE="${1:-help}"

link_deps() {
    local wt="$1"
    ln -sfn "$ROOT/node_modules" "$wt/node_modules"
    ln -sfn "$ROOT/vertex/node_modules" "$wt/vertex/node_modules"
    ln -sfn "$ROOT/packages/mcp/node_modules" "$wt/packages/mcp/node_modules"
    mkdir -p "$wt/validation"
    rm -rf "$wt/validation/eva_cnc_gates"
    cp -a "$GATES" "$wt/validation/eva_cnc_gates"
}

worktree_for() {
    local sha="$1"
    local label="$2"
    local wt="/tmp/eva-cnc-gate-$label"
    if [[ ! -d "$wt" ]]; then
        git -C "$ROOT" worktree add --detach "$wt" "$sha" >&2
    else
        git -C "$wt" checkout --detach "$sha" >&2
    fi
    link_deps "$wt"
    printf '%s\n' "$wt"
}

run_rstest() {
    local wt="$1"
    shift
    (
        cd "$wt"
        env "$@" "$RSTEST" run --config validation/eva_cnc_gates/rstest.config.ts
    )
}

ensure_sha() {
    local sha="$1"
    if git -C "$ROOT" cat-file -t "$sha" >/dev/null 2>&1; then
        return 0
    fi
    git -C "$ROOT" fetch origin "$sha" || git -C "$ROOT" fetch origin \
        cursor/eva-cnc-fit-up-to-size-15-on-the-block-cutout-sweeps-may-cross-never-the-insole-mill-side-lr-r-2cf9
    git -C "$ROOT" cat-file -t "$sha" >/dev/null
}

case "$MODE" in
    proof)
        WT="$(worktree_for "$BASE_SHA" base)"
        run_rstest "$WT" \
            EVA_GATE_MODE=proof \
            EVA_GATE_LABEL=base \
            EVA_GATE_OUT="$GATES/proof.json"
        ;;
    grade-base)
        WT="$(worktree_for "$BASE_SHA" base)"
        run_rstest "$WT" \
            EVA_GATE_MODE=grade \
            EVA_GATE_LABEL=base \
            EVA_GATE_OUT="$GATES/base.json"
        ;;
    grade-candidate)
        ensure_sha "$CAND_SHA"
        if [[ ! -f "$GATES/base.json" ]]; then
            echo "base.json missing; run grade-base first" >&2
            exit 1
        fi
        WT="$(worktree_for "$CAND_SHA" candidate)"
        run_rstest "$WT" \
            EVA_GATE_MODE=grade \
            EVA_GATE_LABEL=candidate \
            EVA_GATE_BASE_JSON="$GATES/base.json" \
            EVA_GATE_OUT="$GATES/candidate.json"
        ;;
    format)
        node "$GATES/format_results.mjs" "$GATES/proof.json" "$GATES/base.json" "$GATES/candidate.json" \
            > "$GATES/RESULTS.md"
        ;;
    help|*)
        echo "usage: run_gates.sh proof|grade-base|grade-candidate|format" >&2
        exit 2
        ;;
esac
