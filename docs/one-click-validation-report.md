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

Flexible foot sets `apexMoveMm` to +4. In the height field that is 4 mm toward the toe (`apexCenter = 0.42 + apexMoveMm / length`). An explicit Rx arch or apex replaces the class or the checkbox. Other Rx items are explicit corrections, elements, and sinks. Left and right stay unlinked. An unnamed clause is not copied when both feet are present. Pathology words with no explicit correction, element, or sink call `PathologyDesigner`. The stub returns `needs_design` and does not invent millimetres. Gap-fit and registration are not on this path.

## Baseline STL parity (unchanged when one-click is unused)

| Item | Value |
|------|--------|
| Main pin commit | `53ebd8e5` |
| Export settings | SAMPLE_Top procedural wall, `straight`, manufacturing STL, mesh closed after the loft |
| US men's 9 | Left `6c67e279aa33ea15bd6ffb0c9ba8feecee907d73dfdc5eacadda24e09052df14`, right `cd57887c45189bce39b0ead2fbcc959e1bdfebe12a11256f05751ff670d76c99` |
| US men's 8 / 10 / 11 | Distinct hashes. XY scale is applied to the closed solid. The loft still runs on the native sheet. |
| Left length (maxX − minX) | US 8 **264.3 mm**, US 9 **273.1 mm**, US 10 **281.9 mm**, US 11 **290.7 mm** |

## Sample export (gen.design)

US men's 9. Left scan arch 20 mm, Flexible foot checked. Right scan arch 24 mm, not flexible. No other Rx.

| Item | Result |
|------|--------|
| Left class / correction | Low, `archHeightMm` **−3.5**, `apexMoveMm` **+4** |
| Right class / correction | Standard, arch **0**, apex **0** |
| Left STL SHA-256 | `14b8136885be58d973c5edfffd72f93edeacdd14ae1fd6e4b2a917b8d85e5f40` (differs from the default left) |
| Right STL SHA-256 | `cd57887c…` — **byte-identical** to the default right US men's 9 export |
| Arch apex side | Left Y **−36.3** (medial −Y), right Y **+36.3** (medial +Y) |
| Left / right bbox | X −0.7→272.4, Y −46.4→46.4, Z 0→**22.8** / X −0.7→272.4, Y −46.3→46.3, Z 0→**25.2** |
| Manufactured length | maxX − minX ≈ **273.1 mm** on both shells |

The height-field tests hold the exact deltas: Low and High are −3.5 mm and +3 mm versus the default at the apex station, and the flexible apex station is 4 mm anterior. On the closed left STL the medial crest inside x 85–145 dropped **2.63 mm** (Z 25.24 → 22.61) and sits on the heel edge of that window (x 85.3 versus 89.3). Sampling the medial top ±4 mm from the default crest, the toe-side station dropped **2.79 mm** and the heel-side station **2.55 mm**. That crest is the rim of a lowered dome, so it is not a second measurement of the parametric −3.5 mm.

S1-B / S1-PRELOFT completed (those gates throw inside the loft). `assertClosedSolidAcceptable` is stubbed in this harness, the same way as the baseline parity test. Trimesh: both STLs watertight, one body (left 37 954 vertices, right 37 428).

**Artifacts** (after `tests/one-click-export-artifacts.test.ts`):

- `/opt/cursor/artifacts/one-click/` and `/tmp/one-click-artifacts/`
  - `generated-left.stl`, `generated-right.stl`
  - `generated-left-top.png`, `generated-right-top.png`
  - `generated-left-medial.png`, `generated-right-medial.png`
  - `validation-metrics.json`

## Still untested / known gaps

- Clinical wear, patient sign-off, and printer/material validation
- The STL crest drop (about 2.6 mm) is not the parametric −3.5 mm. The −3.5 / +3 / +4 mm checks are on `heightAt`
- Bilateral different US sizes on one design row
- External vendor foot scans (synthetic arch-height grids in the recipe tests)
- The pathology result is a stub. No biomechanics model is called
- OCCT authoritative kernel (this harness forces the preview / mesh-close path)
