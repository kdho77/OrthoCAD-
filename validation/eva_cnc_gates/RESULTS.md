# EVA CNC gates — results

Independent grade. Gates were frozen before the candidate run. This file is the measured output.

- Base SHA: `4e2e196561bada8f2a4faf4ad174a716306d8c94`
- Candidate SHA: `8e3a686926b5eee54841cd6e2a9c5df7f8e3610d`
- Graded HEAD recorded by the candidate run: `8e3a686926b5eee54841cd6e2a9c5df7f8e3610d`
- BASE own-cutout entry max: `0.01492002143408655` mm

## Proofs

Proof harness: **PASS**

| Gate | No-op on a good copy | Bad copy detected | Detail |
| --- | --- | --- | --- |
| G1 | PASS | PASS | byte copy vs one-byte-changed copy |
| G2 | PASS | PASS | safe edge 25.000 mm; broken centerline x=2 |
| G3 | PASS | PASS | safe gap 3.000 mm; broken path inside the other outline |
| G3-own | PASS | PASS | cutout tangent vs cutout through its own outline |
| G4 | PASS | PASS | slide 8.00 mm vs broken 38.00 mm |
| G5 | PASS | PASS | RR filename and physical map; broken create_saved_design side key; mirrored outline rejected |
| G6 | PASS | PASS | empty diff vs a profile.ts edit |

Live BASE Men's 9 LR (where BASE should pass):

```json
{
  "sha256": "7386ff09e8a8dc1a9be796607d26f3c3b4ce8b600108c6e86881309711ad7b8e",
  "filename": "Fixture_Sample_EVA_LR.gcode",
  "edgeClearanceMm": 1.0042,
  "minOtherGapMm": 24.242829136804087,
  "ownEntryMm": 0.01382250857245726,
  "slideMm": 0,
  "outlineLengthMm": 260,
  "placementMedianMm": 0.000024103651707597724,
  "feet": [
    {
      "slot": 0,
      "foot": "left",
      "otherGapMm": 25.17672221677235
    },
    {
      "slot": 1,
      "foot": "right",
      "otherGapMm": 24.242829136804087
    }
  ]
}
```

Deliberately broken copy of that G-code / segment list:

```json
{
  "hashChanged": true,
  "brokenEdgeMm": -5,
  "insideOtherGapMm": -44.187901649258535,
  "profileRejected": true
}
```

## Gate table

| Gate | BASE | Candidate | Threshold | Candidate measured |
| --- | --- | --- | --- | --- |
| G1 | PASS | PASS | sha256 and filename equal BASE where BASE placement passes; sha.json unchanged | sample-m9 7386ff09e8a8 Fixture_Sample_EVA_LR.gcode; sample-m12 8f6648eb17ef Fixture_Sample_EVA_LR.gcode; sample-m13 BASE refuses — not a byte-identity case; clinical-m9 7386ff09e8a8 Fixture_Sample_EVA_LR.gcode |
| G2 | FAIL | PASS | M13.5 M14 M15 produce G-code; tool sweep inside 368.3 x 260.35 with >= 1 mm edge clearance | M13.5 edge 1.005 mm; M14 edge 1.009 mm; M15 edge 1.006 mm |
| G3 | FAIL | PASS | sweep-to-other-outline >= 1 mm; own cutout entry <= BASE max 0.015 + 0.1 mm | sample-m9 [slot1:left=25.177, slot2:right=24.243] ownEntry 0.014 | sample-m12 [slot1:left=15.984, slot2:right=15.982] ownEntry 0.015 | sample-m13 [slot1:left=12.353, slot2:right=11.360] ownEntry 0.016 | clinical-m9 [slot1:left=25.177, slot2:right=24.243] ownEntry 0.014 | sample-m13.5 [slot1:left=9.311, slot2:right=9.312] ownEntry 0.015 | sample-m14 [slot1:left=6.248, slot2:right=5.309] ownEntry 0.015 | sample-m15 [slot1:left=1.051, slot2:right=1.055] ownEntry 0.016 |
| G4 | PASS | PASS | second-slot toe slide <= 30 mm | sample-m9 LR slide 0.000 mm; sample-m12 LR slide 0.000 mm; sample-m13 LR slide 0.000 mm; clinical-m9 LR slide 0.000 mm; sample-m13.5 LR slide -0.010 mm; sample-m14 LR slide 0.000 mm; sample-m15 LR slide 23.800 mm; sample-m9-RR RR slide 0.000 mm; sample-m9-LL LL slide 0.000 mm; clinical-m9-RR RR slide 0.000 mm; clinical-m9-LL LL slide 0.000 mm |
| G5 | FAIL | PASS | RR/LL mill two copies of the physical foot; filenames _EVA_RR/_EVA_LL; mill_side default LR; create_saved_design has no side parameter | omitted=LR RR=RR LL=LL RX=rejected; top-level keys stay external_order_id,manufacturing_method,client_id,catalog,patient_name,given_name,family_name |
| G6 | PASS | PASS | worker FILES allowlist only; profile.ts cutter, feeds, stepover, strategy, Z unchanged | diff inside FILES; Idaho cutter/feeds/stepover/strategy/Z unchanged |

## Commands

```bash
bash validation/eva_cnc_gates/run_gates.sh proof
bash validation/eva_cnc_gates/run_gates.sh grade-base
bash validation/eva_cnc_gates/run_gates.sh grade-candidate
bash validation/eva_cnc_gates/run_gates.sh format
```

## Per job

### BASE

| Job | Side | Refused | sha256 | Filename | Edge mm | Other gap mm | Own entry mm | Slide mm | Feet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sample-m9 | omit | no | 7386ff09e8a8 | Fixture_Sample_EVA_LR.gcode | 1.004 | 24.243 | 0.014 | 0.000 | left:25.177 right:24.243 |
| sample-m9 | LR | no | 7386ff09e8a8 | Fixture_Sample_EVA_LR.gcode | 1.004 | 24.243 | 0.014 | 0.000 | left:25.177 right:24.243 |
| sample-m12 | omit | no | 8f6648eb17ef | Fixture_Sample_EVA_LR.gcode | 1.000 | 15.982 | 0.015 | 0.000 | left:15.984 right:15.982 |
| sample-m12 | LR | no | 8f6648eb17ef | Fixture_Sample_EVA_LR.gcode | 1.000 | 15.982 | 0.015 | 0.000 | left:15.984 right:15.982 |
| sample-m13 | omit | Tool envelope does not fit pocket 2 (envelope 128.740 mm, usable 128.175 mm) |  |  |  |  |  |  |  |
| sample-m13 | LR | Tool envelope does not fit pocket 2 (envelope 128.740 mm, usable 128.175 mm) |  |  |  |  |  |  |  |
| clinical-m9 | omit | no | 7386ff09e8a8 | Fixture_Sample_EVA_LR.gcode | 1.004 | 24.243 | 0.014 | 0.000 | left:25.177 right:24.243 |
| clinical-m9 | LR | no | 7386ff09e8a8 | Fixture_Sample_EVA_LR.gcode | 1.004 | 24.243 | 0.014 | 0.000 | left:25.177 right:24.243 |
| sample-m13.5 | LR | Tool envelope does not fit pocket 2 (envelope 129.470 mm, usable 128.175 mm) |  |  |  |  |  |  |  |
| sample-m14 | LR | Tool envelope does not fit pocket 1 (envelope 131.760 mm, usable 128.175 mm) |  |  |  |  |  |  |  |
| sample-m15 | LR | Tool envelope does not fit pocket 1 (envelope 134.800 mm, usable 128.175 mm) |  |  |  |  |  |  |  |

### Candidate

| Job | Side | Refused | sha256 | Filename | Edge mm | Other gap mm | Own entry mm | Slide mm | Feet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sample-m9 | omit | no | 7386ff09e8a8 | Fixture_Sample_EVA_LR.gcode | 1.004 | 24.243 | 0.014 | 0.000 | left:25.177 right:24.243 |
| sample-m9 | LR | no | 7386ff09e8a8 | Fixture_Sample_EVA_LR.gcode | 1.004 | 24.243 | 0.014 | 0.000 | left:25.177 right:24.243 |
| sample-m12 | omit | no | 8f6648eb17ef | Fixture_Sample_EVA_LR.gcode | 1.000 | 15.982 | 0.015 | 0.000 | left:15.984 right:15.982 |
| sample-m12 | LR | no | 8f6648eb17ef | Fixture_Sample_EVA_LR.gcode | 1.000 | 15.982 | 0.015 | 0.000 | left:15.984 right:15.982 |
| sample-m13 | omit | no | a01dfdfb24aa | Fixture_Sample_EVA_LR.gcode | 1.011 | 11.360 | 0.016 | 0.000 | left:12.353 right:11.360 |
| sample-m13 | LR | no | a01dfdfb24aa | Fixture_Sample_EVA_LR.gcode | 1.011 | 11.360 | 0.016 | 0.000 | left:12.353 right:11.360 |
| clinical-m9 | omit | no | 7386ff09e8a8 | Fixture_Sample_EVA_LR.gcode | 1.004 | 24.243 | 0.014 | 0.000 | left:25.177 right:24.243 |
| clinical-m9 | LR | no | 7386ff09e8a8 | Fixture_Sample_EVA_LR.gcode | 1.004 | 24.243 | 0.014 | 0.000 | left:25.177 right:24.243 |
| sample-m13.5 | LR | no | b5e04ea000e0 | Fixture_Sample_EVA_LR.gcode | 1.005 | 9.311 | 0.015 | -0.010 | left:9.311 right:9.312 |
| sample-m14 | LR | no | eede568a9bce | Fixture_Sample_EVA_LR.gcode | 1.009 | 5.309 | 0.015 | 0.000 | left:6.248 right:5.309 |
| sample-m15 | LR | no | 63977f880260 | Fixture_Sample_EVA_LR.gcode | 1.006 | 1.051 | 0.016 | 23.800 | left:1.051 right:1.055 |
| sample-m9-RR | RR | no | c8901418e866 | Fixture_Sample_EVA_RR.gcode | 1.004 | 25.786 | 0.014 | 0.000 | left:25.788 left:25.786 |
| sample-m9-LL | LL | no | bf7f1765bcfa | Fixture_Sample_EVA_LL.gcode | 1.004 | 23.862 | 0.014 | 0.000 | right:25.786 right:23.862 |
| clinical-m9-RR | RR | no | bf7f1765bcfa | Fixture_Sample_EVA_RR.gcode | 1.004 | 23.862 | 0.014 | 0.000 | right:25.786 right:23.862 |
| clinical-m9-LL | LL | no | c8901418e866 | Fixture_Sample_EVA_LL.gcode | 1.004 | 25.786 | 0.014 | 0.000 | left:25.788 left:25.786 |

## Scope and schema

Candidate profile diffs: none

Candidate scope: PASS 

Schema: omitted=LR RR=RR LL=LL RX=rejected

create_saved_design: top-level keys stay external_order_id,manufacturing_method,client_id,catalog,patient_name,given_name,family_name

G1 byte identity uses full sha256 in the JSON artifacts `base.json` and `candidate.json` (not only the 12-character prefix in the table).

## Size-15 slide and clearance

- M13.5 LR: refused=false edge=1.005 mm gap=9.311 mm slide=-0.010 mm heels 11.010 -> 11.000 ownEntry=0.015 mm
- M14 LR: refused=false edge=1.009 mm gap=5.309 mm slide=0.000 mm heels 11.010 -> 11.010 ownEntry=0.015 mm
- M15 LR: refused=false edge=1.006 mm gap=1.051 mm slide=23.800 mm heels 11.010 -> 34.810 ownEntry=0.016 mm

## Re-grade of 8e3a6869

Frozen checkers were not edited. This table is PR #392 head `8e3a686926b5eee54841cd6e2a9c5df7f8e3610d`, not the earlier head `3260b001`. The earlier FAIL is still in `candidate.json`. This run is `candidate-8e3a6869.json`. CI run 45153009093 on this SHA completed success.

**Candidate: PASS** on G1, G2, G3, G4, G5, and G6.

| Gate | Result | Measured vs threshold |
| --- | --- | --- |
| G1 | PASS | M9 `7386ff09e8a8dc1a9be796607d26f3c3b4ce8b600108c6e86881309711ad7b8e`, M12 `8f6648eb17ef26e1cb0383ee83d82847a98d6db7f382730a721a737d69f63a0b`, clinical M9 equals M9. omit == LR == BASE. Filename `Fixture_Sample_EVA_LR.gcode`. M13 still refuses on BASE, so it is not a byte-identity case. |
| G2 | PASS | No refusal. Tool-sweep edge M13.5 **1.0052 mm**, M14 **1.0090 mm**, M15 **1.0065 mm**. Threshold >= **1 mm** inside 368.3 x 260.35. |
| G3 | PASS | M15 other-outline sweep slot1 left **1.051 mm**, slot2 right **1.055 mm**. Own cutout entry stays within BASE max 0.01492 mm + 0.1 mm. |
| G4 | PASS | Largest second-slot toe slide is M15 LR **23.800 mm** (heels 11.010 -> 34.810). Cap **30 mm**. |
| G5 | PASS | Omitted `mill_side` parses as **LR**. RR and LL accepted, RX rejected. Filenames `Fixture_Sample_EVA_RR.gcode` and `Fixture_Sample_EVA_LL.gcode`. SAMPLE_Top RR is two internal left outlines; clinical RR is two internal right outlines. `create_saved_design` keys unchanged. |
| G6 | PASS | Diff is inside the worker FILES list. `profile.ts` unchanged. Feeds, 10 mm ball, and spindle match the frozen profile. |

Command, from a detached worktree at that SHA, with the frozen `run_gates.ts` and `base.json`:

```bash
env EVA_GATE_MODE=grade EVA_GATE_LABEL=candidate \
  EVA_GATE_BASE_JSON=validation/eva_cnc_gates/base.json \
  EVA_GATE_OUT=validation/eva_cnc_gates/candidate-8e3a6869.json \
  node_modules/.bin/rstest run --config validation/eva_cnc_gates/rstest.config.ts
```

Next: Kendon decides. Gates-only PR #393 stays unmerged. PR #392 stays unmerged.

