// Frozen before grading. No-op proofs must pass. Bad-change proofs must fail.
// Run: node validation/export_parallel_workers_gates/proofs.mjs

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    checkEngraveMarking,
    checkExportCancel,
    checkFallback,
    checkGeometryMatch,
    checkHashesDiffer,
    checkParallelDispatch,
    checkPreviewCancel,
    checkSourceRules,
    checkTests,
    checkWarm,
    checkWorkerCase,
} from "./checkers.mjs";
import { evaluateSource } from "./source-gate.mjs";
import {
    compareStlBuffers,
    manifoldOf,
    parseBinaryStl,
    tetrahedronTriangles,
    writeBinaryStl,
} from "./stl-compare.mjs";

const results = [];

function expectPass(name, row) {
    const ok = row.pass === true;
    results.push({ name, kind: "noop", ok, pass: row.pass });
    if (!ok) console.error(`NOOP FAIL ${name}`, JSON.stringify(row.measured));
}

function expectFail(name, row) {
    const ok = row.pass === false;
    results.push({ name, kind: "bad", ok, pass: row.pass });
    if (!ok) console.error(`BAD CHANGE DID NOT FAIL ${name}`, JSON.stringify(row.measured));
}

const goodDispatch = {
    peakBusyWorkers: 2,
    eventLoopTurnedWhileBothBusy: true,
    events: [
        { kind: "construct", workerId: 1 },
        { kind: "construct", workerId: 2 },
        { kind: "solid-post", workerId: 1, side: "left" },
        { kind: "solid-post", workerId: 2, side: "right" },
    ],
};
const badDispatch = {
    peakBusyWorkers: 1,
    eventLoopTurnedWhileBothBusy: false,
    events: [
        { kind: "construct", workerId: 1 },
        { kind: "solid-post", workerId: 1, side: "left" },
        { kind: "solid-post", workerId: 1, side: "right" },
    ],
};

const dir = mkdtempSync(join(tmpdir(), "export-gates-proof-"));
writeFileSync(join(dir, "good-dispatch.json"), JSON.stringify(goodDispatch));
writeFileSync(join(dir, "bad-dispatch.json"), JSON.stringify(badDispatch));
expectPass(
    "T1 good trace",
    checkParallelDispatch(JSON.parse(readFileSync(join(dir, "good-dispatch.json"), "utf8"))),
);
expectFail(
    "T1 sequential one worker",
    checkParallelDispatch(JSON.parse(readFileSync(join(dir, "bad-dispatch.json"), "utf8"))),
);

const goodPreview = { preview: { constructed: 1, terminated: true, rejectedCancelled: true } };
const badPreview = { preview: { constructed: 1, terminated: false, rejectedCancelled: false } };
expectPass("T4a terminate", checkPreviewCancel(goodPreview));
expectPass(
    "T4a terminated without rejection",
    checkPreviewCancel({ preview: { constructed: 1, terminated: true, rejectedCancelled: false } }),
);
expectFail("T4a left running", checkPreviewCancel(badPreview));

const goodExport = {
    exportAbort: { constructed: 2, terminated: true, rejectedCancelled: true },
    exportUnmount: { constructed: 1, terminated: true, rejectedCancelled: true },
};
const badExport = {
    exportAbort: { constructed: 0, terminated: false, rejectedCancelled: false },
    exportUnmount: { constructed: 0, terminated: false, rejectedCancelled: false },
};
expectPass("T4b abort and unmount", checkExportCancel(goodExport));
expectFail("T4b no workers terminated", checkExportCancel(badExport));

const tetra = writeBinaryStl(tetrahedronTriangles());
const moved = tetrahedronTriangles();
moved[0][0] = [moved[0][0][0] + 0.2, moved[0][0][1], moved[0][0][2]];
const broken = writeBinaryStl(moved);
writeFileSync(join(dir, "good.stl"), tetra);
writeFileSync(join(dir, "bad.stl"), broken);
const same = compareStlBuffers(readFileSync(join(dir, "good.stl")), readFileSync(join(dir, "good.stl")));
const delta = compareStlBuffers(readFileSync(join(dir, "good.stl")), readFileSync(join(dir, "bad.stl")));
expectPass("geometry identical", checkGeometryMatch(same, null, null));
expectFail("geometry vertex moved 0.2 mm", checkGeometryMatch(delta, null, null));

const openTri = writeBinaryStl([
    [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
    ],
]);
const openMan = manifoldOf(parseBinaryStl(openTri));
const closedMan = manifoldOf(parseBinaryStl(tetra));
if (!(closedMan.isWatertight && closedMan.eulerCharacteristic === 2 && closedMan.openEdges === 0)) {
    results.push({ name: "tetra watertight", kind: "noop", ok: false, pass: false });
    console.error("tetra manifold", closedMan);
} else {
    results.push({ name: "tetra watertight", kind: "noop", ok: true, pass: true });
}
if (openMan.isWatertight || openMan.eulerCharacteristic === 2) {
    results.push({ name: "open triangle not watertight", kind: "bad", ok: false, pass: true });
    console.error("open triangle looked closed", openMan);
} else {
    results.push({ name: "open triangle not watertight", kind: "bad", ok: true, pass: false });
}

const main = {
    ok: true,
    workerConstructs: 0,
    workerPosts: 0,
    byteLength: 1000,
    sha256: "abc",
    product: closedProduct(),
};
const warm = { ok: true, workerConstructs: 0, workerPosts: 0, byteLength: 1000, sha256: "abc" };
const worker = {
    ok: true,
    workerConstructs: 1,
    workerPosts: 1,
    workerErrors: [],
    fallbackWarnings: [],
    sha256: "abc",
    byteLength: 1000,
};
expectPass("T3 fallback", checkFallback(main));
expectFail("T3 constructed a worker", checkFallback({ ...main, workerConstructs: 1, workerPosts: 1 }));
expectPass("warm cache", checkWarm(main, warm));
expectFail("warm rebuilt", checkWarm(main, { ...warm, sha256: "def", workerPosts: 1 }));
expectPass("worker produced solid", checkWorkerCase(worker));
expectFail(
    "worker fell back",
    checkWorkerCase({ ...worker, fallbackWarnings: ["export solid falling back"] }),
);
expectPass("bottom engrave", checkEngraveMarking({ textSurface: "bottom", textMode: "engrave" }));
expectFail("wall emboss", checkEngraveMarking({ textSurface: "wall", textMode: "emboss" }));
expectPass("engrave changes bytes", checkHashesDiffer({ sha256: "stock" }, { sha256: "name" }));
expectFail("engrave identical to stock", checkHashesDiffer({ sha256: "stock" }, { sha256: "stock" }));
expectPass("tests green", checkTests(0));
expectFail("tests red", checkTests(1));

const empty = evaluateSource({ changedFiles: [], patch: "", sampleTopBodyIdentical: true });
const emptyRules = checkSourceRules(empty);
for (const [id, rule] of Object.entries(emptyRules)) {
    expectPass(`source ${id} empty diff`, rule);
}

const dirty = evaluateSource({
    changedFiles: [
        "vertex/src/lib/kiri/slicer.ts",
        "vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.ts",
        "vertex/src/lib/geometry/text-marking/apply.ts",
        "vertex/src/lib/geometry/mesh-close.ts",
        "vertex/unrelated.ts",
        "vertex/prisma/schema.prisma",
    ],
    patch: '+const api_key = "secret";\n+user mrn 123\n',
    sampleTopBodyIdentical: false,
});
const dirtyRules = checkSourceRules(dirty);
for (const [id, rule] of Object.entries(dirtyRules)) {
    expectFail(`source ${id} broken copy`, rule);
}

function closedProduct() {
    return {
        isWatertight: true,
        euler: 2,
        openEdges: 0,
        nonManifoldEdges: 0,
        triangles: 4,
    };
}

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, dir, results }, null, 2));
if (failed.length > 0) process.exit(1);
