# Thickness-mode gate results

Base `268aac85847160b5b2703a05688721ea4cb93b24`. Candidate `3dd73e97bdcfe0cefeac531ace243f7c46c9ab14` (PR #403).

Proof failures: 0. Threshold is zero proof failures before the grade is trusted.

## Proofs

| Proof | Kind | Gate | Wanted | Gate result | Proof | Measured |
| --- | --- | --- | --- | --- | --- | --- |
| noop-on-base | noop | G-ONE | FAIL | FAIL | PASS | mode=zonal thicknessMm=3 left=3 right=3 |
| noop-on-base | noop | G-MUST-OMIT | PASS | PASS | PASS | mode=zonal thicknessMm=2 left=2 right=2 hashEq=true |
| noop-on-base | noop | G-MUST-ZONAL | PASS | PASS | PASS | omittedWalls=3,2.5,2,12 thickWalls=3,2.5,2,12 baseWalls=3,2.5,2,12 omittedMode=zonal |
| noop-on-base | noop | G-R1 | PASS | PASS | PASS | surfaceOrSeamFiles=none |
| noop-on-base | noop | G-R2 | PASS | PASS | PASS | surfaceOrSeamFiles=none textSurface=bottom |
| noop-on-base | noop | G-R3 | PASS | PASS | PASS | outOfAllow=none guardCount=2 readPathGuardCount=0 loftForefootBand=true |
| noop-on-base | noop | G-R4 | PASS | PASS | PASS | asset=sample-top source=stock glb=Templates/SAMPLE_Top.glb method=printing_solid elements=0 |
| noop-on-base | noop | G-R5 | PASS | PASS | PASS | surface=bottom mode=engrave nameFlag=true engraveFiles=none |
| noop-on-base | noop | G-R6 | PASS | PASS | PASS | forbiddenPaths=none |
| noop-on-base | noop | G-R7 | PASS | PASS | PASS | emptyCatalogHashEq=true archHighHashEq=true |
| spec-uniform-copy | noop | G-ONE | PASS | PASS | PASS | mode=uniform thicknessMm=3 left=3 right=3 |
| noop-on-spec-uniform | noop | G-ONE | PASS | PASS | PASS | mode=uniform thicknessMm=3 left=3 right=3 |
| bad-force-zonal | bad | G-ONE | FAIL | FAIL | PASS | mode=zonal thicknessMm=3 left=3 right=3 |
| bad-omit-thickness | bad | G-MUST-OMIT | FAIL | FAIL | PASS | mode=zonal thicknessMm=7 left=7 right=7 hashEq=false |
| bad-omit-thickness | bad | G-R7 | FAIL | FAIL | PASS | emptyCatalogHashEq=false archHighHashEq=false |
| bad-zonal-wall | bad | G-MUST-ZONAL | FAIL | FAIL | PASS | omittedWalls=3,2.5,2,12 thickWalls=9,2.5,2,12 baseWalls=3,2.5,2,12 omittedMode=zonal |
| bad-stock-mesh | bad | G-R4 | FAIL | FAIL | PASS | asset=not-sample-top source=stock glb=Templates/SAMPLE_Top.glb method=printing_solid elements=0 |
| bad-text-surface | bad | G-R2 | FAIL | FAIL | PASS | surfaceOrSeamFiles=none textSurface=wall |
| bad-text-surface | bad | G-R5 | FAIL | FAIL | PASS | surface=wall mode=emboss nameFlag=true engraveFiles=none |
| bad-delete-forefoot-band | bad | G-R3 | FAIL | FAIL | PASS | outOfAllow=none guardCount=2 readPathGuardCount=0 loftForefootBand=false |
| bad-seam-file | bad | G-R1 | FAIL | FAIL | PASS | surfaceOrSeamFiles=vertex/src/lib/geometry/procedural-wall/ring-seam.ts |
| bad-seam-file | bad | G-R2 | FAIL | FAIL | PASS | surfaceOrSeamFiles=vertex/src/lib/geometry/procedural-wall/ring-seam.ts textSurface=bottom |
| bad-guard-file | bad | G-R3 | FAIL | FAIL | PASS | outOfAllow=vertex/src/features/exports/saved-design-finalized-mesh.ts guardCount=2 readPathGuardCount=0 loftForefootBand=true |
| bad-forbidden-path | bad | G-R6 | FAIL | FAIL | PASS | forbiddenPaths=vertex-api/railway.toml |
| noop-empty-diff | noop | G-R1 | PASS | PASS | PASS | surfaceOrSeamFiles=none |
| noop-empty-diff | noop | G-R2 | PASS | PASS | PASS | surfaceOrSeamFiles=none textSurface=bottom |
| noop-empty-diff | noop | G-R3 | PASS | PASS | PASS | outOfAllow=none guardCount=2 readPathGuardCount=0 loftForefootBand=true |
| noop-empty-diff | noop | G-R6 | PASS | PASS | PASS | forbiddenPaths=none |
| noop-existing-omit-test | noop | G-TESTS | PASS | PASS | PASS | exit=0 |
| bad-omit-breaks-existing-test | bad | G-TESTS | FAIL | FAIL | PASS | exit=1 |

## Grade

| Tree | Gate | Rule | Result | Measured | Threshold |
| --- | --- | --- | --- | --- | --- |
| base | G-ONE | ONE | FAIL | mode=zonal thicknessMm=3 left=3 right=3 | round-trip shellThicknessMode=uniform, thicknessMm=3, leftThicknessMm=3, rightThicknessMm=3 |
| base | G-MUST-OMIT | MUST-MATCH | PASS | mode=zonal thicknessMm=2 left=2 right=2 hashEq=true | omitted thicknessMm=2, shellThicknessMode=zonal, both sides 2, settings hash equal to base |
| base | G-MUST-ZONAL | MUST-MATCH | PASS | omittedWalls=3,2.5,2,12 thickWalls=3,2.5,2,12 baseWalls=3,2.5,2,12 omittedMode=zonal | zonal rf/mf/ff/blend unchanged by thickness_mm and equal to base; omitted mode stays zonal |
| base | G-R1 | R1 | PASS | surfaceOrSeamFiles=none | zero changed files matching seam, slicer, layer-change, or surface-quality paths |
| base | G-R2 | R2 | PASS | surfaceOrSeamFiles=none textSurface=bottom | zero seam/layer/slicer file edits, and text marking surface stays bottom |
| base | G-R3 | R3 | PASS | outOfAllow=none guardCount=2 readPathGuardCount=0 loftForefootBand=true | diff only snapshot writer plus existing thickness tests; manufacturing guard count stays 2 because get_design_params does not call it; loft forefoot 0.9–1.1 band stays |
| base | G-R4 | R4 | PASS | asset=sample-top source=stock glb=Templates/SAMPLE_Top.glb method=printing_solid elements=0 | SAMPLE_Top stock asset sample-top, Templates/SAMPLE_Top.glb, printing_solid, no elements |
| base | G-R5 | R5 | PASS | surface=bottom mode=engrave nameFlag=true engraveFiles=none | bottom engrave textMarking unchanged, no new engraving files |
| base | G-R6 | R6 | PASS | forbiddenPaths=none | diff does not touch railway, vertex-web, vertex-api, printers, or deploy paths |
| base | G-R7 | R7 | PASS | emptyCatalogHashEq=true archHighHashEq=true | SAMPLE_Top with no thickness_mm, and a non-thickness catalog, hash-equal to base |
| candidate | G-ONE | ONE | PASS | mode=uniform thicknessMm=3 left=3 right=3 | round-trip shellThicknessMode=uniform, thicknessMm=3, leftThicknessMm=3, rightThicknessMm=3 |
| candidate | G-MUST-OMIT | MUST-MATCH | PASS | mode=zonal thicknessMm=2 left=2 right=2 hashEq=true | omitted thicknessMm=2, shellThicknessMode=zonal, both sides 2, settings hash equal to base |
| candidate | G-MUST-ZONAL | MUST-MATCH | PASS | omittedWalls=3,2.5,2,12 thickWalls=3,2.5,2,12 baseWalls=3,2.5,2,12 omittedMode=zonal | zonal rf/mf/ff/blend unchanged by thickness_mm and equal to base; omitted mode stays zonal |
| candidate | G-R1 | R1 | PASS | surfaceOrSeamFiles=none | zero changed files matching seam, slicer, layer-change, or surface-quality paths |
| candidate | G-R2 | R2 | PASS | surfaceOrSeamFiles=none textSurface=bottom | zero seam/layer/slicer file edits, and text marking surface stays bottom |
| candidate | G-R3 | R3 | FAIL | outOfAllow=vertex/src/features/exports/saved-design-finalized-mesh.ts guardCount=0 readPathGuardCount=0 loftForefootBand=false | diff only snapshot writer plus existing thickness tests; manufacturing guard count stays 2 because get_design_params does not call it; loft forefoot 0.9–1.1 band stays |
| candidate | G-R4 | R4 | PASS | asset=sample-top source=stock glb=Templates/SAMPLE_Top.glb method=printing_solid elements=0 | SAMPLE_Top stock asset sample-top, Templates/SAMPLE_Top.glb, printing_solid, no elements |
| candidate | G-R5 | R5 | PASS | surface=bottom mode=engrave nameFlag=true engraveFiles=none | bottom engrave textMarking unchanged, no new engraving files |
| candidate | G-R6 | R6 | PASS | forbiddenPaths=none | diff does not touch railway, vertex-web, vertex-api, printers, or deploy paths |
| candidate | G-R7 | R7 | PASS | emptyCatalogHashEq=true archHighHashEq=true | SAMPLE_Top with no thickness_mm, and a non-thickness catalog, hash-equal to base |
| base | G-TESTS | TESTS | PASS | exit=0 signal none | existing thickness tests exit 0 |
| candidate | G-TESTS | TESTS | PASS | exit=0 signal none | existing thickness tests exit 0 |

## Existing tests

| Tree | Result | Exit | Summary |
| --- | --- | --- | --- |
| base | PASS | 0 | signal none |
| candidate | PASS | 0 | signal none |

## Direct retest of the five existing files

The frozen runner records exit codes. Its summary matcher looks for a `Test Files` / `Tests ` line, and rstest 0.10 prints a JSON report instead, so the grade rows say `signal none` next to exit 0.

A direct rerun of the same five files on the candidate worktree (`rstest run` in `/tmp/tm-gates-candidate`, cwd confirmed in the report) measured `passedTests=41`, `failedTests=0`, `testFiles=5`, `durationMs.total=153798`, exit 0. The new readback tests are in that run: `create_saved_design thickness_mm 3 stores uniform shell for get_design_params` and `thickness_mm 3 matches get_design_params shell mode and both feet`.

## Scope note

G-R3 fails when `saved-design-finalized-mesh.ts` drops `assertSolidManufacturingShellThickness` while `get_design_params` never calls that guard (`readPathGuardCount` 0). That removal is not required for the readback defect. It is a scope-growth question for Kendon: the guard refused uniform non-default thickness on solid and milling loft.
