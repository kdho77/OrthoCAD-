// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

/**
 * Transpile the Vercel tRPC entry file-by-file (same as @vercel/node: ESM,
 * specifiers kept verbatim, no bundle) and import it under plain Node.
 *
 * Vite/tsx hide `import x from "./foo.json"`; Node 20+ ESM throws
 * ERR_IMPORT_ATTRIBUTE_MISSING and the Lambda exits 1 (FUNCTION_INVOCATION_FAILED).
 */

import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

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
const tsEntries = [];
const jsonFiles = [];
for (const root of srcRoots) {
    for (const file of walk(root)) {
        if (file.endsWith(".test.ts")) continue;
        if (file.endsWith(".ts")) tsEntries.push(file);
        if (file.endsWith(".json")) jsonFiles.push(file);
    }
}

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

const handlerPath = join(outDir, "api/trpc/[[...trpc]].js");

try {
    await import(pathToFileURL(handlerPath).href);
    console.log("server-esm-boot: ok", relative(vertexRoot, handlerPath));
} catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    const message = err instanceof Error ? err.message : String(err);
    console.error("server-esm-boot: failed", { code, message });
    process.exit(1);
}
