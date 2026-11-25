// Independent grader: Vercel includeFiles, nft reachability, scope, memory notes.
// Does not call a live generate endpoint and does not deploy.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { nodeFileTrace } from "../../vertex/node_modules/@vercel/nft/out/index.js";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const VERTEX = join(REPO, "vertex");
const MAIN = "3cfcff559d9839fd36637e4db48eb07471a6b917";
const SHA = "6f54ab84ff457dbcf70976cfaa14b327d1bae759";
const OUT = join(REPO, "grader/pr-454/results/packaging-report.json");

function git(args) {
    return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

function walkImports(entry, seen = new Set()) {
    if (seen.has(entry) || !existsSync(entry)) return seen;
    seen.add(entry);
    const text = readFileSync(entry, "utf8");
    const specifiers = [...text.matchAll(/from\s+["'](\.[^"']+)["']/g)].map((match) => match[1]);
    const dynamic = [...text.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)].map((match) => match[1]);
    for (const spec of [...specifiers, ...dynamic]) {
        const base = join(dirname(entry), spec);
        const candidates = [
            base,
            base.replace(/\.js$/, ".ts"),
            base.replace(/\.js$/, ".mjs"),
            `${base}.ts`,
            `${base}.mjs`,
        ];
        const hit = candidates.find((path) => existsSync(path));
        if (hit) walkImports(hit, seen);
    }
    return seen;
}

const vercel = JSON.parse(readFileSync(join(VERTEX, "vercel.json"), "utf8"));
const includeFiles = vercel.functions?.["api/trpc/[[...trpc]].ts"]?.includeFiles ?? "";
const apiEntry = join(VERTEX, "api/trpc/[[...trpc]].ts");
const apiText = readFileSync(apiEntry, "utf8");
const poolText = readFileSync(join(VERTEX, "server/src/lib/loft-worker-pool.ts"), "utf8");
const cadText = readFileSync(join(VERTEX, "server/src/routers/manufacturing-cad.ts"), "utf8");
const changed = git(["diff", "--name-only", MAIN, SHA]).split("\n").filter(Boolean);

const staticGraph = [...walkImports(apiEntry)].map((path) => path.slice(VERTEX.length + 1));
const workerInStaticGraph = staticGraph.some((path) => path.endsWith("loft-off-thread.mjs"));
const runnerInStaticGraph = staticGraph.some((path) => path.endsWith("finalized-mesh-runner.ts"));
const poolInStaticGraph = staticGraph.some((path) => path.endsWith("loft-worker-pool.ts"));
const canonicalInStaticGraph = staticGraph.some((path) => path.endsWith("canonical-export-loft.js"));

let nft = {
    error: null,
    fileCount: 0,
    workerIncluded: false,
    runnerIncluded: false,
    canonicalIncluded: false,
    poolIncluded: false,
};
try {
    const traced = await nodeFileTrace([apiEntry], {
        base: VERTEX,
        conditions: ["import", "node", "default"],
        processCwd: VERTEX,
    });
    const files = [...traced.fileList];
    nft = {
        error: null,
        fileCount: files.length,
        workerIncluded: files.some((file) => file.endsWith("loft-off-thread.mjs")),
        runnerIncluded: files.some((file) => file.includes("finalized-mesh-runner")),
        canonicalIncluded: files.some((file) => file.endsWith("canonical-export-loft.js")),
        poolIncluded: files.some((file) => file.includes("loft-worker-pool")),
        reasons: traced.reasons ? undefined : undefined,
    };
} catch (error) {
    nft = { ...nft, error: error instanceof Error ? error.message : String(error) };
}

let deployment = { accessible: false, status: null, note: "" };
try {
    const response = await fetch("https://api.vercel.com/v13/deployments/AwbLwvfnTjeMNGinS7H4eFkPzj4z");
    deployment = {
        accessible: response.ok,
        status: response.status,
        note: response.ok
            ? "deployment metadata returned"
            : "deployment API refused without a token; function file list not readable",
    };
} catch (error) {
    deployment = {
        accessible: false,
        status: null,
        note: error instanceof Error ? error.message : String(error),
    };
}

const forbidden = changed.filter((file) =>
    /vertexslice-client|print-recipe|seam|layer-height|slicer|pin|gate|gcode/i.test(file),
);
const memoryExport = /export const memory\b/.test(apiText);

const report = {
    sha: SHA,
    includeFiles,
    includeFilesNamesWorker: includeFiles.includes("server/src/lib/loft-off-thread.mjs"),
    workerFileExists: existsSync(join(VERTEX, "server/src/lib/loft-off-thread.mjs")),
    apiMaxDuration: apiText.includes("maxDuration = 300"),
    memoryInRepo: memoryExport,
    vercelJsonSetsMemory: JSON.stringify(vercel).includes("memory"),
    platformDefaultMb: 2048,
    platformDefaultNote:
        "Vercel Functions default is 2 GB / 1 vCPU. vercel.json cannot set memory. This repo does not set it. A dashboard override was not visible without Vercel auth.",
    staticGraph: {
        files: staticGraph.length,
        workerInStaticGraph,
        runnerInStaticGraph,
        poolInStaticGraph,
        canonicalInStaticGraph,
    },
    nft,
    poolHasInProcessFallback: poolText.includes("buildHeadlessFinalizedFoot("),
    cadCallsOffThread: cadText.includes("buildHeadlessFinalizedFootOffThread("),
    cadCallsInProcess: /buildHeadlessFinalizedFoot\(/.test(cadText),
    changedFiles: changed,
    forbiddenPathHits: forbidden,
    deployment,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
