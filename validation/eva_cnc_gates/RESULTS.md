# EVA CNC gates — results

Independent grade. Gates were frozen before the candidate run. This file is the measured output.

- Base SHA: `4e2e196561bada8f2a4faf4ad174a716306d8c94`
- Candidate SHA: `3260b001686883fa74ea95b1833df42100bfc656`
- Graded HEAD recorded by the candidate run: `3260b001686883fa74ea95b1833df42100bfc656`
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
| G2 | FAIL | FAIL | M13.5 M14 M15 produce G-code; tool sweep inside 368.3 x 260.35 with >= 1 mm edge clearance | M13.5 edge 0.995 mm; M14 edge 0.999 mm; M15 edge 0.997 mm |
| G3 | FAIL | PASS | sweep-to-other-outline >= 1 mm; own cutout entry <= BASE max 0.015 + 0.1 mm | sample-m9 [slot1:left=25.177, slot2:right=24.243] ownEntry 0.014 | sample-m12 [slot1:left=15.984, slot2:right=15.982] ownEntry 0.015 | sample-m13 [slot1:left=12.373, slot2:right=11.379] ownEntry 0.016 | clinical-m9 [slot1:left=25.177, slot2:right=24.243] ownEntry 0.014 | sample-m13.5 [slot1:left=9.331, slot2:right=9.332] ownEntry 0.015 | sample-m14 [slot1:left=6.268, slot2:right=5.329] ownEntry 0.015 | sample-m15 [slot1:left=1.050, slot2:right=1.054] ownEntry 0.016 |
| G4 | PASS | PASS | second-slot toe slide <= 30 mm | sample-m9 LR slide 0.000 mm; sample-m12 LR slide 0.000 mm; sample-m13 LR slide 0.000 mm; clinical-m9 LR slide 0.000 mm; sample-m13.5 LR slide -0.010 mm; sample-m14 LR slide 0.000 mm; sample-m15 LR slide 23.520 mm; sample-m9-RR RR slide 0.000 mm; sample-m9-LL LL slide 0.000 mm; clinical-m9-RR RR slide 0.000 mm; clinical-m9-LL LL slide 0.000 mm |
| G5 | FAIL | FAIL | RR/LL mill two copies of the physical foot; filenames _EVA_RR/_EVA_LL; mill_side default LR; create_saved_design has no side parameter | omitted=undefined RR=RR LL=LL RX=rejected |
| G6 | PASS | FAIL | worker FILES allowlist only; profile.ts cutter, feeds, stepover, strategy, Z unchanged | outside FILES: .github/workflows/main.yml; outside FILES: ci/unit-test-shards.json; outside FILES: packages/mcp/src/clients/manufacturing-client.ts; outside FILES: vertex/server/src/lib/cad-operator-production.ts; outside FILES: vertex/server/src/lib/cnc-mill-job.d.ts; outside FILES: vertex/server/src/lib/cnc-mill-runner.ts; outside FILES: vertex/server/src/routers/cad-operator-generate.ts; outside FILES: vertex/server/src/routers/manufacturing.ts |

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
| sample-m13 | omit | no | 10ea8e892113 | Fixture_Sample_EVA_LR.gcode | 1.001 | 11.379 | 0.016 | 0.000 | left:12.373 right:11.379 |
| sample-m13 | LR | no | 10ea8e892113 | Fixture_Sample_EVA_LR.gcode | 1.001 | 11.379 | 0.016 | 0.000 | left:12.373 right:11.379 |
| clinical-m9 | omit | no | 7386ff09e8a8 | Fixture_Sample_EVA_LR.gcode | 1.004 | 24.243 | 0.014 | 0.000 | left:25.177 right:24.243 |
| clinical-m9 | LR | no | 7386ff09e8a8 | Fixture_Sample_EVA_LR.gcode | 1.004 | 24.243 | 0.014 | 0.000 | left:25.177 right:24.243 |
| sample-m13.5 | LR | no | 5d6a3faaa2c6 | Fixture_Sample_EVA_LR.gcode | 0.995 | 9.331 | 0.015 | -0.010 | left:9.331 right:9.332 |
| sample-m14 | LR | no | c807551f727a | Fixture_Sample_EVA_LR.gcode | 0.999 | 5.329 | 0.015 | 0.000 | left:6.268 right:5.329 |
| sample-m15 | LR | no | 037cc535acb2 | Fixture_Sample_EVA_LR.gcode | 0.997 | 1.050 | 0.016 | 23.520 | left:1.050 right:1.054 |
| sample-m9-RR | RR | no | c8901418e866 | Fixture_Sample_EVA_RR.gcode | 1.004 | 25.786 | 0.014 | 0.000 | left:25.788 left:25.786 |
| sample-m9-LL | LL | no | bf7f1765bcfa | Fixture_Sample_EVA_LL.gcode | 1.004 | 23.862 | 0.014 | 0.000 | right:25.786 right:23.862 |
| clinical-m9-RR | RR | no | bf7f1765bcfa | Fixture_Sample_EVA_RR.gcode | 1.004 | 23.862 | 0.014 | 0.000 | right:25.786 right:23.862 |
| clinical-m9-LL | LL | no | c8901418e866 | Fixture_Sample_EVA_LL.gcode | 1.004 | 25.786 | 0.014 | 0.000 | left:25.788 left:25.786 |

## Scope and schema

Candidate profile diffs: none

Candidate scope: FAIL outside FILES: .github/workflows/main.yml; outside FILES: ci/unit-test-shards.json; outside FILES: packages/mcp/src/clients/manufacturing-client.ts; outside FILES: vertex/server/src/lib/cad-operator-production.ts; outside FILES: vertex/server/src/lib/cnc-mill-job.d.ts; outside FILES: vertex/server/src/lib/cnc-mill-runner.ts; outside FILES: vertex/server/src/routers/cad-operator-generate.ts; outside FILES: vertex/server/src/routers/manufacturing.ts

Schema: omitted=undefined RR=RR LL=LL RX=rejected

create_saved_design: top-level keys stay external_order_id,manufacturing_method,client_id,catalog,patient_name,given_name,family_name

G1 byte identity uses full sha256 in the JSON artifacts `base.json` and `candidate.json` (not only the 12-character prefix in the table).

## Size-15 slide and clearance

- M13.5 LR: refused=false edge=0.995 mm gap=9.331 mm slide=-0.010 mm heels 11.000 -> 10.990 ownEntry=0.015 mm
- M14 LR: refused=false edge=0.999 mm gap=5.329 mm slide=0.000 mm heels 11.000 -> 11.000 ownEntry=0.015 mm
- M15 LR: refused=false edge=0.997 mm gap=1.050 mm slide=23.520 mm heels 11.000 -> 34.520 ownEntry=0.016 mm

## Grade

Candidate `3260b001686883fa74ea95b1833df42100bfc656` against gates frozen at `af6250a8ec0fa6f9f3ec675008cb69af6b936a11`: **FAIL**.

| Gate | Candidate | Why |
| --- | --- | --- |
| G1 | PASS | Men's 9 and 12 SAMPLE_Top, and clinical Men's 9, omit and LR match BASE sha256 and `Fixture_Sample_EVA_LR.gcode`. Men's 13 refuses on BASE, so it is not a byte-identity case. `tests/cnc/golden/sha.json` is not in the diff. |
| G2 | FAIL | M13.5, M14, and M15 produce G-code. Tool-sweep edge clearance is 0.9952 mm, 0.9990 mm, and 0.9965 mm. Threshold is >= 1 mm inside the 368.3 x 260.35 block. |
| G3 | PASS | Smallest other-outline sweep gap is M15 slot 1 left 1.050 mm and slot 2 right 1.054 mm. Own cutout entry stays within BASE max 0.01492 mm + 0.1 mm. |
| G4 | PASS | Largest second-slot toe slide is M15 LR 23.520 mm. Cap is 30 mm. |
| G5 | FAIL | RR and LL mill two copies of the physical foot on SAMPLE_Top and the clinical fixture, and the filenames end `_EVA_RR.gcode` / `_EVA_LL.gcode`. `create_saved_design` gained no side parameter. `generate_cnc_gcode` parses an omitted `mill_side` as `undefined`, not default `LR`. |
| G6 | FAIL | Eight paths are outside the worker FILES list. `profile.ts` is unchanged. Feeds, tool, and spindle match the frozen Idaho profile. |

Next step: Kendon decides. This grade does not merge, deploy, or change product code.

