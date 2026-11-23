// FROZEN runner. Imports the product at the worktree SHA and scores G1–G6.
// Gate thresholds live in check.ts. This file does not retune them after the freeze.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "@rstest/core";
import {
    BASE_SHA,
    BLOCK_LENGTH_MM,
    BLOCK_WIDTH_MM,
    CREATE_SAVED_DESIGN_KEYS,
    createSavedDesignSideOk,
    cuttingSegments,
    EDGE_CLEARANCE_MM,
    expectedInternalSide,
    FROZEN_SPINDLE,
    feedsOk,
    G1_FIXTURES,
    G2_SIZES,
    lrFilename,
    matchesOutline,
    maxOwnEntryMm,
    minEdgeClearanceMm,
    minGapToOtherOutlines,
    OTHER_OUTLINE_CLEARANCE_MM,
    OWN_ENTRY_SLACK_MM,
    parseProgram,
    profileDiffs,
    scopeFilesOk,
    secondSlotToeSlideMm,
    sha256,
    singleSideFilename,
    syntheticProofs,
    TOE_SLIDE_MAX_MM,
    toolsOk,
    type Xy,
} from "./check.ts";

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

interface JobSpec {
    id: string;
    menSize: number;
    sampleTop: boolean;
    millSide: "omit" | "LR" | "RR" | "LL";
}

interface FootMeasure {
    slot: number;
    foot: string;
    otherGapMm: number | null;
}

interface JobRecord {
    id: string;
    menSize: number;
    sampleTop: boolean;
    millSide: string;
    refused: boolean;
    error: string | null;
    sha256: string | null;
    bytes: number | null;
    filename: string | null;
    filenameMcp: string | null;
    footComment: string | null;
    sides: string[];
    edgeClearanceMm: number | null;
    feet: FootMeasure[];
    minOtherGapMm: number | null;
    ownEntryMm: number | null;
    slideMm: number | null;
    slot1HeelX: number | null;
    slot2HeelX: number | null;
    outlineLengthMm: number | null;
    placementMedianMm: number | null;
    feedsOk: boolean | null;
    toolsOk: boolean | null;
    spindleOk: boolean | null;
    outlineOk: boolean | null;
    outlineDetail: string | null;
}

interface GateRow {
    id: string;
    pass: boolean;
    measured: string;
    threshold: string;
}

interface GradeFile {
    label: string;
    sha: string;
    ownEntryMaxMm: number | null;
    gates: GateRow[];
    jobs: JobRecord[];
    profileDiffs: string[];
    scope: { ok: boolean; reasons: string[] };
    schema: string;
    savedDesign: string;
}

function assetIdFor(sampleTop: boolean): string {
    return sampleTop ? "sample-top" : "clinical-fixture";
}

function sideRank(side: string): number {
    if (side === "left") return 0;
    if (side === "right") return 1;
    return 2;
}

function shortError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/\s+/g, " ").slice(0, 400);
}

function median(values: number[]): number {
    if (values.length === 0) return Infinity;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? Infinity;
}

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    const t = len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
    return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function installSampleFetch(): void {
    const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
    const orig = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.toString()
                  : String((input as { url?: string } | null)?.url ?? input);
        if (/SAMPLE_Top\.glb/i.test(url)) {
            return new Response(bytes, {
                status: 200,
                headers: { "content-type": "model/gltf-binary" },
            });
        }
        return orig(input as Parameters<typeof orig>[0], init);
    }) as typeof fetch;
}

function flatProfile(profile: {
    id: string;
    strategy: string;
    strategyContour: string;
    tableWidthMm: number;
    tableLengthMm: number;
    materialHeightMm: number;
    freeMovementHeightMm: number;
    topOffsetMm: number;
    zOffsetCorrectionMm: number;
    extraMovementMm: number;
    layeredMm: number;
    stepoverBallMm: number;
    stepoverFlatMm: number;
    sampleMm: number;
    chordTolMm: number;
    heelDirection: string;
    contourEnabled: boolean;
    toolpathCutter: { diameterMm: number; type: string; rpm: number };
    contourCutter: { diameterMm: number; type: string; rpm: number };
    topFeeds: { dip: number; normal: number; slow: number; contour: number };
    bottomFeeds: { dip: number; normal: number; slow: number; contour: number };
}): Record<string, unknown> {
    return {
        id: profile.id,
        strategy: profile.strategy,
        strategyContour: profile.strategyContour,
        tableWidthMm: profile.tableWidthMm,
        tableLengthMm: profile.tableLengthMm,
        materialHeightMm: profile.materialHeightMm,
        freeMovementHeightMm: profile.freeMovementHeightMm,
        topOffsetMm: profile.topOffsetMm,
        zOffsetCorrectionMm: profile.zOffsetCorrectionMm,
        extraMovementMm: profile.extraMovementMm,
        layeredMm: profile.layeredMm,
        stepoverBallMm: profile.stepoverBallMm,
        stepoverFlatMm: profile.stepoverFlatMm,
        sampleMm: profile.sampleMm,
        chordTolMm: profile.chordTolMm,
        toolDiameterMm: profile.toolpathCutter.diameterMm,
        toolType: profile.toolpathCutter.type,
        toolRpm: profile.toolpathCutter.rpm,
        contourDiameterMm: profile.contourCutter.diameterMm,
        contourType: profile.contourCutter.type,
        contourRpm: profile.contourCutter.rpm,
        topDip: profile.topFeeds.dip,
        topNormal: profile.topFeeds.normal,
        topSlow: profile.topFeeds.slow,
        topContour: profile.topFeeds.contour,
        bottomDip: profile.bottomFeeds.dip,
        bottomNormal: profile.bottomFeeds.normal,
        bottomSlow: profile.bottomFeeds.slow,
        bottomContour: profile.bottomFeeds.contour,
        heelDirection: profile.heelDirection,
        contourEnabled: profile.contourEnabled,
    };
}

function readDiff(): { files: string[]; patches: Record<string, string> } {
    if (process.env.EVA_GATE_LABEL !== "candidate") return { files: [], patches: {} };
    const files = execSync(`git diff --name-only ${BASE_SHA} HEAD`, { encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const patches: Record<string, string> = {};
    for (const file of [
        "vertex/src/lib/cnc/export.ts",
        "vertex/src/lib/cnc/compose.ts",
        "packages/mcp/src/tools/schemas.ts",
        "packages/mcp/src/tools/handlers.ts",
    ]) {
        if (!files.includes(file)) continue;
        patches[file] = execSync(`git diff -U0 ${BASE_SHA} HEAD -- ${file}`, {
            encoding: "utf8",
            maxBuffer: 20_000_000,
        });
    }
    return { files, patches };
}

type NameMod = {
    cncPairGcodeFilename: (input: {
        firstName?: string;
        lastName?: string;
        material?: string;
        sides: Array<"left" | "right">;
        millSide?: string;
        mill_side?: string;
        base?: { assetId?: string };
    }) => string;
};

function filenameFor(
    mod: NameMod,
    sides: Array<"left" | "right">,
    millSide: JobSpec["millSide"],
    sampleTop: boolean,
): string {
    return mod.cncPairGcodeFilename({
        firstName: "Fixture",
        lastName: "Sample",
        material: "EVA",
        sides,
        ...(millSide === "omit" ? {} : { millSide, mill_side: millSide }),
        base: { assetId: assetIdFor(sampleTop) },
    });
}

test(
    "eva cnc gates",
    async () => {
        const mode = process.env.EVA_GATE_MODE ?? "grade";
        const outPath = process.env.EVA_GATE_OUT;
        if (!outPath) throw new Error("EVA_GATE_OUT is required");
        installSampleFetch();
        if (mode === "proof") {
            const proof = await runProof();
            writeFileSync(outPath, JSON.stringify(proof, null, 2));
            if (!proof.pass) {
                throw new Error(`proof failed: ${JSON.stringify(proof.failures)}`);
            }
            return;
        }
        const grade = await runGrade();
        writeFileSync(outPath, JSON.stringify(grade, null, 2));
    },
    45 * 60 * 1000,
);

async function loadApi() {
    const mill = await import("@/lib/cnc/mill-job");
    const placement = await import("@/lib/cnc/placement");
    const compose = await import("@/lib/cnc/compose");
    const profileMod = await import("@/lib/cnc/profile");
    const polygon = await import("@/lib/cnc/polygon");
    const store = await import("@/stores/design-store");
    const names = (await import("../../vertex/shared/export-filename.ts")) as NameMod;
    const mcpNames = (await import("../../packages/mcp/src/shared/export-filename.ts")) as NameMod;
    const schemas = await import("../../packages/mcp/src/tools/schemas.ts");
    return { mill, placement, compose, profileMod, polygon, store, names, mcpNames, schemas };
}

function makeDesign(api: Awaited<ReturnType<typeof loadApi>>, menSize: number, sampleTop: boolean) {
    const seed = api.store.defaultDesign();
    seed.method = "milling_3axis";
    seed.usMenSize = menSize;
    seed.sizeSystem = "us";
    const design = api.store.createDesignWithStockPlaceholder(seed);
    design.method = "milling_3axis";
    design.usMenSize = menSize;
    design.sizeSystem = "us";
    if (design.paired) {
        design.paired = {
            ...design.paired,
            leftMethod: "milling_3axis",
            rightMethod: "milling_3axis",
        };
    }
    if (!sampleTop) {
        const retag = <T extends { assetId?: string; name?: string }>(base: T | undefined): T | undefined =>
            base ? { ...base, assetId: "clinical-fixture", name: "ClinicalFixture" } : base;
        design.base = retag(design.base);
        if (design.paired) {
            design.paired = {
                ...design.paired,
                leftBase: retag(design.paired.leftBase),
                rightBase: retag(design.paired.rightBase),
            };
        }
        design.customPrefabId = "clinical-fixture";
    }
    return design;
}

async function runJob(
    api: Awaited<ReturnType<typeof loadApi>>,
    spec: JobSpec,
    outlines: Map<string, Xy[]>,
): Promise<{ record: JobRecord; gcode: string | null; machineOutlines: Xy[][] }> {
    const started = Date.now();
    console.log(`[gate] ${spec.id} ${spec.millSide} size ${spec.menSize}`);
    const record: JobRecord = {
        id: spec.id,
        menSize: spec.menSize,
        sampleTop: spec.sampleTop,
        millSide: spec.millSide,
        refused: false,
        error: null,
        sha256: null,
        bytes: null,
        filename: null,
        filenameMcp: null,
        footComment: null,
        sides: [],
        edgeClearanceMm: null,
        feet: [],
        minOtherGapMm: null,
        ownEntryMm: null,
        slideMm: null,
        slot1HeelX: null,
        slot2HeelX: null,
        outlineLengthMm: null,
        placementMedianMm: null,
        feedsOk: null,
        toolsOk: null,
        spindleOk: null,
        outlineOk: null,
        outlineDetail: null,
    };
    const profile = api.profileMod.cloneProfile(api.profileMod.IDAHO_PROFILE);
    const design = makeDesign(api, spec.menSize, spec.sampleTop);
    let gcode: string | null = null;
    let machineOutlines: Xy[][] = [];
    try {
        const input: {
            design: ReturnType<typeof makeDesign>;
            millSide?: "LR" | "RR" | "LL";
            mill_side?: "LR" | "RR" | "LL";
        } = { design };
        if (spec.millSide !== "omit") {
            input.millSide = spec.millSide;
            input.mill_side = spec.millSide;
        }
        const milled = await api.mill.buildMillCncGcode(input);
        gcode = milled.gcode;
        record.sha256 = sha256(gcode);
        record.bytes = gcode.length;
        record.sides = milled.sides.slice();
        record.footComment = parseProgram(gcode).footComment;
        const assetSides = milled.sides as Array<"left" | "right">;
        record.filename = filenameFor(api.names, assetSides, spec.millSide, spec.sampleTop);
        record.filenameMcp = filenameFor(api.mcpNames, assetSides, spec.millSide, spec.sampleTop);
        const parts = await api.compose.workpiecesFromDesign(design, milled.sides, profile);
        const placed = api.placement.placeWorkpieces(profile, parts);
        for (const part of placed) {
            const key = `${spec.menSize}:${part.side}`;
            if (!outlines.has(key)) {
                outlines.set(
                    key,
                    part.outline.map((p) => ({ x: p.x, y: p.y })),
                );
            }
        }
        const xs = placed[0]?.outline.map((p) => p.x) ?? [];
        if (xs.length) record.outlineLengthMm = Math.max(...xs) - Math.min(...xs);
        const byPocket = placed.slice().sort((a, b) => a.pocketIndex - b.pocketIndex);
        const heelX = (part: (typeof placed)[number]) => {
            let min = Infinity;
            for (const p of part.outline) {
                const w = api.placement.machineXY(p, part, profile);
                if (w.x < min) min = w.x;
            }
            return min;
        };
        if (byPocket.length >= 2 && byPocket[0] && byPocket[1]) {
            record.slot1HeelX = heelX(byPocket[0]);
            record.slot2HeelX = heelX(byPocket[1]);
            record.slideMm = secondSlotToeSlideMm(record.slot1HeelX, record.slot2HeelX);
        }
        const ordered = placed
            .map((part, index) => ({ part, index }))
            .sort((a, b) => sideRank(a.part.side) - sideRank(b.part.side) || a.index - b.index)
            .map((row) => row.part);
        machineOutlines = ordered.map((part) =>
            part.outline.map((p) => api.placement.machineXY(p, part, profile)),
        );
        const program = parseProgram(gcode);
        const cuts = cuttingSegments(program);
        record.edgeClearanceMm = minEdgeClearanceMm(cuts);
        const gaps = minGapToOtherOutlines(cuts, machineOutlines);
        record.feet = ordered.map((part, slot) => ({
            slot,
            foot: part.side,
            otherGapMm: gaps.get(slot) ?? null,
        }));
        const gapValues = record.feet.map((foot) => foot.otherGapMm).filter((v): v is number => v != null);
        record.minOtherGapMm = gapValues.length ? Math.min(...gapValues) : null;
        record.ownEntryMm = maxOwnEntryMm(cuts, machineOutlines);
        record.feedsOk = feedsOk(program.feeds);
        record.toolsOk = toolsOk(program.toolComments);
        record.spindleOk = program.spindles.length > 0 && program.spindles.every((s) => s === FROZEN_SPINDLE);
        const distances: number[] = [];
        for (let slot = 0; slot < ordered.length; slot++) {
            const part = ordered[slot]!;
            const poly = machineOutlines[slot] ?? [];
            const offset = api.polygon.offsetClosed(poly, 5, 0.05);
            const loop = program.perimeters.find((item) => item.slot === slot);
            if (!loop || offset.length < 3) continue;
            const step = Math.max(1, Math.floor(loop.points.length / 400));
            for (let i = 0; i < loop.points.length; i += step) {
                const p = loop.points[i]!;
                let best = Infinity;
                for (let e = 0; e < offset.length; e++) {
                    const a = offset[e]!;
                    const b = offset[(e + 1) % offset.length]!;
                    const d = pointSegDist(p.x, p.y, a.x, a.y, b.x, b.y);
                    if (d < best) best = d;
                }
                distances.push(best);
            }
            void part;
        }
        record.placementMedianMm = distances.length ? median(distances) : null;
        if (spec.millSide === "RR" || spec.millSide === "LL") {
            const expected = expectedInternalSide(spec.sampleTop, spec.millSide);
            const want = outlines.get(`${spec.menSize}:${expected}`) ?? [];
            const otherSide = expected === "left" ? "right" : "left";
            const other = outlines.get(`${spec.menSize}:${otherSide}`) ?? [];
            const details: string[] = [];
            let ok = placed.length === 2 && want.length > 0 && other.length > 0;
            for (const part of placed) {
                const local = part.outline.map((p) => ({ x: p.x, y: p.y }));
                const match = matchesOutline(local, want, other);
                details.push(
                    `${part.side} mean ${match.meanMm.toFixed(3)} other ${match.otherMm.toFixed(3)}`,
                );
                if (!match.ok) ok = false;
            }
            const comment = `${expected}+${expected}`;
            if (record.footComment !== comment) {
                ok = false;
                details.push(`foot comment ${record.footComment} != ${comment}`);
            }
            record.outlineOk = ok;
            record.outlineDetail = details.join("; ");
        }
    } catch (error) {
        record.refused = true;
        record.error = shortError(error);
        gcode = null;
    }
    console.log(
        `[gate] ${spec.id} ${spec.millSide} ${record.refused ? `REFUSED ${record.error}` : record.sha256?.slice(0, 12)} ` +
            `edge=${record.edgeClearanceMm?.toFixed(3) ?? "-"} gap=${record.minOtherGapMm?.toFixed(3) ?? "-"} ` +
            `slide=${record.slideMm?.toFixed(3) ?? "-"} ${(Date.now() - started) / 1000}s`,
    );
    return { record, gcode, machineOutlines };
}

function schemaReport(api: Awaited<ReturnType<typeof loadApi>>): { pass: boolean; detail: string } {
    const schema = api.schemas.generateCncGcodeInputSchema;
    const omitted = schema.safeParse({ design_id: UUID });
    const rr = schema.safeParse({ design_id: UUID, mill_side: "RR" });
    const ll = schema.safeParse({ design_id: UUID, mill_side: "LL" });
    const rx = schema.safeParse({ design_id: UUID, mill_side: "RX" });
    const omittedSide =
        omitted.success && typeof omitted.data === "object" && omitted.data
            ? (omitted.data as { mill_side?: unknown }).mill_side
            : undefined;
    const rrSide = rr.success ? (rr.data as { mill_side?: unknown }).mill_side : undefined;
    const llSide = ll.success ? (ll.data as { mill_side?: unknown }).mill_side : undefined;
    const pass = omittedSide === "LR" && rrSide === "RR" && llSide === "LL" && !rx.success;
    return {
        pass,
        detail: `omitted=${String(omittedSide)} RR=${String(rrSide)} LL=${String(llSide)} RX=${rx.success ? "accepted" : "rejected"}`,
    };
}

function savedDesignReport(api: Awaited<ReturnType<typeof loadApi>>): { pass: boolean; detail: string } {
    const keys = Object.keys(api.schemas.createSavedDesignInputSchema.shape);
    const check = createSavedDesignSideOk(keys);
    const frozen = CREATE_SAVED_DESIGN_KEYS.join(",");
    return {
        pass: check.ok,
        detail: check.ok ? `top-level keys stay ${frozen}` : `added ${check.added.join(",")}`,
    };
}

async function runGrade(): Promise<GradeFile> {
    const api = await loadApi();
    const label = process.env.EVA_GATE_LABEL ?? "base";
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const profileProblems = profileDiffs(
        flatProfile(api.profileMod.cloneProfile(api.profileMod.IDAHO_PROFILE)),
    );
    const diff = readDiff();
    const scope = scopeFilesOk(diff.files, diff.patches);
    const schema = schemaReport(api);
    const saved = savedDesignReport(api);
    const outlines = new Map<string, Xy[]>();
    const jobs: JobRecord[] = [];
    const specs: JobSpec[] = [];
    for (const fixture of G1_FIXTURES) {
        specs.push({ ...fixture, millSide: "omit" });
        specs.push({ ...fixture, millSide: "LR" });
    }
    for (const menSize of G2_SIZES) {
        specs.push({ id: `sample-m${menSize}`, menSize, sampleTop: true, millSide: "LR" });
    }
    if (schema.pass || label === "candidate") {
        for (const sampleTop of [true, false]) {
            for (const millSide of ["RR", "LL"] as const) {
                specs.push({
                    id: `${sampleTop ? "sample" : "clinical"}-m9-${millSide}`,
                    menSize: 9,
                    sampleTop,
                    millSide,
                });
            }
        }
    }
    for (const spec of specs) {
        const ran = await runJob(api, spec, outlines);
        jobs.push(ran.record);
    }
    const baseRaw = process.env.EVA_GATE_BASE_JSON
        ? (JSON.parse(readFileSync(process.env.EVA_GATE_BASE_JSON, "utf8")) as GradeFile)
        : null;
    const produced = jobs.filter((job) => !job.refused && job.ownEntryMm != null);
    const ownEntryMaxMm =
        baseRaw?.ownEntryMaxMm ?? Math.max(0, ...produced.map((job) => job.ownEntryMm ?? 0));
    const gates = scoreGates({
        label,
        jobs,
        base: baseRaw,
        ownEntryMaxMm,
        profileProblems,
        scope,
        schema,
        saved,
    });
    return {
        label,
        sha,
        ownEntryMaxMm,
        gates,
        jobs,
        profileDiffs: profileProblems,
        scope,
        schema: schema.detail,
        savedDesign: saved.detail,
    };
}

function pairOf(jobs: JobRecord[], id: string, millSide: string): JobRecord | undefined {
    return jobs.find((job) => job.id === id && job.millSide === millSide);
}

function scoreGates(input: {
    label: string;
    jobs: JobRecord[];
    base: GradeFile | null;
    ownEntryMaxMm: number;
    profileProblems: string[];
    scope: { ok: boolean; reasons: string[] };
    schema: { pass: boolean; detail: string };
    saved: { pass: boolean; detail: string };
}): GateRow[] {
    const g1Failures: string[] = [];
    const g1Notes: string[] = [];
    for (const fixture of G1_FIXTURES) {
        const omit = pairOf(input.jobs, fixture.id, "omit");
        const lr = pairOf(input.jobs, fixture.id, "LR");
        const baseLr = input.base ? pairOf(input.base.jobs, fixture.id, "LR") : lr;
        const basePassed = Boolean(baseLr && !baseLr.refused && baseLr.sha256);
        if (!basePassed && input.label === "candidate") {
            g1Notes.push(`${fixture.id} BASE refuses — not a byte-identity case`);
            continue;
        }
        if (!basePassed && input.label === "base") {
            g1Notes.push(`${fixture.id} refuses on BASE — not a byte-identity case`);
        }
        if (!omit || !lr || omit.refused || lr.refused || !omit.sha256 || !lr.sha256) {
            if (input.label === "base") continue;
            g1Failures.push(`${fixture.id} missing bytes`);
            continue;
        }
        if (omit.sha256 !== lr.sha256) g1Failures.push(`${fixture.id} omit!=LR`);
        if (lr.filename !== lrFilename() || omit.filename !== lrFilename()) {
            g1Failures.push(`${fixture.id} filename ${lr.filename}`);
        }
        if (input.base && baseLr?.sha256 && lr.sha256 !== baseLr.sha256) {
            g1Failures.push(`${fixture.id} sha != BASE`);
        } else {
            g1Notes.push(`${fixture.id} ${lr.sha256.slice(0, 12)} ${lr.filename}`);
        }
    }
    if (input.scope.reasons.some((reason) => reason.includes("sha.json"))) {
        g1Failures.push("sha.json changed");
    }
    if (input.label === "candidate" && input.base) {
        const shaTouched = input.scope.reasons.some((reason) => reason.includes("golden/sha.json"));
        if (shaTouched) g1Failures.push("sha.json in diff");
    }
    const shaFileChanged =
        input.label === "candidate" &&
        input.scope.reasons.length >= 0 &&
        execSync(`git diff --name-only ${BASE_SHA} HEAD -- tests/cnc/golden/sha.json`, {
            encoding: "utf8",
        }).trim() !== "";
    if (shaFileChanged) g1Failures.push("tests/cnc/golden/sha.json changed");

    const g2Rows = G2_SIZES.map((size) => pairOf(input.jobs, `sample-m${size}`, "LR"));
    const g2Failures: string[] = [];
    const g2Measured: string[] = [];
    for (const size of G2_SIZES) {
        const job = pairOf(input.jobs, `sample-m${size}`, "LR");
        if (!job || job.refused || job.edgeClearanceMm == null) {
            g2Failures.push(`M${size} refused ${job?.error ?? "missing"}`);
            g2Measured.push(`M${size}=refused`);
            continue;
        }
        g2Measured.push(`M${size} edge ${job.edgeClearanceMm.toFixed(3)} mm`);
        if (job.edgeClearanceMm < EDGE_CLEARANCE_MM) {
            g2Failures.push(`M${size} edge ${job.edgeClearanceMm.toFixed(3)}`);
        }
    }
    void g2Rows;

    const g3Failures: string[] = [];
    const g3Measured: string[] = [];
    const considered = input.jobs.filter((job) => job.millSide === "LR" || job.millSide === "omit");
    for (const job of considered) {
        if (job.millSide === "omit") continue;
        if (job.refused) {
            if (G2_SIZES.some((size) => job.id === `sample-m${size}`)) {
                g3Failures.push(`${job.id} no program`);
            }
            continue;
        }
        const gap = job.minOtherGapMm;
        const own = job.ownEntryMm;
        const feet = job.feet
            .map((foot) => `slot${foot.slot + 1}:${foot.foot}=${foot.otherGapMm?.toFixed(3) ?? "n/a"}`)
            .join(", ");
        g3Measured.push(`${job.id} [${feet}] ownEntry ${own?.toFixed(3) ?? "n/a"}`);
        if (gap == null || gap < OTHER_OUTLINE_CLEARANCE_MM) g3Failures.push(`${job.id} gap ${gap}`);
        if (own == null || own > input.ownEntryMaxMm + OWN_ENTRY_SLACK_MM) {
            g3Failures.push(`${job.id} own entry ${own} > ${input.ownEntryMaxMm}+${OWN_ENTRY_SLACK_MM}`);
        }
        if (job.placementMedianMm == null || job.placementMedianMm > 3) {
            g3Failures.push(`${job.id} contour/placement median ${job.placementMedianMm}`);
        }
    }

    const g4Measured: string[] = [];
    const g4Failures: string[] = [];
    for (const job of input.jobs) {
        if (job.millSide === "omit" || job.refused || job.slideMm == null) continue;
        g4Measured.push(`${job.id} ${job.millSide} slide ${job.slideMm.toFixed(3)} mm`);
        if (job.slideMm > TOE_SLIDE_MAX_MM) g4Failures.push(`${job.id} slide ${job.slideMm.toFixed(3)}`);
    }

    const g5Failures: string[] = [];
    if (!input.schema.pass) g5Failures.push(input.schema.detail);
    if (!input.saved.pass) g5Failures.push(input.saved.detail);
    for (const sampleTop of [true, false]) {
        for (const millSide of ["RR", "LL"] as const) {
            const id = `${sampleTop ? "sample" : "clinical"}-m9-${millSide}`;
            const job = pairOf(input.jobs, id, millSide);
            const expectName = singleSideFilename(millSide);
            if (!job) {
                g5Failures.push(`${id} not run`);
                continue;
            }
            if (job.refused) g5Failures.push(`${id} refused ${job.error}`);
            if (job.filename !== expectName || job.filenameMcp !== expectName) {
                g5Failures.push(`${id} filename ${job.filename} / ${job.filenameMcp}`);
            }
            if (job.outlineOk !== true)
                g5Failures.push(`${id} geometry ${job.outlineDetail ?? job.footComment}`);
        }
    }

    const g6Failures: string[] = [...input.scope.reasons, ...input.profileProblems];
    for (const job of input.jobs) {
        if (job.refused) continue;
        if (job.feedsOk === false) g6Failures.push(`${job.id} feed outside frozen set`);
        if (job.toolsOk === false) g6Failures.push(`${job.id} tool is not 10mm ball`);
        if (job.spindleOk === false) g6Failures.push(`${job.id} spindle != ${FROZEN_SPINDLE}`);
    }

    return [
        {
            id: "G1",
            pass: g1Failures.length === 0,
            measured: [...g1Failures, ...g1Notes].join("; ") || "LR bytes and Fixture_Sample_EVA_LR.gcode match",
            threshold: "sha256 and filename equal BASE where BASE placement passes; sha.json unchanged",
        },
        {
            id: "G2",
            pass: g2Failures.length === 0,
            measured: g2Measured.join("; "),
            threshold: `M13.5 M14 M15 produce G-code; tool sweep inside ${BLOCK_WIDTH_MM} x ${BLOCK_LENGTH_MM} with >= ${EDGE_CLEARANCE_MM} mm edge clearance`,
        },
        {
            id: "G3",
            pass: g3Failures.length === 0,
            measured: [...g3Failures, ...g3Measured].join(" | ") || "no programs",
            threshold: `sweep-to-other-outline >= ${OTHER_OUTLINE_CLEARANCE_MM} mm; own cutout entry <= BASE max ${input.ownEntryMaxMm.toFixed(3)} + ${OWN_ENTRY_SLACK_MM} mm`,
        },
        {
            id: "G4",
            pass: g4Failures.length === 0,
            measured: g4Measured.join("; ") || "no placed pair",
            threshold: `second-slot toe slide <= ${TOE_SLIDE_MAX_MM} mm`,
        },
        {
            id: "G5",
            pass: g5Failures.length === 0,
            measured: g5Failures.length
                ? g5Failures.join("; ")
                : `${input.schema.detail}; ${input.saved.detail}`,
            threshold:
                "RR/LL mill two copies of the physical foot; filenames _EVA_RR/_EVA_LL; mill_side default LR; create_saved_design has no side parameter",
        },
        {
            id: "G6",
            pass: g6Failures.length === 0,
            measured: g6Failures.length
                ? g6Failures.join("; ")
                : "diff inside FILES; Idaho cutter/feeds/stepover/strategy/Z unchanged",
            threshold:
                "worker FILES allowlist only; profile.ts cutter, feeds, stepover, strategy, Z unchanged",
        },
    ];
}

async function runProof(): Promise<{
    pass: boolean;
    failures: string[];
    synthetic: ReturnType<typeof syntheticProofs>;
    live: Record<string, unknown>;
    broken: Record<string, unknown>;
}> {
    const failures: string[] = [];
    const synthetic = syntheticProofs();
    for (const row of synthetic) {
        if (!row.noopPass) failures.push(`${row.gate} noop did not pass (${row.detail})`);
        if (!row.badDetected) failures.push(`${row.gate} bad copy was not detected (${row.detail})`);
    }
    const api = await loadApi();
    const outlines = new Map<string, Xy[]>();
    const liveJob = await runJob(
        api,
        { id: "sample-m9", menSize: 9, sampleTop: true, millSide: "LR" },
        outlines,
    );
    const live = liveJob.record;
    if (live.refused) failures.push(`live M9 refused ${live.error}`);
    if (live.filename !== lrFilename()) failures.push(`live filename ${live.filename}`);
    if (live.edgeClearanceMm == null || live.edgeClearanceMm < EDGE_CLEARANCE_MM) {
        failures.push(`live edge ${live.edgeClearanceMm}`);
    }
    if (live.minOtherGapMm == null || live.minOtherGapMm < OTHER_OUTLINE_CLEARANCE_MM) {
        failures.push(`live gap ${live.minOtherGapMm}`);
    }
    if (live.slideMm == null || live.slideMm > TOE_SLIDE_MAX_MM) failures.push(`live slide ${live.slideMm}`);
    if (live.outlineLengthMm == null || live.outlineLengthMm < 180 || live.outlineLengthMm > 360) {
        failures.push(`live outline length ${live.outlineLengthMm} is not a shoe-sized foot`);
    }
    if ((live.placementMedianMm ?? 99) > 3) failures.push(`live placement median ${live.placementMedianMm}`);
    if (live.feedsOk === false) failures.push("live G-code feed is outside the frozen Idaho set");
    if (live.toolsOk === false) failures.push("live G-code tool is not 10mm ball");
    if (live.spindleOk === false) failures.push("live spindle is not 24000");
    const profileProblems = profileDiffs(
        flatProfile(api.profileMod.cloneProfile(api.profileMod.IDAHO_PROFILE)),
    );
    if (profileProblems.length) failures.push(`profile drift on BASE ${profileProblems.join(",")}`);
    const saved = savedDesignReport(api);
    if (!saved.pass) failures.push(`BASE create_saved_design ${saved.detail}`);

    let brokenEdge = 0;
    let hashChanged = false;
    if (liveJob.gcode) {
        const brokenGcode = `${liveJob.gcode}\nG1 X2.0000 Y20.0000 Z4.0000 F3500\n`;
        hashChanged = sha256(brokenGcode) !== live.sha256;
        brokenEdge = minEdgeClearanceMm(cuttingSegments(parseProgram(brokenGcode)));
        if (!hashChanged) failures.push("broken gcode copy did not change sha256");
        if (!(brokenEdge < EDGE_CLEARANCE_MM))
            failures.push(`broken edge copy still cleared (${brokenEdge})`);
    } else {
        failures.push("no live gcode to break");
    }
    const insideGap =
        liveJob.machineOutlines.length >= 2
            ? minGapToOtherOutlines(
                  [
                      {
                          a: {
                              x:
                                  liveJob.machineOutlines[1]!.reduce((s, p) => s + p.x, 0) /
                                  liveJob.machineOutlines[1]!.length,
                              y:
                                  liveJob.machineOutlines[1]!.reduce((s, p) => s + p.y, 0) /
                                  liveJob.machineOutlines[1]!.length,
                              z: 4,
                          },
                          b: {
                              x:
                                  liveJob.machineOutlines[1]!.reduce((s, p) => s + p.x, 0) /
                                      liveJob.machineOutlines[1]!.length +
                                  0.4,
                              y:
                                  liveJob.machineOutlines[1]!.reduce((s, p) => s + p.y, 0) /
                                  liveJob.machineOutlines[1]!.length,
                              z: 4,
                          },
                          kind: "surface",
                          slot: 0,
                      },
                  ],
                  liveJob.machineOutlines,
              ).get(0)
            : null;
    if (insideGap == null || insideGap >= OTHER_OUTLINE_CLEARANCE_MM) {
        failures.push(`broken insole crossing was not detected (${insideGap})`);
    }
    const profile = api.profileMod.cloneProfile(api.profileMod.IDAHO_PROFILE);
    const design = makeDesign(api, 9, true);
    const leftParts = await api.compose.workpiecesFromDesign(design, ["left"], profile);
    const rightParts = await api.compose.workpiecesFromDesign(design, ["right"], profile);
    const leftOutline = (leftParts[0]?.outline ?? []).map((p) => ({ x: p.x, y: p.y }));
    const rightOutline = (rightParts[0]?.outline ?? []).map((p) => ({ x: p.x, y: p.y }));
    const selfMatch = matchesOutline(leftOutline, leftOutline, rightOutline);
    const crossMatch = matchesOutline(leftOutline, rightOutline, leftOutline);
    if (!selfMatch.ok) {
        failures.push(
            `left outline self-match failed mean ${selfMatch.meanMm.toFixed(3)} other ${selfMatch.otherMm.toFixed(3)}`,
        );
    }
    if (crossMatch.ok) {
        failures.push(
            `left outline was accepted as the right foot mean ${crossMatch.meanMm.toFixed(3)} other ${crossMatch.otherMm.toFixed(3)}`,
        );
    }
    const scopeBad = scopeFilesOk(["vertex/src/lib/cnc/profile.ts"], {});
    if (scopeBad.ok) failures.push("profile.ts copy was allowed");
    const scopeGood = scopeFilesOk([], {});
    if (!scopeGood.ok) failures.push("empty diff was rejected");

    return {
        pass: failures.length === 0,
        failures,
        synthetic,
        live: {
            sha256: live.sha256,
            filename: live.filename,
            edgeClearanceMm: live.edgeClearanceMm,
            minOtherGapMm: live.minOtherGapMm,
            ownEntryMm: live.ownEntryMm,
            slideMm: live.slideMm,
            outlineLengthMm: live.outlineLengthMm,
            placementMedianMm: live.placementMedianMm,
            feet: live.feet,
        },
        broken: {
            hashChanged,
            brokenEdgeMm: brokenEdge,
            insideOtherGapMm: insideGap,
            profileRejected: !scopeBad.ok,
        },
    };
}
