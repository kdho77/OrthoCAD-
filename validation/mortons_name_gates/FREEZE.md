# Freeze

Gates in `thresholds.mjs` and `score.mjs` were written against BASE `268aac85847160b5b2703a05688721ea4cb93b24` and are not edited after this commit.

BASE measurement (`out/base.json`), taken on that commit before any candidate checkout:

- Stock left, no text: the engraved floor is absent. STL sha256 begins `4c0e3fa85750`.
- Stock left and right with bottom engrave `SAMPLE`: floor area 455.494 mm² and 455.490 mm², letter span about 70.2 mm by 12.6 mm, axis within 0.2° of +X. The export kept the text.
- Left Morton's extension, bottom engrave: text was dropped. Floor area 0 mm². Triangle count 76926, identical to the same foot with no text.
- Pad plateau (median cell raise above stock, cells over 1.5 mm) is 3.000 mm. Raised-cell mean Y is -35.039 mm (left medial).

`prove.mjs` on that file: detector, other-foot, element, R1–R7 pass. G-DEFECT fails, which is the bug on BASE. A synthetic copy that keeps the stock floor passes G-DEFECT. Every deliberate bad copy fails its gate (`out/bad.json`).

CI run 45258603564 on `60817d43` failed every unit shard before any test ran: `Count mismatch: unit tests 370, manifest 369`, missing `validation/mortons_name_gates/measure.test.ts`. The recorder was renamed to `measure.optional.test.ts`, which `scripts/ci/list-unit-test-files.mjs` and `rstest.config.ts` already skip. `thresholds.mjs` and `score.mjs` were not edited.
