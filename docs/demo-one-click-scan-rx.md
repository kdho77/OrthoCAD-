# One-click scan + Rx — demo script

Representative flows validated in automated tests (`generateOrthoticFromScanAndRx.test.ts`) using synthetic plantar scans (no PHI).

## Fixture A — Left foot, neutral Rx

1. Clinical workflow → **Scan** step.
2. Import side **Left**; approve keep-set if prompted.
3. Choose a shoe size. Generation stays blocked until a size is selected. Size is never taken from scan length.
4. **Generate Orthotic** — the scan sets arch class only (below 23 mm Low −3.5 mm, 23–26 mm Standard, above 26 mm High +3 mm). Check **Flexible foot** to move that foot's apex 4 mm forward. Explicit Rx corrections, elements, and sinks apply. A pathology-only note is flagged for a future design and does not guess millimetres.
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

- Unit tests: arch bands at 17.9 / 18 / 22.9 / 23 / 26 / 26.1 mm, Low −3.5 and High +3 at the apex, flexible apex +4 mm, shoe size required, L/R independence.
- Regression: default design with **no scans** unchanged (corrections snapshot test).
- Manual: viewer overlay scan + generated insole; ARCH/M1 medial on both feet in L/R imports.

## Not covered in v1

Clinical accuracy vs physical reference scans, AI image Rx without server, per-foot different US sizes on one design record.
