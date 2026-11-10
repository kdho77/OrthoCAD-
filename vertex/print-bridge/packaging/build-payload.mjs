#!/usr/bin/env node
// Bundle the print bridge for the Windows and macOS installers.
// Does not download a Node runtime and does not sign the result.

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const vertex = resolve(here, "../..");
const out = resolve(here, "dist");
mkdirSync(out, { recursive: true });

const require = createRequire(resolve(vertex, "package.json"));
const esbuild = require("esbuild");

for (const [entry, outfile] of [
    ["../service-main.ts", "bridge.mjs"],
    ["../prepare-config.ts", "prepare-config.mjs"],
]) {
    await esbuild.build({
        absWorkingDir: here,
        entryPoints: [entry],
        bundle: true,
        platform: "node",
        target: "node22",
        format: "esm",
        outfile: resolve(out, outfile),
        legalComments: "none",
    });
}

const origin = (process.env.ORTHOCAD_BRIDGE_CLOUD_ORIGIN ?? "").trim();
if (origin.startsWith("https://")) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(resolve(out, "cloud-origin.txt"), `${origin}\n`);
}

console.log(`Bundled print bridge payload in ${out}`);
