// Sink-depth gates. Instrument proofs always run. The export grade runs when
// SINK_GATE_LIVE=1. A failing product gate does not fail this test: the JSON
// report is the grade. A failing proof means the instrument is broken.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { SINK_KIND_ORDER, SINK_PROFILES } from "@/lib/geometry/sink";
import type { PlacedSink, SinkKind } from "@/types";
import {
    type GateResult,
    judgeDiff,
    judgeExportDrop,
    judgeFlat,
    judgeFloor,
    judgeHashes,
    syntheticProofs,
} from "./judge";
import {
    breakFlat,
    bundleFromGeometry,
    loadSampleTop,
    loftExport,
    measureFlat,
    measureFloor,
    positionHash,
    retargetPlateauGap,
} from "./measure";
import { parseNameStatus } from "./rules";

function depthsFor(kind: SinkKind): number[] {
    const max = SINK_PROFILES[kind].maxDepthMm;
    const wanted = [1, 2, Math.min(3, max), max];
    return [...new Set(wanted.filter((d) => d > 0 && d <= max))];
}

describe("sink-depth gate instrument", () => {
    test("synthetic no-op proofs pass and bad-change proofs fail the gate", () => {
        const proofs = syntheticProofs();
        const failed = proofs.filter((p) => !p.pass);
        expect(failed.map((p) => `${p.id} ${p.measured}`)).toEqual([]);
    });

    test("flat 3 mm sheet: real cut passes, a deeper copy fails", () => {
        const proofs: GateResult[] = [];
        for (const kind of ["mpj5", "mpj1"] as const) {
            const good = measureFlat(kind, 2);
            for (const gate of judgeFlat(good)) proofs.push({ ...gate, id: `PROOF-NOOP-${gate.id}` });
            const broken = breakFlat(kind, 2, 0.8);
            for (const gate of judgeFlat(broken)) {
                proofs.push({
                    ...gate,
                    id: `PROOF-BAD-${gate.id}`,
                    pass: gate.pass === false,
                    measured: `${gate.measured}; gate ${gate.pass ? "PASS" : "FAIL"}`,
                });
            }
        }
        const failed = proofs.filter((p) => !p.pass);
        expect(failed.map((p) => `${p.id} ${p.measured}`)).toEqual([]);
    });

    test("flat sheet, other depths and positions, is graded but not required to pass here", () => {
        const gates: GateResult[] = [];
        for (const kind of SINK_KIND_ORDER) {
            for (const depth of depthsFor(kind)) {
                gates.push(...judgeFlat(measureFlat(kind, depth, 3)));
                // A 6 mm sheet has room for every catalog depth above the 1 mm sole floor.
                gates.push(...judgeFlat(measureFlat(kind, depth, 6)));
            }
        }
        const failed = gates.filter((g) => !g.pass);
        // The flat sheet on this tree is part of the grade. Record it by failing
        // the test only when the no-wall cut is not exact: that is the base
        // behaviour the observed defect did not break.
        expect(failed.map((g) => `${g.id} ${g.measured} | ${g.threshold}`)).toEqual([]);
    });
});

describe("sink-depth export grade", () => {
    test("measure the export mesh and write the grade JSON", async () => {
        if (process.env.SINK_GATE_LIVE !== "1") return;
        const label = process.env.SINK_GATE_LABEL || "base";
        const sha =
            process.env.SINK_GATE_SHA ||
            execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        const diffBase = process.env.SINK_GATE_DIFF_BASE || sha;
        const diffHead = process.env.SINK_GATE_DIFF_HEAD || sha;
        const nameStatus = execFileSync("git", ["diff", "--name-status", diffBase, diffHead], {
            encoding: "utf8",
        });
        const diffGates = judgeDiff(parseNameStatus(nameStatus));
        const raw = await loadSampleTop();
        const started = Date.now();
        const defaultGeo = await loftExport(raw, undefined, "default");
        const defaultNoSink = positionHash(defaultGeo);
        defaultGeo.dispose();
        console.log(
            "[GATE] default no-sink",
            defaultNoSink,
            `${((Date.now() - started) / 1000).toFixed(1)}s`,
        );

        const tUniform = Date.now();
        const unsunkGeo = await loftExport(raw, undefined, "uniform", 3);
        const uniform3NoSink = positionHash(unsunkGeo);
        unsunkGeo.dispose();
        console.log(
            "[GATE] uniform3 no-sink",
            uniform3NoSink,
            `${((Date.now() - tUniform) / 1000).toFixed(1)}s`,
        );
        const unsunkCache = new Map<number, { positions: Float32Array; index: Uint32Array }>();
        const unsunkAt = async (thicknessMm: number) => {
            const hit = unsunkCache.get(thicknessMm);
            if (hit) return hit;
            const geo = await loftExport(raw, undefined, "uniform", thicknessMm);
            const stored = {
                positions: new Float32Array(geo.getAttribute("position").array as Float32Array),
                index: new Uint32Array(geo.getIndex()!.array as ArrayLike<number>),
            };
            geo.dispose();
            unsunkCache.set(thicknessMm, stored);
            return stored;
        };

        const observed: Array<{ kind: SinkKind; depthMm: number; role: "floor" | "exact" }> = [
            { kind: "mpj5", depthMm: 2, role: "floor" },
            { kind: "mpj1", depthMm: 2, role: "floor" },
        ];
        const cases =
            process.env.SINK_GATE_CASES === "floor"
                ? observed
                : [
                      ...observed,
                      { kind: "mpj2" as const, depthMm: 3, role: "exact" as const },
                      { kind: "mpj3" as const, depthMm: 1, role: "exact" as const },
                      { kind: "mpj4" as const, depthMm: 2, role: "exact" as const },
                      { kind: "styloid" as const, depthMm: 2, role: "exact" as const },
                      { kind: "rkw" as const, depthMm: 2, role: "exact" as const },
                  ];

        const floors = [];
        const gates: GateResult[] = [...diffGates, ...judgeHashes({ defaultNoSink, uniform3NoSink })];
        const proofs: GateResult[] = [];
        for (const spec of cases) {
            const t0 = Date.now();
            const sink: PlacedSink = { id: spec.kind, kind: spec.kind, depthMm: spec.depthMm };
            // A sink deeper than shell − 1 raises the whole shell to depth + 1
            // before the cut. The unsunk twin has to be that same shell.
            const shellMm = Math.max(3, spec.depthMm + 1);
            const bare = await unsunkAt(shellMm);
            const geo = await loftExport(raw, [sink], "uniform", shellMm);
            const bundle = bundleFromGeometry(geo, sink);
            const sample = measureFloor(bundle, bare.positions, bare.index, spec.depthMm);
            floors.push(sample);
            if (spec.role === "floor") gates.push(...judgeFloor(sample));
            else gates.push(judgeExportDrop(sample));
            console.log(
                "[GATE]",
                spec.kind,
                spec.depthMm,
                `min ${sample.minMm.toFixed(3)} med ${sample.medianMm.toFixed(3)}`,
                `drop ${sample.dropMedianMm.toFixed(3)}/${sample.dropMaxMm.toFixed(3)}`,
                `ring ${sample.ringMedianMm.toFixed(3)} n ${sample.ringCount}`,
                `unsunk ${sample.unsunkMedianMm?.toFixed(3)}`,
                `belt ${sample.beltMoveMm.toFixed(4)} xy ${sample.xyMoveMm.toFixed(4)}`,
                `n ${sample.plateauCount} miss ${sample.rayMisses}`,
                `${((Date.now() - t0) / 1000).toFixed(1)}s`,
            );
            if (spec.kind === "mpj5" && spec.depthMm === 2) {
                proofs.push(...meshCopyProof(geo, sink, bare.positions, bare.index));
            }
            geo.dispose();
        }
        raw.dispose();

        const flatGates: GateResult[] = [];
        for (const kind of SINK_KIND_ORDER) {
            for (const depth of depthsFor(kind)) {
                flatGates.push(...judgeFlat(measureFlat(kind, depth, 3)));
                flatGates.push(...judgeFlat(measureFlat(kind, depth, 6)));
            }
        }
        gates.push(...flatGates);

        const proofFailed = proofs.filter((p) => !p.pass);
        const out = {
            label,
            sha,
            diffBase,
            diffHead,
            hashes: { defaultNoSink, uniform3NoSink },
            floors,
            gates,
            proofs,
        };
        const outPath = process.env.SINK_GATE_OUT || `/tmp/sink-depth-gates-${label}.json`;
        writeFileSync(outPath, JSON.stringify(out, null, 2));
        console.log("[GATE] wrote", outPath);
        expect(proofFailed.map((p) => `${p.id} ${p.measured}`)).toEqual([]);
    }, 900_000);
});

function meshCopyProof(
    geo: BufferGeometry,
    sink: PlacedSink,
    unsunkPositions: Float32Array,
    unsunkIndex: Uint32Array,
): GateResult[] {
    const goodGeo = geo.clone();
    const goodBundle = bundleFromGeometry(goodGeo, sink);
    const lifted = retargetPlateauGap(goodBundle, 1);
    const good = measureFloor(goodBundle, unsunkPositions, unsunkIndex, 2);
    goodGeo.dispose();
    const badGeo = geo.clone();
    const badBundle = bundleFromGeometry(badGeo, sink);
    const thinned = retargetPlateauGap(badBundle, 0.04);
    const bad = measureFloor(badBundle, unsunkPositions, unsunkIndex, 2);
    badGeo.dispose();
    const goodFloor = judgeFloor(good).find((g) => g.id === "G-FLOOR-MPJ5")!;
    const badFloor = judgeFloor(bad).find((g) => g.id === "G-FLOOR-MPJ5")!;
    return [
        {
            ...goodFloor,
            id: "PROOF-NOOP-MESH-MPJ5",
            pass: lifted > 0 && goodFloor.pass === true,
            measured: `moved ${lifted}; ${goodFloor.measured}`,
            evidence: "plateau vertices reset to a 1.0 mm gap, then measured again",
        },
        {
            ...badFloor,
            id: "PROOF-BAD-MESH-MPJ5",
            pass: thinned > 0 && badFloor.pass === false,
            measured: `moved ${thinned}; ${badFloor.measured}; gate ${badFloor.pass ? "PASS" : "FAIL"}`,
            evidence: "same plateau reset to a 0.04 mm gap; the floor gate must fail",
        },
    ];
}
