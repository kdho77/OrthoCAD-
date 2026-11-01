# One-click scan + Rx validation report

**Branch:** `feature/one-click-scan-rx-generation` (PR #234)
**Scope:** Automated engineering validation only — not clinical fit, comfort, or dispensing sign-off.

## Baseline STL parity (unchanged default design)

| Item | Value |
|------|--------|
| Main pin commit | `53ebd8e5` |
| Export settings | SAMPLE_Top procedural wall, `straight`, manufacturing STL, mesh closed after the loft |
| US men's 9 | Left and right SHA-256 **unchanged** from the pin (`6c67e279…` / `cd57887c…`) |
| US men's 8 / 10 / 11 | Distinct hashes. XY scale is applied to the **closed** solid (`layout.scale` vs Men's 9). The loft and seam close still run on the native sheet. |
| Left length (maxX − minX) | US 8 **264.3 mm**, US 9 **273.1 mm**, US 10 **281.9 mm**, US 11 **290.7 mm** (US 8 / US 9 = 30/31) |

Shoe-size scale does not run when one-click is unused and the design is Men's 9. The viewer procedural preview is still the native sheet.

## What the Default.glb scan fits

The previous −8 mm arch was not a 1.5 mm clearance constant. The fixture ARCH sat on the B1–B3 chord (Z ≈ 3.2 mm) while the stock top at that XY is the dome (Z ≈ 12.0 mm). `fitArchParamsFromApexMarker` reported that gap, and the heel-width sample was a 10 mm landmark patch against a 67 mm shell, which clamped `heelCupWidthMm` to −10.

The Default.glb scan arch is now seated on the stock medial top (same rigid offset Kabsch removes). Heel-cup fits from a scan heel under 35 mm, or under half the shell heel, are not applied.

`one-click-e2e-clinical-match.test.ts` (production `matchClinicalParamsFromRegisteredScanAuto`, no injected seam):

| Correction | Result |
|------------|--------|
| Left `archHeightMm` | **0.9** (gate ±1 mm) |
| Left `apexMoveMm` | **2.9** (rigid fit onto the sized frame; not a second dome) |
| Left `heelCupWidthMm` | **0** |
| Right arch / skive | **0** (feet are unlinked; nothing is copied) |

## Generation export (gen.design, no template fallback)

Prescription: `Left medial heel skive 4mm rearfoot 4 deg varus`.

The manufacturing STL is `gen.design` itself. Kirby skive is applied on the procedural top (it used to be omitted because `includeSkives` stays false inside the analytic delta). Varus is a **medial** rearfoot wedge.

| Metric | Value |
|--------|--------|
| Left medial skive | **4 mm** |
| Left rearfoot wedge | **medial 4°** (varus) |
| Right skive / wedge / arch | **0** — right STL SHA-256 matches the default right export |
| Left medial / lateral heel top-quartile Z vs default | **+3.53 mm** / **+0.58 mm** |
| Right shell, same 4 mm skive + 4° medial wedge | Medial **+3.46 mm**, lateral **+0.57 mm** (medialSign +Y) |
| Arch apex | Left Y **−37.2** (medial −Y), right Y **+36.3** (medial +Y) |
| Left bbox | X −0.7→272.4, Y −46.3→46.4, Z 0→28.8 |
| Right bbox | X −0.7→272.4, Y −46.3→46.3, Z 0→25.2 |

S1-B / S1-PRELOFT completed on this design (those gates throw inside the loft; the export returned). There is no silent fallback to a skive-only template. `assertClosedSolidAcceptable` is stubbed in this harness the same way as the baseline parity test. Trimesh on the written STLs: watertight, one body.

**Artifacts** (after `tests/one-click-export-artifacts.test.ts`):

- `/opt/cursor/artifacts/one-click/` and `/tmp/one-click-artifacts/`
  - `generated-left.stl`, `generated-right.stl`
  - `generated-left-top.png`, `generated-right-top.png`
  - `generated-left-medial.png`, `generated-right-medial.png`
  - `validation-metrics.json`

## Still untested / known gaps

- Clinical wear, patient sign-off, and printer/material validation
- The 0.9 mm arch and 2.9 mm apex are registration residual of this fixture, not a claim that every scan of the stock shell lands on exactly 0
- Medial-heel raise is about the 4 mm skive (measured +3.5 mm on the upper quartile), not a point sample at the Kirby one-third line
- Bilateral different US sizes on one design row
- External vendor foot scans (in-repo Default.glb + synthetic fixtures only)
- OCCT authoritative kernel (CI forces the preview / mesh-close path)
- Full `npm test` wall time is the PR CI job (`trimesh` + `scipy` for `tests/helpers/stl-gates.py`)
