# One-click scan + Rx validation report

**Branch:** `feature/one-click-scan-rx-generation` (PR #234)
**Scope:** Automated engineering validation of Kendon's one-click recipe. Not clinical fit, comfort, or dispensing sign-off.

## Recipe

Shoe size is a required input. It scales the default SAMPLE_Top. Scan length is not a size. The scan contributes arch height only, measured as the medial midfoot height above the heel and forefoot floor.

| Measured arch | Band | Parametric `archHeightMm` |
|---------------|------|---------------------------|
| Below 23 mm | Low. Below 18 mm is still Low and is flagged for review | −3.5 |
| 23–26 mm (23 and 26 included) | Standard | 0 (default mesh) |
| Above 26 mm | High | +3 |

Flexible foot adds +4 mm to the apex control, toward the toe. A manual Rx apex adds to that and the sum is clamped to the existing control range (−12 to +12 mm), with a warning when it clamps. That policy lives only in `combineFlexibleApex`. An explicit Rx arch height replaces the scan class. A leading `+` is an explicit arch height (`arch height +2 mm`, `+2mm`, `+ 2 mm`). Other Rx items are explicit corrections, elements, and sinks. Left and right stay unlinked. An unnamed clause is not copied when both feet are present. Pathology words with no explicit correction, element, or sink call `PathologyDesigner`. The stub returns `needs_design` and does not invent millimetres. Gap-fit and registration are not on this path.

On a Standard arch the height-field bump is multiplied by an arch delta of 0, so the apex control does not move the stock crest. The needed slide is then the full 4 mm, applied by the same apex-move correction: a Z-only shift of the stock arch (`z` at `x` takes the stock `z` from `x − shift`). The shift is `apexMoveMm` only when `archHeightMm + archFillMm` is 0. That branches on the arch delta, not on the Low/Standard/High name. Low and High already recenter the bump, so their extra slide is 0 and the loft is not rewritten. The window is 0 for `u ≤ 0.15` and `u ≥ 0.46` (forefoot `u > 0.60` is inside that), and the top rim is shifted along itself so the wall column does not fold. Heel and forefoot outline XY stay put. On Default.glb the shell copies the height field onto the wall before that slide, so the wall then inherits the rim's Z change. An apex-only move (10 mm) keeps heel wall-top versus rim mismatch at 0.176 mm.

## Baseline STL parity (unchanged when one-click is unused)

| Item | Value |
|------|--------|
| Main pin commit | `53ebd8e5` |
| Export settings | SAMPLE_Top procedural wall, `straight`, manufacturing STL, mesh closed after the loft |
| US men's 9 | Left `6c67e279aa33ea15bd6ffb0c9ba8feecee907d73dfdc5eacadda24e09052df14`, right `cd57887c45189bce39b0ead2fbcc959e1bdfebe12a11256f05751ff670d76c99` |
| US men's 8 / 10 / 11 | Distinct hashes. XY scale is applied to the closed solid. The loft still runs on the native sheet. |
| Left length (maxX − minX) | US 8 **264.3 mm**, US 9 **273.1 mm**, US 10 **281.9 mm**, US 11 **290.7 mm** |

## Sample export (gen.design)

US men's 9. Both scans 24 mm (Standard). Flexible foot checked on both. No other Rx.

| Item | Result |
|------|--------|
| Class / correction | Standard, `archHeightMm` **0**, `apexMoveMm` **+4** on both feet |
| Left STL SHA-256 | `1f1f0267b68371f7bade1402392c56530bf1102df253855ed3a6d1b21ea28dd9` |
| Right STL SHA-256 | `742d5e03645de10032b991a8e9db888856f3cda9090b922c2f4806f403ecd9bd` |
| Default US 9 hashes | Still the pins above (non-flexible export unchanged) |
| Peak vs default | Left and right **+4.006 mm** in X, **0.000 mm** in Z |
| Arch apex | Left Y **−37.19** (medial −Y), right Y **+37.19** (medial +Y), Z **25.240** |
| Bbox | Z min **0**. X about −0.7→272.4. Outline XY within 0.02 mm of the default |
| Medial wall vs surface | Wall-top change minus rim change **≤ 0.007 mm** |
| Two-face fold | Straight export worst edge **58.319°**. Matrix worst **59.078°** (Low, flex off) |

Low and High with Flexible do not take this stock slide. Their solid crest X stays within 0.2 mm of the same arch without the extra warp. Across straight, round, and hybrid, Standard/Low/High, Flexible on and off, both feet: zero-area faces 0, flipped edges 0, bottom z = 0, watertight. Hybrid skips the stock crease band x 70–78 (the first stock edge sits at x 71.7, just before 72).

Trimesh on the two sample STLs: watertight, winding consistent, one body, no face under 1e-8 mm². S1 gates throw inside the loft if they fail. `assertClosedSolidAcceptable` is stubbed in this harness, the same way as the baseline parity test.

**Artifacts** (after `tests/one-click-export-artifacts.test.ts`):

- `/opt/cursor/artifacts/one-click/` and `/tmp/one-click-artifacts/`
  - `generated-left.stl`, `generated-right.stl`
  - `generated-left-top.png`, `generated-right-top.png`
  - `generated-left-medial.png`, `generated-right-medial.png`
  - `validation-metrics.json`

## Still untested / known gaps

- Clinical wear, patient sign-off, and printer/material validation
- Bilateral different US sizes on one design row
- External vendor foot scans (synthetic arch-height grids in the recipe tests)
- The pathology result is a stub. No biomechanics model is called
- OCCT authoritative kernel (this harness forces the preview / mesh-close path)
- Low/High + Flexible byte hashes were not frozen against the pre-warp commit. The stock slide is skipped when the arch delta is non-zero, so that loft is the previous analytic path
- Founder confirmation of additive Flexible + manual apex is still open. Change only `combineFlexibleApex`
