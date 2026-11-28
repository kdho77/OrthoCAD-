# Morton's-name gates

Independent checks for the bottom engraved name on a foot that has a Morton's extension. The thresholds in `thresholds.mjs` and the pass/fail rules in `score.mjs` are frozen before the candidate commit is measured.

`measure.optional.test.ts` only records geometry. It loads `tests/fixtures/SAMPLE_Top.glb`, lofts the stock Men's 9 solid, and calls the existing bottom `textMarking` engrave (`SAMPLE`, depth 0.6 mm, both feet). The left foot also gets one Morton's extension from `defaultElementPose` (registry height 3 mm, medial). The `.optional.test.ts` suffix keeps it out of the required unit-test shards.

```bash
GATE_OUT=validation/mortons_name_gates/out/base.json npx rstest validation/mortons_name_gates/measure.optional.test.ts
node validation/mortons_name_gates/prove.mjs --meas validation/mortons_name_gates/out/base.json
node validation/mortons_name_gates/prove.mjs --bad --meas validation/mortons_name_gates/out/base.json
```

Candidate grading uses the same frozen files against a second measurement:

```bash
node validation/mortons_name_gates/prove.mjs --grade \
  --meas validation/mortons_name_gates/out/candidate.json \
  --base validation/mortons_name_gates/out/base.json
```
