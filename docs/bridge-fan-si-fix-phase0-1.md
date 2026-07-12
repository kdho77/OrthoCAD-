# Phase 0 + Phase 1 — Live-2963 Closure & Two-Pointer Fan SI Fix Design

**Branch:** `cursor/bridge-fan-si-fix-ef6f`  
**Status:** HALT after Phase 1 — awaiting explicit Go before any `mesh-close.ts` edit.

---

## PHASE 0 — Live-2963 closure (CLOSED)

### Source pin (current main ≡ this workspace)

| Check | Result |
|-------|--------|
| `HEEL_BRIDGE_Y_MAX_MM = 80` | yes |
| `ymin >= HEEL_BRIDGE_Y_MAX_MM` continue | yes |
| `sharesVertexIndices` skip | yes |
| Only SI counter | `countHeelBridgeSelfIntersections` → `assertClosedSolidAcceptable` |

Heel-filtered SI on Default.glb never exceeds ~414 in any tested stack. **Current main cannot emit 2963 from the production heel filter.**

### Reproduction (unfiltered all-bridge SI)

| Config | allBridgeSI | heelSI | Δ vs 2963 |
|--------|------------:|-------:|----------:|
| depth=15 alone | 2555 | 365 | −408 |
| d10,w5,a12,apex5 | 2921 | 359 | −42 |
| **d9,w5,a12,apex5** | **2958** | **366** | **−5** |
| d10,w5,a12,apex6 | 2953 | 360 | −10 |
| kitchen-sink | 3170 | 325 | +207 |

**Closest discrete match:** `{ heelCupDepthMm: 9, heelCupWidthMm: 5, archHeightMm: 12, apexMoveMm: 5 }` → allBridgeSI=**2958** (within SAT jitter of 2963).

Screenshot-like multi-correction stacks sit in the same 2860–3016 unfiltered band.

### Verdict

1. **2963 is unfiltered all-bridge SI** under a multi-correction state near depth≈9–10 + width≈5 + arch≈12 + apex≈5 — **not** heel-filtered 365.
2. Live error string template is the production gate’s, so that session’s `countHeelBridgeSelfIntersections` returned an unfiltered-scope number → **stale/different build** (missing or unbounded `HEEL_BRIDGE_Y_MAX_MM`) **or** an equivalent effective filter bypass — **not** a second geometric defect.
3. Geometric mechanism remains: adjacent-fan crossings on the two-pointer strip. Step 0 closed; no further 2963 archaeology required for the fix.

Artifacts: `/opt/cursor/artifacts/live-2963-closure.json`, `live-2963-target.json`.

---

## PHASE 1 — Fix design (HALT — no implementation yet)

### Constraint reminder (pigeonhole)

`botRim/topRim = 1184/446 ≈ 2.65`. Some fans **must** have ≥3 bot-edges.  
A hard cap of 2 is **impossible** without adding top samples. Cap of 3 is feasible (`446×3 = 1338 > 1184`).  
Subsampling bot to 446 for equal-count quads would leave skipped bot rim edges **open** — invalid. Equal-count path is reference-only for guards, not a drop-in for unequal rims.

### Ranked options

#### Option 1 (RECOMMENDED) — Walk steering: fan-run cap + non-planar forced top-advance

**Idea:** Keep two-pointer edge coverage (every rim edge gets a tri). Change only the **advance decision** so long fans are broken earlier and prospective high-tetra bot advances prefer a top advance when one remains.

**Why it fits diagnosis:** SI is cross-fan (non-adjacent fans in 3D); max fan size was 5; mean 2.65. Clipping max toward 3 and avoiding high-volume bot steps should shrink the worst overlapping spans without new verts / without touching equal-count or slit-cap.

**Pseudo-code diff map** (`buildTwoPointerBridgeTriangles` only):

```
# mesh-close.ts buildTwoPointerBridgeTriangles (~914–963)

const MAX_BOT_RUN = 3;  # pigeonhole-feasible ceiling (was unbounded, measured max=5)
const FORCE_TOP_TETRA_MM3 = BRIDGE_QUAD_MAX_TETRA_VOL_MM3; # reuse 0.5 from equal-count

let botRun = 0;

# replace the pure arc-length branch:

else {
  const canTop = i < topLen;
  const canBot = j < botLen;
  const arcPrefersTop = topArc[i+1] <= botArc[j+1] + 1e-9;

  let forceTop = false;
  if (canTop && canBot && botRun >= MAX_BOT_RUN) forceTop = true;
  if (canTop && canBot && !arcPrefersTop) {
    # prospective bot tri non-planarity vs next top sample (local tetra proxy)
    const vol = tetraVolumeMm3(
      getPosition(topIndices[i]), getPosition(bottomIndices[j]),
      getPosition(bottomIndices[(j+1)%botLen]),
      getPosition(topIndices[(i+1)%topLen]));
    if (vol > FORCE_TOP_TETRA_MM3 && botRun >= 1) forceTop = true;
  }

  if (canTop && (arcPrefersTop || forceTop)) {
    emit(top[i], bot[j], top[(i+1)%topLen]);  # existing top-advance emit
    i++; botRun = 0;
  } else if (canBot) {
    emit(top[i], bot[j], bot[(j+1)%botLen]);  # existing bot-advance emit
    j++; botRun++;
  }
}
# wrap-up branches (i>=topLen / j>=botLen) unchanged
```

**Call-site:** no change to `closeGlbInsoleToSolid` unequal branch (still calls `buildTwoPointerBridgeTriangles`).  
**Out of scope untouched:** equal-count path, slit-cap / Euler=3, height-field, rim-conformity, baseline retune-as-fix.

**Risks:** Forced top advances change pairing; must validate openEdges=0, nonManifold=0, Euler≤3. SI may not reach 0 (pigeonhole still requires fans of 3).

**Tests:** update `MEASURED_SI_BY_DEPTH` / baseline in `heel-cup-depth.export-solid.test.ts` to measured post-fix resting SI (only after geometric improvement). Re-run rim-conformity matrix.

---

#### Option 2 — Mid-row on two-pointer strip (adapt equal-count midpoints)

Insert lerp midpoints per vertical sample; emit 2 tris per advance. New verts appended to `combinedPos`. Larger blast radius (closeGlb merge path currently direct-index only). Better geometric smoothing of fan span; more validation surface. **Defer** unless Option 1 under-delivers.

---

#### Option 3 — Post-emit local retessellation of intersecting heel pairs

Emit two-pointer as today; detect SI pairs; flip/rebuild local neighborhoods. Non-local, harder manifold proof. **Not preferred.**

---

### Phase 1 recommendation

**Implement Option 1 only** in Phase 2 after Go.  
Success bar: meaningful heelSI drop at depth 0/3/8/15 vs 249/277/296/365; openEdges=0; nonManifold=0; Euler not worse than 3; rim-conformity matrix green.  
If SI floor remains ≫0, report residual as pigeonhole fan≥3 + cross-fan geometry, not silent under-delivery.

---

## HALT

No `mesh-close.ts` edits until explicit Go on Phase 1 Option 1 (or a directed choice of Option 2).
