// Transpile the API import graph to JS, then run @vercel/nft the way the
// file-by-file Node function does. includeFiles is applied by the builder,
// not by nft, so the worker script is reported separately.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeFileTrace } from "../../vertex/node_modules/@vercel/nft/out/index.js";
import { transform } from "../../vertex/node_modules/esbuild/lib/main.js";

const VERTEX = fileURLToPath(new URL("../../vertex/", import.meta.url));
const OUT = "/tmp/grader-fn-sim";

function walk(entry, seen = new Set()) {
    if (seen.has(entry)) return seen;
    seen.add(entry);
    let text = "";
    try {
        text = readFileSync(entry, "utf8");
    } catch {
        return seen;
    }
    const specs = [
        ...text.matchAll(/from\s+["'](\.[^"']+)["']/g),
        ...text.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    for (const spec of specs) {
        const base = join(dirname(entry), spec);
        const candidates = [base, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".mjs")];
        const hit = candidates.find((path) => {
            try {
                readFileSync(path);
                return true;
            } catch {
                return false;
            }
        });
        if (hit) walk(hit, seen);
    }
    return seen;
}

const entry = join(VERTEX, "api/trpc/[[...trpc]].ts");
const files = [...walk(entry)];
for (const source of files) {
    const rel = relative(VERTEX, source);
    const destRel = rel.endsWith(".ts") ? rel.replace(/\.ts$/, ".js") : rel;
    const dest = join(OUT, destRel);
    mkdirSync(dirname(dest), { recursive: true });
    if (source.endsWith(".ts")) {
        const result = await transform(readFileSync(source, "utf8"), {
            loader: "ts",
            format: "esm",
            target: "node22",
        });
        writeFileSync(dest, result.code);
    } else {
        writeFileSync(dest, readFileSync(source));
    }
}

const traced = await nodeFileTrace([join(OUT, "api/trpc/[[...trpc]].js")], {
    base: OUT,
    processCwd: OUT,
    conditions: ["import", "node", "default"],
    ignore: ["**/node_modules/**"],
});
const list = [...traced.fileList];
const interesting = list.filter((file) =>
    /loft-off-thread|loft-worker-pool|finalized-mesh-runner|canonical-export-loft|manufacturing-cad/.test(
        file,
    ),
);
console.log(
    JSON.stringify(
        {
            transpiled: files.length,
            nftFiles: list.length,
            interesting,
            workerInNft: list.some((file) => file.endsWith("loft-off-thread.mjs")),
            warnings: [...traced.warnings].slice(0, 8).map((warning) => warning.message),
        },
        null,
        2,
    ),
);
