# Per-side heel wedge gates

Independent gates for a production design that carries a heel wedge on one foot only. The gates were measured on base `268aac85847160b5b2703a05688721ea4cb93b24` and then frozen. They are not edited to match a candidate.

The existing heel post already lives on each foot as `rearfootWedge`. Station mode is `h = W · tan(θ)` at heel station `u = 0.15`. On a right foot the height-field medial edge is `v = -1` (mesh medial is `+Y`). A 2° post on the US men's 9 SAMPLE_Top outline is frozen in `thresholds.json`:

- heel chord 58.468 mm
- medial-edge rise 2.042 mm (`chord * tan(2°)`)
- lateral-edge field 0 mm
- medial rim vertex lift 1.843 mm at `v = -0.805`
- lateral rim vertex lift 0.207 mm at `v = 0.797` (that vertex is not the outline edge)

Field tolerance is 0.02 mm. Export-lift tolerance against those frozen lifts is 0.05 mm. Stock and bilateral design SHA-256 and STL MD5 values are the base output, compared exactly.

`rearfoot_wedge_by_side.right = { side: "medial", value: 2, unit: "deg", degree_mode: "station" }` must read back on the right only. The left wedge stays unset. Both `rearfootPostingDeg` values stay 0. `side: "varus"` is rejected. The persisted right wedge is `{ side: "medial", value: 2, unit: "deg", degreeMode: "station" }`. The right export STL matches the STL produced by setting that same existing field directly. The left export STL matches the stock left foot.

Run:

```
npx rstest run --config validation/per_side_heel_wedge_gates/rstest.config.ts
```

Proofs, on copies only:

```
node validation/per_side_heel_wedge_gates/prove.mjs pre-candidate
node validation/per_side_heel_wedge_gates/prove.mjs candidate
```
