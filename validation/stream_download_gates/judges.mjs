/**
 * Frozen pass/fail rules for the stream-download grade.
 * Product code is not imported here. Callers pass measurements.
 */

export const BASE_SHA = "da317e858655aa0f4c0d69b24ce25b4ba690959e";

export const ALLOWED_PRODUCT_FILES = [
    "vertex/src/features/exports/export-panel-clinical.ts",
    "vertex/src/features/exports/export-service.ts",
    "vertex/src/features/exports/export-panel-clinical.test.ts",
];

export const EXPECTED_FILENAMES = {
    left: "Stream_Gate_ApexCore_L.gcode",
    right: "Stream_Gate_ApexCore_R.gcode",
};

export const CANCEL_REASON = "Export cancelled. No G-code was downloaded.";

export const THRESHOLDS = {
    G_T1_STREAM:
        "earlyLeft >= 1 AND earlyRight == 0 AND earlyLeftBytesMatch == true AND slicesStarted == 2 AND foot2Pending == true",
    G_T2_PARTIAL:
        "ok == false AND earlyLeft >= 1 AND reason does not contain 'No files were downloaded' AND reason matches left/foot 1 + download AND right/foot 2 + fail",
    G_T3_SINGLE_LEFT:
        "ok == true AND downloadCount == 1 AND filename == Stream_Gate_ApexCore_L.gcode AND gcode bytes equal the server payload AND upload bytes equal leader+stamp(raw) AND uploadTriangles > rawTriangles AND slice JSON equals golden.singleLeft",
    G_T3_SINGLE_RIGHT:
        "ok == true AND downloadCount == 1 AND filename == Stream_Gate_ApexCore_R.gcode AND gcode bytes equal the server payload AND upload bytes equal leader+stamp(raw) AND uploadTriangles > rawTriangles AND slice JSON equals golden.singleRight",
    G_T3_CANCEL_BEFORE: `downloads == 0 AND cancelled == true AND reason == ${JSON.stringify(CANCEL_REASON)} AND slicesStarted == 0`,
    G_T3_CANCEL_INFLIGHT: `downloads == 0 AND cancelled == true AND reason == ${JSON.stringify(CANCEL_REASON)} AND slicesStarted == 2`,
    G_BYTES_PAIR:
        "gcode byte mismatches == 0 AND upload byte mismatches == 0 AND filename mismatches == 0 AND slice JSON equals golden.pair AND every foot uploadTriangles > rawTriangles",
    G_BYTES_SINGLE:
        "same byte rules as G_T3_SINGLE_LEFT (one foot, omitted feet scope)",
    G_R1_SURFACE:
        "changed lines in vertex/src/lib/geometry + vertex/src/lib/kiri + vertex/src/lib/hardness == 0",
    G_R2_SEAMS:
        "changed lines in vertex/src/lib/kiri + vertex/src/lib/geometry == 0 AND added diff lines matching seam|layer-change|z-seam == 0",
    G_R3_SCOPE:
        "every product path changed vs BASE is one of the three allowed export files",
    G_R4_SECRETS: "added diff lines matching a secret assignment == 0",
    G_R4_PHI: "added diff lines matching an email, phone, or SSN == 0",
    G_R4_RAILWAY: "changed paths naming vertex-web, vertex-api, or railway == 0",
    G_R4_MAIN: `git rev-parse main == ${BASE_SHA}`,
    G_R5_SPANS:
        "character delta vs BASE == 0 for STL/3MF/leader/filename/slice-payload spans (download call site excluded)",
    G_MUST_ENGRAVE: "changed lines under vertex/src/lib/geometry/text-marking == 0",
    G_MUST_LEADER_FILE: "changed lines in vertex/src/lib/geometry/leader-block.ts == 0",
    G_EXISTING_TESTS: "rstest exit code == 0 on the frozen export test list",
};

export function judgeStream(m) {
    return (
        m.earlyLeft >= 1 &&
        m.earlyRight === 0 &&
        m.earlyLeftBytesMatch === true &&
        m.slicesStarted === 2 &&
        m.foot2Pending === true
    );
}

export function judgePartial(m) {
    const reason = String(m.reason ?? "");
    const noBogusClear = !/no files were downloaded/i.test(reason);
    const reportsLeft = /(left|foot 1)/i.test(reason) && /download/i.test(reason);
    const reportsRight = /(right|foot 2)/i.test(reason) && /fail/i.test(reason);
    return m.ok === false && m.earlyLeft >= 1 && noBogusClear && reportsLeft && reportsRight;
}

export function judgeSingle(m) {
    return (
        m.ok === true &&
        m.downloadCount === 1 &&
        m.filename === m.expectedFilename &&
        m.gcodeMatch === true &&
        m.uploadMatch === true &&
        m.uploadTriangles > m.rawTriangles &&
        m.sliceMatch === true
    );
}

export function judgeCancel(m) {
    return (
        m.ok === false &&
        m.cancelled === true &&
        m.downloads === 0 &&
        m.reason === CANCEL_REASON &&
        m.slicesStarted === m.expectedSlices
    );
}

export function judgeBytes(m) {
    return (
        m.gcodeMismatches === 0 &&
        m.uploadMismatches === 0 &&
        m.filenameMismatches === 0 &&
        m.sliceMatch === true &&
        m.feetWithNoLeader === 0
    );
}

const SECRET_LINE =
    /(?:api[_-]?key|secret|password)\s*[:=]\s*['"][^'"]+['"]|bearer\s+[A-Za-z0-9._\-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const EMAIL_LINE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_LINE = /\b\d{3}[-.]\d{3}[-.]\d{4}\b/;
const SSN_LINE = /\b\d{3}-\d{2}-\d{4}\b/;

export function scanAddedLines(diffText) {
    const added = String(diffText)
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
    let secrets = 0;
    let phi = 0;
    for (const line of added) {
        if (SECRET_LINE.test(line)) secrets += 1;
        if (EMAIL_LINE.test(line) || PHONE_LINE.test(line) || SSN_LINE.test(line)) phi += 1;
    }
    return { secrets, phi, addedLines: added.length };
}
