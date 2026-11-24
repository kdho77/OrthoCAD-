// Frozen before grading candidate f059edf74b9bed33071a4deb8ad3c9674d289dfd.
// Scope and locked-surface source gate. Reads git. Does not modify the product.

import { execFileSync } from "node:child_process";

/** Files a cold-export worker change may touch. Anything else fails R3. */
export const ALLOWLIST = [
    "vertex/src/lib/geometry/export-geometry.ts",
    "vertex/src/lib/geometry/procedural-wall/preview-loft-worker.ts",
    "vertex/src/lib/geometry/procedural-wall/preview-loft-worker.test.ts",
    "vertex/src/workers/procedural-wall.worker.ts",
    "vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts",
    "vertex/src/features/exports/export-service.ts",
    "vertex/src/features/exports/export-panel-clinical.ts",
    "vertex/src/features/exports/export-panel-clinical.test.ts",
    "vertex/src/features/exports/pair-gcode-isolation.test.ts",
];

const SAMPLE_TOP = "vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts";

/** Prefixes that must stay byte-identical to BASE. */
export const DENY = {
    surface: [
        "vertex/src/lib/geometry/mesh-close.ts",
        "vertex/src/lib/geometry/manifold.ts",
        "vertex/src/lib/geometry/procedural-wall/wall-spline.ts",
    ],
    seam: ["vertex/src/lib/kiri"],
    text: ["vertex/src/lib/geometry/text-marking", "vertex/shared/bottom-text-marking.ts"],
    fingerprint: [
        "vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.ts",
        "vertex/src/lib/geometry/procedural-wall/manufacturing-solid-context.ts",
    ],
    railway: ["vertex-web", "vertex-api"],
    database: ["vertex/prisma", "vertex/server/prisma"],
};

const SECRET_RULES = [
    { id: "api_key", re: /api[_-]?key/i },
    { id: "bearer", re: /bearer\s+[a-z0-9._\-+/=]+/i },
    { id: "sk_live", re: /sk_live/ },
    { id: "ghp_", re: /ghp_/ },
    { id: "email", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
    { id: "mrn", re: /\bmrn\b/i },
];

export function normalizeSampleTopPreview(src) {
    return src.replace(/\bexport async function applyExportText\b/g, "async function applyExportText");
}

function matchesPrefix(file, prefix) {
    return (
        file === prefix ||
        file.startsWith(`${prefix}/`) ||
        file.includes(`/${prefix}/`) ||
        file.startsWith(prefix)
    );
}

export function evaluateSource({ changedFiles, patch, sampleTopBodyIdentical }) {
    const files = [...changedFiles];
    const outsideAllowlist = files.filter((file) => !ALLOWLIST.includes(file));
    const dirty = {};
    for (const [group, prefixes] of Object.entries(DENY)) {
        dirty[group] = files.filter((file) => prefixes.some((prefix) => matchesPrefix(file, prefix)));
    }
    const added = String(patch ?? "")
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
    const secretHits = [];
    const seen = new Set();
    for (const line of added) {
        for (const rule of SECRET_RULES) {
            if (!rule.re.test(line) || seen.has(rule.id)) continue;
            seen.add(rule.id);
            secretHits.push({ rule: rule.id });
        }
    }
    const sampleOk = sampleTopBodyIdentical !== false;
    const sourcePass = {
        R1: dirty.surface.length === 0 && sampleOk,
        R2: dirty.seam.length === 0,
        R3: outsideAllowlist.length === 0,
        R4: dirty.text.length === 0,
        R5: secretHits.length === 0 && dirty.railway.length === 0 && dirty.database.length === 0,
        R6:
            dirty.fingerprint.length === 0 &&
            dirty.surface.length === 0 &&
            sampleOk &&
            dirty.text.length === 0,
    };
    return {
        changedFiles: files,
        outsideAllowlist,
        dirty,
        sampleTopBodyIdentical: sampleOk,
        secretHits,
        addedLineCount: added.length,
        sourcePass,
    };
}

function git(repo, args) {
    return execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
}

export function collectGitDiff(repo, baseSha, headSha) {
    const changedFiles = git(repo, ["diff", "--name-only", baseSha, headSha])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const patch = git(repo, ["diff", "--unified=0", baseSha, headSha]);
    let sampleTopBodyIdentical = true;
    if (changedFiles.includes(SAMPLE_TOP)) {
        const before = git(repo, ["show", `${baseSha}:${SAMPLE_TOP}`]);
        const after = git(repo, ["show", `${headSha}:${SAMPLE_TOP}`]);
        sampleTopBodyIdentical = normalizeSampleTopPreview(before) === normalizeSampleTopPreview(after);
    }
    return evaluateSource({ changedFiles, patch, sampleTopBodyIdentical });
}
