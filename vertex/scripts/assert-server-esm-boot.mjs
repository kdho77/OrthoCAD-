// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Transpile the Vercel tRPC entry file-by-file (same as @vercel/node: ESM,
 * specifiers kept verbatim, no bundle) and import it under plain Node.
 *
 * Vite/tsx hide `import x from "./foo.json"`; Node 20+ ESM throws
 * ERR_IMPORT_ATTRIBUTE_MISSING and the Lambda exits 1 (FUNCTION_INVOCATION_FAILED).
 */

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { bundleCanonicalExportLoft, canonicalExportLoftOutfile } from "./bundle-canonical-export-loft.mjs";

const vertexRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(vertexRoot, ".esm-boot");

function walk(dir, acc = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, acc);
        else acc.push(p);
    }
    return acc;
}

const srcRoots = [join(vertexRoot, "api"), join(vertexRoot, "server/src"), join(vertexRoot, "shared")];
// Server modules statically import a few client files. Those specifiers are kept
// verbatim (no bundle), so the copy must include them or Node throws ERR_MODULE_NOT_FOUND.
const extraTsEntries = [join(vertexRoot, "src/lib/geometry/procedural-wall/sample-top-id.ts")];
const tsEntries = [];
const jsonFiles = [];
for (const root of srcRoots) {
    for (const file of walk(root)) {
        if (file.endsWith(".test.ts") || file.endsWith(".d.ts")) continue;
        if (file.endsWith(".ts")) tsEntries.push(file);
        if (file.endsWith(".json")) jsonFiles.push(file);
    }
}
tsEntries.push(...extraTsEntries);

// Same artifact `vercel-build` emits before @vercel/node traces the function.
await bundleCanonicalExportLoft();

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
    entryPoints: tsEntries,
    outdir: outDir,
    outbase: vertexRoot,
    format: "esm",
    platform: "node",
    bundle: false,
    logLevel: "warning",
});

for (const file of jsonFiles) {
    const dest = join(outDir, relative(vertexRoot, file));
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(file, dest);
}

const handlerPaths = [join(outDir, "api/trpc/[[...trpc]].js"), join(outDir, "api/integrations/index.js")];

for (const handlerPath of handlerPaths) {
    try {
        await import(pathToFileURL(handlerPath).href);
        console.log("server-esm-boot: ok", relative(vertexRoot, handlerPath));
    } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
        const message = err instanceof Error ? err.message : String(err);
        console.error("server-esm-boot: failed", relative(vertexRoot, handlerPath), { code, message });
        process.exit(1);
    }
}

const persistBuilderPath = join(outDir, "shared/saved-design-snapshot.js");
try {
    await import(pathToFileURL(persistBuilderPath).href);
    console.log("server-esm-boot: ok", relative(vertexRoot, persistBuilderPath));
} catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    const message = err instanceof Error ? err.message : String(err);
    console.error("server-esm-boot: failed", relative(vertexRoot, persistBuilderPath), { code, message });
    process.exit(1);
}

// Production-equivalent load of buildHeadlessFinalizedFoot. File-by-file ESM
// keeps the runner's dynamic imports. Before happy-dom was a dependency and
// before the loft bundle replaced the raw .ts specifier, this threw
// ERR_MODULE_NOT_FOUND / Cannot find package 'happy-dom' from finalized-mesh-runner.js.
const runnerPath = join(outDir, "server/src/lib/finalized-mesh-runner.js");
cpSync(canonicalExportLoftOutfile, join(outDir, "server/src/lib/canonical-export-loft.js"));
const sampleDest = join(outDir, "public/Templates/SAMPLE_Top.glb");
mkdirSync(dirname(sampleDest), { recursive: true });
cpSync(join(vertexRoot, "public/Templates/SAMPLE_Top.glb"), sampleDest);
const fontDest = join(outDir, "public/fonts/Inter-Bold.ttf");
mkdirSync(dirname(fontDest), { recursive: true });
cpSync(join(vertexRoot, "public/fonts/Inter-Bold.ttf"), fontDest);

const runnerSource = readFileSync(runnerPath, "utf8");
if (
    runnerSource.includes("saved-design-finalized-mesh.ts") ||
    !runnerSource.includes("happy-dom") ||
    !runnerSource.includes("./canonical-export-loft.js")
) {
    console.error("server-esm-boot: finalized-mesh-runner.js does not load happy-dom and the loft bundle");
    process.exit(1);
}

const runner = await import(pathToFileURL(runnerPath).href);
let refusal = "";
try {
    await runner.buildHeadlessFinalizedFoot({ settingsJson: null, side: "left" });
    console.error("server-esm-boot: finalized mesh load returned a mesh for an empty snapshot");
    process.exit(1);
} catch (err) {
    refusal = err instanceof Error ? err.message : String(err);
}
const resolutionFailure =
    /Cannot find package|ERR_MODULE_NOT_FOUND|saved-design-finalized-mesh\.ts|canonical-export-loft/;
if (
    resolutionFailure.test(refusal) ||
    !refusal.includes("Refusing to substitute a different mesh") ||
    !refusal.includes("Design has no saved parameter snapshot")
) {
    console.error("server-esm-boot: canonical export loft did not load", refusal);
    process.exit(1);
}
if (typeof globalThis.DOMParser !== "function") {
    console.error("server-esm-boot: happy-dom DOMParser was not installed");
    process.exit(1);
}
console.log("server-esm-boot: ok canonical export loft");
