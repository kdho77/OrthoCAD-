// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Loads the Mill bundle with Node, not the rstest bundler.
// Run: node --experimental-strip-types scripts/cnc-mill-parity-check.ts <prepare|gcode> <in.json> <out.json>

import { readFileSync, writeFileSync } from "node:fs";
import { buildHeadlessMillCncGcode, prepareHeadlessMillDesign } from "../server/src/lib/cnc-mill-runner.ts";

const mode = process.argv[2];
const inPath = process.argv[3];
const outPath = process.argv[4];
const millSideRaw = process.argv[5];
const millSide =
    millSideRaw === "RR" || millSideRaw === "LL" || millSideRaw === "LR" ? millSideRaw : undefined;
if (!mode || !inPath || !outPath) {
    console.error("usage: cnc-mill-parity-check.ts <prepare|gcode> <in.json> <out.json> [LR|RR|LL]");
    process.exit(2);
}

const doc: unknown = JSON.parse(readFileSync(inPath, "utf8"));

try {
    const prepared = await prepareHeadlessMillDesign(doc, { millSide });
    if (mode === "prepare") {
        writeFileSync(
            outPath,
            JSON.stringify({ ok: true, sides: prepared.sides, method: prepared.design.method }),
        );
    } else if (mode === "gcode") {
        const milled = await buildHeadlessMillCncGcode(prepared.design, { millSide });
        writeFileSync(
            outPath,
            JSON.stringify({
                ok: true,
                sides: milled.sides,
                fileExtension: milled.fileExtension,
                gcode: milled.gcode,
            }),
        );
    } else {
        throw new Error(`unknown mode ${mode}`);
    }
} catch (error) {
    writeFileSync(
        outPath,
        JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }),
    );
}
