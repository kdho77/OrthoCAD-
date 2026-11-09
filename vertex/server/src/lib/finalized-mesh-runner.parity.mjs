// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Node ESM check for the headless loft. Rstest rewrites import.meta.url, so this
// process loads the runner the way the Vercel function does.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import {
    buildHeadlessFinalizedFoot,
    canonicalExportLoftUrl,
    elementsDirectoryUrl,
    sampleTopFileUrl,
    textFontFileUrl,
} from "./finalized-mesh-runner.ts";

const [nameSettingsPath, elementSettingsPath, reportPath] = process.argv.slice(2);
if (!nameSettingsPath || !elementSettingsPath || !reportPath) {
    console.error("usage: finalized-mesh-runner.parity.mjs <name.json> <element.json> <report.json>");
    process.exit(1);
}

function copyFileBytes(path) {
    const buf = readFileSync(path);
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(buf);
    return copy;
}

const previous = process.cwd();
const vertexCwd = fileURLToPath(new URL("../../..", import.meta.url));
const nameSettings = JSON.parse(readFileSync(nameSettingsPath, "utf8"));
const elementSettings = JSON.parse(readFileSync(elementSettingsPath, "utf8"));
const sampleTopBytes = copyFileBytes(fileURLToPath(sampleTopFileUrl()));
const loft = await import(canonicalExportLoftUrl());

const report = {
    fontPath: fileURLToPath(textFontFileUrl()),
    loftPath: fileURLToPath(canonicalExportLoftUrl()),
    elementsPath: fileURLToPath(elementsDirectoryUrl()),
    vertexCwd,
};

try {
    report.fontExists = existsSync(report.fontPath);
    report.loftExists = existsSync(report.loftPath);
    report.elementsExists = existsSync(report.elementsPath);

    process.chdir(os.tmpdir());
    let emptyMessage = "";
    try {
        await buildHeadlessFinalizedFoot({ settingsJson: null, side: "left" });
        emptyMessage = "returned a mesh";
    } catch (error) {
        emptyMessage = error instanceof Error ? error.message : String(error);
    }
    report.emptySnapshotMessage = emptyMessage;

    process.chdir(vertexCwd);
    const leftReference = await loft.buildFinalizedFootFromSavedSettings({
        settingsJson: nameSettings,
        side: "left",
        sampleTopBytes,
        includeLeader: true,
    });
    const rightReference = await loft.buildFinalizedFootFromSavedSettings({
        settingsJson: nameSettings,
        side: "right",
        sampleTopBytes,
        includeLeader: true,
    });

    process.chdir(os.tmpdir());
    const left = await buildHeadlessFinalizedFoot({ settingsJson: nameSettings, side: "left" });
    const leftAgain = await buildHeadlessFinalizedFoot({ settingsJson: nameSettings, side: "left" });
    const right = await buildHeadlessFinalizedFoot({ settingsJson: nameSettings, side: "right" });
    report.name = {
        leftUpload: left.uploadTriangles,
        leftSolid: left.solidTriangles,
        leftFingerprint: left.fingerprint,
        leftAgainFingerprint: leftAgain.fingerprint,
        leftAgainUpload: leftAgain.uploadTriangles,
        leftReferenceUpload: leftReference.uploadTriangles,
        leftReferenceSolid: leftReference.solidTriangles,
        leftReferenceFingerprint: leftReference.fingerprint,
        rightUpload: right.uploadTriangles,
        rightSolid: right.solidTriangles,
        rightFingerprint: right.fingerprint,
        rightReferenceUpload: rightReference.uploadTriangles,
        rightReferenceFingerprint: rightReference.fingerprint,
    };
    console.error(
        `parity placeholder name left upload=${left.uploadTriangles} solid=${left.solidTriangles} right upload=${right.uploadTriangles} solid=${right.solidTriangles}`,
    );

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
        warnings.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
        originalWarn(...args);
    };
    try {
        const first = await buildHeadlessFinalizedFoot({ settingsJson: elementSettings, side: "left" });
        const second = await buildHeadlessFinalizedFoot({ settingsJson: elementSettings, side: "left" });
        report.element = {
            upload: first.uploadTriangles,
            solid: first.solidTriangles,
            fingerprint: first.fingerprint,
            againFingerprint: second.fingerprint,
            againUpload: second.uploadTriangles,
            warnings: warnings.join("\n"),
        };
        console.error(
            `parity met_bar_1 left upload=${first.uploadTriangles} solid=${first.solidTriangles} fingerprint=${first.fingerprint}`,
        );
    } finally {
        console.warn = originalWarn;
    }

    writeFileSync(reportPath, JSON.stringify(report));
} finally {
    process.chdir(previous);
}
