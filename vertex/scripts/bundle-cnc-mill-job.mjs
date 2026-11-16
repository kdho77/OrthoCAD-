// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Bundle the Mill CNC job for the Vercel Node ESM function.
// Same constraint as bundle-canonical-export-loft.mjs: @vercel/node does not
// rewrite `@/` client imports. `vercel-build` runs this before the file trace.

import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const vertexRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const cncMillJobOutfile = join(vertexRoot, "server/src/lib/cnc-mill-job.js");

const bundleInline = new Set(["opentype.js"]);

export async function bundleCncMillJob() {
    await build({
        entryPoints: [join(vertexRoot, "src/lib/cnc/mill-job.ts")],
        outfile: cncMillJobOutfile,
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
    console.log("cnc-mill-job: bundled", cncMillJobOutfile);
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
    await bundleCncMillJob();
}
