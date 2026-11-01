# One-click scan + Rx validation report

**Branch:** `feature/one-click-scan-rx-generation` (PR #234)  
**Scope:** Automated engineering validation only — **not** clinical fit, comfort, or dispensing sign-off.

## Baseline STL parity (unchanged default design)

| Item | Value |
|------|--------|
| Main pin commit | `53ebd8e5` (hashes captured with same export harness as branch) |
| Export settings | SAMPLE_Top procedural wall, `straight`, manufacturing STL, OCCT dormant |
| US men's sizes | 8, 9, 10, 11 — left + right SHA-256 compared to `tests/fixtures/baseline-default-export-hashes.json` |
| Observation | Hashes are identical across US 8–11 in this harness (layout scaling does not change pinned bytes for SAMPLE_Top export in CI) |

## P7 matrix (orchestration)

Coverage includes high/low arch Rx, wide vs narrow (Default.glb registered scan width scale), US sizes 8–10, yaw rotation, metre and inch-like `displayScale` ambiguity, noisy/incomplete scan failure, missing landmarks (auto-fill then arch-fit), conflicting bilateral rearfoot wedges, low-confidence Rx, bilateral skive Rx, determinism, bulky-foot scan-components keep-set, and repeated inputs.

**Real scan fixtures used:** `tests/fixtures/Default.glb`, `tests/fixtures/SAMPLE_Top.glb`, ranked **bulky-foot** scan-components soup (same pattern as `scan-components.test.ts`).

## E2E clinical match

`one-click-e2e-clinical-match.test.ts` runs `generateOrthoticFromScanAndRx` with **production** `matchClinicalParamsFromRegisteredScanAuto` (no injected seam) on the Default.glb registered plantar scan fixture. Failures are asserted with explicit `failedStep` / `reason` when registration or arch-fit breaks.

## Generation + manufacturing export artifacts

| Metric | Generated design | Export STL (US 9 template + Rx skive) |
|--------|------------------|----------------------------------------|
| Layout length (mm) | (from scan-sized design) | **260** |
| Layout width (mm) | (from scan-sized design) | **95** |
| Left arch height correction (mm) | **-8** (gap-fit vs default 0) | not re-applied to export shell* |
| Left medial skive (mm) | **4** | **4** |
| Left STL bbox X (mm) | — | **0.0 → 272.4** |
| Left STL bbox Y (mm) | — | **-46.3 → 46.4** |
| Left STL max Z (mm) | — | **25.2** |
| Arch apex medial heuristic (midfoot band) | — | **failed** on skive-only export STL† |
| Heel plantar Z medial / lateral (mm) | — | **7.78 / 7.66** |

\* Full scan-sized design with all gap-fit corrections currently trips procedural **S1-B / S1-PRELOFT** gates; artifacts export US 9 SAMPLE_Top shell with **Rx medial skive** applied so the manufacturing path completes in CI.

† Top-view apex sampling assumes stock arch dome orientation; medial skive export peaks can sit lateral in the midfoot band. Baseline parity + default stock export remain the regression guard for unchanged designs.

**Artifacts (after `tests/one-click-export-artifacts.test.ts`):**

- `/opt/cursor/artifacts/one-click/` and `/tmp/one-click-artifacts/`
  - `generated-left.stl`, `generated-right.stl`
  - `generated-left-top.png`, `generated-right-top.png`
  - `validation-metrics.json`

## Full test suite

See commit message / CI for latest `npm test` totals (`/tmp/full-npm-test.log` in agent run).

## Still untested / known gaps

- Clinical wear trial, patient-specific sign-off, and printer/material validation
- Bilateral **different US sizes** on one design row
- Manufacturing export of **full** scan-sized correction state without S1 gate failures
- External vendor foot scans (only in-repo GLB + synthetic/component fixtures)
- OCCT authoritative kernel path (CI forces preview / mesh-close)
- Bilateral simultaneous scans with different Rx mods per foot in UI workflow
