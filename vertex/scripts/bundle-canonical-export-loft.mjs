// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Bundle the Canonical Export loft for the Vercel Node ESM function.
// @vercel/node transpiles api/server/shared file-by-file and keeps import
// specifiers verbatim. saved-design-finalized-mesh.ts imports `@/` client
// modules, so a raw .ts specifier is missing under /var/task.
// `vercel-build` runs this before the function file trace.

import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const vertexRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const canonicalExportLoftOutfile = join(vertexRoot, "server/src/lib/canonical-export-loft.js");

// opentype.js is CJS without an exports map. Node ESM rejects its named imports
// when the package is left external. esbuild inlines the ESM build instead.
const bundleInline = new Set(["opentype.js"]);

export async function bundleCanonicalExportLoft() {
    await build({
        entryPoints: [join(vertexRoot, "src/features/exports/saved-design-finalized-mesh.ts")],
        outfile: canonicalExportLoftOutfile,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node22",
        alias: {
            "@": join(vertexRoot, "src"),
        },
        define: {
            "import.meta.env": JSON.stringify({ DEV: false }),
        },
        logLevel: "warning",
        plugins: [
            {
                name: "externalize-node-packages",
                setup(pluginBuild) {
                    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
                        if (args.path.startsWith("node:")) return { external: true };
                        if (args.path.startsWith("@/")) return null;
                        const name = args.path.startsWith("@")
                            ? args.path.split("/").slice(0, 2).join("/")
                            : args.path.split("/")[0];
                        if (bundleInline.has(name)) return null;
                        return { external: true };
                    });
                },
            },
        ],
    });
    console.log("canonical-export-loft: bundled", canonicalExportLoftOutfile);
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
    await bundleCanonicalExportLoft();
}
