/**
 * Frozen grader for export-parallel-workers.
 * Pure functions only: observations in, pass/fail out.
 * Do not edit after the freeze commit.
 */

export const THRESHOLDS = {
    maxActiveWorkers: 2,
    distinctWorkersPosted: 2,
    maxAbsDeltaMm: 0,
    euler: 2,
    minTriangles: 1,
    terminateCalls: 1,
    lifecycleHooks: 1,
    exportWorkerHosts: 1,
};

export const SURFACE_FILES = [
    "vertex/src/lib/geometry/procedural-wall/reconstruct.ts",
    "vertex/src/lib/geometry/procedural-wall/wall-spline.ts",
    "vertex/src/lib/geometry/procedural-wall/bezier-column.ts",
    "vertex/src/lib/geometry/procedural-wall/curves.ts",
    "vertex/src/lib/geometry/procedural-wall/ring-seam.ts",
    "vertex/src/lib/geometry/mesh-close.ts",
];

export const SEAM_LAYER_FILES = [
    "vertex/src/lib/geometry/procedural-wall/ring-seam.ts",
    "vertex/src/lib/geometry/procedural-wall/curves.ts",
    "vertex/src/lib/geometry/procedural-wall/wall-spline.ts",
    "vertex/src/lib/geometry/procedural-wall/bezier-column.ts",
    "vertex/src/lib/kiri/slicer.ts",
    "vertex/src/lib/kiri/gcode.ts",
];

export const TEXT_DIR = "vertex/src/lib/geometry/text-marking";
export const TEXT_SHARED = "vertex/shared/bottom-text-marking.ts";

export const FINGERPRINT_FILE = "vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.ts";

export const CACHE_INVALIDATION_FILES = [
    "vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.ts",
    "vertex/src/lib/geometry/procedural-wall/manufacturing-solid-context.ts",
    "vertex/src/stores/preview-loft-status-store.ts",
];

const MESH_KEYS = ["stockLeft", "stockRight", "engravedLeft", "engravedRight"];

export function isAllowedPath(filePath) {
    const n = filePath.replace(/\\/g, "/");
    if (n.startsWith("validation/export_parallel_workers_gates/")) return true;
    if (/\.(test|spec)\.tsx?$/.test(n)) return true;
    const exact = new Set([
        "vertex/src/lib/geometry/export-geometry.ts",
        "vertex/src/features/exports/export-service.ts",
        "vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts",
        "vertex/src/lib/geometry/procedural-wall/preview-loft-worker.ts",
        "vertex/src/lib/geometry/procedural-wall/preview-loft-queue.ts",
        "vertex/src/workers/procedural-wall.worker.ts",
    ]);
    if (exact.has(n)) return true;
    if (n.startsWith("vertex/src/workers/")) return true;
    if (
        /^vertex\/src\/lib\/geometry\/procedural-wall\/[A-Za-z0-9_.-]*(worker|parallel)[A-Za-z0-9_.-]*\.tsx?$/.test(
            n,
        )
    ) {
        return true;
    }
    if (/^vertex\/src\/lib\/geometry\/[A-Za-z0-9_.-]*(worker|parallel)[A-Za-z0-9_.-]*\.tsx?$/.test(n)) {
        return true;
    }
    if (/^vertex\/src\/features\/exports\/[A-Za-z0-9_.-]*(worker|parallel)[A-Za-z0-9_.-]*\.tsx?$/.test(n)) {
        return true;
    }
    return false;
}

export function isForbiddenPath(filePath) {
    const n = filePath.replace(/\\/g, "/");
    return /(^|\/)vertex-web(\/|$)|(^|\/)vertex-api(\/|$)|railway|fly\.toml|render\.ya?ml/i.test(n);
}

export function maxVertexDeltaMm(a, b) {
    const A = Buffer.isBuffer(a) ? a : Buffer.from(a);
    const B = Buffer.isBuffer(b) ? b : Buffer.from(b);
    if (A.length < 84 || B.length < 84) return Number.POSITIVE_INFINITY;
    const trianglesA = A.readUInt32LE(80);
    const trianglesB = B.readUInt32LE(80);
    if (trianglesA !== trianglesB) return Number.POSITIVE_INFINITY;
    const expected = 84 + trianglesA * 50;
    if (A.length < expected || B.length < expected) return Number.POSITIVE_INFINITY;
    let max = 0;
    for (let i = 0; i < trianglesA; i++) {
        const off = 84 + i * 50 + 12;
        for (let v = 0; v < 9; v++) {
            const delta = Math.abs(A.readFloatLE(off + v * 4) - B.readFloatLE(off + v * 4));
            if (delta > max) max = delta;
        }
    }
    return max;
}

function mesh(obs, key) {
    return obs.geometry?.[key] ?? null;
}

function geometryIdentityOk(obs) {
    const failures = [];
    for (const key of MESH_KEYS) {
        const row = mesh(obs, key);
        if (!row) {
            failures.push(`${key}:missing`);
            continue;
        }
        if (row.watertight !== true) failures.push(`${key}:watertight=${row.watertight}`);
        if (row.euler !== THRESHOLDS.euler) failures.push(`${key}:euler=${row.euler}`);
        if (!(row.triangleCount >= THRESHOLDS.minTriangles)) {
            failures.push(`${key}:triangles=${row.triangleCount}`);
        }
        const delta = row.maxAbsDeltaMm;
        if (!(typeof delta === "number" && delta <= THRESHOLDS.maxAbsDeltaMm)) {
            failures.push(`${key}:maxAbsDeltaMm=${delta}`);
        }
    }
    const stockLeft = mesh(obs, "stockLeft");
    const stockRight = mesh(obs, "stockRight");
    const engravedLeft = mesh(obs, "engravedLeft");
    const engravedRight = mesh(obs, "engravedRight");
    if (stockLeft && stockRight && stockLeft.sha256 === stockRight.sha256) {
        failures.push("stockLeft.sha256===stockRight.sha256");
    }
    if (stockLeft && engravedLeft && stockLeft.sha256 === engravedLeft.sha256) {
        failures.push("engravedLeft.sha256===stockLeft.sha256");
    }
    if (stockRight && engravedRight && stockRight.sha256 === engravedRight.sha256) {
        failures.push("engravedRight.sha256===stockRight.sha256");
    }
    return failures;
}

function result(id, rule, pass, measured, threshold, detail) {
    return { id, rule, pass: Boolean(pass), measured, threshold, detail };
}

export function gradeG1(obs) {
    const maxActive = obs.runtime?.maxActiveWorkers ?? 0;
    const distinct = obs.runtime?.distinctWorkersPosted ?? 0;
    const pass = maxActive >= THRESHOLDS.maxActiveWorkers && distinct >= THRESHOLDS.distinctWorkersPosted;
    return result(
        "G1",
        "TESTS (1) parallel worker dispatch",
        pass,
        { maxActiveWorkers: maxActive, distinctWorkersPosted: distinct },
        { maxActiveWorkers: ">=2", distinctWorkersPosted: ">=2" },
        "2-foot cold export must overlap work on >=2 worker instances",
    );
}

export function gradeG2Identity(obs) {
    const failures = geometryIdentityOk(obs);
    return result(
        "G2-identity",
        "MUST-MATCH STL / vertex identity vs reference",
        failures.length === 0,
        { failures },
        { maxAbsDeltaMm: "<=0.0", euler: 2, watertight: true, engravedDiffersFromStock: true },
        "stock and engraved Left/Right solids",
    );
}

export function gradeG2Worker(obs) {
    const hosts = obs.source?.exportWorkerHosts ?? 0;
    const delegates = obs.source?.workerDelegatesToExistingBuild === true;
    const ownLoft = obs.source?.workerDefinesOwnLoft === true;
    const identity = geometryIdentityOk(obs);
    const pass = hosts >= 1 && delegates && !ownLoft && identity.length === 0;
    return result(
        "G2-worker",
        "TESTS (2) worker solid matches main-thread build",
        pass,
        {
            exportWorkerHosts: hosts,
            workerDelegatesToExistingBuild: delegates,
            workerDefinesOwnLoft: ownLoft,
            identityFailures: identity,
        },
        {
            exportWorkerHosts: ">=1",
            workerDelegatesToExistingBuild: true,
            workerDefinesOwnLoft: false,
            maxAbsDeltaMm: "<=0.0",
        },
        "worker module must call the existing loft and the STL must match the reference within 0.0 mm",
    );
}

export function gradeG3(obs) {
    const headless = obs.runtime?.headlessExportOk === true;
    const workerType = obs.runtime?.workerTypeDuringHeadless ?? "undefined";
    const fallback = obs.source?.workerUndefinedFallback !== false;
    const single = mesh(obs, "singleFootLeft");
    const singleOk =
        single &&
        single.watertight === true &&
        single.euler === 2 &&
        single.triangleCount >= 1 &&
        single.maxAbsDeltaMm <= 0 &&
        single.sha256 === mesh(obs, "stockLeft")?.sha256;
    const pass = headless && workerType === "undefined" && fallback && Boolean(singleOk);
    return result(
        "G3",
        "TESTS (3) Node/headless fallback when Worker is undefined",
        pass,
        {
            headlessExportOk: headless,
            workerTypeDuringHeadless: workerType,
            workerUndefinedFallback: obs.source?.workerUndefinedFallback ?? null,
            singleFootMatchesStockLeft: Boolean(singleOk),
        },
        {
            headlessExportOk: true,
            workerType: "undefined",
            workerUndefinedFallback: true,
            singleFootDeltaMm: "<=0.0",
        },
        "deleting Worker must still export the same single-foot solid",
    );
}

export function gradeG4(obs) {
    const terminateCalls = obs.source?.terminateCalls ?? 0;
    const lifecycleHooks = obs.source?.lifecycleHooks ?? 0;
    const hosts = obs.source?.exportWorkerHosts ?? 0;
    const constructed = obs.runtime?.constructed ?? 0;
    const terminated = obs.runtime?.terminated ?? 0;
    const sourceOk = terminateCalls >= 1 && lifecycleHooks >= 1 && hosts >= 1;
    const runtimeOk = constructed >= 1 && terminated >= constructed;
    return result(
        "G4",
        "TESTS (4) worker cancellation/cleanup on abort or unmount",
        sourceOk && runtimeOk,
        { terminateCalls, lifecycleHooks, exportWorkerHosts: hosts, constructed, terminated },
        {
            terminateCalls: ">=1",
            lifecycleHooks: ">=1",
            exportWorkerHosts: ">=1",
            terminated: ">=constructed>=1",
        },
        "export workers must be terminated when abort/cancel/unmount runs",
    );
}

export function gradeExisting(obs) {
    const code = obs.existingTests?.exitCode;
    return result(
        "G-existing",
        "TESTS existing export/cache/worker tests green",
        code === 0,
        { exitCode: code ?? null, command: obs.existingTests?.command ?? "" },
        { exitCode: 0 },
        "focused rstest subset",
    );
}

export function gradeR1(obs) {
    const changed = obs.source?.surfaceFilesChanged ?? [];
    const failures = geometryIdentityOk(obs);
    const pass = changed.length === 0 && failures.length === 0;
    return result(
        "R1",
        "R1 surface quality locked",
        pass,
        { surfaceFilesChanged: changed, identityFailures: failures },
        { surfaceFilesChanged: [], maxAbsDeltaMm: "<=0.0" },
        "outer surface files unchanged and vertex delta 0.0 mm",
    );
}

export function gradeR2(obs) {
    const changed = obs.source?.seamLayerFilesChanged ?? [];
    const failures = geometryIdentityOk(obs);
    const pass = changed.length === 0 && failures.length === 0;
    return result(
        "R2",
        "R2 seams and layer changes stay on the bottom",
        pass,
        { seamLayerFilesChanged: changed, identityFailures: failures },
        { seamLayerFilesChanged: [], maxAbsDeltaMm: "<=0.0" },
        "seam/layer-change sources unchanged and the mesh matches the reference",
    );
}

export function gradeR3(obs) {
    const violations = obs.source?.scopeViolations ?? [];
    return result(
        "R3",
        "R3 scope stays on the parallel export defect",
        violations.length === 0,
        { scopeViolations: violations, diffFileCount: obs.source?.diffFileCount ?? 0 },
        { scopeViolations: [] },
        "diff paths must stay on the worker dispatch allowlist",
    );
}

export function gradeR4(obs) {
    const changed = obs.source?.textFilesChanged ?? [];
    const marking = obs.geometry?.engravedMarking ?? {};
    const markingOk =
        marking.surface === "bottom" && marking.mode === "engrave" && marking.addPatientName === true;
    const engravedDiffers = geometryIdentityOk(obs).filter((f) => f.includes("engraved")).length === 0;
    const textIdentity = ["engravedLeft", "engravedRight"].every((key) => {
        const row = mesh(obs, key);
        return row && row.maxAbsDeltaMm <= 0 && row.watertight === true;
    });
    const pass = changed.length === 0 && markingOk && engravedDiffers && textIdentity;
    return result(
        "R4",
        "R4 patient name on the bottom via textMarking engrave",
        pass,
        { textFilesChanged: changed, engravedMarking: marking, textIdentity },
        { textFilesChanged: [], surface: "bottom", mode: "engrave", maxAbsDeltaMm: "<=0.0" },
        "existing bottom engrave, no new engraving system",
    );
}

export function gradeR5(obs) {
    const forbidden = obs.source?.forbiddenSecurityPaths ?? [];
    return result(
        "R5",
        "R5 no Railway, vertex-web, vertex-api, secrets, or main merge",
        forbidden.length === 0,
        { forbiddenSecurityPaths: forbidden },
        { forbiddenSecurityPaths: [] },
        "diff must not touch deploy or the named services",
    );
}

export function gradeR6(obs) {
    const fingerprintChanged = obs.source?.fingerprintChanged === true;
    const cacheChanged = obs.source?.cacheInvalidationChanged === true;
    const failures = geometryIdentityOk(obs);
    const pass = !fingerprintChanged && !cacheChanged && failures.length === 0;
    return result(
        "R6",
        "R6 zero geometry change; do not modify fingerprint or print cache invalidation",
        pass,
        {
            fingerprintChanged,
            cacheInvalidationChanged: cacheChanged,
            identityFailures: failures,
        },
        { fingerprintChanged: false, cacheInvalidationChanged: false, maxAbsDeltaMm: "<=0.0" },
        "manufacturingSolidFingerprint and print-loft invalidation stay byte-identical",
    );
}

export function gradeAll(obs) {
    return [
        gradeG1(obs),
        gradeG2Identity(obs),
        gradeG2Worker(obs),
        gradeG3(obs),
        gradeG4(obs),
        gradeExisting(obs),
        gradeR1(obs),
        gradeR2(obs),
        gradeR3(obs),
        gradeR4(obs),
        gradeR5(obs),
        gradeR6(obs),
    ];
}
