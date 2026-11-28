#!/usr/bin/env bash
# Frozen list of existing tests the Morton's-name change must keep green.
# A candidate file for the new geometry case is included only when that tree has it.
set -euo pipefail
cd "$(dirname "$0")/../.."
files=(
  vertex/src/lib/geometry/anatomical-side.test.ts
  vertex/src/lib/geometry/text-marking/text-marking.test.ts
  vertex/src/lib/geometry/text-marking/bottom-engrave.test.ts
  vertex/src/lib/geometry/text-marking/bottom-plantar-view.test.ts
)
if [[ -f tests/mortons-bottom-name.test.ts ]]; then
  files+=(tests/mortons-bottom-name.test.ts)
fi
npx rstest "${files[@]}"
