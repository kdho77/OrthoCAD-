# Phase 2/3 — Two-Pointer Walk Steering (MERGE candidate)

## Change
`buildTwoPointerBridgeTriangles`: `MAX_BOT_RUN=3` + force top-advance when
prospective bot-tri tetra > `BRIDGE_QUAD_MAX_TETRA_VOL_MM3` (and botRun≥1).
Baseline SI depth0: 249 → **208**.

## Phase 3 results

### Heel-filtered SI (Default.glb)

| depth | before | after | Δ |
|------:|-------:|------:|--:|
| 0 | 249 | **208** | −41 |
| 3 | 277 | **221** | −56 |
| 8 | 296 | **214** | −82 |
| 15 | 365 | **239** | −126 |

### Live-2963 combo (ADDITION 3)

| | before | after |
|--|-------:|------:|
| d9,w5,a12,apex5 heelSI | 366 | **290** |
| d9 allBridgeSI | 2958 | **2816** |
| d10,w5,a12,apex5 heelSI | 359 | **251** |
| d10 allBridgeSI | 2921 | **2747** |

### ADDITION 1 — Rim-edge coverage
All configs: topAdvances=446, botAdvances=1184, each rim edge used exactly once.
openEdges=0, nonManifold=0, Euler=3 (unchanged). fanMax≤3.

### ADDITION 2 — Tetra threshold
`BRIDGE_QUAD_MAX_TETRA_VOL_MM3=0.5` fires **0×** on depth-alone, **1×** on live d10
(vol≈0.59). SI reduction is from **run-cap** (~291–294 forceTopByRunCap).
Surprise: equal-count constant is nearly inert here — kept as insurance; residual
SI is pigeonhole fans of size 3 still crossing, not a dead-threshold failure mode
requiring immediate retune. Follow-up option: derive a lower two-pointer-specific
threshold from prospective-vol distribution if further cuts are needed.

### Regressions
- rim-conformity matrix (#110/#111): **PASS** (9/9)
- heel-cup-depth.export-solid: **PASS**
- bridge-manifold: **PASS**
- export-geometry.routing OCCT mocks: **pre-existing FAIL on main** (unrelated)

## Residual
heelSI not zero: fans must average ~2.65 (pigeonhole); cap@3 still allows
cross-fan SI. Further elimination needs Option 2 (mid-row) or out-of-scope work.

**MERGE-READY: YES** (with documented residual + inert tetra-threshold note)
