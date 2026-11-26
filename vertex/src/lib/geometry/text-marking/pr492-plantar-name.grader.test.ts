// Independent grader for PR #492 @ 51c9a2bd. Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { fitLinear } from "../../../../../tests/name-plantar-e2e/measure";
import { G1_AXIS_MIN } from "../../../../../tests/name-plantar-e2e/thresholds";
import { flatBedSoleView, printedPlantarView } from "./belt-print-frame";
import { flattenText } from "./contours";
import { loadTextFont } from "./font";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..", "..");
const PR492_HEAD = "51c9a2bdb207e2d891c6e45d09034735a3b6cabc";

const PR492_ALLOWED_PATHS = [
    ".github/workflows/name-plantar-e2e.yml",
    "ci/unit-test-shards.json",
    "tests/name-plantar-e2e/PROOFS.md",
    "tests/name-plantar-e2e/README.md",
    "vertex/src/lib/geometry/text-marking/belt-print-frame.test.ts",
    "vertex/src/lib/geometry/text-marking/belt-print-frame.ts",
    "vertex/src/lib/geometry/text-marking/place.ts",
    "vertex/src/lib/geometry/text-marking/plantar-glyph-chirality.test.ts",
    "vertex/src/lib/geometry/text-marking/types.ts",
] as const;

function git(args: string): string {
    return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

describe("PR #492 grader G-scope — diff touches only brief files", () => {
    test(`${PR492_HEAD.slice(0, 8)}..main is limited to the nine PR paths`, () => {
        const mergeBase = git(`merge-base main ${PR492_HEAD}`);
        const changed = git(`diff --name-only ${mergeBase}..${PR492_HEAD}`)
            .split("\n")
            .filter(Boolean)
            .sort();
        const allowed = [...PR492_ALLOWED_PATHS].sort();
        expect(changed).toEqual(allowed);
    });

    test("worker tree matches graded commit for every worker file", () => {
        const graderOnly = new Set(["ci/unit-test-shards.json"]);
        for (const path of PR492_ALLOWED_PATHS) {
            if (graderOnly.has(path)) continue;
            expect(git(`diff ${PR492_HEAD} -- ${path}`), path).toBe("");
        }
    });
});

describe("PR #492 grader G-placement — ySign lock", () => {
    const placeSrc = readFileSync(
        resolve(REPO_ROOT, "vertex/src/lib/geometry/text-marking/place.ts"),
        "utf8",
    );

    test("placeBottomText uses a single ySign = -1 for belt and flat bed", () => {
        const fn = placeSrc.slice(placeSrc.indexOf("export function placeBottomText"));
        const body = fn.slice(0, fn.indexOf("\nexport ", 1) > 0 ? fn.indexOf("\nexport ", 1) : fn.length);
        expect(body).toMatch(/const ySign = -1;/);
        expect(body).not.toMatch(/opts\?\.beltPrint/);
        expect(body).not.toMatch(/xSign/);
    });

    test("main belt ySign +1 fails the plantar sole camera (repro)", async () => {
        const font = await loadTextFont();
        const flat = flattenText(font, "GNRF", 12, 0, true);
        const group = flat.groups[1]!;
        const upright = group.outer;
        const mainBelt = upright.map((p) => ({ x: p.x, y: p.y }));
        const fixedBelt = upright.map((p) => ({ x: p.x, y: -p.y }));
        const capMain = fitLinear(
            upright,
            mainBelt.map((p) => printedPlantarView(p)),
        );
        const capFixed = fitLinear(
            upright,
            fixedBelt.map((p) => printedPlantarView(p)),
        );
        expect(capMain.d, "main +Y belt cap upside down from below").toBeLessThan(-G1_AXIS_MIN);
        expect(capFixed.d, "fix −Y belt cap upright from below").toBeGreaterThan(G1_AXIS_MIN);
        const bedMain = fitLinear(
            upright,
            mainBelt.map((p) => flatBedSoleView(p)),
        );
        expect(bedMain.d, "main +Y still wrong on flat bed camera").toBeLessThan(-G1_AXIS_MIN);
    });
});

describe("PR #492 grader G-ci — live slicer, no Y-negate overlay", () => {
    const workflow = readFileSync(resolve(REPO_ROOT, ".github/workflows/name-plantar-e2e.yml"), "utf8");
    const shards = readFileSync(resolve(REPO_ROOT, "ci/unit-test-shards.json"), "utf8");

    test("name-plantar-e2e pins LIVE_IMAGE and forbids stl_preprocess overlay", () => {
        expect(workflow).toContain("LIVE_IMAGE: ghcr.io/kdho77/vertexslice-server@sha256:");
        expect(workflow).toContain("Do not overlay stl_preprocess.py from 9fe93642");
        expect(workflow).not.toContain("FIX_SHA:");
        expect(workflow).not.toContain("COPY validation/stl_preprocess.py");
    });

    test("plantar-glyph-chirality is registered in unit-test-shards", () => {
        expect(shards).toContain("vertex/src/lib/geometry/text-marking/plantar-glyph-chirality.test.ts");
    });
});

describe("PR #492 grader G-hygiene — synthetic names only", () => {
    test("new tests use GNRF / JABBOUR, not patient strings", () => {
        const chirality = readFileSync(
            resolve(REPO_ROOT, "vertex/src/lib/geometry/text-marking/plantar-glyph-chirality.test.ts"),
            "utf8",
        );
        expect(chirality).toContain('"GNRF"');
        expect(chirality).not.toMatch(/TEST PATIENT|t2794u/i);
        const belt = readFileSync(
            resolve(REPO_ROOT, "vertex/src/lib/geometry/text-marking/belt-print-frame.test.ts"),
            "utf8",
        );
        expect(belt).toContain('"JABBOUR"');
    });
});

describe("PR #492 grader G-pin — graded commit", () => {
    test("graded commit is an ancestor of this branch", () => {
        expect(git(`merge-base --is-ancestor ${PR492_HEAD} HEAD`)).toBe("");
    });
});
