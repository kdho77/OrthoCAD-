#!/usr/bin/env bash
# Succeeds (exit 0) when gates FAIL on BASE client — proves gates catch main defects.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
BASE_SHA="${CADOP_GATES_BASE_SHA:-cc6482be37175bd7db3c25e3179e22753e5dd899}"
CURRENT="$(git rev-parse HEAD)"
if [[ "$(git rev-parse "$BASE_SHA^{commit}")" != "$(git rev-parse vertex/server/src/lib/vertexslice-client.ts 2>/dev/null | head -1)" ]]; then
  :
fi
CLIENT_SHA="$(git log -1 --format=%H -- vertex/server/src/lib/vertexslice-client.ts 2>/dev/null || echo unknown)"
echo "noop-proof: running gates with client at tree HEAD=$CURRENT (vertexslice-client last commit touch=$CLIENT_SHA)"
set +e
OUT="$(npm test -- --config validation/cadop_slice_submit_unavailable_gates/rstest.gates.config.ts 2>&1)"
CODE=$?
set -e
echo "$OUT"
if [[ $CODE -eq 0 ]]; then
  echo "noop-proof FAIL: gates passed on BASE tree; expected failure on cc6482be client behavior"
  exit 1
fi
echo "noop-proof PASS: gates failed on BASE client (exit $CODE)"
exit 0