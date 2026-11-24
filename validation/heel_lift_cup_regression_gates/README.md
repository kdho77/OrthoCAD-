# Heel-lift cup-depth gates

Independent gates for the heel-lift regression. They were measured on base `8aced4b5042bdafc2d300006fa80802bca1b94b9` and then frozen. They are not edited to match a candidate.

The graded path is the production compose path: SAMPLE_Top, US men's 11, medium width, `full_contact`, `printing_solid`, round walls, `printSolidOptions` into `reconstructProceduralPreview` (`sourceField` + `composedTop`, which calls `composePrintSolidTop`).

The posterior heel seat is the lowest interior vertex of the composed top sheet with `u` in `[0.05, 0.22]` and `|v| ≤ 0.35`. On this base that vertex is at `u = 0.116`. The rim sample is the wall vertex nearest that `u`. Cup depth is rim z − seat z. Added height at the met heads is the foot-contact sample at `u = 0.75`. The print/belt face is the set of vertices with `u ≤ 0.20` and `|z| ≤ 0.02`; its minimum z has to stay at 0.

Tolerances, frozen in `thresholds.ts`:

- seat rise equals `H` or `heelLiftDeltaAt(u, H)`, ± 0.2 mm
- cup-depth change ≤ 0.2 mm
- added height at `u = 0.75` within ± 0.1 mm, and the station samples do not rise toward the toe (0.05 mm slack)
- belt minimum z within ± 0.1 mm of 0, with at least 500 vertices on that face
- `heelLiftMm = 0` STL SHA-256 equals the frozen BASE hashes
- a left-foot lift leaves the right STL on that same hash
- no product file outside this directory
- no outer-surface, seam, layer-change, slicer, or 0.5×inset S1-PRELOFT cap change

On BASE the compose path fails. Right foot, 12 mm: seat `+0.063` mm (need `10.143`), cup `+7.618` mm, and added height rises from `u = 0.15` to `u = 0.30`. The brief's neighboring floor sample (`dSeat +0.086`, `dRim +7.66`, `dCup +7.58`) is the same regression. An authoring check of `applyAnalyticTopDeltas` (not the graded path) on this same seat rose `+10.143` mm with cup change `+0.006` mm, so the thresholds are reachable by the existing full-strength lift.

Run the frozen gates:

```
node validation/heel_lift_cup_regression_gates/prove-noop.mjs
node validation/heel_lift_cup_regression_gates/prove-bad-change.mjs
npx rstest run --config validation/heel_lift_cup_regression_gates/rstest.gates.config.ts validation/heel_lift_cup_regression_gates/checker.optional.test.ts
```

Grade a candidate without editing these files:

```
node validation/heel_lift_cup_regression_gates/grade-candidate.mjs <sha>
```
