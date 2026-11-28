# flange-lateral-zero gates

Independent grader gates for worker PR #394. Product code is not modified in this branch.

```bash
node validation/flange_lateral_zero_gates/prove.mjs noop
node validation/flange_lateral_zero_gates/prove.mjs known-good
node validation/flange_lateral_zero_gates/prove.mjs bad
node validation/flange_lateral_zero_gates/run-gates.mjs \
  --subject /path/to/tree \
  --baseline-json /tmp/flz-probe-flz-base.json \
  --expect-head <sha> \
  --out /tmp/flz-report.json
```

`noop` must be run before `known-good` and `bad`. It writes the BASE probe used as the R7 baseline.

The runner prints one line per gate: `PASS` or `FAIL`, the gate id, and the measured value. Exit status is 1 when any selected gate fails. That non-zero status is expected for `noop`, because BASE still has the lateral-flange defect.
