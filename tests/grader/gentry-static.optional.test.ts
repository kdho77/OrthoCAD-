// Independent grade of PR #453 at 20619e0f. Product code is not under test here.
// These checks read that commit; they do not import the worker's new test.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import { SKEW_INSET_RATIO as STATION_SKEW_INSET_RATIO } from "@/lib/geometry/procedural-wall/station-gates";
import { SKEW_INSET_RATIO as STATIONS_SKEW_INSET_RATIO } from "@/lib/geometry/procedural-wall/stations";

const GRADED = "20619e0f4a11a6a436c465b67699081dd6d06e10";
const PR_BASE = "c0933946a9b6c93020cc87f66a68d9120aca6b5d";
const ORIGIN_MAIN = "3cfcff559d9839fd36637e4db48eb07471a6b917";

const PRODUCT_DIFF = [
    "ci/unit-test-shards.json",
    "vertex/src/features/exports/saved-design-finalized-mesh.ts",
    "vertex/src/lib/geometry/procedural-wall/manufacturing-foot-guard.test.ts",
    "vertex/src/lib/geometry/procedural-wall/manufacturing-foot-guard.ts",
    "vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts",
].sort();

const PIN_PATHS = [
    "vertex/src/lib/geometry/procedural-wall/narrow-heelcup-preloft.test.ts",
    "vertex/src/lib/geometry/heel-lift-cup.test.ts",
    "tests/name-plantar-e2e/build-stls.test.ts",
    "tests/name-plantar-e2e/chirality.test.ts",
    "tests/name-plantar-e2e/thresholds.ts",
    "vertex/src/lib/geometry/procedural-wall/station-gates.ts",
    "vertex/src/lib/geometry/procedural-wall/stations.ts",
];

function git(args: string[]): string {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
}

describe("G5 static scope of 20619e0f", () => {
    test("the graded diff is the five declared files and leaves gates, pins, seams, and text geometry alone", () => {
        expect(git(["rev-parse", `${GRADED}^{commit}`])).toBe(GRADED);
        const names = git(["diff", "--name-only", `${PR_BASE}...${GRADED}`])
            .split("\n")
            .filter(Boolean)
            .sort();
        expect(names).toEqual(PRODUCT_DIFF);

        const patch = git(["diff", "-U0", `${PR_BASE}...${GRADED}`]);
        expect(patch).not.toMatch(/stlStorageKey|sourceStlPath/);
        expect(patch).not.toMatch(/\bcheckpoint\b/);

        for (const path of PIN_PATHS) {
            expect(git(["diff", "--name-only", `${PR_BASE}...${GRADED}`, "--", path]), path).toBe("");
            expect(
                git(["diff", "--name-only", `${PR_BASE}..${ORIGIN_MAIN}`, "--", path]),
                `${path} vs origin/main`,
            ).toBe("");
        }

        expect(STATION_SKEW_INSET_RATIO).toBe(0.5);
        expect(STATIONS_SKEW_INSET_RATIO).toBe(0.5);
        const gates = readFileSync("vertex/src/lib/geometry/procedural-wall/station-gates.ts", "utf8");
        expect(gates).toContain("export function assertPreLoftStations");
        expect(
            git([
                "diff",
                "--name-only",
                `${PR_BASE}...${GRADED}`,
                "--",
                "vertex/src/lib/geometry/text-marking",
            ]),
        ).toBe("");
        expect(
            git([
                "diff",
                "--name-only",
                `${PR_BASE}...${GRADED}`,
                "--",
                "vertex/server/src/lib/vertexslice-client.ts",
            ]),
        ).toBe("");
    });

    test("production still lofts the saved design and does not read a stored STL as the slice mesh", () => {
        const loft = git(["show", `${GRADED}:vertex/src/features/exports/saved-design-finalized-mesh.ts`]);
        expect(loft).not.toMatch(/stlStorageKey|sourceStlPath/);
        expect(loft).toContain("buildPrinterFootManufacturingStl");
        expect(loft).toContain("assertProductionFootStl");

        const cad = git(["show", `${GRADED}:vertex/server/src/routers/manufacturing-cad.ts`]);
        const buildAt = cad.indexOf("buildHeadlessFinalizedFoot");
        const uploadAt = cad.indexOf("await args.uploadStl");
        expect(buildAt).toBeGreaterThan(0);
        expect(uploadAt).toBeGreaterThan(buildAt);
        expect(cad).toContain("A caller storage key is not the mesh");
        expect(cad).not.toMatch(/sourceStlPath/);
    });
});
