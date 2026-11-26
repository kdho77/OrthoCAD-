// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Bundle correction-macro apply for the Vercel Node function.
// @vercel/node transpiles server files one by one and does not rewrite `@/`.
// `npm run build` runs this before the function file trace.

import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const vertexRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const designMacrosOutfile = join(vertexRoot, "server/src/lib/design-macros.bundled.js");

export async function bundleDesignMacros() {
    await build({
        entryPoints: [join(vertexRoot, "src/lib/clinical/correction-presets.ts")],
        outfile: designMacrosOutfile,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node22",
        alias: {
            "@": join(vertexRoot, "src"),
        },
        logLevel: "warning",
        plugins: [
            {
                name: "externalize-node-packages",
                setup(pluginBuild) {
                    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
                        if (args.path.startsWith("node:")) return { external: true };
                        if (args.path.startsWith("@/")) return null;
                        return { external: true };
                    });
                },
            },
        ],
    });
    console.log("design-macros: bundled", designMacrosOutfile);
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
    await bundleDesignMacros();
}
