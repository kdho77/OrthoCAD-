#!/usr/bin/env bash
# Run one frozen gate mode. Does not edit product code.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
MODE="${HEEL_GATE_MODE:-grade}"
LABEL="${HEEL_GATE_LABEL:-base}"
OUT="${HEEL_GATE_OUT:-validation/heel_bridge_watertight_gates/${LABEL}.json}"
export HEEL_GATE_MODE="$MODE"
export HEEL_GATE_LABEL="$LABEL"
export HEEL_GATE_OUT="$OUT"
exec node_modules/.bin/rstest run --config validation/heel_bridge_watertight_gates/rstest.config.ts
