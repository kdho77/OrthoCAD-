// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Headless Canonical Export for saved designs whose arch, sinks, or wedges are
// not the medium-arch default. Rstest rewrites import.meta.url, so this process
// loads the runner the way the Vercel function does, from a cwd that is not the repo.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { buildHeadlessFinalizedFoot } from "./finalized-mesh-runner.ts";

const [casesPath, reportPath] = process.argv.slice(2);
if (!casesPath || !reportPath) {
    console.error("usage: finalized-mesh-runner.geometry.mjs <cases.json> <report.json>");
    process.exit(1);
}

function sha256(bytes) {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function stampSide(stl) {
    const text = new TextDecoder().decode(new Uint8Array(stl, 0, 80)).replace(/\0[\s\S]*$/, "");
    if (text === "OrthoCAD single-foot left") return "left";
    if (text === "OrthoCAD single-foot right") return "right";
    return null;
}

const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const previous = process.cwd();
process.chdir(os.tmpdir());

const report = { emptySnapshotMessage: "", cases: {} };
try {
    try {
        await buildHeadlessFinalizedFoot({ settingsJson: null, side: "left" });
        report.emptySnapshotMessage = "returned a mesh";
    } catch (error) {
        report.emptySnapshotMessage = error instanceof Error ? error.message : String(error);
    }

    for (const item of cases) {
        try {
            const foot = await buildHeadlessFinalizedFoot({
                settingsJson: item.settings,
                side: item.side,
            });
            report.cases[item.label] = {
                solid: foot.solidTriangles,
                upload: foot.uploadTriangles,
                fingerprint: foot.fingerprint,
                sha256: sha256(foot.stl),
                stamp: stampSide(foot.stl),
                error: null,
            };
            console.error(
                `geometry ${item.label} ${item.side} solid=${foot.solidTriangles} upload=${foot.uploadTriangles}`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            report.cases[item.label] = { error: message };
            console.error(`geometry ${item.label} ${item.side} FAIL ${message}`);
        }
    }
    writeFileSync(reportPath, JSON.stringify(report));
} finally {
    process.chdir(previous);
}
