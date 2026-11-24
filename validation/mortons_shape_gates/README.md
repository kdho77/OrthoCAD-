# Morton's shape gates

Frozen measurement of the Morton's extension shape. These files were written and
the no-op proof was run on main `4a6c76f2e8acf7b62506090b96164dc74ca4e7ba`
before the candidate SHA was graded. Do not edit the gate code after that
proof. `RESULTS.md` is the grading record and is the only file added afterwards.

Thresholds are in `measure.ts`. The clinical line is in `anatomy.ts` (stock
outline copied from that main commit, sink centers MPJ1 u=0.665 v=0.145 and
MPJ2 u=0.685 v=0.365). No hallux cleft is registered, so the line is parallel
to the medial border from the 1st MPJ to u=0.97.

Default `rstest` run is the no-op proof: the shape-defect gates fail on this
checkout, and the gates that already hold (G7, G8 at 3 mm, G11, planform bytes,
SAMPLE_Top hash, STL pins) pass. `MORTONS_GATE_MODE=grade` records the same
measurements without requiring the defect to remain.

Recorded no-op numbers are in `proofs/noop-main.json` and `proofs/noop-stl.json`.
A deliberately broken synthetic copy is asserted in `gates.test.ts`.
