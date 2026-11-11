/**
 * Bundle packages/mcp Streamable HTTP into one file the vertex Vercel function can import.
 * The function root is `vertex/`, and Node will not resolve @modelcontextprotocol/sdk from
 * a file that lives outside that root. Run this and commit the bundle after MCP source edits:
 *   node vertex/scripts/bundle-orthocad-mcp-http.mjs
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { orthocadMcpHttpSourceHash } from "./orthocad-mcp-http-bundle-hash.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const vertexRoot = resolve(here, "..");
const repoRoot = resolve(vertexRoot, "..");
const require = createRequire(import.meta.url);

function loadEsbuild() {
    const candidates = [
        resolve(vertexRoot, "node_modules/esbuild"),
        resolve(repoRoot, "packages/mcp/node_modules/esbuild"),
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate)) return require(candidate);
    }
    return require("esbuild");
}

const esbuild = loadEsbuild();
const outfile = resolve(vertexRoot, "server/src/orthocad-mcp.bundled.mjs");
const hash = orthocadMcpHttpSourceHash();

await esbuild.build({
    entryPoints: [resolve(repoRoot, "packages/mcp/src/http.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    legalComments: "none",
    banner: { js: `// orthocad-mcp-http-bundle ${hash}` },
    plugins: [
        {
            name: "node-next-ts",
            setup(build) {
                build.onResolve({ filter: /^\./ }, (args) => {
                    if (!args.path.endsWith(".js")) return null;
                    const base = resolve(args.resolveDir, args.path).replace(/\.js$/, ".ts");
                    if (existsSync(base)) return { path: base };
                    return null;
                });
            },
        },
    ],
    nodePaths: [
        resolve(repoRoot, "packages/mcp/node_modules"),
        resolve(vertexRoot, "node_modules"),
        resolve(repoRoot, "node_modules"),
    ],
});

console.log(`Wrote ${outfile}`);
console.log(`Source hash ${hash}`);
