// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Compares one off-thread loft to the in-process loft (main's mesh) and checks
// the VertexSlice upload is those STL bytes. G-code is that model plus the
// unchanged profile, material, and infill path.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { selectVertexSliceUpload } from "../../../shared/vertexslice-regional-3mf.ts";
import { buildHeadlessFinalizedFoot } from "./finalized-mesh-runner.ts";
import { buildHeadlessFinalizedFootOffThread } from "./loft-worker-pool.ts";

const [casesPath, reportPath] = process.argv.slice(2);
if (!casesPath || !reportPath) {
    console.error("usage: pair-loft-byte-identity.mjs <cases.json> <report.json>");
    process.exit(1);
}

function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const report = { patientName: cases.patientName, feet: {} };

for (const foot of cases.feet) {
    const input = {
        settingsJson: foot.settingsJson,
        side: foot.side,
        includeLeader: true,
    };
    const offThread = buildHeadlessFinalizedFootOffThread(input);
    const inProcess = await buildHeadlessFinalizedFoot(input);
    const off = await offThread;
    const mainBytes = Buffer.from(inProcess.stl);
    const workerBytes = Buffer.from(off.stl);
    const upload = selectVertexSliceUpload({
        stl: mainBytes,
        stlFilename: `${foot.side}.stl`,
        regional3mf: null,
        regional3mfEnabled: false,
    });
    const uploadBytes = Buffer.from(upload.bytes);
    report.feet[foot.id] = {
        side: foot.side,
        equal: mainBytes.equals(workerBytes),
        sha256: sha256(mainBytes),
        workerSha256: sha256(workerBytes),
        solidTriangles: inProcess.solidTriangles,
        uploadTriangles: inProcess.uploadTriangles,
        workerUploadTriangles: off.uploadTriangles,
        fingerprintEqual: inProcess.fingerprint === off.fingerprint,
        sliceModelEqualsStl: uploadBytes.equals(mainBytes) && upload.filename === `${foot.side}.stl`,
        composedText: foot.composedText,
    };
    console.log(
        JSON.stringify({
            msg: "pair-loft-byte-identity",
            id: foot.id,
            side: foot.side,
            equal: report.feet[foot.id].equal,
            sha256: report.feet[foot.id].sha256,
        }),
    );
}

writeFileSync(reportPath, `${JSON.stringify(report)}\n`);
