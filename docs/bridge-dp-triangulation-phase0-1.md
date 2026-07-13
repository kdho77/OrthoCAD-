# Rigorous Bridge Triangulation — Phase 0 + Phase 1 (Fable 5)

**Branch:** `cursor/bridge-dp-triangulation-ef6f` (stacked on #113)
**Status:** HALT after Phase 1 — awaiting explicit Go before any implementation.
**Vertex insertion:** NOT required. Connectivity-only. The second mandatory halt is not triggered.

---

## PHASE 0 — HEAD verification & feasibility

### Drift check (measured this pass, production path)

| depth | expected (#113) | measured | drift |
|------:|----------------:|---------:|:-----:|
| 0 | 208 | 208 | none |
| 3 | 221 | 221 | none |
| 8 | 214 | 214 | none |
| 15 | 239 | 239 | none |
| live d9 (w5,a12,apex5) | 290 | 290 | none |
| live d10 | 251 | 251 | none |

topRim=446, botRim=1184, bridgeTris=1630, V=250765, Euler=3, openEdges=0, nonManifold=0 — all confirmed on HEAD.

### Connectivity-only feasibility — CONFIRMED, with measured proof

A temporary, now-reverted builder-override hook was used to run a sandboxed
prototype of the proposed algorithm through the full production
`closeGlbInsoleToSolid` pipeline (archive: `/opt/cursor/artifacts/dp-bridge-prototype.test.ts.txt`,
results: `dp-bridge-prototype.json`). No production code is changed at this halt
(`git status` clean).

`base-modifier.ts` rim-conformity dependency review: `RimConformityFrame` arrays
(`wallVertexIndex`/`wallSeedIndex`/`wallWeight`) are keyed off BASE vertex indices in
`[0, count)`; HC-1 iterates `[topVertexCount, count)`. The proposed change reuses the
existing 1630 rim vertices and only alters bridge **connectivity** — vertex count,
order, and index ranges are untouched, so no ripple.

---

## PHASE 1 — Algorithm: global min-cost staircase triangulation (Fuchs–Kedem–Uselton)

### Problem identification

Bridging two closed loops of unequal cardinality with the exact-coverage invariant
(every top edge in exactly one triangle with 2 top verts; every bot edge in exactly one
triangle with 2 bot verts; total tris = 446+1184 = 1630) is precisely the classical
**contour-stitching** problem (Fuchs, Kedem & Uselton 1977; Christiansen & Sederberg 1978).
The space of valid bridges = the set of **monotone staircase paths** through a
(446+1)×(1184+1) lattice from (0,0) to (446,1184): a top-step at (i,j) emits triangle
(T[i−1], B[j], T[i]); a bot-step emits (T[i], B[j−1], B[j]). Every prior attempt
(arc-length walk, #113 steering) is a **greedy path** through this lattice.
The correct method is **dynamic programming over the full lattice**: O(n·m) states,
two transitions each, globally minimizing a per-triangle cost. This is not a heuristic —
it returns the provable global optimum over the *entire* family of coverage-exact bridges.

### Why min-cost eliminates cross-fan crossing

Cross-fan SI is two chords (top→bot diagonals) crossing in 3D. For any crossing pair
of adjacent chords there is an uncrossed staircase alternative connecting the same
four vertices whose total chord length is strictly smaller (triangle-inequality
exchange argument, exact in the locally near-planar strip). A global minimum therefore
contains no locally-improvable crossing. This is a structural argument, not a tuning
argument — and it is confirmed empirically below to full elimination.

### Cost-function shootout (prototype, full production pipeline)

| config | production walk heelSI / allSI | **DP min-area** | **DP min-chord** |
|--------|-------------------------------:|----------------:|-----------------:|
| d0 | 208 / 2435 | 0 / 2 | **0 / 0** |
| d3 | 221 / 2483 | 0 / 2 | — |
| d8 | 214 / 2476 | 0 / 2 | — |
| d15 | 239 / 2431 | 0 / 2 | **0 / 0** |
| live d9 (w5,a12,apex5) | 290 / 2816 | 0 / 2 | **0 / 0** |
| live d10 | 251 / 2747 | 0 / 2 | **0 / 0** |

All DP rows: topEdgeTris=446, botEdgeTris=1184, uniqueTopEdges=446, uniqueBotEdges=1184
(exact coverage), openEdges=0, nonManifold=0, **Euler=3 unchanged**.

**Chosen cost: min-chord** (sum of top→bot diagonal lengths — the "shortest total
surface tension" functional). It achieves **allBridgeSI = 0** — complete elimination,
not just heel-band — at rest and under every tested correction shear.

### Honest notes

1. **fanMax grows** (up to 129 bot edges under one top vertex on live combos vs 3 under
   #113's cap). This is the *taut* answer where the jagged mixed plantar/wall botRim
   zigzags under a sparse topRim span: a clean cone fan instead of forced crossings.
   Watertight, zero SI, manifold — but thinner triangles on the wall strip. If print
   quality ever demands bounded fans, a hybrid cost (chord + fan penalty) exists in the
   same DP framework; NOT proposed now since measured SI=0.
2. **Runtime:** DP with a ±8 start-offset window ≈ +8–10 s inside `closeGlbInsoleToSolid`
   (export-time only; never in the interactive loop). Phase 3 will measure window
   {0, ±2, ±8} and ship the smallest that preserves allBridgeSI=0.
3. **Zero-SI is not a formal theorem for arbitrary 3D loops** — the exchange argument is
   exact only locally-planar. The claim shipped is: global optimum over the full
   coverage-exact family + measured 0 across the entire validation matrix, vs 2431–2816
   for the walk.

### Phase 2 diff map (precise; no implementation until Go)

```
# vertex/src/lib/geometry/mesh-close.ts

+ export const BRIDGE_DP_OFFSET_WINDOW = 8;   # start-offset search half-width (final value from Phase 3)

+ export function buildMinChordBridgeTriangles(
+     topPositions, topIndices, bottomPositions, bottomIndices,
+     getPosition, centroid,
+     offsetWindow = BRIDGE_DP_OFFSET_WINDOW,
+ ): number[]
+     # (n+1)×(m+1) Float64 cost lattice + Uint8 parent lattice, reused across offsets
+     # transitions: top-step cost = |T[i] − B[j]| ; bot-step cost = |T[i] − B[j]|
+     #   (chord length of the diagonal each step creates)
+     # for k in [−offsetWindow, +offsetWindow]: run DP on bot rotated by k; keep min-total
+     # backtrack → step sequence; emit via existing emitGuardedBridgeTri with the
+     #   IDENTICAL per-step triangle patterns as the walk (coverage invariant inherited)

  # closeGlbInsoleToSolid — unequal-count branch ONLY (the branch Default.glb takes):
-     bridgeFaces = buildTwoPointerBridgeTriangles(topPositions, topIndices,
-         botPositionsAligned, botIndices, getPosition, centroid, twoPointerDiag);
+     bridgeFaces = buildMinChordBridgeTriangles(topPositions, topIndices,
+         botPositionsAligned, botIndices, getPosition, centroid);

  # DEFAULT_GLB_CLOSED_BASELINE.heelBridgeSelfIntersections: 208 → 0
  # buildTwoPointerBridgeTriangles + TWO_POINTER_MAX_BOT_RUN: KEPT (equal-count
  #   fallback + generateBridgeStripTwoPointer + bridge-manifold tests) — untouched
  # equal-count path, slit-cap (#103), height-field, rim-conformity: untouched

# tests/heel-cup-depth.export-solid.test.ts
  # MEASURED_SI_BY_DEPTH → {0:0, 3:0, 8:0, 15:0}
  # depth>0 assertions FLIP: assertClosedSolidAcceptable now expected NOT to throw
  #   → heel-cup depth becomes genuinely exportable (gate passes on real geometry)

# tests/two-pointer-walk-steering.phase3.test.ts
  # fanMax≤3 / walkDiag assertions replaced by the DP invariants:
  #   coverage exact (446/1184, unique edges), allBridgeSI=0, Euler=3, open/nm=0

# vertex/src/lib/geometry/export-geometry.routing.test.ts
  # mock baseline literal 208 → 0 (cosmetic)

# NEW tests/min-chord-bridge.test.ts
  # focused invariants: synthetic loops (4:8, 8:8, jagged-Z) + Default.glb sweep
```

**Blast radius:** one new function + one call-site swap in the unequal branch;
all other bridge paths untouched. No vertex-count/index change anywhere.

---

## HALT

Awaiting explicit Go on min-chord DP (Option: min-area available as fallback, residual
allSI=2). Vertex-insertion checkpoint: **not applicable** — connectivity-only solution
measured sufficient (complete elimination).
