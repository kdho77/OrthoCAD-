#!/usr/bin/env node
// Bundle the print bridge for the Windows and macOS installers.
// Does not download a Node runtime and does not sign the result.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestUrlForPayload } from "../baked-config.mjs";

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

copyFileSync(resolve(here, "update-public-keys.json"), resolve(out, "update-public-keys.json"));

const origin = (process.env.ORTHOCAD_BRIDGE_CLOUD_ORIGIN ?? "").trim();
if (origin.startsWith("https://")) {
    writeFileSync(resolve(out, "cloud-origin.txt"), `${origin}\n`);
}
const manifestUrl = manifestUrlForPayload({
    origin,
    envValue: process.env.ORTHOCAD_BRIDGE_UPDATE_MANIFEST_URL,
});
if (manifestUrl.startsWith("https://")) {
    writeFileSync(resolve(out, "update-manifest-url.txt"), `${manifestUrl}\n`);
}

console.log(`Bundled print bridge payload in ${out}`);
