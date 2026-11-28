/**
 * Frozen source observer. Reads a product tree and emits the source half of a gate observation.
 * Do not edit after the freeze commit.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
    CACHE_INVALIDATION_FILES,
    FINGERPRINT_FILE,
    isAllowedPath,
    isForbiddenPath,
    SEAM_LAYER_FILES,
    SURFACE_FILES,
    TEXT_DIR,
    TEXT_SHARED,
} from "./checker.mjs";

const ENTRY_FILES = [
    "vertex/src/lib/geometry/export-geometry.ts",
    "vertex/src/features/exports/export-service.ts",
];

function sha256(buf) {
    return createHash("sha256").update(buf).digest("hex");
}

function readText(file) {
    return readFileSync(file, "utf8");
}

export function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

export function extractFunction(src, name) {
    const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
    const match = re.exec(src);
    if (!match) return "";
    const brace = src.indexOf("{", match.index);
    if (brace < 0) return "";
    let depth = 0;
    for (let i = brace; i < src.length; i++) {
        if (src[i] === "{") depth += 1;
        else if (src[i] === "}") {
            depth -= 1;
            if (depth === 0) return src.slice(match.index, i + 1);
        }
    }
    return src.slice(match.index);
}

function fileHash(root, rel) {
    const abs = path.join(root, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) return "MISSING";
    return sha256(readFileSync(abs));
}

function walkFiles(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
        const abs = path.join(dir, name);
        const st = statSync(abs);
        if (st.isDirectory()) walkFiles(abs, out);
        else out.push(abs);
    }
    return out;
}

function dirHash(root, rel) {
    const dir = path.join(root, rel);
    if (!existsSync(dir)) return "MISSING";
    const files = walkFiles(dir)
        .map((abs) => path.relative(dir, abs).replace(/\\/g, "/"))
        .sort();
    const hash = createHash("sha256");
    for (const relFile of files) {
        hash.update(relFile);
        hash.update(readFileSync(path.join(dir, relFile)));
    }
    return hash.digest("hex");
}

function resolveSpec(fromFile, spec, root) {
    let abs = null;
    if (spec.startsWith("@/")) abs = path.join(root, "vertex/src", spec.slice(2));
    else if (spec.startsWith(".")) abs = path.resolve(path.dirname(fromFile), spec);
    else return null;
    const candidates = [
        abs,
        `${abs}.ts`,
        `${abs}.tsx`,
        path.join(abs, "index.ts"),
        path.join(abs, "index.tsx"),
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
}

function parseImportSpecs(src) {
    const specs = [];
    const re = /from\s+["']([^"']+)["']/g;
    for (const match of src.matchAll(re)) specs.push(match[1]);
    return specs;
}

const SKIP_WALK_PREFIXES = [
    "vertex/src/stores/",
    "vertex/src/lib/geometry/afo/",
    "vertex/src/lib/cnc/",
    "vertex/src/features/afo/",
];

const SKIP_WALK_FILES = new Set([
    "vertex/src/lib/geometry/geometry-engine.ts",
    "vertex/src/lib/geometry/geometry-kernel.ts",
    "vertex/src/workers/geometry.worker.ts",
]);

function skippedWalk(root, file) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    if (SKIP_WALK_FILES.has(rel)) return true;
    return SKIP_WALK_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

function walkExportGraph(root) {
    const visited = new Set();
    const queue = [];
    for (const rel of ENTRY_FILES) {
        const abs = path.join(root, rel);
        if (existsSync(abs)) queue.push(abs);
    }
    while (queue.length) {
        const file = queue.pop();
        if (!file || visited.has(file)) continue;
        visited.add(file);
        let src = "";
        try {
            src = readText(file);
        } catch {
            continue;
        }
        for (const spec of parseImportSpecs(src)) {
            const next = resolveSpec(file, spec, root);
            if (!next || visited.has(next) || skippedWalk(root, next)) continue;
            queue.push(next);
        }
    }
    return [...visited];
}

function isExcludedHost(rel) {
    const n = rel.replace(/\\/g, "/");
    if (n.includes("/afo/")) return true;
    if (n.endsWith("vertex/src/workers/geometry.worker.ts")) return true;
    return false;
}

function workerUrls(src, fromFile, root) {
    const found = [];
    const re = /new\s+URL\(\s*["']([^"']+)["']/g;
    for (const match of src.matchAll(re)) {
        const resolved = resolveSpec(fromFile, match[1], root);
        if (resolved) found.push(resolved);
    }
    return found;
}

function countMatches(src, re) {
    return [...src.matchAll(re)].length;
}

function lifecycleCount(src) {
    const code = stripComments(src);
    return (
        countMatches(code, /AbortSignal/g) +
        countMatches(code, /\.abort\s*\(/g) +
        countMatches(code, /\bunmount\b/g) +
        countMatches(code, /\bpagehide\b/g) +
        countMatches(code, /\bbeforeunload\b/g) +
        countMatches(code, /addEventListener\(\s*["']abort["']/g) +
        countMatches(code, /export\s+(?:async\s+)?function\s+cancel[A-Za-z0-9_]*/g)
    );
}

function terminateCount(src) {
    const code = stripComments(src);
    return (
        countMatches(code, /\.terminate\s*\(/g) + countMatches(code, /\bterminate[A-Z][A-Za-z0-9_]*\s*\(/g)
    );
}

function hasUndefinedWorkerFallback(src) {
    const code = stripComments(src);
    const guard =
        /typeof\s+Worker\s*===?\s*["']undefined["']/.test(code) ||
        /typeof\s+globalThis\.Worker\s*===?\s*["']undefined["']/.test(code) ||
        /typeof\s+window\.Worker\s*===?\s*["']undefined["']/.test(code);
    const callsExisting =
        /reconstructProceduralPreview|buildProceduralExportSolid|buildExportStl|buildClosedExportGeometry|buildOrderPairGeometry/.test(
            code,
        );
    return guard && callsExisting;
}

function delegationOf(src) {
    const code = stripComments(src);
    const mentions =
        /reconstructProceduralPreview|buildProceduralExportSolid|buildExportStl|buildClosedExportGeometry/.test(
            code,
        );
    const definesOwn =
        /function\s+reconstructProceduralPreview\b/.test(code) ||
        /function\s+buildProceduralExportSolid\b/.test(code);
    return { mentions, definesOwn };
}

function pairDispatchOf(root) {
    const files = [
        path.join(root, "vertex/src/lib/geometry/export-geometry.ts"),
        path.join(root, "vertex/src/features/exports/export-service.ts"),
    ];
    const names = ["buildOrderPairGeometry", "buildOrderPairStl", "exportDesign"];
    for (const file of files) {
        if (!existsSync(file)) continue;
        const src = stripComments(readText(file));
        for (const name of names) {
            const body = extractFunction(src, name);
            if (body && /Promise\.all\s*\(/.test(body)) return "parallel";
        }
    }
    return "serial";
}

function capacityOf(hostSources, pairDispatch) {
    let capacity = 0;
    let perCall = false;
    for (const src of hostSources) {
        const code = stripComments(src);
        for (const match of code.matchAll(
            /\b(?:poolSize|POOL_SIZE|WORKER_POOL|workerCount|maxWorkers)\b\s*=\s*(\d+)/g,
        )) {
            capacity = Math.max(capacity, Number(match[1]));
        }
        const ctors = countMatches(code, /new\s+Worker\s*\(/g);
        if (ctors >= 2) capacity = Math.max(capacity, ctors);
        const singleton = /if\s*\(\s*worker\s*\)\s*return/.test(code);
        if (ctors >= 1 && singleton) capacity = Math.max(capacity, 1);
        if (ctors >= 1 && !singleton) perCall = true;
    }
    if (perCall && pairDispatch === "parallel") capacity = Math.max(capacity, 2);
    else if (perCall && capacity === 0) capacity = 1;
    return capacity;
}

function changedFromGit(root, diffFrom) {
    const out = execFileSync("git", ["-C", root, "diff", "--name-only", diffFrom, "HEAD"], {
        encoding: "utf8",
    });
    return out
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

function hashesDiffer(root, baseline, rels) {
    return rels.filter((rel) => fileHash(root, rel) !== fileHash(baseline, rel));
}

export function observeSource(root, baseline, diffFrom) {
    const graph = walkExportGraph(root);
    const hosts = [];
    const workerScripts = [];
    for (const file of graph) {
        const rel = path.relative(root, file).replace(/\\/g, "/");
        if (isExcludedHost(rel)) continue;
        const src = readText(file);
        if (/new\s+Worker\s*\(/.test(stripComments(src))) hosts.push(file);
        for (const script of workerUrls(src, file, root)) workerScripts.push(script);
    }
    const uniqueScripts = [...new Set(workerScripts)];
    let terminateCalls = 0;
    let lifecycleHooks = 0;
    const hostSources = [];
    for (const file of hosts) {
        const src = readText(file);
        hostSources.push(src);
        terminateCalls += terminateCount(src);
        lifecycleHooks += lifecycleCount(src);
    }
    const hostSet = new Set(hosts.map((file) => path.relative(root, file).replace(/\\/g, "/")));
    const importerRoots = walkFiles(path.join(root, "vertex/src"));
    for (const file of importerRoots) {
        const rel = path.relative(root, file).replace(/\\/g, "/");
        if (!rel.endsWith(".ts") && !rel.endsWith(".tsx")) continue;
        if (hostSet.has(rel)) continue;
        let src = "";
        try {
            src = readText(file);
        } catch {
            continue;
        }
        const importsHost = [...hostSet].some((hostRel) => {
            const base = hostRel.replace(/^vertex\/src\//, "").replace(/\.tsx?$/, "");
            const baseName = path.basename(hostRel).replace(/\.tsx?$/, "");
            const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return (
                src.includes(`@/${base}`) || new RegExp(`from\\s+["'][^"']*(?:^|/)${escaped}["']`).test(src)
            );
        });
        if (!importsHost) continue;
        if (terminateCount(src) === 0) continue;
        terminateCalls += terminateCount(src);
        lifecycleHooks += lifecycleCount(src);
    }

    let workerDelegatesToExistingBuild = uniqueScripts.length > 0;
    let workerDefinesOwnLoft = false;
    for (const script of uniqueScripts) {
        const info = delegationOf(readText(script));
        if (!info.mentions || info.definesOwn) workerDelegatesToExistingBuild = false;
        if (info.definesOwn) workerDefinesOwnLoft = true;
    }
    if (uniqueScripts.length === 0) workerDelegatesToExistingBuild = false;

    const fallbackFromHost = hosts.some((file) => hasUndefinedWorkerFallback(readText(file)));
    const workerUndefinedFallback = hosts.length === 0 ? true : fallbackFromHost;
    const pairDispatch = pairDispatchOf(root);
    const maxConcurrentCapacity = capacityOf(hostSources, pairDispatch);

    const changed = diffFrom ? changedFromGit(root, diffFrom) : [];
    const surfaceFilesChanged = hashesDiffer(root, baseline, SURFACE_FILES);
    const seamLayerFilesChanged = hashesDiffer(root, baseline, SEAM_LAYER_FILES);
    const textChangedRels = [
        ...(dirHash(root, TEXT_DIR) === dirHash(baseline, TEXT_DIR) ? [] : [TEXT_DIR]),
        ...(fileHash(root, TEXT_SHARED) === fileHash(baseline, TEXT_SHARED) ? [] : [TEXT_SHARED]),
    ];
    const fingerprintChanged =
        sha256(
            extractFunction(safeRead(path.join(root, FINGERPRINT_FILE)), "manufacturingSolidFingerprint"),
        ) !==
        sha256(
            extractFunction(safeRead(path.join(baseline, FINGERPRINT_FILE)), "manufacturingSolidFingerprint"),
        );
    const cacheInvalidationChanged = CACHE_INVALIDATION_FILES.some(
        (rel) => fileHash(root, rel) !== fileHash(baseline, rel),
    );
    const scopeViolations = changed.filter((rel) => !isAllowedPath(rel));
    const forbiddenSecurityPaths = changed.filter((rel) => isForbiddenPath(rel));

    return {
        exportWorkerHosts: hosts.length,
        exportWorkerHostFiles: [...hostSet],
        workerScripts: uniqueScripts.map((file) => path.relative(root, file).replace(/\\/g, "/")),
        maxConcurrentCapacity,
        pairDispatch,
        workerUndefinedFallback,
        terminateCalls,
        lifecycleHooks,
        workerDelegatesToExistingBuild,
        workerDefinesOwnLoft,
        surfaceFilesChanged,
        seamLayerFilesChanged,
        textFilesChanged: textChangedRels,
        fingerprintChanged,
        cacheInvalidationChanged,
        scopeViolations,
        forbiddenSecurityPaths,
        diffFileCount: changed.length,
        changedFiles: changed,
    };
}

function safeRead(file) {
    if (!existsSync(file)) return "";
    return readText(file);
}

function arg(name, fallback = "") {
    const i = process.argv.indexOf(name);
    if (i < 0) return fallback;
    return process.argv[i + 1] ?? fallback;
}

const invokedDirectly =
    process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
    const root = path.resolve(arg("--root", process.cwd()));
    const baseline = path.resolve(arg("--baseline", root));
    const diffFrom = arg("--diff-from", "");
    const out = observeSource(root, baseline, diffFrom || null);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
