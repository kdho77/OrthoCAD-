# Rim-Conformity Post-#110 Diagnosis (Defects A & B)

**Status:** DIAGNOSIS ONLY — no fixes in this change.
**Fixture:** `tests/fixtures/Default.glb` (closed `V=250765`, `topRim=446`, `botRim≈1184` — matches live console).
**Raw numbers:** `/opt/cursor/artifacts/rim-conformity-diagnosis.json`

Temporary `RIM_CONFORMITY_DISABLE=1` gate was used for A1 ON/OFF isolation and **fully reverted** (no flag shipped).

---

## Task A1 — heelBridgeSI with transfer ON vs OFF

| depth mm | transfer ON | transfer OFF |
|---------:|------------:|-------------:|
| 0 | 249 | 249 |
| 3 | 277 | 305 |
| 8 | 296 | 369 |
| 15 | 365 | 340 |

Additional:

| config | ON | OFF |
|--------|---:|----:|
| combined screenshot (w5+d5+arch10+apex5) | 326 | 34 |
| depth15 + arch10 | 397 | 349 |

**Verdict:** Hypothesis 1 (“rim-conformity transfer causes SI explosion to ~2963”) is **rejected** for depth-alone on Default.glb. Transfer ON at depth=15 is 365 (matches PR #110 matrix), not 2963. Transfer OFF is similar or *worse* at depths 3/8.

### Live 2963 chase

Unrestricted bridge SI (no `ymin < HEEL_BRIDGE_Y_MAX_MM` filter):

| config | heelSI ON | allBridgeSI ON |
|--------|----------:|---------------:|
| depth15 | 365 | **2555** |
| depth10 | 330 | 2598 |
| kitchen_sink | 325 | **3170** |

Live `heelBridgeSelfIntersections=2963` was **not** reproduced as the production heel-filtered counter. The nearest measured analogue is unrestricted `allBridgeSI` ∈ 2555–3170. Same mesh (`V=250765`). Heel band covers only 32% of bridge tris (`523/1630`).

Export still fails at depth>0 because 365 > baseline 249 — that failure mode is real and expected under the current gate; the “2963” figure needs a separate live-build audit (filter bypass vs different counter path).

---

## Task A2 — where SI occurs (depth=15, transfer ON)

- **total heelBridgeSI = 365**
- **heel u&lt;0.25: 365 (100%)**
- mid u∈[0.25,0.60]: 0
- anterior u&gt;0.60: 0
- u-bin mode: **u≈0.10 (311 of 365)**

Intersections cluster at the heel where depth’s own rim delta is largest — not at arch/anterior.

---

## Task B1 — arch rim vs interior thick-delta (`archHeight=10`)

| u | rimΔ | interior@5mm | interior@15mm |
|--:|-----:|-------------:|--------------:|
| 0.20 | 3.34 | 3.20 | 2.43 |
| 0.26 | 5.67 | 5.34 | 4.33 |
| 0.32 | 8.03 | 7.65 | 6.05 |
| 0.38 | 9.55 | 8.97 | 7.26 |
| **0.42** | **9.84** | **9.21** | 7.37 |
| 0.46 | 9.59 | 8.99 | 7.26 |
| 0.50 | 8.80 | 8.47 | 6.95 |
| 0.54 | 7.05 | 7.30 | 6.06 |
| 0.58 | 3.97 | 5.94 | 5.03 |
| 0.60 | 2.67 | 4.99 | 4.31 |

Peaks coincide (rim & int@5 at u=0.422). Second-diff sharpness: rim **0.77** vs int5 **0.43** vs int15 **0.38** — rim is somewhat sharper on the anterior shoulder, but the arch peak itself is a smooth graded dome, not a spike in the rim data.

Wall-top medial transect (h&gt;0.85) tracks the same smooth dome through u≈0.20–0.48.

---

## Task B2 — seed dedup at arch

| metric | value |
|--------|------:|
| seeds before dedup | 269 |
| unique wallTops | 266 |
| discarded pairings | 3 |
| arch-region collisions | **1** |
| max arch Δ discrepancy | **0.00 mm** |

**Verdict:** Surprise #1 dedup is **not** the arch-spike cause.

---

## RANKED OPTIONS

### Defect A — export SI gate / “2963”

1. **Best supported — Depth SI escalation vs depth=0 baseline (gate working as coded); transfer not the 2963 driver.**
   Measured heelSI stays in the 249–397 band with transfer ON. Export fails because gate compares against 249. Live 2963 was not reproduced as heel-filtered SI; closest is unrestricted allBridgeSI.
   *Fix sketch (not implementing):* Phase-3 bridge retune and/or depth-aware SI baseline policy in `assertClosedSolidAcceptable`. Do **not** disable rim-conformity for depth-alone — OFF is not better.

2. **Transfer amplifies SI when width is co-active (secondary).**
   Combined/width stacks: ON can raise heelSI vs OFF (326 vs 34 on screenshot stack), still ≪2963.

3. **Live-counter discrepancy (investigate, don’t guess-fix).**
   Audit deployed `countHeelBridgeSelfIntersections` / `HEEL_BRIDGE_Y_MAX_MM` path against this harness if 2963 remains live.

### Defect B — arch wall spike vs rounded dome

1. **Best supported — Hypothesis 2: wall gets rim delta without lateral (inward) blending.**
   Rim and interior curves are similar graded domes (same peak u). Dedup ruled out. Transfer writes `w_h·w_u·w_d · Δ_rim` onto the wall corridor → bottom view reads as a near-vertical ridge/extrusion while the top surface still shows the dome.
   *Fix sketch (not implementing):* Bottom-writes-only. Keep `height-field.ts` unchanged. Soften transferred delta by a footprint-inward weight (distance from rim / local half-width), still using BASE correspondence — no Laplacian/mesh-adjacency diffusion, no new deps.

2. **Hypothesis 1 (sharp rim data) — partial, secondary.**
   Rim anterior shoulder is sharper than interior@5mm; not a peak discontinuity.

3. **Dedup discontinuity — rejected** by B2 (1 collision, 0 mm discrepancy).
