#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
exec npm test -- --config validation/cadop_slice_submit_unavailable_gates/rstest.gates.config.ts "$@"