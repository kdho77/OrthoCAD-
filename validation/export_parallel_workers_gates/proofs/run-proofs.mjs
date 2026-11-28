/**
 * No-op proofs must pass. Bad-change proofs must fail.
 * Runs on the frozen checker only. Do not edit after the freeze commit.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradeAll, maxVertexDeltaMm } from "../checker.mjs";
import { observeSource } from "../observe-source.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const noopTree = path.join(here, "noop-tree");
const badTree = path.join(here, "bad-tree");
const failures = [];

function check(name, ok, detail) {
    if (ok) {
        process.stdout.write(`PASS ${name}\n`);
        return;
    }
    failures.push(`${name}: ${detail}`);
    process.stdout.write(`FAIL ${name}: ${detail}\n`);
}

function mesh(sha) {
    return { sha256: sha, triangleCount: 1200, watertight: true, euler: 2, maxAbsDeltaMm: 0 };
}

function goodGeometry() {
    return {
        stockLeft: mesh("aaa"),
        stockRight: mesh("bbb"),
        engravedLeft: mesh("ccc"),
        engravedRight: mesh("ddd"),
        singleFootLeft: mesh("aaa"),
        engravedMarking: { surface: "bottom", mode: "engrave", addPatientName: true },
    };
}

function goodRuntime() {
    return {
        maxActiveWorkers: 2,
        distinctWorkersPosted: 2,
        constructed: 2,
        terminated: 2,
        headlessExportOk: true,
        workerTypeDuringHeadless: "undefined",
    };
}

const noopSource = observeSource(noopTree, noopTree, null);
const badSource = observeSource(badTree, badTree, null);
const tamperedSource = observeSource(badTree, noopTree, null);

check(
    "noop-tree capacity >= 2",
    noopSource.maxConcurrentCapacity >= 2,
    JSON.stringify(noopSource.maxConcurrentCapacity),
);
check("noop-tree pairDispatch parallel", noopSource.pairDispatch === "parallel", noopSource.pairDispatch);
check(
    "noop-tree Worker undefined fallback",
    noopSource.workerUndefinedFallback === true,
    String(noopSource.workerUndefinedFallback),
);
check("noop-tree terminate >= 1", noopSource.terminateCalls >= 1, String(noopSource.terminateCalls));
check("noop-tree lifecycle >= 1", noopSource.lifecycleHooks >= 1, String(noopSource.lifecycleHooks));
check(
    "noop-tree delegates to existing build",
    noopSource.workerDelegatesToExistingBuild === true && noopSource.workerDefinesOwnLoft === false,
    JSON.stringify({
        delegates: noopSource.workerDelegatesToExistingBuild,
        own: noopSource.workerDefinesOwnLoft,
        scripts: noopSource.workerScripts,
    }),
);
check(
    "noop-tree export worker hosts >= 1",
    noopSource.exportWorkerHosts >= 1,
    String(noopSource.exportWorkerHosts),
);
check(
    "noop-tree fingerprint unchanged vs itself",
    noopSource.fingerprintChanged === false,
    String(noopSource.fingerprintChanged),
);
check("noop-tree scope empty", noopSource.scopeViolations.length === 0, noopSource.scopeViolations.join(","));

check("bad-tree capacity < 2", badSource.maxConcurrentCapacity < 2, String(badSource.maxConcurrentCapacity));
check("bad-tree pairDispatch serial", badSource.pairDispatch === "serial", badSource.pairDispatch);
check(
    "bad-tree missing Worker fallback",
    badSource.workerUndefinedFallback === false,
    String(badSource.workerUndefinedFallback),
);
check("bad-tree terminate == 0", badSource.terminateCalls === 0, String(badSource.terminateCalls));
check("bad-tree lifecycle == 0", badSource.lifecycleHooks === 0, String(badSource.lifecycleHooks));
check(
    "bad-tree does not delegate",
    badSource.workerDelegatesToExistingBuild === false && badSource.workerDefinesOwnLoft === true,
    JSON.stringify({
        delegates: badSource.workerDelegatesToExistingBuild,
        own: badSource.workerDefinesOwnLoft,
    }),
);
check(
    "bad-tree fingerprint differs from noop copy",
    tamperedSource.fingerprintChanged === true,
    String(tamperedSource.fingerprintChanged),
);

const goodObs = {
    source: {
        ...noopSource,
        scopeViolations: [],
        forbiddenSecurityPaths: [],
        surfaceFilesChanged: [],
        seamLayerFilesChanged: [],
        textFilesChanged: [],
        fingerprintChanged: false,
        cacheInvalidationChanged: false,
    },
    runtime: goodRuntime(),
    geometry: goodGeometry(),
    existingTests: { exitCode: 0, command: "proof" },
};
const goodGrades = gradeAll(goodObs);
for (const grade of goodGrades) {
    check(`noop grade ${grade.id}`, grade.pass === true, grade.detail);
}

function expectFail(id, obs, label) {
    const grade = gradeAll(obs).find((row) => row.id === id);
    check(`bad ${label} fails ${id}`, grade?.pass === false, JSON.stringify(grade?.measured));
}

expectFail(
    "G1",
    { ...goodObs, runtime: { ...goodRuntime(), maxActiveWorkers: 1, distinctWorkersPosted: 1 } },
    "serial workers",
);
expectFail(
    "G2-identity",
    {
        ...goodObs,
        geometry: { ...goodGeometry(), stockLeft: { ...mesh("aaa"), maxAbsDeltaMm: 0.4 } },
    },
    "vertex moved 0.4 mm",
);
expectFail(
    "G2-worker",
    {
        ...goodObs,
        source: { ...goodObs.source, workerDelegatesToExistingBuild: false, workerDefinesOwnLoft: true },
    },
    "worker defines its own loft",
);
expectFail(
    "G3",
    {
        ...goodObs,
        runtime: { ...goodRuntime(), headlessExportOk: false, workerTypeDuringHeadless: "function" },
    },
    "headless export threw",
);
expectFail("G4", { ...goodObs, runtime: { ...goodRuntime(), terminated: 0 } }, "workers left running");
expectFail(
    "G-existing",
    { ...goodObs, existingTests: { exitCode: 1, command: "proof" } },
    "existing tests red",
);
expectFail(
    "R1",
    {
        ...goodObs,
        source: {
            ...goodObs.source,
            surfaceFilesChanged: ["vertex/src/lib/geometry/procedural-wall/reconstruct.ts"],
        },
    },
    "reconstruct.ts edited",
);
expectFail(
    "R2",
    { ...goodObs, source: { ...goodObs.source, seamLayerFilesChanged: ["vertex/src/lib/kiri/slicer.ts"] } },
    "slicer seam file edited",
);
expectFail(
    "R3",
    { ...goodObs, source: { ...goodObs.source, scopeViolations: ["vertex/src/lib/geometry/sink.ts"] } },
    "scope left the export path",
);
expectFail(
    "R4",
    {
        ...goodObs,
        source: { ...goodObs.source, textFilesChanged: ["vertex/src/lib/geometry/text-marking/apply.ts"] },
    },
    "text marking edited",
);
expectFail(
    "R5",
    { ...goodObs, source: { ...goodObs.source, forbiddenSecurityPaths: ["vertex-api/server.ts"] } },
    "vertex-api touched",
);
expectFail(
    "R6",
    { ...goodObs, source: { ...goodObs.source, fingerprintChanged: true, cacheInvalidationChanged: true } },
    "fingerprint and cache invalidation edited",
);

const stl = Buffer.alloc(84 + 50);
stl.writeUInt32LE(1, 80);
stl.writeFloatLE(1.25, 84 + 12);
const flipped = Buffer.from(stl);
flipped.writeFloatLE(1.25 + 0.5, 84 + 12);
check("noop STL delta is 0.0 mm", maxVertexDeltaMm(stl, stl) === 0, String(maxVertexDeltaMm(stl, stl)));
const brokenDelta = maxVertexDeltaMm(stl, flipped);
check("bad STL copy delta is 0.5 mm", brokenDelta === 0.5, String(brokenDelta));

const brokenObs = {
    ...goodObs,
    geometry: {
        ...goodGeometry(),
        stockLeft: { ...mesh("aaa"), maxAbsDeltaMm: brokenDelta },
    },
};
expectFail("G2-identity", brokenObs, "flipped STL vertex");
expectFail("R1", brokenObs, "flipped STL surface");
expectFail("R6", brokenObs, "flipped STL geometry");

const temp = mkdtempSync(path.join(tmpdir(), "gate-bad-copy-"));
execFileSync("cp", ["-a", `${noopTree}/.`, temp]);
const fingerprintFile = path.join(
    temp,
    "vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.ts",
);
writeFileSync(
    fingerprintFile,
    readFileSync(fingerprintFile, "utf8").replace("frozen-fingerprint", "broken-fingerprint"),
);
const brokenCopy = observeSource(temp, noopTree, null);
check(
    "broken fingerprint copy is detected",
    brokenCopy.fingerprintChanged === true && brokenCopy.cacheInvalidationChanged === true,
    JSON.stringify({
        fingerprintChanged: brokenCopy.fingerprintChanged,
        cacheInvalidationChanged: brokenCopy.cacheInvalidationChanged,
    }),
);

if (failures.length) {
    process.stderr.write(`\n${failures.length} proof failure(s)\n`);
    process.exit(1);
}
process.stdout.write("\nall no-op proofs passed and all bad-change proofs failed\n");
