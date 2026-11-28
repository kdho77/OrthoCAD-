// Pass/fail for one measured specimen. No product imports.

import { classifyDiff, type DiffEntry } from "./rules";
import {
    BASE_NOSINK_HASHES,
    BELT_MOVE_MAX_MM,
    EXACT_TOL_MM,
    EXPORT_DROP_TOL_MM,
    FLOOR_TOL_MM,
    floorBand,
    hashesFrozen,
    inBand,
    MAX_RAY_MISS_FRACTION,
    MIN_INTERIOR_SAMPLES,
    MIN_PLATEAU_SAMPLES,
    MIN_RING_SAMPLES,
    NOT_DEEPER_MM,
    RING_TOL_MM,
    XY_MOVE_MAX_MM,
} from "./thresholds";

export interface GateResult {
    id: string;
    rule: string;
    pass: boolean;
    measured: string;
    threshold: string;
    evidence: string;
}

export interface FloorMeasurement {
    id: string;
    kind: string;
    side: "left";
    depthMm: number;
    thicknessMm: number;
    plateauCount: number;
    rayMisses: number;
    minMm: number;
    medianMm: number;
    ringCount: number;
    ringMedianMm: number;
    dropMedianMm: number;
    dropMaxMm: number;
    beltMoveMm: number;
    xyMoveMm: number;
    /** Unsunk shell thickness under the same plateau, for the results table. */
    unsunkMedianMm?: number;
    /** Remaining thickness where the unsunk shell is at most 3.15 mm. */
    lowShellCount?: number;
    lowShellMedianMm?: number;
    /** Median |sunk − unsunk| thickness on the ring around the pad. */
    ringDeltaMm?: number;
    /** Drop where the unsunk shell is deep enough for a full cut above 1 mm. */
    roomyCount?: number;
    roomyDropMedianMm?: number;
}

export interface FlatMeasurement {
    kind: string;
    depthMm: number;
    /** Sheet thickness before the cut. The sole floor guard keeps 1 mm. */
    shellMm: number;
    interiorCount: number;
    plateauCount: number;
    removedMedianMm: number;
    removedMinMm: number;
    removedMaxMm: number;
    remainMinMm: number;
    remainMedianMm: number;
}

export interface HashMeasurement {
    defaultNoSink: string;
    uniform3NoSink: string;
}

function num(value: number): string {
    if (!Number.isFinite(value)) return "n/a";
    return value.toFixed(3);
}

function gate(
    id: string,
    rule: string,
    pass: boolean,
    measured: string,
    threshold: string,
    evidence: string,
): GateResult {
    return { id, rule, pass, measured, threshold, evidence };
}

export function judgeFloor(sample: FloorMeasurement): GateResult[] {
    const band = floorBand();
    const bandText = `${band.lo.toFixed(2)}..${band.hi.toFixed(2)} mm`;
    const missFrac =
        sample.plateauCount + sample.rayMisses > 0
            ? sample.rayMisses / (sample.plateauCount + sample.rayMisses)
            : 1;
    const lowCount = sample.lowShellCount ?? sample.plateauCount;
    const lowMedian = sample.lowShellMedianMm ?? sample.medianMm;
    const enough =
        sample.plateauCount >= MIN_PLATEAU_SAMPLES &&
        missFrac <= MAX_RAY_MISS_FRACTION &&
        lowCount >= MIN_PLATEAU_SAMPLES;
    // Whole-plateau min catches a wall under the pad. The median is taken
    // where the unsunk shell is at most 3.15 mm, which is the 3 mm design
    // the defect was measured on, not the taller arch.
    const minOk = inBand(sample.minMm, band.lo, band.hi);
    const medOk = inBand(lowMedian, band.lo, band.hi);
    const id = `G-FLOOR-${sample.kind.toUpperCase()}`;
    const floor = gate(
        id,
        "TESTS",
        enough && minOk && medOk,
        `min ${num(sample.minMm)} mm, low-shell median ${num(lowMedian)} mm (n ${lowCount}), overall median ${num(sample.medianMm)} mm, plateau n ${sample.plateauCount}, ray misses ${sample.rayMisses}`,
        `min and low-shell median in ${bandText}; low-shell n >= ${MIN_PLATEAU_SAMPLES}; miss fraction <= ${MAX_RAY_MISS_FRACTION}`,
        `${sample.side} export, ${sample.kind} depthMm ${sample.depthMm}, thickness ${sample.thicknessMm}, plateau weight >= 0.98, vertical gap top to next surface`,
    );
    const ringDelta = sample.ringDeltaMm ?? 0;
    const ringOk = sample.ringCount >= MIN_RING_SAMPLES && ringDelta <= RING_TOL_MM;
    const ring = gate(
        `G-RING-${sample.kind.toUpperCase()}`,
        "MUST-MATCH",
        ringOk,
        `ring median ${num(sample.ringMedianMm)} mm, |change| ${num(ringDelta)} mm, n ${sample.ringCount}`,
        `|sunk − unsunk| median <= ${RING_TOL_MM} mm, n >= ${MIN_RING_SAMPLES}`,
        `shell just outside ${sample.kind} (weight < 0.2, underside on the sole) stays at its unsunk thickness`,
    );
    const notDeeper = gate(
        `G-NOT-DEEPER-${sample.kind.toUpperCase()}`,
        "MUST-MATCH",
        Number.isFinite(sample.dropMaxMm) && sample.dropMaxMm <= sample.depthMm + EXPORT_DROP_TOL_MM,
        `plateau drop max ${num(sample.dropMaxMm)} mm, median ${num(sample.dropMedianMm)} mm`,
        `max drop <= depth ${sample.depthMm} + ${EXPORT_DROP_TOL_MM} mm`,
        `unsunk top z minus sunk top z on the ${sample.kind} plateau`,
    );
    const belt = gate(
        `G-BELT-${sample.kind.toUpperCase()}`,
        "R2",
        Number.isFinite(sample.beltMoveMm) && sample.beltMoveMm <= BELT_MOVE_MAX_MM,
        `plantar move ${num(sample.beltMoveMm)} mm`,
        `<= ${BELT_MOVE_MAX_MM} mm`,
        `vertices with unsunk z <= 0.001 compared index-wise to the sunk export`,
    );
    const xy = gate(
        `G-XY-${sample.kind.toUpperCase()}`,
        "R1",
        Number.isFinite(sample.xyMoveMm) && sample.xyMoveMm <= XY_MOVE_MAX_MM,
        `top XY move ${num(sample.xyMoveMm)} mm`,
        `<= ${XY_MOVE_MAX_MM} mm`,
        `max plan move of top-sheet vertices, sunk vs unsunk`,
    );
    return [floor, ring, notDeeper, belt, xy];
}

/** Other depths/positions on the curved export: the top drops by depthMm. */
export function judgeExportDrop(sample: FloorMeasurement): GateResult {
    const lo = sample.depthMm - EXPORT_DROP_TOL_MM;
    const hi = sample.depthMm + EXPORT_DROP_TOL_MM;
    const roomyN = sample.roomyCount ?? 0;
    const roomy = sample.roomyDropMedianMm ?? Number.NaN;
    const ok =
        roomyN >= 8 && inBand(roomy, lo, hi) && sample.dropMaxMm <= sample.depthMm + EXPORT_DROP_TOL_MM;
    return gate(
        `G-EXACT-${sample.kind.toUpperCase()}-D${sample.depthMm}`,
        "MUST-MATCH",
        ok,
        `roomy drop median ${num(roomy)} mm (n ${roomyN}), plateau max ${num(sample.dropMaxMm)} mm, plateau median ${num(sample.dropMedianMm)} mm`,
        `where unsunk shell >= depth + 1, median drop in ${lo.toFixed(2)}..${hi.toFixed(2)} mm; max drop <= ${(sample.depthMm + EXPORT_DROP_TOL_MM).toFixed(2)} mm; n >= 8`,
        `${sample.kind} depthMm ${sample.depthMm} on the export (not the observed mpj5/mpj1 depth 2 case)`,
    );
}

/** Locked sole clearance. A cut that would leave less than this is shortened. */
const SOLE_FLOOR_MM = 1;

export function expectedRemovalMm(depthMm: number, shellMm: number): number {
    return Math.min(depthMm, Math.max(0, shellMm - SOLE_FLOOR_MM));
}

export function judgeFlat(sample: FlatMeasurement): GateResult[] {
    const expected = expectedRemovalMm(sample.depthMm, sample.shellMm);
    const remainTarget = sample.shellMm - expected;
    const bandLo = remainTarget - FLOOR_TOL_MM;
    const bandHi = remainTarget + FLOOR_TOL_MM;
    const exact =
        sample.interiorCount >= MIN_INTERIOR_SAMPLES &&
        Math.abs(sample.removedMedianMm - expected) <= EXACT_TOL_MM &&
        Math.abs(sample.removedMinMm - expected) <= EXACT_TOL_MM &&
        sample.removedMaxMm <= expected + NOT_DEEPER_MM &&
        sample.removedMaxMm <= sample.depthMm + NOT_DEEPER_MM;
    const floor =
        sample.plateauCount >= MIN_INTERIOR_SAMPLES &&
        inBand(sample.remainMinMm, bandLo, bandHi) &&
        inBand(sample.remainMedianMm, bandLo, bandHi);
    const tag = `${sample.kind.toUpperCase()}-D${sample.depthMm}-S${sample.shellMm}`;
    return [
        gate(
            `G-FLAT-EXACT-${tag}`,
            sample.depthMm === 2 && (sample.kind === "mpj5" || sample.kind === "mpj1")
                ? "TESTS"
                : "MUST-MATCH",
            exact,
            `removed median ${num(sample.removedMedianMm)} min ${num(sample.removedMinMm)} max ${num(sample.removedMaxMm)} mm, n ${sample.interiorCount}`,
            `median and min within ${EXACT_TOL_MM} mm of ${expected.toFixed(2)} (min of depth ${sample.depthMm} and shell ${sample.shellMm} − ${SOLE_FLOOR_MM}); max <= that + ${NOT_DEEPER_MM}`,
            `flat ${sample.shellMm} mm sheet, no wall, ${sample.kind} interior weight >= 0.999`,
        ),
        gate(
            `G-FLAT-FLOOR-${tag}`,
            "TESTS",
            floor,
            `remain min ${num(sample.remainMinMm)} median ${num(sample.remainMedianMm)} mm, n ${sample.plateauCount}`,
            `min and median in ${bandLo.toFixed(2)}..${bandHi.toFixed(2)} mm`,
            `flat ${sample.shellMm} mm sheet plateau weight >= 0.98, remaining = shell − removed`,
        ),
    ];
}

export function judgeHashes(hashes: HashMeasurement): GateResult[] {
    const frozen = hashesFrozen();
    const defOk = frozen && hashes.defaultNoSink === BASE_NOSINK_HASHES.defaultNoSink;
    const uniOk = frozen && hashes.uniform3NoSink === BASE_NOSINK_HASHES.uniform3NoSink;
    return [
        gate(
            "G-R7-DEFAULT",
            "R7",
            defOk,
            hashes.defaultNoSink || "(empty)",
            `sha256 ${BASE_NOSINK_HASHES.defaultNoSink || "(unfrozen)"}`,
            "position SHA-256 of the left SAMPLE_Top preview with no sinks and no thickness override",
        ),
        gate(
            "G-R7-UNIFORM3",
            "R7",
            uniOk,
            hashes.uniform3NoSink || "(empty)",
            `sha256 ${BASE_NOSINK_HASHES.uniform3NoSink || "(unfrozen)"}`,
            "position SHA-256 of the left uniform 3 mm shell with no sinks",
        ),
    ];
}

export function judgeDiff(entries: DiffEntry[]): GateResult[] {
    const diff = classifyDiff(entries);
    const listed = (paths: string[]) => (paths.length ? paths.join(", ") : "(none)");
    return [
        gate(
            "G-R1-FILES",
            "R1",
            diff.seamOrSlicer.length === 0,
            listed(diff.seamOrSlicer),
            "no path matching seam, slicer, vertexslice, kiri, or layer-change",
            "git diff --name-status base..candidate",
        ),
        gate(
            "G-R2-FILES",
            "R2",
            diff.seamOrSlicer.length === 0,
            listed(diff.seamOrSlicer),
            "seam and slicer paths unchanged (seams stay on the plantar face; this diff must not move them)",
            "git diff --name-status base..candidate",
        ),
        gate(
            "G-R3-SCOPE",
            "R3",
            diff.outOfScope.length === 0,
            listed(diff.outOfScope),
            "every path contains 'sink' or is ci/unit-test-shards.json",
            "git diff --name-status base..candidate",
        ),
        gate(
            "G-ONE-FILES",
            "ONE",
            diff.outOfScope.length === 0,
            `${diff.files.length} file(s); out of scope: ${listed(diff.outOfScope)}`,
            "sink-depth files only",
            "git diff --name-status base..candidate",
        ),
        gate(
            "G-R4-MESH",
            "R4",
            diff.stockMesh.length === 0,
            listed(diff.stockMesh),
            "SAMPLE_Top.glb, Default.glb, and other stock/stl meshes unchanged",
            "git diff --name-status base..candidate",
        ),
        gate(
            "G-R5-TEXT",
            "R5",
            diff.textMarking.length === 0,
            listed(diff.textMarking),
            "text-marking paths unchanged",
            "git diff --name-status base..candidate",
        ),
        gate(
            "G-R6-DEPLOY",
            "R6",
            diff.railwayOrDeploy.length === 0,
            listed(diff.railwayOrDeploy),
            "no railway, vertex-web, vertex-api, deploy, or workflow path",
            "git diff --name-status base..candidate",
        ),
    ];
}

function wantPass(g: GateResult, prefix: string): GateResult {
    return {
        ...g,
        id: `${prefix}-${g.id}`,
        pass: g.pass === true,
        evidence: `${g.evidence}; proof wants the gate to pass (gate said ${g.pass ? "pass" : "fail"})`,
    };
}

function wantFail(g: GateResult, prefix: string): GateResult {
    return {
        ...g,
        id: `${prefix}-${g.id}`,
        pass: g.pass === false,
        measured: `${g.measured}; gate ${g.pass ? "PASS" : "FAIL"}`,
        evidence: `${g.evidence}; proof wants the gate to fail`,
    };
}

/** Synthetic specimens. Each gate has a no-op (pass) and a bad-change (fail) proof. */
export function syntheticProofs(): GateResult[] {
    const goodFloor: FloorMeasurement = {
        id: "proof",
        kind: "mpj5",
        side: "left",
        depthMm: 2,
        thicknessMm: 3,
        plateauCount: 40,
        rayMisses: 0,
        minMm: 1,
        medianMm: 1,
        ringCount: 20,
        ringMedianMm: 2.99,
        dropMedianMm: 2,
        dropMaxMm: 2,
        beltMoveMm: 0,
        xyMoveMm: 0,
    };
    const badFloor: FloorMeasurement = { ...goodFloor, minMm: 0.04, medianMm: 0.69 };
    const deepFloor: FloorMeasurement = { ...goodFloor, dropMaxMm: 3.2, dropMedianMm: 3.2 };
    const movedBelt: FloorMeasurement = { ...goodFloor, beltMoveMm: 1.2, xyMoveMm: 0.4 };
    const goodFlat: FlatMeasurement = {
        kind: "mpj5",
        depthMm: 2,
        shellMm: 3,
        interiorCount: 30,
        plateauCount: 40,
        removedMedianMm: 2,
        removedMinMm: 2,
        removedMaxMm: 2,
        remainMinMm: 1,
        remainMedianMm: 1,
    };
    const badFlat: FlatMeasurement = {
        ...goodFlat,
        removedMedianMm: 2.8,
        removedMinMm: 2.6,
        removedMaxMm: 2.9,
        remainMinMm: 0.1,
        remainMedianMm: 0.2,
    };
    const goodExact: FloorMeasurement = {
        ...goodFloor,
        kind: "mpj3",
        depthMm: 1,
        dropMedianMm: 1,
        dropMaxMm: 1,
        roomyCount: 40,
        roomyDropMedianMm: 1,
    };
    const badExact: FloorMeasurement = { ...goodExact, roomyDropMedianMm: 0.4, dropMaxMm: 1.6 };
    const floorOf = (sample: FloorMeasurement, id: string) => judgeFloor(sample).find((g) => g.id === id)!;
    const flatOf = (sample: FlatMeasurement, id: string) => judgeFlat(sample).find((g) => g.id === id)!;
    const diffOf = (entries: DiffEntry[], id: string) => judgeDiff(entries).find((g) => g.id === id)!;
    return [
        wantPass(judgeExportDrop(goodExact), "PROOF-NOOP"),
        wantFail(judgeExportDrop(badExact), "PROOF-BAD"),
        wantPass(floorOf(goodFloor, "G-FLOOR-MPJ5"), "PROOF-NOOP"),
        wantFail(floorOf(badFloor, "G-FLOOR-MPJ5"), "PROOF-BAD"),
        wantPass(floorOf(goodFloor, "G-RING-MPJ5"), "PROOF-NOOP"),
        wantFail(floorOf({ ...goodFloor, ringMedianMm: 1.2, ringCount: 3 }, "G-RING-MPJ5"), "PROOF-BAD"),
        wantPass(floorOf(goodFloor, "G-NOT-DEEPER-MPJ5"), "PROOF-NOOP"),
        wantFail(floorOf(deepFloor, "G-NOT-DEEPER-MPJ5"), "PROOF-BAD"),
        wantPass(floorOf(goodFloor, "G-BELT-MPJ5"), "PROOF-NOOP"),
        wantFail(floorOf(movedBelt, "G-BELT-MPJ5"), "PROOF-BAD"),
        wantPass(floorOf(goodFloor, "G-XY-MPJ5"), "PROOF-NOOP"),
        wantFail(floorOf(movedBelt, "G-XY-MPJ5"), "PROOF-BAD"),
        wantPass(flatOf(goodFlat, "G-FLAT-EXACT-MPJ5-D2-S3"), "PROOF-NOOP"),
        wantFail(flatOf(badFlat, "G-FLAT-EXACT-MPJ5-D2-S3"), "PROOF-BAD"),
        wantPass(flatOf(goodFlat, "G-FLAT-FLOOR-MPJ5-D2-S3"), "PROOF-NOOP"),
        wantFail(flatOf(badFlat, "G-FLAT-FLOOR-MPJ5-D2-S3"), "PROOF-BAD"),
        ...judgeDiff([]).map((g) => wantPass(g, "PROOF-NOOP")),
        wantFail(diffOf([{ status: "M", path: "vertex/src/lib/kiri/slicer.ts" }], "G-R1-FILES"), "PROOF-BAD"),
        wantFail(
            diffOf(
                [{ status: "M", path: "vertex/src/lib/geometry/procedural-wall/ring-seam.ts" }],
                "G-R2-FILES",
            ),
            "PROOF-BAD",
        ),
        wantFail(
            diffOf([{ status: "M", path: "vertex/src/lib/geometry/heel-lift.ts" }], "G-R3-SCOPE"),
            "PROOF-BAD",
        ),
        wantFail(
            diffOf([{ status: "M", path: "vertex/src/lib/geometry/heel-lift.ts" }], "G-ONE-FILES"),
            "PROOF-BAD",
        ),
        wantFail(diffOf([{ status: "M", path: "tests/fixtures/SAMPLE_Top.glb" }], "G-R4-MESH"), "PROOF-BAD"),
        wantFail(
            diffOf([{ status: "M", path: "vertex/src/lib/geometry/text-marking/apply.ts" }], "G-R5-TEXT"),
            "PROOF-BAD",
        ),
        wantFail(diffOf([{ status: "M", path: "vertex-api/src/index.ts" }], "G-R6-DEPLOY"), "PROOF-BAD"),
        wantPass(
            gate("G-HASH", "R7", "abc" === `${"ab"}c`, "abc", "abc", "identical position hash"),
            "PROOF-NOOP",
        ),
        wantFail(gate("G-HASH", "R7", "abc" === "def", "abc", "def", "position hash changed"), "PROOF-BAD"),
    ];
}
