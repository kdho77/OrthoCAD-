# Pair-run transaction timeout and wait_s gates

Frozen independent gates for the pair-run Prisma interactive-transaction timeout and `get_production` `wait_s`. These scripts, `base-byte-manifest.json`, `proofs/noop-base.txt`, and `proofs/bad-change.txt` are frozen before the candidate is graded. Do not edit them after the freeze commit.

`RESULTS.md` and `RULE-COMPLIANCE.md` are the grade record written after the frozen gates run. They are not part of the gate logic.

## What is checked

| Gate | Pass condition |
| --- | --- |
| A | A both-feet `executeCadOperatorProduction` whose loft stub blocks the event loop for 6000 ms (more than 5 s) leaves both feet `succeeded`, with no `Manufacturing timed out (left\|right)` and no `Transaction already closed`. The loft stub must not observe an open interactive `$transaction`. Uploaded G-code bytes and STL keys stay equal to the fixed fixture. The real loft and slicer are not called. |
| B | `get_production` `wait_s` > 0 long-polls until `succeeded` or `failed` or the deadline. Omitted or `0` is one fetch. The cap is 300 (`301` and `-1` are rejected). The advertised JSON schema and the hosted bundle schema include `wait_s` as a number with minimum 0 and maximum 300, and it is not required. |
| C | A fixed tetrahedron fixture's binary STL and FDM G-code bytes, the coupon STL, `SKEW_INSET_RATIO` (the 0.5× inset cap), and the geometry / kiri / cnc source hashes match the recorded BASE `8aced4b5042bdafc2d300006fa80802bca1b94b9`. |
| D | GitHub check runs for the graded SHA are completed and each conclusion is `success` or `skipped`, with at least one `success`. |

Hosted `/api/mcp` `maxDuration` of 60 s is reported and is not a pass/fail check. A `wait_s` of 300 can still be cut off on that HTTP route. Stdio is not under that cap.

## Run

From the repository root, with `tsx`, `zod`, `@prisma/client`, `@trpc/server`, `@vercel/functions`, and `three` installed, and the Prisma client generated:

```bash
node validation/cadop_txn_timeout_wait_s_gates/run-gates.mjs
```

Grade another checkout without editing these files:

```bash
ORTHOCAD_ROOT=/path/to/checkout node validation/cadop_txn_timeout_wait_s_gates/run-gates.mjs
```

`ORTHOCAD_ROOT` defaults to this repository. Gate D reads that checkout's `HEAD` unless `GATE_SHA` is set.

The no-op proof is this command on BASE `8aced4b5042bdafc2d300006fa80802bca1b94b9`. The suite exits non-zero there. The bad-change proof is:

```bash
node validation/cadop_txn_timeout_wait_s_gates/prove-bad-change.mjs
```

That proof rejects long work inside a 5 s interactive transaction, a `get_production` handler that does not long-poll, a dropped advertised `wait_s` field, and an STL or G-code byte change.
