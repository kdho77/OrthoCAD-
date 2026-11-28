#!/usr/bin/env bash
# No-op and bad-change proofs. Does not grade the candidate.
# Fast proofs skip the STL loft. STL proofs are separate and slow.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
GATES="validation/export_cache_no_double_engrave_gates"
CONFIG="$GATES/rstest.gates.config.ts"
BREAK="$GATES/proofs/break-tree.mjs"

run_gate() {
    local results="$1"
    shift
    : >"$results"
    set +e
    GATE_RESULTS="$results" npx rstest run \
        --config "$CONFIG" \
        --pool.maxWorkers 1 \
        "$@"
    local code=$?
    set -e
    return "$code"
}

expect_fail() {
    local label="$1"
    shift
    local results
    results="$(mktemp)"
    if run_gate "$results" "$@"; then
        echo "PROOF FAIL $label: gate passed, expected failure"
        exit 1
    fi
    echo "PROOF OK $label failed as required"
}

expect_pass() {
    local label="$1"
    shift
    local results
    results="$(mktemp)"
    if ! run_gate "$results" "$@"; then
        echo "PROOF FAIL $label: gate failed, expected pass"
        exit 1
    fi
    echo "PROOF OK $label passed"
}

worktree_for() {
    local name="$1"
    local dir="/tmp/oc-gate-$name"
    git worktree remove --force "$dir" >/dev/null 2>&1 || true
    rm -rf "$dir"
    git worktree add --detach "$dir" HEAD >&2
    ln -s "$ROOT/node_modules" "$dir/node_modules"
    ln -s "$ROOT/vertex/node_modules" "$dir/vertex/node_modules"
    mkdir -p "$dir/validation"
    rm -rf "$dir/validation/export_cache_no_double_engrave_gates"
    cp -a "$ROOT/validation/export_cache_no_double_engrave_gates" "$dir/validation/"
    echo "$dir"
}

echo "== defect gates fail on unmodified BASE =="
expect_fail "BASE T1-engraved" --testNamePattern "T1-engraved" "$GATES/t1-no-second-engrave.gate.ts"
expect_fail "BASE T2-name" --testNamePattern "T2-name" "$GATES/t2-fingerprint.gate.ts"
expect_fail "BASE T3-viewer" --testNamePattern "T3-viewer" "$GATES/t3-print-export-cache.gate.ts"

echo "== no-op on this tree (fast gates; BASE should pass these) =="
expect_pass "T1-control" --testNamePattern "T1-control" "$GATES/t1-no-second-engrave.gate.ts"
expect_pass "T1-pretext" --testNamePattern "T1-pretext" "$GATES/t1-no-second-engrave.gate.ts"
expect_pass "T2-extra" --testNamePattern "T2-extra" "$GATES/t2-fingerprint.gate.ts"
expect_pass "T2-param" --testNamePattern "T2-param" "$GATES/t2-fingerprint.gate.ts"
expect_pass "T2-fresh-extra" --testNamePattern "T2-fresh-extra" "$GATES/t2-fingerprint.gate.ts"
expect_pass "T3-export" --testNamePattern "T3-export" "$GATES/t3-print-export-cache.gate.ts"
expect_pass "T3-corrections" --testNamePattern "T3-corrections" "$GATES/t3-print-export-cache.gate.ts"
expect_pass "R1-R6" "$GATES/r-locked-rules.gate.ts"

echo "== bad-change copies =="
bad_t1="$(worktree_for bad-t1-control)"
node "$BREAK" "$bad_t1" bad-t1-control
(cd "$bad_t1" && expect_fail "bad T1-control" --testNamePattern "T1-control" "$GATES/t1-no-second-engrave.gate.ts")

bad_pre="$(worktree_for bad-t1-pretext)"
node "$BREAK" "$bad_pre" bad-t1-pretext
(cd "$bad_pre" && expect_fail "bad T1-pretext" --testNamePattern "T1-pretext" "$GATES/t1-no-second-engrave.gate.ts")

bad_t2="$(worktree_for bad-t2)"
node "$BREAK" "$bad_t2" bad-t2-extra
(cd "$bad_t2" && expect_fail "bad T2-extra" --testNamePattern "T2-extra " "$GATES/t2-fingerprint.gate.ts")

bad_t3="$(worktree_for bad-t3)"
node "$BREAK" "$bad_t3" bad-t3-export
(cd "$bad_t3" && expect_fail "bad T3-export" --testNamePattern "T3-export" "$GATES/t3-print-export-cache.gate.ts")

bad_surface="$(worktree_for bad-surface)"
node "$BREAK" "$bad_surface" bad-surface
(cd "$bad_surface" && expect_fail "bad R1" --testNamePattern "R1 " "$GATES/r-locked-rules.gate.ts")
(cd "$bad_surface" && expect_fail "bad R2" --testNamePattern "R2 " "$GATES/r-locked-rules.gate.ts")
(cd "$bad_surface" && expect_fail "bad R3" --testNamePattern "R3 " "$GATES/r-locked-rules.gate.ts")
(cd "$bad_surface" && expect_fail "bad R4" --testNamePattern "R4 " "$GATES/r-locked-rules.gate.ts")
(cd "$bad_surface" && expect_fail "bad R5" --testNamePattern "R5 " "$GATES/r-locked-rules.gate.ts")
(cd "$bad_surface" && expect_fail "bad R6" --testNamePattern "R6 " "$GATES/r-locked-rules.gate.ts")

echo "== positive control: a minimal fix makes the defect gates pass =="
good_t1="$(worktree_for good-t1)"
node "$BREAK" "$good_t1" good-t1
(cd "$good_t1" && expect_pass "good T1-engraved" --testNamePattern "T1-engraved" "$GATES/t1-no-second-engrave.gate.ts")

good_t2="$(worktree_for good-t2)"
node "$BREAK" "$good_t2" good-t2
(cd "$good_t2" && expect_pass "good T2" --testNamePattern "T2-" "$GATES/t2-fingerprint.gate.ts")

good_t3="$(worktree_for good-t3)"
node "$BREAK" "$good_t3" good-t3
(cd "$good_t3" && expect_pass "good T3-viewer" --testNamePattern "T3-viewer" "$GATES/t3-print-export-cache.gate.ts")

echo "FAST PROOFS PASSED"
