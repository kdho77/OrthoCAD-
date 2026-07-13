# Min-Chord DP Bridge — Phase 2/3 Completion Report

**Branch:** `cursor/bridge-dp-triangulation-ef6f` | PR #114 (stacked on #113)

## What shipped

`buildMinChordBridgeTriangles` (mesh-close.ts): global minimum-cost staircase
triangulation over the (446+1)×(1184+1) lattice (Fuchs–Kedem–Uselton contour
stitching). Both step types create the diagonal T[i]−B[j], so path cost = total
chord length; DP returns the global optimum over the entire coverage-exact
bridge family. Emits via the existing `emitGuardedBridgeTri` with walk-identical
step patterns — the rim-edge coverage invariant is inherited by construction.

One call-site swap: the unequal-count branch of `closeGlbInsoleToSolid` (the
branch Default.glb takes). Walk, equal-count path, slit-cap: untouched.
`DEFAULT_GLB_CLOSED_BASELINE.heelBridgeSelfIntersections`: 208 → **0**.

## Phase 3 results (final window: BRIDGE_DP_OFFSET_WINDOW = 0)

Window narrowing: 8 → 2 → 0 all hold zero across the matrix; smallest shipped.
DP overhead is negligible in the ~13.6 s export-time close (never interactive —
`closeGlbInsoleToSolid` reachable only from export paths; `applyBaseModifiersWithSidewall`
has no non-test callers — HC-6 confirmed).

| config | heelSI | allBridgeSI | coverage | open/nm | Euler |
|--------|-------:|------------:|----------|---------|------:|
| d0 | **0** | **0** | 446/1184 exact | 0/0 | 3 |
| d3 | **0** | **0** | 446/1184 exact | 0/0 | 3 |
| d8 | **0** | **0** | 446/1184 exact | 0/0 | 3 |
| d15 | **0** | **0** | 446/1184 exact | 0/0 | 3 |
| live d9 (w5,a12,apex5) | **0** | **0** | 446/1184 exact | 0/0 | 3 |
| live d10 (w5,a12,apex5) | **0** | **0** | 446/1184 exact | 0/0 | 3 |

History: 249/277/296/365 (raw walk) → 208/221/214/239 (#113 steering) → **0** (DP).

**Export gate now passes at every heel-cup depth** — real geometric correctness;
the baseline tightened (208→0), no tolerance was loosened.

## Tests

- `tests/min-chord-bridge.test.ts` (new): synthetic 4:8 / 8:8 / jagged-Z 6:16
  coverage+SI unit tests, degenerate guard, live d9/d10 integration.
- `tests/two-pointer-walk-steering.phase3.test.ts`: repurposed to DP invariants
  depth sweep (per-edge exactly-once assertions included).
- `tests/heel-cup-depth.export-solid.test.ts`: SI table → all 0; depth>0
  assertions flipped to expected-pass.
- `export-geometry.routing.test.ts`: mock literal 208→0.

## Regression

Full suite: **1035 passed / 2 failed / 1 skipped**. Both failures are the known
pre-existing OCCT-mock routing tests (fail identically on main; out of scope per
contract). Rim-conformity matrix (#110/#111), bottom-wall, realmesh, width,
toprim, bridge-manifold: green.

HC-1 (plantar fixed) — green. HC-3 — zero-correction positions bit-identical
(connectivity-only change; closed-solid index buffer differs by design — that is
the fix). HC-4 manifold targets — green. No vertex count/index change anywhere
(V=250765, bridgeTris=1630 — no ripple into RimConformityFrame / HC-1 ranges).

## Drift encountered & resolved autonomously

1. Prototype's per-transition sqrt cost → replaced with precomputed chord matrix
   (n×m Float64) shared across offsets.
2. Phase 3 plan said "narrow to ±2" — measurement showed window 0 already holds
   zero everywhere; shipped 0 with the parameter retained for future meshes.
3. `two-pointer-walk-steering.phase3.test.ts` #113 assertions (fanMax≤3,
   walk diagnostics) were obsolete post-swap — repurposed the file to DP
   invariants rather than deleting, keeping depth-sweep coverage in one place
   and live combos in the new file (no duplicated 3-minute sweep).

**MERGE-READY: YES** — all acceptance criteria met; merge decision is Kendon's.
