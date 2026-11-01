# AFO clinical rules addendum — CAD APPROVED 2026-10-16 (binding)

`c > 0` shrinks the positive; `c < 0` is clearance. Calcaneus / plantar origin is `C = 0` in the oriented frame. Shell print defaults stay **4 / 2.5 / 2.5** mm.

Source: `/cursor/stores/bot/afo/AFO_CLINICAL_ADDENDUM.md`.

## 1. Offset field

Per-vertex on the oriented scan. Apply along the outward normal as `p' = p − n c` (equivalent to SDF iso `d(x) = c(π(x))` for the meshing check).

Masks in `[0, 1]` with smoothstep and a 10 mm arc feather (auto-widened; see slope limit):

| Mask | Region |
|------|--------|
| **T** soft tissue | Calf posterior 120° sector, `C+80 … braceH−10`; anterior shin lateral of the crest band to the lateral midline, `C+60 … braceH−10`; medial arch (medial plantar wall, 25–65% foot length, `Z ≤ 25`). |
| **B** bone | Crest band 8 mm + feather; disks: malleoli r15, navicular / 5th met base / post calcaneus r10, fibular head r15, + feather. Applied whether the matching relief is on or off. Missing navicular → estimated disk (medial border, 45% foot length, `Z ≈ 35`, r15) + warning `place navicular marker`. |
| **W_shin** | smoothstep `C+20 … C+60`. |

```
c_pos = (1 − B) [max(0, c_cast) T + max(0, c_shin) W_shin T]
c_neg = min(0, c_cast) + min(0, c_shin) W_shin
c_rel = smoothmin_i (r_i φ_i)     // deepest, never sum
c     = c_pos + c_neg + c_rel
```

`φ = 1` in the core (malleoli 12 mm, fibular head 12 mm, others 8 mm), then smoothstep over the feather by **geodesic** distance.

**Insensate:** `c_pos = 0`, all reliefs ON, prompt missing markers.

**Slope limit:** `|∇c| ≤ 0.7`. Effective feather `= max(10, 2.15 |Δc|)` mm, auto-widen, show in UI, store on the design. Validate before meshing.

## 2. Tibial crest

Auto sections every 5 mm from `C+60` to brace height. On each 3 mm-smoothed section, take max convex curvature in the anterior ±45° sector, spline, reject outliers `> 6 mm`. Optional markers: tibial tuberosity + distal crest end; a draggable spline overrides. Low confidence (`> 30%` outliers **or** peak `< 1.5×` sector median) → require those markers and **block Cast confirm**.

## 3. Bony reliefs

| Site | Default | On |
|------|---------|----|
| Malleoli | −3 mm | ON |
| Navicular | −2 mm | OFF |
| 5th met base | −2 mm | OFF |
| Post calcaneus | −2 mm | OFF |
| Fibular head | −2 mm | OFF |

Range `0 … −6` mm. Each needs a marker. Malleoli are prompted at Orient (M2 / M3), same landmarks as Design.

## 4. Rules (replace ±20° rotations and boolean Remove Cast)

| Control | Default | Range | Notes |
|---------|---------|-------|-------|
| Remove Cast `c_cast` | 0 | −10…+10 | warn `> +3` or `< −5` |
| Shin `c_shin` | 0 | −6…+4 | |
| Toe box height | 100% | 100–130% | `pct ×` max Z of the toe region |
| Sagittal (PF/DF) | 0 | −5…+10 | about malleolar axis through midpoint; warn `> +5` |
| Frontal (varus/valgus) | 0 | ±10 | axis through midpoint ⟂ malleolar & leg axes; warn `|deg| > 5` |
| Heel lift | 0 | 0–12 | |

Warp `w = 0` below malleolar midpoint `Z − 15`, `w = 1` above `Z + 25`.

**Non-blocking warnings:** trim within 20 mm geodesic of the fibular head (no marker **and** trim top `> C+250` → `place fibular head marker`); wall `< 2 mm` (hard min **1.2**); DF `> 5` **and** heel lift `> 8`; insensate active.

## 5. Acceptance tests

Two generated fixtures with ground-truth markers + a hand crest (no patient scans).

| Id | Rule |
|----|------|
| a | `c_cast=+10`, `c_shin=+4`: vertices with `B ≥ 0.5` have inward disp `≤ +0.05` |
| b | Crest within 5 mm over 90% of the hand crest; low-confidence blocks Cast |
| c | T-core offset `= c ± 0.3`; outside T+feather inward disp `≤ +0.05` when `c > 0` |
| d | Relief at marker `r ± 0.2`; beyond core+feather `|d| ≤ 0.1`; monotone; two overlapping −3 → −3 ± 0.2 |
| e | `max ‖∇c‖ ≤ 0.7` at all extremes |
| f | Defaults: only malleolar regions move `> 0.05` vs `c = 0` baseline |
| g | Table `c_cast ∈ {−10,0,10} × c_shin ∈ {−6,0,4} ×` insensate vs formula `± 0.3` |
| h | Insensate: zero shrink, reliefs applied |
| i | Malleoli move `≤ 0.01` under sagittal; frontal orthogonality `≤ 0.1°`; clamps |
| j | Toe box height `± 0.5` mm |
| k | Warnings fire at exact thresholds, both sides |
| l | Earlier AFO gates + insole regression + frozen hashes pass |
