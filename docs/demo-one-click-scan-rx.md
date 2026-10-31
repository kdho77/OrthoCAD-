# One-click scan + Rx — demo script

Representative flows validated in automated tests (`generateOrthoticFromScanAndRx.test.ts`) using synthetic plantar scans (no PHI).

## Fixture A — Left foot, neutral Rx

1. Clinical workflow → **Scan** step.
2. Import side **Left**; approve keep-set if prompted.
3. Leave Rx empty (defaults: round walls after generate, Medium width class, stock posting).
4. **Generate Orthotic** — auto M1/M2/M3/ARCH from suggest, size from length, arch from marker/gap-fit.
5. Review summary warnings; open **Corrections** / **Export** as usual.

## Fixture B — Right foot with text Rx

Rx textarea example:

```text
Right: 4 deg rearfoot varus, medial heel skive 4 mm
```

Expect rearfoot wedge + skive on **right** corrections only (verify in Corrections panel).

## Fixture C — Bilateral pair

Import **Pair** (two files). Generate once; each foot uses its assigned side and independent correction patches when unlinked.

## Validation evidence

- Unit tests: medial/lateral landmark ordering, Rx side isolation, determinism (double-run hash of corrections JSON).
- Regression: default design with **no scans** unchanged (corrections snapshot test).
- Manual: viewer overlay scan + generated insole; ARCH/M1 medial on both feet in L/R imports.

## Not covered in v1

Clinical accuracy vs physical reference scans, AI image Rx without server, per-foot different US sizes on one design record.
