#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
npm test -- --config validation/cadop_slice_submit_unavailable_gates/rstest.bad-change.config.ts
echo "bad-change-proof PASS: structural anti-pattern checks hold on current client source"