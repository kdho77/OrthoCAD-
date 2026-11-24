# CAD-operator VertexSlice submit-unavailable — frozen independent gates

Grades **client retry / concurrent submit** behavior for pair-run `submitVertexSliceJob` only.
Does not run live pair `generate_gcode` or production timing reruns.

## Base and candidate

- **BASE:** `cc6482be37175bd7db3c25e3179e22753e5dd899` (main)
- **Candidate:** PR #437 (`675b690033da3b6e0d6d3f04ecec63924a99ecc1` unless head moved)

## Gates (frozen)

| Gate | Requirement |
|------|-------------|
| G1 | `Promise.all` of two concurrent submits: each POST `/v1/slice/jobs` → 202; both job ids polled (GET status + result) to `succeeded` |
| G2 | Hung POST past 20s on first attempt → bounded retry; later attempt accepted (retry after >20s first-attempt failure, not a single 60s attempt only) |
| G3 | HTTP 400, 422, and 5xx from `throwSliceHttpError` — exactly one POST, no retry |
| G4 | Missed 202 on first attempt → retry → client polls **exactly one** job id to completion (measure enqueued vs polled) |
| G5 | Candidate diff vs BASE touches only allowlisted client/test files |

## Run

```bash
./validation/cadop_slice_submit_unavailable_gates/scripts/run-gates.sh
./validation/cadop_slice_submit_unavailable_gates/scripts/run-noop-proof.sh
./validation/cadop_slice_submit_unavailable_gates/scripts/run-bad-change-proof.sh
./validation/cadop_slice_submit_unavailable_gates/scripts/grade-candidate.sh
```

**Do not edit gate tests after the freeze commit.** Grade results live in `RESULTS.md` only.