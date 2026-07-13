# Defect A Diagnosis — Live SI Reconciliation + Two-Pointer Bridge Root Cause

**Status:** DIAGNOSIS ONLY — no implementation.
**Fixture:** `tests/fixtures/Default.glb` (`V=250765`, `topRim=446`, `botRim=1184`, two-pointer path).
**Raw data:** `/opt/cursor/artifacts/defect-a-diagnosis.json`, `defect-a-ymax-scan.json`

Temporary measurement harnesses were used and deleted; no production code changes.

---

## Task 1 — Counter reconciliation (2963 vs 365)

### Call-path evidence (same function)

| Path | Source |
|------|--------|
| Live UI error | `buildExportStl` (`export-geometry.ts:162–164`) → `assertClosedSolidAcceptable` (`mesh-close.ts:1267–1291`) → `countHeelBridgeSelfIntersections` (`mesh-close.ts:1203–1240`) |
| Error string template | `` `[MESH-CLOSE] heelBridgeSelfIntersections=${si} exceeds baseline ${baseline…}` `` at `mesh-close.ts:1288–1289` |
| Harness 365 | `tests/heel-cup-depth.export-solid.test.ts` calls `countHeelBridgeSelfIntersections` directly |
| Other SI counters in repo | **None** — only this function computes bridge self-intersections |

UI mapping (`export-user-message.ts`) only string-matches `heelBridgeSelfIntersections`; it does not compute SI.

### Measured at depth=15 (current main, Default.glb)

| Scope | Tris in band | SI |
|-------|-------------:|---:|
| Heel filter `ymin < 80` (production) | 523 | **365** |
| Unfiltered all bridge tris | 1630 | **2555** |
| Live console | — | **2963** |

Assert with production path throws: `heelBridgeSelfIntersections=365 exceeds baseline 249` (same string pattern as live).

### Y-threshold scan (what filter would be needed for ~2963)

At depth=15, raising `HEEL_BRIDGE_Y_MAX_MM` never hits 2963 — SI jumps 365→779→1360→**2555** (plateau = allBridgeSI).  
At `depth10+arch12` allBridgeSI=**2777**; kitchen-sink allBridgeSI=**3170**. Live **2963** sits in that unfiltered multi-correction band.

### Verdict

**Not two different functions.** Live and harness share `countHeelBridgeSelfIntersections`.  
**2963 is not a second mesh defect** beyond the known two-pointer SI issue. It is numerically consistent with **unfiltered all-bridge SI** under a multi-correction stack (2777–3170), not with the heel-filtered value (365) on current main. Exact live stack / whether the deployed bundle omitted the `ymin` gate was **not** proven from source alone — only that current main cannot emit 2963 from the heel-filtered counter on Default.glb.

---

## Task 2 — Two-pointer mechanism (depth=0 vs depth=15)

### Topology (identical at both depths)

| Metric | depth=0 | depth=15 |
|--------|--------:|---------:|
| bridge tris | 1630 | 1630 |
| top-advance / bot-advance | 446 / 1184 | 446 / 1184 |
| heel-band tris | 523 | 523 |
| V / E / F | 250765 / 131088 / 87392 | same |
| Euler χ | **3** | **3** (unchanged) |
| openEdges / nonManifold | 0 / 0 | 0 / 0 |
| fan sizes | mean 2.65, max 5 | same |

Connectivity is frozen by the two-pointer walk (`buildTwoPointerBridgeTriangles`, `mesh-close.ts:914–963`). Depth changes **geometry only** (top-rim tangent field from heel-cup depth in `base-modifier.ts`).

### SI escalation

| | depth=0 | depth=15 | Δ |
|--|--------:|---------:|--:|
| heelSI | 249 | 365 | **+116** |
| allBridgeSI | 2482 | 2555 | +73 |
| bot+bot SI pairs | 174 | 272 | **+98** |
| same-sole-top fan pairs | **0** | **0** | 0 |
| heel fan tetra vol max (mm³) | 0.130 | 0.457 | **+0.327** |

### Mechanism

1. Unequal rims (446 vs 1184) force ~2.65 bot-edge advances per top step (fan mean 2.65).
2. SI pairs are **between neighboring fans** (different sole top verts) — not within one catch-up fan (`sameSoleTopFanPairs=0` because co-fan tris share a vertex and are excluded by `sharesVertexIndices`).
3. Depth increases fan non-planarity (heel tetra max ×3.5) and adds mostly **bot+bot** cross-fan intersections along the heel arc (`u≈0.05–0.13`).
4. Euler=3 does **not** track depth; it is not the SI escalation driver.

---

## Task 3 — Why SI=249 is the acceptable baseline

| Artifact | At depth=0 | Related to depth SI? |
|----------|------------|----------------------|
| `heelBridgeSI=249` | Real heel-band two-pointer bridge self-intersections | **Yes — same defect at rest** |
| `Euler=3` | Documented PR #103 slit-cap bowtie residue (`mesh-close.ts:1251–1253`); edge-usage 3+/4+ = 0 | **No — separate; χ unchanged at depth=15** |

The #107 gate treats SI=249 as a **tolerance floor**, not true zero. Fixing the two-pointer mechanism should be expected to **change the acceptable baseline**, not merely flatten the depth slope.

---

## RANKED OPTIONS

### #1 BEST SUPPORTED — Two-pointer unequal-rim fans cross at heel; depth shears them further
**Confidence: high** for SI=249→365 mechanism; **high** that Euler=3 is independent slit-cap residue.

Unequal-count arc-length walk (`mesh-close.ts:914–963`) on 446↔1184 emits overlapping adjacent heel fans. Already imperfect at depth=0 (249). Depth’s rim displacement increases non-planarity and cross-fan SI (+116).

*Fix sketch (not implementing):* Prefer a non-crossing strip — e.g. snap/resample to equal count with existing `buildGuardedEqualCountBridgeFaces` planarity guards when non-planarity stays under threshold, or replace two-pointer fans with a constrained strip that forbids adjacent-fan 3D overlap. Keep slit-cap Euler=3 as a separate track. No `height-field.ts` changes; bottom-writes-only if wall transfer involved; no new deps.

### #2 Live 2963 = same gate, unfiltered-scope number (not a second defect)
**Confidence: high** that it’s the same function/string; **medium** on exact live filter bypass vs rich correction stack (2977–3170 brackets 2963; no exact match on tested stacks).

*Action sketch:* Re-run live export on stock Default + depth-only and log `HEEL_BRIDGE_Y_MAX_MM`, heel-band tri count, and SI; confirm deployed bundle matches main.

### #3 Weaker / incomplete — “pointer seam skip” as primary
**Confidence: low as primary.** Fan size distribution is stable (max 5); SI is cross-fan, not intra-fan catch-up. Seam catch-up is the *structure that creates adjacent fans*, but the measured intersections are between fans after depth shear.

---

**HALT** — no implementation without a separate Go. Escalation to Fable 5 not required for the SI escalation mechanism (clear); optional only if live-2963 deploy audit remains blocked.
