# CNC millSide server parameter fix — gate results

Independent grade of worker draft PR #404. Gates were frozen in `6f9608bf` before this file. Product code was not modified. Neither PR is merged.

## SHAs

| Role | SHA |
| --- | --- |
| BASE (main) | `4a6c76f2e8acf7b62506090b96164dc74ca4e7ba` |
| Candidate (PR #404 head) | `7dca75075c1e4ddd6cab2c1bc1be37d3f5380c1e` |
| Frozen gates | `6f9608bf3998eea9609e71c3c84f8a8503ead875` |
| Worker merge-base | `268aac85847160b5b2703a05688721ea4cb93b24` |

## Commands

BASE no-op proof (same gate source later committed as `6f9608bf`):

```text
vertex/node_modules/.bin/tsx --tsconfig vertex/tsconfig.json validation/mill_side_server_gates/gates.ts prove-noop
```

Exit 0. `proofs/noop.json` records `ok: true`. Every `defect_*` gate failed. Every `keep_*` gate passed. Existing file `vertex/server/src/lib/cnc-mill-gcode.test.ts`: exit 0, 3 passed, 0 failed.

Bad-change proof, a temporary detached worktree of BASE with a deliberately broken copy (not committed as product code):

```text
vertex/node_modules/.bin/tsx --tsconfig vertex/tsconfig.json validation/mill_side_server_gates/gates.ts prove-bad
```

Exit 0. `proofs/bad.json` records `ok: true`. All 29 gates failed. Existing tests on that copy: exit 1, 2 failed, 1 passed.

Candidate grade, after the freeze commit, `GATE_REPO` set to a detached worktree of `7dca75075c1e4ddd6cab2c1bc1be37d3f5380c1e`:

```text
GATE_REPO=/tmp/mill-candidate GATE_BASELINE=validation/mill_side_server_gates/baseline.frozen.json \
  vertex/node_modules/.bin/tsx --tsconfig /tmp/mill-candidate/vertex/tsconfig.json \
  validation/mill_side_server_gates/gates.ts grade
```

Exit 0. All 29 gates passed. Existing tests: exit 0, 5 passed, 0 failed.

## How the numbers were measured

Fixture: two-foot `milling_3axis` design, US men size 9, SAMPLE_Top (`assetId` `sample-top`), thickness 4.0 mm on both feet, design id `11111111-1111-4111-8111-111111111111`, filename material `EVA Milled`. On this stock, internal-right is internal side `left` and internal-left is internal side `right`.

The server path is the live `generateCncGcode` zod input, plus `prepareHeadlessMillDesign` / `buildHeadlessMillCncGcode` / `cncPairGcodeFilename` called with `millSide` only when `runCadOperatorCncGcodeRequest` passes `args.input.millSide`. Browser bytes are `buildMillCncGcode` with that `millSide`. LR bytes, filename suffix, and idempotency key are compared to the baseline captured on BASE.

## BASE (main) — defect present

| Gate | Result | Measured | Threshold |
| --- | --- | --- | --- |
| defect_zod_rr | FAIL | `null` (stripped) | `RR` |
| defect_zod_ll | FAIL | `null` (stripped) | `LL` |
| defect_zod_rejects_rx | FAIL | `false` (unknown key stripped) | throw |
| keep_zod_lr_omitted | PASS | omitted `null`, LR `null` | `undefined` or `LR` |
| defect_wiring | FAIL | prepare/filename/build all `false` | all `true` |
| defect_sides_rr | FAIL | `["left","right"]` | `["left","left"]` (internal-right twice) |
| defect_sides_ll | FAIL | `["left","right"]` | `["right","right"]` (internal-left twice) |
| defect_filename_rr | FAIL | `_EVA_LR.gcode` | `_EVA_RR.gcode` |
| defect_filename_ll | FAIL | `_EVA_LR.gcode` | `_EVA_LL.gcode` |
| defect_idempotency_rr | FAIL | RR key equals LR key | RR key differs from LR and from main |
| defect_idempotency_ll | FAIL | LL key equals LR and RR | LL key differs from both |
| defect_gcode_rr | FAIL | server sha256 `4f23cf6efcf29e358b8d730cf907fdc4d875b9db27cc0ad23949fcf5d993f4b6` (1,643,392 bytes) vs browser `fbb9eb5f34f8cccd255f8701d98f3ee03ebdd957d9353f386e0f574c34744bb3` (1,643,617 bytes) | equal sha256 and byte length |
| defect_gcode_ll | FAIL | server same LR hash vs browser `40152b8e67e4fd43ec2f634220fcc8d8b2c0adb400a5a54ee7bab1a6ef2d557d` (1,643,586 bytes) | equal sha256 and byte length |
| keep_lr_sides | PASS | omitted and LR `["left","right"]` | `["left","right"]` |
| keep_lr_filename | PASS | `_EVA_LR.gcode` | `_EVA_LR.gcode` |
| keep_lr_idempotency | PASS | `cadop:v1:11111111-1111-4111-8111-111111111111:pair:vertex-lab-idaho-one-side:e67c91518c8a8687947c13b0e70dbb4671b8dc3e03ecf6e6b4fbaa2219aa9ef3` | same key |
| keep_lr_gcode | PASS | sha256 `4f23cf6efcf29e358b8d730cf907fdc4d875b9db27cc0ad23949fcf5d993f4b6`, 1,643,392 bytes | same |
| keep_profile_r6 | PASS | Idaho `spiral`, stepover ball 1.4 mm / flat 3 mm, layered 15 mm, 10 mm ball at 24,000 rpm, top feeds 3500/36000/3500/2500, bottom feeds 3500/24000/3500/2500 | same snapshot |
| keep_normalize_mill_side | PASS | RR/LL/LR/omit/RX = RR/LL/LR/LR/LR | same |
| keep_r2_thickness | PASS | left 4, right 4 | `>= 4.0` and equal to baseline |
| keep_r2_marked | PASS | left 6, right 6 | 6 and 6 |
| keep_r2_files | PASS | no thickness-file drift | empty |
| keep_r3_clearance | PASS | 1 mm, no drift | 1 mm |
| keep_r3_size15_fit | PASS | length 310.323 mm, width 113.387 mm, X margin 45.977 mm, Y margin 4.788 mm | margins `>= 0` and equal to baseline |
| keep_r4_scope | PASS | no product diff | no out-of-scope paths |
| keep_r5_phi | PASS | 0 hits | 0 |
| keep_r7_surface | PASS | no surface-file drift, LR sha256 matches | empty drift and same sha256 |
| keep_safety_guards | PASS | print refusal, uuid, rate limit, and CAD-operator credential check present | all true |
| keep_existing_tests | PASS | exit 0, 3 passed | exit 0 |

Main LR idempotency key (omitted and explicit LR): `cadop:v1:11111111-1111-4111-8111-111111111111:pair:vertex-lab-idaho-one-side:e67c91518c8a8687947c13b0e70dbb4671b8dc3e03ecf6e6b4fbaa2219aa9ef3`.

## Candidate `7dca750` — all gates pass

| Gate | Result | Measured | Threshold |
| --- | --- | --- | --- |
| defect_zod_rr | PASS | `RR` | `RR` |
| defect_zod_ll | PASS | `LL` | `LL` |
| defect_zod_rejects_rx | PASS | throws | throw |
| keep_zod_lr_omitted | PASS | LR `LR`, omitted `null` | `undefined` or `LR` |
| defect_wiring | PASS | prepare, filename, and build all pass `args.input.millSide` | all true |
| defect_sides_rr | PASS | `["left","left"]`, internal-right `left` | `["left","left"]` |
| defect_sides_ll | PASS | `["right","right"]`, internal-left `right` | `["right","right"]` |
| defect_filename_rr | PASS | `_EVA_RR.gcode` | `_EVA_RR.gcode` |
| defect_filename_ll | PASS | `_EVA_LL.gcode` | `_EVA_LL.gcode` |
| defect_idempotency_rr | PASS | RR `…242a508c51d5f4eb34dcfa4596c5c2852ee7a97722155fdf3a73b3d0d58c6760` differs from LR `…e67c9151…` | different from LR and from main |
| defect_idempotency_ll | PASS | LL `…ef212c294203559cd7a4eb88eeed473836f6835f8013e685e153368bbbfddf39` differs from LR and RR | different from both |
| defect_gcode_rr | PASS | server and browser sha256 `fbb9eb5f34f8cccd255f8701d98f3ee03ebdd957d9353f386e0f574c34744bb3`, 1,643,617 bytes | equal |
| defect_gcode_ll | PASS | server and browser sha256 `40152b8e67e4fd43ec2f634220fcc8d8b2c0adb400a5a54ee7bab1a6ef2d557d`, 1,643,586 bytes | equal |
| keep_lr_sides | PASS | omitted and LR `["left","right"]` | main pair |
| keep_lr_filename | PASS | `_EVA_LR.gcode` | `_EVA_LR.gcode` |
| keep_lr_idempotency | PASS | same key as main, `…e67c91518c8a8687947c13b0e70dbb4671b8dc3e03ecf6e6b4fbaa2219aa9ef3` | main key |
| keep_lr_gcode | PASS | sha256 `4f23cf6efcf29e358b8d730cf907fdc4d875b9db27cc0ad23949fcf5d993f4b6`, 1,643,392 bytes | main bytes |
| keep_profile_r6 | PASS | same Idaho snapshot as main (stepover ball 1.4 mm) | main snapshot |
| keep_normalize_mill_side | PASS | unchanged | RR/LL/LR/LR/LR |
| keep_r2_thickness | PASS | 4 and 4 | `>= 4.0` |
| keep_r2_marked | PASS | 6 and 6 | 6 |
| keep_r2_files | PASS | no drift | empty |
| keep_r3_clearance | PASS | 1 mm | 1 mm |
| keep_r3_size15_fit | PASS | X margin 45.977 mm, Y margin 4.788 mm | `>= 0` |
| keep_r4_scope | PASS | 7 files, all on the allowlist | no out-of-scope paths |
| keep_r5_phi | PASS | 0 name-field logs, 0 secret lines, no Railway / vertex-web / vertex-api / migration paths | 0 |
| keep_r7_surface | PASS | surface, seam, and layer-change files unchanged; LR sha256 matches main | no drift |
| keep_safety_guards | PASS | `assertMilledCncOrder` still called in prepare and build; print-order refusal string present; `designId` stays `z.string().uuid()`; rate limit and CAD-operator credential check remain | all true |
| keep_existing_tests | PASS | exit 0, 5 passed, 0 failed | exit 0 |

Full RR idempotency key: `cadop:v1:11111111-1111-4111-8111-111111111111:pair:vertex-lab-idaho-one-side:242a508c51d5f4eb34dcfa4596c5c2852ee7a97722155fdf3a73b3d0d58c6760`.

Full LL idempotency key: `cadop:v1:11111111-1111-4111-8111-111111111111:pair:vertex-lab-idaho-one-side:ef212c294203559cd7a4eb88eeed473836f6835f8013e685e153368bbbfddf39`.

Allowlist files actually changed versus the worker merge-base: `packages/mcp/src/clients/manufacturing-client.ts`, `vertex/scripts/cnc-mill-parity-check.ts`, `vertex/server/src/lib/cnc-mill-gcode.test.ts`, `vertex/server/src/lib/cnc-mill-job.d.ts`, `vertex/server/src/lib/cnc-mill-runner.ts`, `vertex/server/src/routers/cad-operator-generate.ts`, `vertex/server/src/routers/manufacturing.ts`. No other product paths. No safety guard listed above was removed.

## Verdict

PASS. The candidate wires optional `millSide` (`LR` | `RR` | `LL`) through `generateCncGcode`. RR returns two internal-right sides, filename suffix `_EVA_RR`, its own idempotency key, and G-code bytes equal to the browser build with `millSide` RR. LL matches the same contract. Omitted and LR stay byte-identical to main for G-code, filename suffix, and idempotency key. The Idaho milling profile is unchanged.

## Residuals

The candidate commit sits on `268aac85`, which is behind BASE `4a6c76f2`. LR G-code, the filename suffix, and the idempotency key still matched the BASE baseline. This gates PR and worker PR #404 stay unmerged. No deploy.

## Handoff

Candidate SHA `7dca75075c1e4ddd6cab2c1bc1be37d3f5380c1e`. Tests: `cnc-mill-gcode.test.ts` 5 passed on the candidate and 3 passed on BASE. Next step is review of the worker PR. Do not merge this gates PR.
