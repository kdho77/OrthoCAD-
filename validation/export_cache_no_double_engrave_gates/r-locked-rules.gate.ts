// Frozen gates R1–R6. Do not edit after the freeze commit.
// Surface, seam, layer-change, and engraving-placement files must stay
// byte-identical to BASE. The product diff must stay inside the cache fix.
// Geometry identity is also enforced by T4 (0.0 mm).

import { describe, test } from "@rstest/core";
import {
    addedDiffLines,
    BASE_SHA,
    blobAt,
    check,
    productDiffNames,
    untrackedProductPaths,
    worktreeBlob,
} from "./support";

/** Seam and layer-change placement. A change here can move a seam onto the top or a side. */
const R1_FILES = [
    "vertex/src/lib/kiri/slicer.ts",
    "vertex/src/lib/kiri/engine.ts",
    "vertex/src/lib/kiri/presets.ts",
    "vertex/src/lib/geometry/procedural-wall/reconstruct.ts",
    "vertex/src/lib/geometry/procedural-wall/wall-spline.ts",
];

/** Seams and layer changes belong on the bottom (plantar / belt face). */
const R2_FILES = [
    "vertex/src/lib/kiri/slicer.ts",
    "vertex/src/lib/kiri/engine.ts",
    "vertex/src/lib/kiri/presets.ts",
    "vertex/src/lib/geometry/text-marking/bottom-engrave.ts",
];

/** Engraving placement and depth. R4 and R6 lock these bytes. */
const ENGRAVE_FILES = [
    "vertex/src/lib/geometry/text-marking/bottom-engrave.ts",
    "vertex/src/lib/geometry/text-marking/apply.ts",
    "vertex/src/lib/geometry/text-marking/place.ts",
    "vertex/src/lib/geometry/text-marking/constants.ts",
    "vertex/src/lib/geometry/text-marking/boolean.ts",
    "vertex/shared/bottom-text-marking.ts",
    "vertex/src/lib/geometry/mesh-close.ts",
    "vertex/src/lib/geometry/procedural-wall/reconstruct.ts",
];

/**
 * Files a cache-reuse fix may touch. Anything else is scope growth (R3).
 * Tests of those files are part of the same fix.
 */
const ALLOWED_PRODUCT_FILES = new Set([
    "vertex/src/hooks/useBaseInsoleGeometry.ts",
    "vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.ts",
    "vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.test.ts",
    "vertex/src/lib/geometry/procedural-wall/print-export-cache-parity.test.ts",
    "vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts",
    "vertex/src/stores/clinical-workflow-print-loft.test.ts",
]);

const SECRET_RE = /api_key|bearer|railway|vertex-web|vertex-api|\btoken\b/i;

function changedFiles(paths: string[]): string[] {
    return paths.filter((path) => {
        try {
            return worktreeBlob(path) !== blobAt(BASE_SHA, path);
        } catch {
            return true;
        }
    });
}

describe("R1-R6 locked rules", () => {
    test("R1 surface and seam files are byte-identical to main", () => {
        const changed = changedFiles(R1_FILES);
        check({
            id: "R1",
            rule: "R1: print surface quality stays locked; no seam or layer-change edit on the top or sides",
            expectOnBase: "pass",
            pass: changed.length === 0,
            measured: changed.length === 0 ? "0 files differ" : changed.join(","),
            threshold: "0 protected surface/seam files differ from BASE",
        });
    });

    test("R2 bottom seam and layer-change files are byte-identical to main", () => {
        const changed = changedFiles(R2_FILES);
        check({
            id: "R2",
            rule: "R2: seams and layer changes stay on the bottom; those sources are untouched",
            expectOnBase: "pass",
            pass: changed.length === 0,
            measured: changed.length === 0 ? "0 files differ" : changed.join(","),
            threshold: "0 bottom seam/layer files differ from BASE",
        });
    });

    test("R3 the product diff stays inside the cache-reuse fix", () => {
        const names = productDiffNames();
        const untracked = untrackedProductPaths();
        const extra = [...names.filter((path) => !ALLOWED_PRODUCT_FILES.has(path)), ...untracked];
        check({
            id: "R3",
            rule: "R3: scope stays on the observed cache defect; no new construction",
            expectOnBase: "pass",
            pass: extra.length === 0,
            measured: extra.length === 0 ? `productFiles=${names.length}` : extra.join(","),
            threshold: "0 product paths outside the cache fingerprint and export-reuse allowlist",
        });
    });

    test("R4 patient name still uses the existing bottom textMarking engrave", () => {
        const changed = changedFiles(ENGRAVE_FILES);
        const names = productDiffNames();
        const newEngrave = names.filter(
            (path) => /engrave|text-marking|text_marking/i.test(path) && !ALLOWED_PRODUCT_FILES.has(path),
        );
        check({
            id: "R4",
            rule: "R4: patient name stays on the bottom through the existing textMarking engrave; no new engraving system",
            expectOnBase: "pass",
            pass: changed.length === 0 && newEngrave.length === 0,
            measured:
                changed.length + newEngrave.length === 0
                    ? "engrave sources unchanged"
                    : [...changed, ...newEngrave].join(","),
            threshold: "0 engraving-placement files differ and 0 new engraving paths",
        });
    });

    test("R5 the product diff contains no secrets, Railway targets, or PHI", () => {
        const hits = addedDiffLines().filter((line) => SECRET_RE.test(line));
        check({
            id: "R5",
            rule: "R5: no secrets, no PHI, no Railway vertex-web/vertex-api or deploy edits",
            expectOnBase: "pass",
            pass: hits.length === 0,
            measured: hits.length === 0 ? "0 secret lines" : `${hits.length} lines`,
            threshold: "0 added lines match api_key|token|bearer|railway|vertex-web|vertex-api",
        });
    });

    test("R6 geometry, walls, and engraving depth sources are byte-identical to main", () => {
        const changed = changedFiles(ENGRAVE_FILES);
        check({
            id: "R6",
            rule: "R6: zero change to geometry, walls, outer surface, or text engraving placement and depth",
            expectOnBase: "pass",
            pass: changed.length === 0,
            measured: changed.length === 0 ? "0 files differ" : changed.join(","),
            threshold: "0 geometry/engrave files differ from BASE; STL delta is enforced by T4 at 0.0 mm",
        });
    });
});
