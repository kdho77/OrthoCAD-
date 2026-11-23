# Sink-depth gates

Frozen before the candidate was graded. Product code was not modified. Gate sources were not edited after the candidate run.

**Candidate verdict: FAIL.** 119/120 gates pass on base `268aac85` and 119/120 pass on candidate `b7e09d62`. The same gate fails on both, with the same measured floor.

`G-FLOOR-MPJ1` min remaining thickness is **0.302 mm** (threshold 0.85–1.15 mm). Low-shell median is 1.000 mm (n 300), which is inside the band. The candidate does not move the thin spot. `G-FLOOR-MPJ5` passes: min 0.875 mm on base, 0.976 mm on the candidate; low-shell median 1.000 mm both.

The production observation (design b2d48d94, order c813e723: mpj5 median 0.69 mm, min 0.04 mm, ring 2.99 mm; design 30266822 mpj1 0.77–1.3 mm) is not in this repo. These gates measure the stock left SAMPLE_Top export, round wall, uniform 3 mm. On that shape mpj5 is already inside 1.0 ± 0.15 mm. The stock failure is the mpj1 minimum, 0.302 mm versus ≥ 0.85 mm.

- Base product SHA: `268aac85847160b5b2703a05688721ea4cb93b24`
- Candidate SHA: `b7e09d62208d1a40011f3a4ab1f7ecc215c70c08` (worker draft PR #401, worktree HEAD)
- Design id b2d48d94, order id c813e723. Design id 30266822. No patient names.

## Floor thickness

Remaining material under the plateau (vertical gap from the sunk top to the next surface). Target 1.0 ± 0.15 mm.

| Sink | Tree | min mm | low-shell median | overall median | drop median | drop max | ring Δ | unsunk median | n | verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| mpj5 d2 | base | 0.875 | 1.000 | 1.000 | 1.357 | 1.992 | 0.109 | 2.357 | 332 | PASS |
| mpj1 d2 | base | 0.302 | 1.000 | 1.498 | 2.000 | 2.000 | 0.061 | 3.406 | 751 | FAIL |
| mpj2 d3 | base | 1.000 | 1.000 | 1.000 | 2.682 | 3.000 | 0.103 | 3.682 | 418 | PASS |
| mpj3 d1 | base | 1.813 | 1.994 | 2.523 | 1.000 | 1.000 | 0.043 | 3.522 | 367 | PASS |
| mpj4 d2 | base | 1.000 | 1.000 | 1.042 | 1.945 | 2.000 | 0.090 | 3.023 | 331 | PASS |
| styloid d2 | base | 3.397 | n/a | 4.543 | 2.000 | 2.000 | 0.044 | 6.543 | 309 | PASS |
| rkw d2 | base | 1.000 | 1.000 | 1.494 | 1.998 | 2.000 | 0.044 | 3.493 | 1016 | PASS |
| mpj5 d2 | candidate | 0.976 | 1.000 | 1.000 | 1.356 | 1.992 | 0.109 | 2.357 | 333 | PASS |
| mpj1 d2 | candidate | 0.302 | 1.000 | 1.498 | 2.000 | 2.000 | 0.061 | 3.406 | 751 | FAIL |
| mpj2 d3 | candidate | 1.000 | 1.000 | 1.000 | 2.682 | 3.000 | 0.103 | 3.682 | 418 | PASS |
| mpj3 d1 | candidate | 1.813 | 1.994 | 2.523 | 1.000 | 1.000 | 0.043 | 3.522 | 367 | PASS |
| mpj4 d2 | candidate | 1.000 | 1.000 | 1.042 | 1.945 | 2.000 | 0.090 | 3.023 | 331 | PASS |
| styloid d2 | candidate | 3.397 | n/a | 4.543 | 2.000 | 2.000 | 0.044 | 6.543 | 309 | PASS |
| rkw d2 | candidate | 1.000 | 1.000 | 1.494 | 1.998 | 2.000 | 0.044 | 3.493 | 1016 | PASS |

## Hashes

| Mesh | Base | Candidate | Match |
| --- | --- | --- | --- |
| default no-sink | `fe88d0a938c0b009b15964b5cb5f606b1326bcbc1740c9d51d48c932ee9a5600` | `fe88d0a938c0b009b15964b5cb5f606b1326bcbc1740c9d51d48c932ee9a5600` | yes |
| uniform 3 mm no-sink | `1e75979e06a5f33d9c5c7511c2c60c64406e76256e230e43982041fd8276d2f0` | `1e75979e06a5f33d9c5c7511c2c60c64406e76256e230e43982041fd8276d2f0` | yes |

## Gates

| Id | Rule | Base | Candidate | Candidate measured | Threshold |
| --- | --- | --- | --- | --- | --- |
| `G-R1-FILES` | R1 | PASS | PASS | (none) | no path matching seam, slicer, vertexslice, kiri, or layer-change |
| `G-R2-FILES` | R2 | PASS | PASS | (none) | seam and slicer paths unchanged (seams stay on the plantar face; this diff must not move them) |
| `G-R3-SCOPE` | R3 | PASS | PASS | (none) | every path contains 'sink' or is ci/unit-test-shards.json |
| `G-ONE-FILES` | ONE | PASS | PASS | 4 file(s); out of scope: (none) | sink-depth files only |
| `G-R4-MESH` | R4 | PASS | PASS | (none) | SAMPLE_Top.glb, Default.glb, and other stock/stl meshes unchanged |
| `G-R5-TEXT` | R5 | PASS | PASS | (none) | text-marking paths unchanged |
| `G-R6-DEPLOY` | R6 | PASS | PASS | (none) | no railway, vertex-web, vertex-api, deploy, or workflow path |
| `G-R7-DEFAULT` | R7 | PASS | PASS | fe88d0a938c0b009b15964b5cb5f606b1326bcbc1740c9d51d48c932ee9a5600 | sha256 fe88d0a938c0b009b15964b5cb5f606b1326bcbc1740c9d51d48c932ee9a5600 |
| `G-R7-UNIFORM3` | R7 | PASS | PASS | 1e75979e06a5f33d9c5c7511c2c60c64406e76256e230e43982041fd8276d2f0 | sha256 1e75979e06a5f33d9c5c7511c2c60c64406e76256e230e43982041fd8276d2f0 |
| `G-FLOOR-MPJ5` | TESTS | PASS | PASS | min 0.976 mm, low-shell median 1.000 mm (n 332), overall median 1.000 mm, plateau n 333, ray misses 0 | min and low-shell median in 0.85..1.15 mm; low-shell n >= 20; miss fraction <= 0.1 |
| `G-RING-MPJ5` | MUST-MATCH | PASS | PASS | ring median 2.920 mm, \|change\| 0.109 mm, n 55 | \|sunk − unsunk\| median <= 0.15 mm, n >= 8 |
| `G-NOT-DEEPER-MPJ5` | MUST-MATCH | PASS | PASS | plateau drop max 1.992 mm, median 1.356 mm | max drop <= depth 2 + 0.15 mm |
| `G-BELT-MPJ5` | R2 | PASS | PASS | plantar move 0.000 mm | <= 0.02 mm |
| `G-XY-MPJ5` | R1 | PASS | PASS | top XY move 0.000 mm | <= 0.02 mm |
| `G-FLOOR-MPJ1` | TESTS | FAIL | FAIL | min 0.302 mm, low-shell median 1.000 mm (n 300), overall median 1.498 mm, plateau n 751, ray misses 7 | min and low-shell median in 0.85..1.15 mm; low-shell n >= 20; miss fraction <= 0.1 |
| `G-RING-MPJ1` | MUST-MATCH | PASS | PASS | ring median 3.796 mm, \|change\| 0.061 mm, n 101 | \|sunk − unsunk\| median <= 0.15 mm, n >= 8 |
| `G-NOT-DEEPER-MPJ1` | MUST-MATCH | PASS | PASS | plateau drop max 2.000 mm, median 2.000 mm | max drop <= depth 2 + 0.15 mm |
| `G-BELT-MPJ1` | R2 | PASS | PASS | plantar move 0.000 mm | <= 0.02 mm |
| `G-XY-MPJ1` | R1 | PASS | PASS | top XY move 0.000 mm | <= 0.02 mm |
| `G-EXACT-MPJ2-D3` | MUST-MATCH | PASS | PASS | roomy drop median 3.000 mm (n 143), plateau max 3.000 mm, plateau median 2.682 mm | where unsunk shell >= depth + 1, median drop in 2.85..3.15 mm; max drop <= 3.15 mm; n >= 8 |
| `G-EXACT-MPJ3-D1` | MUST-MATCH | PASS | PASS | roomy drop median 1.000 mm (n 366), plateau max 1.000 mm, plateau median 1.000 mm | where unsunk shell >= depth + 1, median drop in 0.85..1.15 mm; max drop <= 1.15 mm; n >= 8 |
| `G-EXACT-MPJ4-D2` | MUST-MATCH | PASS | PASS | roomy drop median 2.000 mm (n 184), plateau max 2.000 mm, plateau median 1.945 mm | where unsunk shell >= depth + 1, median drop in 1.85..2.15 mm; max drop <= 2.15 mm; n >= 8 |
| `G-EXACT-STYLOID-D2` | MUST-MATCH | PASS | PASS | roomy drop median 2.000 mm (n 308), plateau max 2.000 mm, plateau median 2.000 mm | where unsunk shell >= depth + 1, median drop in 1.85..2.15 mm; max drop <= 2.15 mm; n >= 8 |
| `G-EXACT-RKW-D2` | MUST-MATCH | PASS | PASS | roomy drop median 2.000 mm (n 676), plateau max 2.000 mm, plateau median 1.998 mm | where unsunk shell >= depth + 1, median drop in 1.85..2.15 mm; max drop <= 2.15 mm; n >= 8 |
| `G-FLAT-EXACT-MPJ1-D1-S3` | MUST-MATCH | PASS | PASS | removed median 1.000 min 0.999 max 1.000 mm, n 284 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ1-D1-S3` | TESTS | PASS | PASS | remain min 2.000 median 2.000 mm, n 308 | min and median in 1.85..2.15 mm |
| `G-FLAT-EXACT-MPJ1-D1-S6` | MUST-MATCH | PASS | PASS | removed median 1.000 min 0.999 max 1.000 mm, n 284 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ1-D1-S6` | TESTS | PASS | PASS | remain min 5.000 median 5.000 mm, n 308 | min and median in 4.85..5.15 mm |
| `G-FLAT-EXACT-MPJ1-D2-S3` | TESTS | PASS | PASS | removed median 2.000 min 1.998 max 2.000 mm, n 284 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ1-D2-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 308 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-MPJ1-D2-S6` | TESTS | PASS | PASS | removed median 2.000 min 1.998 max 2.000 mm, n 284 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ1-D2-S6` | TESTS | PASS | PASS | remain min 4.000 median 4.000 mm, n 308 | min and median in 3.85..4.15 mm |
| `G-FLAT-EXACT-MPJ1-D3-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 2.000 max 2.000 mm, n 284 | median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ1-D3-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 308 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-MPJ1-D3-S6` | MUST-MATCH | PASS | PASS | removed median 3.000 min 2.997 max 3.000 mm, n 284 | median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ1-D3-S6` | TESTS | PASS | PASS | remain min 3.000 median 3.000 mm, n 308 | min and median in 2.85..3.15 mm |
| `G-FLAT-EXACT-MPJ1-D4-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 2.000 max 2.000 mm, n 284 | median and min within 0.05 mm of 2.00 (min of depth 4 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ1-D4-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 308 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-MPJ1-D4-S6` | MUST-MATCH | PASS | PASS | removed median 4.000 min 3.997 max 4.000 mm, n 284 | median and min within 0.05 mm of 4.00 (min of depth 4 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ1-D4-S6` | TESTS | PASS | PASS | remain min 2.000 median 2.000 mm, n 308 | min and median in 1.85..2.15 mm |
| `G-FLAT-EXACT-MPJ2-D1-S3` | MUST-MATCH | PASS | PASS | removed median 1.000 min 1.000 max 1.000 mm, n 156 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ2-D1-S3` | TESTS | PASS | PASS | remain min 2.000 median 2.000 mm, n 171 | min and median in 1.85..2.15 mm |
| `G-FLAT-EXACT-MPJ2-D1-S6` | MUST-MATCH | PASS | PASS | removed median 1.000 min 1.000 max 1.000 mm, n 156 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ2-D1-S6` | TESTS | PASS | PASS | remain min 5.000 median 5.000 mm, n 171 | min and median in 4.85..5.15 mm |
| `G-FLAT-EXACT-MPJ2-D2-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 1.999 max 2.000 mm, n 156 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ2-D2-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 171 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-MPJ2-D2-S6` | MUST-MATCH | PASS | PASS | removed median 2.000 min 1.999 max 2.000 mm, n 156 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ2-D2-S6` | TESTS | PASS | PASS | remain min 4.000 median 4.000 mm, n 171 | min and median in 3.85..4.15 mm |
| `G-FLAT-EXACT-MPJ2-D3-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 2.000 max 2.000 mm, n 156 | median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ2-D3-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 171 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-MPJ2-D3-S6` | MUST-MATCH | PASS | PASS | removed median 3.000 min 2.999 max 3.000 mm, n 156 | median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ2-D3-S6` | TESTS | PASS | PASS | remain min 3.000 median 3.000 mm, n 171 | min and median in 2.85..3.15 mm |
| `G-FLAT-EXACT-MPJ3-D1-S3` | MUST-MATCH | PASS | PASS | removed median 1.000 min 0.999 max 1.000 mm, n 137 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ3-D1-S3` | TESTS | PASS | PASS | remain min 2.000 median 2.000 mm, n 150 | min and median in 1.85..2.15 mm |
| `G-FLAT-EXACT-MPJ3-D1-S6` | MUST-MATCH | PASS | PASS | removed median 1.000 min 0.999 max 1.000 mm, n 137 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ3-D1-S6` | TESTS | PASS | PASS | remain min 5.000 median 5.000 mm, n 150 | min and median in 4.85..5.15 mm |
| `G-FLAT-EXACT-MPJ3-D2-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 1.998 max 2.000 mm, n 137 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ3-D2-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 150 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-MPJ3-D2-S6` | MUST-MATCH | PASS | PASS | removed median 2.000 min 1.998 max 2.000 mm, n 137 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ3-D2-S6` | TESTS | PASS | PASS | remain min 4.000 median 4.000 mm, n 150 | min and median in 3.85..4.15 mm |
| `G-FLAT-EXACT-MPJ3-D3-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 2.000 max 2.000 mm, n 137 | median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ3-D3-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 150 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-MPJ3-D3-S6` | MUST-MATCH | PASS | PASS | removed median 3.000 min 2.997 max 3.000 mm, n 137 | median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ3-D3-S6` | TESTS | PASS | PASS | remain min 3.000 median 3.000 mm, n 150 | min and median in 2.85..3.15 mm |
| `G-FLAT-EXACT-MPJ4-D1-S3` | MUST-MATCH | PASS | PASS | removed median 1.000 min 0.999 max 1.000 mm, n 124 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ4-D1-S3` | TESTS | PASS | PASS | remain min 2.000 median 2.000 mm, n 131 | min and median in 1.85..2.15 mm |
| `G-FLAT-EXACT-MPJ4-D1-S6` | MUST-MATCH | PASS | PASS | removed median 1.000 min 0.999 max 1.000 mm, n 124 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ4-D1-S6` | TESTS | PASS | PASS | remain min 5.000 median 5.000 mm, n 131 | min and median in 4.85..5.15 mm |
| `G-FLAT-EXACT-MPJ4-D2-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 1.999 max 2.000 mm, n 124 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ4-D2-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 131 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-MPJ4-D2-S6` | MUST-MATCH | PASS | PASS | removed median 2.000 min 1.999 max 2.000 mm, n 124 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ4-D2-S6` | TESTS | PASS | PASS | remain min 4.000 median 4.000 mm, n 131 | min and median in 3.85..4.15 mm |
| `G-FLAT-EXACT-MPJ4-D3-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 2.000 max 2.000 mm, n 124 | median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ4-D3-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 131 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-MPJ4-D3-S6` | MUST-MATCH | PASS | PASS | removed median 3.000 min 2.998 max 3.000 mm, n 124 | median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ4-D3-S6` | TESTS | PASS | PASS | remain min 3.000 median 3.000 mm, n 131 | min and median in 2.85..3.15 mm |
| `G-FLAT-EXACT-MPJ5-D1-S3` | MUST-MATCH | PASS | PASS | removed median 1.000 min 0.999 max 1.000 mm, n 127 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ5-D1-S3` | TESTS | PASS | PASS | remain min 2.000 median 2.000 mm, n 136 | min and median in 1.85..2.15 mm |
| `G-FLAT-EXACT-MPJ5-D1-S6` | MUST-MATCH | PASS | PASS | removed median 1.000 min 0.999 max 1.000 mm, n 127 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ5-D1-S6` | TESTS | PASS | PASS | remain min 5.000 median 5.000 mm, n 136 | min and median in 4.85..5.15 mm |
| `G-FLAT-EXACT-MPJ5-D2-S3` | TESTS | PASS | PASS | removed median 2.000 min 1.998 max 2.000 mm, n 127 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ5-D2-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 136 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-MPJ5-D2-S6` | TESTS | PASS | PASS | removed median 2.000 min 1.998 max 2.000 mm, n 127 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ5-D2-S6` | TESTS | PASS | PASS | remain min 4.000 median 4.000 mm, n 136 | min and median in 3.85..4.15 mm |
| `G-FLAT-EXACT-MPJ5-D3-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 2.000 max 2.000 mm, n 127 | median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ5-D3-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 136 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-MPJ5-D3-S6` | MUST-MATCH | PASS | PASS | removed median 3.000 min 2.997 max 3.000 mm, n 127 | median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ5-D3-S6` | TESTS | PASS | PASS | remain min 3.000 median 3.000 mm, n 136 | min and median in 2.85..3.15 mm |
| `G-FLAT-EXACT-MPJ5-D4-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 2.000 max 2.000 mm, n 127 | median and min within 0.05 mm of 2.00 (min of depth 4 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ5-D4-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 136 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-MPJ5-D4-S6` | MUST-MATCH | PASS | PASS | removed median 4.000 min 3.997 max 4.000 mm, n 127 | median and min within 0.05 mm of 4.00 (min of depth 4 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-MPJ5-D4-S6` | TESTS | PASS | PASS | remain min 2.000 median 2.000 mm, n 136 | min and median in 1.85..2.15 mm |
| `G-FLAT-EXACT-RKW-D1-S3` | MUST-MATCH | PASS | PASS | removed median 1.000 min 0.999 max 1.000 mm, n 383 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-RKW-D1-S3` | TESTS | PASS | PASS | remain min 2.000 median 2.000 mm, n 464 | min and median in 1.85..2.15 mm |
| `G-FLAT-EXACT-RKW-D1-S6` | MUST-MATCH | PASS | PASS | removed median 1.000 min 0.999 max 1.000 mm, n 383 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-RKW-D1-S6` | TESTS | PASS | PASS | remain min 5.000 median 5.000 mm, n 464 | min and median in 4.85..5.15 mm |
| `G-FLAT-EXACT-RKW-D2-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 1.998 max 2.000 mm, n 383 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-RKW-D2-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 464 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-RKW-D2-S6` | MUST-MATCH | PASS | PASS | removed median 2.000 min 1.998 max 2.000 mm, n 383 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-RKW-D2-S6` | TESTS | PASS | PASS | remain min 4.000 median 4.000 mm, n 464 | min and median in 3.85..4.15 mm |
| `G-FLAT-EXACT-RKW-D3-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 2.000 max 2.000 mm, n 383 | median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-RKW-D3-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 464 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-RKW-D3-S6` | MUST-MATCH | PASS | PASS | removed median 3.000 min 2.997 max 3.000 mm, n 383 | median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-RKW-D3-S6` | TESTS | PASS | PASS | remain min 3.000 median 3.000 mm, n 464 | min and median in 2.85..3.15 mm |
| `G-FLAT-EXACT-RKW-D4-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 2.000 max 2.000 mm, n 383 | median and min within 0.05 mm of 2.00 (min of depth 4 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-RKW-D4-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 464 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-RKW-D4-S6` | MUST-MATCH | PASS | PASS | removed median 4.000 min 3.996 max 4.000 mm, n 383 | median and min within 0.05 mm of 4.00 (min of depth 4 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-RKW-D4-S6` | TESTS | PASS | PASS | remain min 2.000 median 2.000 mm, n 464 | min and median in 1.85..2.15 mm |
| `G-FLAT-EXACT-STYLOID-D1-S3` | MUST-MATCH | PASS | PASS | removed median 1.000 min 0.999 max 1.000 mm, n 107 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-STYLOID-D1-S3` | TESTS | PASS | PASS | remain min 2.000 median 2.000 mm, n 122 | min and median in 1.85..2.15 mm |
| `G-FLAT-EXACT-STYLOID-D1-S6` | MUST-MATCH | PASS | PASS | removed median 1.000 min 0.999 max 1.000 mm, n 107 | median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-STYLOID-D1-S6` | TESTS | PASS | PASS | remain min 5.000 median 5.000 mm, n 122 | min and median in 4.85..5.15 mm |
| `G-FLAT-EXACT-STYLOID-D2-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 1.999 max 2.000 mm, n 107 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-STYLOID-D2-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 122 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-STYLOID-D2-S6` | MUST-MATCH | PASS | PASS | removed median 2.000 min 1.999 max 2.000 mm, n 107 | median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-STYLOID-D2-S6` | TESTS | PASS | PASS | remain min 4.000 median 4.000 mm, n 122 | min and median in 3.85..4.15 mm |
| `G-FLAT-EXACT-STYLOID-D3-S3` | MUST-MATCH | PASS | PASS | removed median 2.000 min 2.000 max 2.000 mm, n 107 | median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-STYLOID-D3-S3` | TESTS | PASS | PASS | remain min 1.000 median 1.000 mm, n 122 | min and median in 0.85..1.15 mm |
| `G-FLAT-EXACT-STYLOID-D3-S6` | MUST-MATCH | PASS | PASS | removed median 3.000 min 2.998 max 3.000 mm, n 107 | median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05 |
| `G-FLAT-FLOOR-STYLOID-D3-S6` | TESTS | PASS | PASS | remain min 3.000 median 3.000 mm, n 122 | min and median in 2.85..3.15 mm |

## Proofs

No-op proofs must pass. Bad-change proofs pass only when the gate itself fails.

| Id | Base | Candidate |
| --- | --- | --- |
| `PROOF-NOOP-MESH-MPJ5` | PASS | PASS |
| `PROOF-BAD-MESH-MPJ5` | PASS | PASS |

## Rule compliance

Graded on the candidate. A rule passes only when every gate tagged with that rule passes.

### R1: PASS

> R1 (2026-11-20 12:59 PM MT): print surface quality is locked permanently. Never let any agent or change put seams or layer changes on the top surface or sides, and never touch surface quality.

PASS `G-R1-FILES` measured (none) ; threshold no path matching seam, slicer, vertexslice, kiri, or layer-change<br>PASS `G-XY-MPJ5` measured top XY move 0.000 mm ; threshold <= 0.02 mm<br>PASS `G-XY-MPJ1` measured top XY move 0.000 mm ; threshold <= 0.02 mm

### R2: PASS

> R2 (2026-11-20 11:38 AM MT): seams and layer changes must always be on the bottom (plantar/belt face).

PASS `G-R2-FILES` measured (none) ; threshold seam and slicer paths unchanged (seams stay on the plantar face; this diff must not move them)<br>PASS `G-BELT-MPJ5` measured plantar move 0.000 mm ; threshold <= 0.02 mm<br>PASS `G-BELT-MPJ1` measured plantar move 0.000 mm ; threshold <= 0.02 mm

### R3: PASS

> R3 (2026-11-21 8:41-8:45 PM MT): slicer and geometry briefs must not grow scope. Solve only the defect Kendon has observed; anything else comes to him as a question first. Copy known methods rather than inventing new constructions.

PASS `G-R3-SCOPE` measured (none) ; threshold every path contains 'sink' or is ci/unit-test-shards.json

### R4: PASS

> R4 (2026-11-05): Production designs start from the approved SAMPLE_Top stock mesh at the order's size/width; corrections apply through the existing parametric corrections, elements and sinks; do not invent values or a new mesh.

PASS `G-R4-MESH` measured (none) ; threshold SAMPLE_Top.glb, Default.glb, and other stock/stl meshes unchanged

### R5: PASS

> R5 (2026-11-05): every printed device has the patient name on the bottom via the existing textMarking field (bottom surface, engrave mode so the sole stays flat); no new engraving system.

PASS `G-R5-TEXT` measured (none) ; threshold text-marking paths unchanged

### R6: PASS

> R6 Security: never print secrets (filter output through grep -v -i "api_key\|token\|bearer"); no PHI (use only design/order ids, never patient names); never touch Railway vertex-web/vertex-api or PR #310; no push or merge to main; no deploy.

PASS `G-R6-DEPLOY` measured (none) ; threshold no railway, vertex-web, vertex-api, deploy, or workflow path

### R7: PASS

> R7: designs and exports not affected by your defect must produce identical output to current main (prove with a before/after comparison on at least the SAMPLE_Top stock design with no corrections).

PASS `G-R7-DEFAULT` measured fe88d0a938c0b009b15964b5cb5f606b1326bcbc1740c9d51d48c932ee9a5600 ; threshold sha256 fe88d0a938c0b009b15964b5cb5f606b1326bcbc1740c9d51d48c932ee9a5600<br>PASS `G-R7-UNIFORM3` measured 1e75979e06a5f33d9c5c7511c2c60c64406e76256e230e43982041fd8276d2f0 ; threshold sha256 1e75979e06a5f33d9c5c7511c2c60c64406e76256e230e43982041fd8276d2f0

### PUSH: FAIL

> PUSH: new branch cursor/sink-depth-gates-1123 (from BASE) -> ONE draft PR "[GATES ONLY - DO NOT MERGE] sink-depth gates". Never push to the worker branch; never push/merge main, deploy, Railway (never touch vertex-web / vertex-api or #310), printers, production orders.

`cursor/sink-depth-gates-1123` is on the remote at `4f8ce17139ee12ee1ca2269e5fd67c5373b3cf39`. Draft PR #414 has the required title and is not merged. Its head is `cursor/independent-grader-frozen-gates-for-sink-depth-worker-pr-401-8f25` at that same commit, because the pull-request tool only opens the session branch. The worker branch was not pushed. Main was not pushed. Railway, vertex-web, vertex-api, and PR #310 were not touched.

### FILES: PASS

> FILES: validation/sink_depth_gates/** only (new); read-only everything else - do not modify product code or the worker's tests.

`git diff --name-only 268aac85847160b5b2703a05688721ea4cb93b24` lists only `validation/sink_depth_gates/`. Product code and the worker's tests were not edited. The candidate was graded from a detached worktree.

### MUST-MATCH: PASS

> MUST-MATCH: sinks of other depths/positions remove exactly depthMm; every non-sink design unchanged.

PASS `G-RING-MPJ5` measured ring median 2.920 mm, |change| 0.109 mm, n 55 ; threshold |sunk − unsunk| median <= 0.15 mm, n >= 8<br>PASS `G-NOT-DEEPER-MPJ5` measured plateau drop max 1.992 mm, median 1.356 mm ; threshold max drop <= depth 2 + 0.15 mm<br>PASS `G-RING-MPJ1` measured ring median 3.796 mm, |change| 0.061 mm, n 101 ; threshold |sunk − unsunk| median <= 0.15 mm, n >= 8<br>PASS `G-NOT-DEEPER-MPJ1` measured plateau drop max 2.000 mm, median 2.000 mm ; threshold max drop <= depth 2 + 0.15 mm<br>PASS `G-EXACT-MPJ2-D3` measured roomy drop median 3.000 mm (n 143), plateau max 3.000 mm, plateau median 2.682 mm ; threshold where unsunk shell >= depth + 1, median drop in 2.85..3.15 mm; max drop <= 3.15 mm; n >= 8<br>PASS `G-EXACT-MPJ3-D1` measured roomy drop median 1.000 mm (n 366), plateau max 1.000 mm, plateau median 1.000 mm ; threshold where unsunk shell >= depth + 1, median drop in 0.85..1.15 mm; max drop <= 1.15 mm; n >= 8<br>PASS `G-EXACT-MPJ4-D2` measured roomy drop median 2.000 mm (n 184), plateau max 2.000 mm, plateau median 1.945 mm ; threshold where unsunk shell >= depth + 1, median drop in 1.85..2.15 mm; max drop <= 2.15 mm; n >= 8<br>PASS `G-EXACT-STYLOID-D2` measured roomy drop median 2.000 mm (n 308), plateau max 2.000 mm, plateau median 2.000 mm ; threshold where unsunk shell >= depth + 1, median drop in 1.85..2.15 mm; max drop <= 2.15 mm; n >= 8<br>PASS `G-EXACT-RKW-D2` measured roomy drop median 2.000 mm (n 676), plateau max 2.000 mm, plateau median 1.998 mm ; threshold where unsunk shell >= depth + 1, median drop in 1.85..2.15 mm; max drop <= 2.15 mm; n >= 8<br>PASS `G-FLAT-EXACT-MPJ1-D1-S3` measured removed median 1.000 min 0.999 max 1.000 mm, n 284 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ1-D1-S6` measured removed median 1.000 min 0.999 max 1.000 mm, n 284 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ1-D3-S3` measured removed median 2.000 min 2.000 max 2.000 mm, n 284 ; threshold median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ1-D3-S6` measured removed median 3.000 min 2.997 max 3.000 mm, n 284 ; threshold median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ1-D4-S3` measured removed median 2.000 min 2.000 max 2.000 mm, n 284 ; threshold median and min within 0.05 mm of 2.00 (min of depth 4 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ1-D4-S6` measured removed median 4.000 min 3.997 max 4.000 mm, n 284 ; threshold median and min within 0.05 mm of 4.00 (min of depth 4 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ2-D1-S3` measured removed median 1.000 min 1.000 max 1.000 mm, n 156 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ2-D1-S6` measured removed median 1.000 min 1.000 max 1.000 mm, n 156 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ2-D2-S3` measured removed median 2.000 min 1.999 max 2.000 mm, n 156 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ2-D2-S6` measured removed median 2.000 min 1.999 max 2.000 mm, n 156 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ2-D3-S3` measured removed median 2.000 min 2.000 max 2.000 mm, n 156 ; threshold median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ2-D3-S6` measured removed median 3.000 min 2.999 max 3.000 mm, n 156 ; threshold median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ3-D1-S3` measured removed median 1.000 min 0.999 max 1.000 mm, n 137 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ3-D1-S6` measured removed median 1.000 min 0.999 max 1.000 mm, n 137 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ3-D2-S3` measured removed median 2.000 min 1.998 max 2.000 mm, n 137 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ3-D2-S6` measured removed median 2.000 min 1.998 max 2.000 mm, n 137 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ3-D3-S3` measured removed median 2.000 min 2.000 max 2.000 mm, n 137 ; threshold median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ3-D3-S6` measured removed median 3.000 min 2.997 max 3.000 mm, n 137 ; threshold median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ4-D1-S3` measured removed median 1.000 min 0.999 max 1.000 mm, n 124 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ4-D1-S6` measured removed median 1.000 min 0.999 max 1.000 mm, n 124 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ4-D2-S3` measured removed median 2.000 min 1.999 max 2.000 mm, n 124 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ4-D2-S6` measured removed median 2.000 min 1.999 max 2.000 mm, n 124 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ4-D3-S3` measured removed median 2.000 min 2.000 max 2.000 mm, n 124 ; threshold median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ4-D3-S6` measured removed median 3.000 min 2.998 max 3.000 mm, n 124 ; threshold median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ5-D1-S3` measured removed median 1.000 min 0.999 max 1.000 mm, n 127 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ5-D1-S6` measured removed median 1.000 min 0.999 max 1.000 mm, n 127 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ5-D3-S3` measured removed median 2.000 min 2.000 max 2.000 mm, n 127 ; threshold median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ5-D3-S6` measured removed median 3.000 min 2.997 max 3.000 mm, n 127 ; threshold median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ5-D4-S3` measured removed median 2.000 min 2.000 max 2.000 mm, n 127 ; threshold median and min within 0.05 mm of 2.00 (min of depth 4 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-MPJ5-D4-S6` measured removed median 4.000 min 3.997 max 4.000 mm, n 127 ; threshold median and min within 0.05 mm of 4.00 (min of depth 4 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-RKW-D1-S3` measured removed median 1.000 min 0.999 max 1.000 mm, n 383 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-RKW-D1-S6` measured removed median 1.000 min 0.999 max 1.000 mm, n 383 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-RKW-D2-S3` measured removed median 2.000 min 1.998 max 2.000 mm, n 383 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-RKW-D2-S6` measured removed median 2.000 min 1.998 max 2.000 mm, n 383 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-RKW-D3-S3` measured removed median 2.000 min 2.000 max 2.000 mm, n 383 ; threshold median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-RKW-D3-S6` measured removed median 3.000 min 2.997 max 3.000 mm, n 383 ; threshold median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-RKW-D4-S3` measured removed median 2.000 min 2.000 max 2.000 mm, n 383 ; threshold median and min within 0.05 mm of 2.00 (min of depth 4 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-RKW-D4-S6` measured removed median 4.000 min 3.996 max 4.000 mm, n 383 ; threshold median and min within 0.05 mm of 4.00 (min of depth 4 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-STYLOID-D1-S3` measured removed median 1.000 min 0.999 max 1.000 mm, n 107 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-STYLOID-D1-S6` measured removed median 1.000 min 0.999 max 1.000 mm, n 107 ; threshold median and min within 0.05 mm of 1.00 (min of depth 1 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-STYLOID-D2-S3` measured removed median 2.000 min 1.999 max 2.000 mm, n 107 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-STYLOID-D2-S6` measured removed median 2.000 min 1.999 max 2.000 mm, n 107 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-STYLOID-D3-S3` measured removed median 2.000 min 2.000 max 2.000 mm, n 107 ; threshold median and min within 0.05 mm of 2.00 (min of depth 3 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-EXACT-STYLOID-D3-S6` measured removed median 3.000 min 2.998 max 3.000 mm, n 107 ; threshold median and min within 0.05 mm of 3.00 (min of depth 3 and shell 6 − 1); max <= that + 0.05

### TESTS: FAIL

> TESTS: new unit/geometry test: mpj5 and mpj1 sinks at depthMm 2 on a 3 mm uniform shell leave a floor of 1.0 mm +/-0.15 everywhere under the sink (measure min and median remaining thickness). Gates derive from this: measure remaining floor thickness under the sink on the observed design shape (mpj5 depth 2, thickness 3, and mpj1) in the export mesh; flat 3 mm shell with no wall under the pad must stay exactly depth removed.

PASS `G-FLOOR-MPJ5` measured min 0.976 mm, low-shell median 1.000 mm (n 332), overall median 1.000 mm, plateau n 333, ray misses 0 ; threshold min and low-shell median in 0.85..1.15 mm; low-shell n >= 20; miss fraction <= 0.1<br>FAIL `G-FLOOR-MPJ1` measured min 0.302 mm, low-shell median 1.000 mm (n 300), overall median 1.498 mm, plateau n 751, ray misses 7 ; threshold min and low-shell median in 0.85..1.15 mm; low-shell n >= 20; miss fraction <= 0.1<br>PASS `G-FLAT-FLOOR-MPJ1-D1-S3` measured remain min 2.000 median 2.000 mm, n 308 ; threshold min and median in 1.85..2.15 mm<br>PASS `G-FLAT-FLOOR-MPJ1-D1-S6` measured remain min 5.000 median 5.000 mm, n 308 ; threshold min and median in 4.85..5.15 mm<br>PASS `G-FLAT-EXACT-MPJ1-D2-S3` measured removed median 2.000 min 1.998 max 2.000 mm, n 284 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-FLOOR-MPJ1-D2-S3` measured remain min 1.000 median 1.000 mm, n 308 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-EXACT-MPJ1-D2-S6` measured removed median 2.000 min 1.998 max 2.000 mm, n 284 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-FLOOR-MPJ1-D2-S6` measured remain min 4.000 median 4.000 mm, n 308 ; threshold min and median in 3.85..4.15 mm<br>PASS `G-FLAT-FLOOR-MPJ1-D3-S3` measured remain min 1.000 median 1.000 mm, n 308 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-MPJ1-D3-S6` measured remain min 3.000 median 3.000 mm, n 308 ; threshold min and median in 2.85..3.15 mm<br>PASS `G-FLAT-FLOOR-MPJ1-D4-S3` measured remain min 1.000 median 1.000 mm, n 308 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-MPJ1-D4-S6` measured remain min 2.000 median 2.000 mm, n 308 ; threshold min and median in 1.85..2.15 mm<br>PASS `G-FLAT-FLOOR-MPJ2-D1-S3` measured remain min 2.000 median 2.000 mm, n 171 ; threshold min and median in 1.85..2.15 mm<br>PASS `G-FLAT-FLOOR-MPJ2-D1-S6` measured remain min 5.000 median 5.000 mm, n 171 ; threshold min and median in 4.85..5.15 mm<br>PASS `G-FLAT-FLOOR-MPJ2-D2-S3` measured remain min 1.000 median 1.000 mm, n 171 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-MPJ2-D2-S6` measured remain min 4.000 median 4.000 mm, n 171 ; threshold min and median in 3.85..4.15 mm<br>PASS `G-FLAT-FLOOR-MPJ2-D3-S3` measured remain min 1.000 median 1.000 mm, n 171 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-MPJ2-D3-S6` measured remain min 3.000 median 3.000 mm, n 171 ; threshold min and median in 2.85..3.15 mm<br>PASS `G-FLAT-FLOOR-MPJ3-D1-S3` measured remain min 2.000 median 2.000 mm, n 150 ; threshold min and median in 1.85..2.15 mm<br>PASS `G-FLAT-FLOOR-MPJ3-D1-S6` measured remain min 5.000 median 5.000 mm, n 150 ; threshold min and median in 4.85..5.15 mm<br>PASS `G-FLAT-FLOOR-MPJ3-D2-S3` measured remain min 1.000 median 1.000 mm, n 150 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-MPJ3-D2-S6` measured remain min 4.000 median 4.000 mm, n 150 ; threshold min and median in 3.85..4.15 mm<br>PASS `G-FLAT-FLOOR-MPJ3-D3-S3` measured remain min 1.000 median 1.000 mm, n 150 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-MPJ3-D3-S6` measured remain min 3.000 median 3.000 mm, n 150 ; threshold min and median in 2.85..3.15 mm<br>PASS `G-FLAT-FLOOR-MPJ4-D1-S3` measured remain min 2.000 median 2.000 mm, n 131 ; threshold min and median in 1.85..2.15 mm<br>PASS `G-FLAT-FLOOR-MPJ4-D1-S6` measured remain min 5.000 median 5.000 mm, n 131 ; threshold min and median in 4.85..5.15 mm<br>PASS `G-FLAT-FLOOR-MPJ4-D2-S3` measured remain min 1.000 median 1.000 mm, n 131 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-MPJ4-D2-S6` measured remain min 4.000 median 4.000 mm, n 131 ; threshold min and median in 3.85..4.15 mm<br>PASS `G-FLAT-FLOOR-MPJ4-D3-S3` measured remain min 1.000 median 1.000 mm, n 131 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-MPJ4-D3-S6` measured remain min 3.000 median 3.000 mm, n 131 ; threshold min and median in 2.85..3.15 mm<br>PASS `G-FLAT-FLOOR-MPJ5-D1-S3` measured remain min 2.000 median 2.000 mm, n 136 ; threshold min and median in 1.85..2.15 mm<br>PASS `G-FLAT-FLOOR-MPJ5-D1-S6` measured remain min 5.000 median 5.000 mm, n 136 ; threshold min and median in 4.85..5.15 mm<br>PASS `G-FLAT-EXACT-MPJ5-D2-S3` measured removed median 2.000 min 1.998 max 2.000 mm, n 127 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 3 − 1); max <= that + 0.05<br>PASS `G-FLAT-FLOOR-MPJ5-D2-S3` measured remain min 1.000 median 1.000 mm, n 136 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-EXACT-MPJ5-D2-S6` measured removed median 2.000 min 1.998 max 2.000 mm, n 127 ; threshold median and min within 0.05 mm of 2.00 (min of depth 2 and shell 6 − 1); max <= that + 0.05<br>PASS `G-FLAT-FLOOR-MPJ5-D2-S6` measured remain min 4.000 median 4.000 mm, n 136 ; threshold min and median in 3.85..4.15 mm<br>PASS `G-FLAT-FLOOR-MPJ5-D3-S3` measured remain min 1.000 median 1.000 mm, n 136 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-MPJ5-D3-S6` measured remain min 3.000 median 3.000 mm, n 136 ; threshold min and median in 2.85..3.15 mm<br>PASS `G-FLAT-FLOOR-MPJ5-D4-S3` measured remain min 1.000 median 1.000 mm, n 136 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-MPJ5-D4-S6` measured remain min 2.000 median 2.000 mm, n 136 ; threshold min and median in 1.85..2.15 mm<br>PASS `G-FLAT-FLOOR-RKW-D1-S3` measured remain min 2.000 median 2.000 mm, n 464 ; threshold min and median in 1.85..2.15 mm<br>PASS `G-FLAT-FLOOR-RKW-D1-S6` measured remain min 5.000 median 5.000 mm, n 464 ; threshold min and median in 4.85..5.15 mm<br>PASS `G-FLAT-FLOOR-RKW-D2-S3` measured remain min 1.000 median 1.000 mm, n 464 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-RKW-D2-S6` measured remain min 4.000 median 4.000 mm, n 464 ; threshold min and median in 3.85..4.15 mm<br>PASS `G-FLAT-FLOOR-RKW-D3-S3` measured remain min 1.000 median 1.000 mm, n 464 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-RKW-D3-S6` measured remain min 3.000 median 3.000 mm, n 464 ; threshold min and median in 2.85..3.15 mm<br>PASS `G-FLAT-FLOOR-RKW-D4-S3` measured remain min 1.000 median 1.000 mm, n 464 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-RKW-D4-S6` measured remain min 2.000 median 2.000 mm, n 464 ; threshold min and median in 1.85..2.15 mm<br>PASS `G-FLAT-FLOOR-STYLOID-D1-S3` measured remain min 2.000 median 2.000 mm, n 122 ; threshold min and median in 1.85..2.15 mm<br>PASS `G-FLAT-FLOOR-STYLOID-D1-S6` measured remain min 5.000 median 5.000 mm, n 122 ; threshold min and median in 4.85..5.15 mm<br>PASS `G-FLAT-FLOOR-STYLOID-D2-S3` measured remain min 1.000 median 1.000 mm, n 122 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-STYLOID-D2-S6` measured remain min 4.000 median 4.000 mm, n 122 ; threshold min and median in 3.85..4.15 mm<br>PASS `G-FLAT-FLOOR-STYLOID-D3-S3` measured remain min 1.000 median 1.000 mm, n 122 ; threshold min and median in 0.85..1.15 mm<br>PASS `G-FLAT-FLOOR-STYLOID-D3-S6` measured remain min 3.000 median 3.000 mm, n 122 ; threshold min and median in 2.85..3.15 mm

### ONE: PASS

> ONE: Independent grade of worker PR #401. Make a sink remove exactly its configured depth. Observed: design b2d48d94 (order c813e723), mpj5 sink depthMm 2, thickness_mm 3.

PASS `G-ONE-FILES` measured 4 file(s); out of scope: (none) ; threshold sink-depth files only

### CAP: PASS

> CAP: 0/3

Gate sources were frozen in `95b7a13e` before the candidate measurement and were not edited afterward. This file is the results record. No retune of thresholds (0 revisions after seeing the candidate).

## Commands

Base grade, from `/agent/repos/OrthoCAD-` at the freeze:

```
SINK_GATE_LIVE=1 SINK_GATE_LABEL=base \
  SINK_GATE_SHA=268aac85847160b5b2703a05688721ea4cb93b24 \
  SINK_GATE_DIFF_BASE=268aac85847160b5b2703a05688721ea4cb93b24 \
  SINK_GATE_DIFF_HEAD=268aac85847160b5b2703a05688721ea4cb93b24 \
  SINK_GATE_OUT=/tmp/sink-depth-gates-base.json \
  npx rstest validation/sink_depth_gates/run.test.ts -t "export grade"
```

Candidate grade, cwd `/tmp/sink-candidate` (detached HEAD `b7e09d62208d1a40011f3a4ab1f7ecc215c70c08`). `git diff` of the raw candidate SHA fails in this partial clone, so the frozen diff interface was given `HEAD`, which is that commit:

```
SINK_GATE_LIVE=1 SINK_GATE_LABEL=candidate \
  SINK_GATE_DIFF_BASE=268aac85847160b5b2703a05688721ea4cb93b24 \
  SINK_GATE_DIFF_HEAD=HEAD \
  SINK_GATE_OUT=/tmp/sink-depth-gates-candidate.json \
  npx rstest validation/sink_depth_gates/run.test.ts -t "export grade"
```

Instrument (no-op and bad-change proofs) on the freeze tree, and again on the candidate worktree. The candidate run exited 0 (3 passed, the live grade skipped): synthetic proofs, the real flat cut, and the deliberately deeper copy.

```
npx rstest validation/sink_depth_gates/run.test.ts -t instrument
```
