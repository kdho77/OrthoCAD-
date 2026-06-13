# Implementation Notes

Ad-hoc engineering tracking items that are not tied to a single PR.

---

## Pre-existing TypeScript Errors (tracking)

**Recorded:** 2026-06-13 (PR #78 final gate)

**Files with pre-existing `tsc --noEmit` errors (not introduced by PR #78):**

- `src/stores/design-store.ts`
- `src/stores/issues-store.ts`
- `src/lib/geometry/base-occt.ts`
- `src/lib/geometry/base-bounds.ts`
- `src/lib/geometry/kernel-build.ts`
- `src/lib/geometry/export-geometry.ts` (unused import)
- `src/lib/geometry/operator-graph.ts`
- `src/features/library/custom-library-service.ts`
- `src/hooks/useInsoleGeometry.ts`
- `src/lib/geometry/base-asset.ts`
- `src/stores/mesh-edit-store.ts`

(Full list: run `npm run typecheck` in `vertex/` on `main`.)

**Risk:** These errors mask new type errors in future PRs if `tsc --noEmit` is used as a CI gate without a baseline.

**Recommended action:** Run `tsc --noEmit` on `main` before next sprint. Record the exact error list as a baseline. Use a tsc error-count gate in CI: **new errors introduced by this PR = 0** rather than **total errors = 0** until pre-existing errors are cleared.

**Owner:** _unassigned_

**Priority:** Medium — does not block PR #78 but should be addressed before the codebase grows further.

---

## Production STL size baseline (mesh-close)

**Recorded:** 2026-06-13 (commit `100611f6`)

Foot-shaped orthotic pair (~260 mm L × 80 mm W), `closeMeshPerimeter` + `geometryToBinarySTL`:

| Metric | Value |
|--------|-------|
| V | 320 |
| E | 570 |
| F | 380 |
| STL | 18.64 KB |
| bridge_faces | 256 |
| perimeter samples | 64 |

Regression guard: `mesh-close.integration.test.ts` → `production-scale orthotic STL size baseline`.
