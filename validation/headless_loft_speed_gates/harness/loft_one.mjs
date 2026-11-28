// One cold headless loft. Writes the STL bytes and the loft wall time.
// Usage: node loft_one.mjs <worktree> <settings.json> <side> <stl-out> <meta-out>

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [worktree, settingsPath, side, stlOut, metaOut] = process.argv.slice(2);
if (!worktree || !settingsPath || !side || !stlOut || !metaOut) {
    console.error("usage: node loft_one.mjs <worktree> <settings.json> <side> <stl-out> <meta-out>");
    process.exit(2);
}

const require = createRequire(path.join(worktree, "vertex/package.json"));
const { Window } = await import(pathToFileURL(require.resolve("happy-dom")).href);
const target = globalThis;
if (typeof target.DOMParser !== "function") {
    const window = new Window();
    target.DOMParser = window.DOMParser;
    if (!target.self) target.self = globalThis;
}

const loftPath = path.join(worktree, "vertex/server/src/lib/canonical-export-loft.js");
const loft = await import(pathToFileURL(loftPath).href);
const sampleTop = readFileSync(path.join(worktree, "vertex/public/Templates/SAMPLE_Top.glb"));
const font = readFileSync(path.join(worktree, "vertex/public/fonts/Inter-Bold.ttf"));

function toArrayBuffer(buf) {
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(buf);
    return copy;
}

const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
const started = performance.now();
const foot = await loft.buildFinalizedFootFromSavedSettings({
    settingsJson: settings,
    side,
    sampleTopBytes: toArrayBuffer(sampleTop),
    includeLeader: true,
    fontBytes: toArrayBuffer(font),
    elementsBaseDir: path.join(worktree, "vertex/public/elements"),
});
const loftS = (performance.now() - started) / 1000;
const bytes = Buffer.from(foot.stl);
const sha256 = createHash("sha256").update(bytes).digest("hex");
writeFileSync(stlOut, bytes);
writeFileSync(
    metaOut,
    JSON.stringify(
        {
            sha256,
            loft_s: loftS,
            bytes: bytes.length,
            solidTriangles: foot.solidTriangles,
            uploadTriangles: foot.uploadTriangles,
            side: foot.side,
        },
        null,
        2,
    ),
);
console.log(JSON.stringify({ sha256, loft_s: loftS, bytes: bytes.length, side: foot.side }));
