// Independent grader for PR #461 @ 4d223923. Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const PR461_HEAD = "4d2239239125082f8d90de81e1410681b7f33597";

/** Paths the worker was allowed to touch (plus their tests). */
const PR461_ALLOWED = [
    "vertex/src/lib/geometry/text-marking/",
    "vertex/src/lib/geometry/procedural-wall/manufacturing-foot-guard",
    "vertex/src/features/exports/export-panel-clinical",
    "vertex/src/features/exports/export-panel-clinical.test",
    "vertex/src/features/exports/ExportPanel.test",
    "vertex/src/lib/geometry/export-geometry.ts",
    "packages/mcp/src/shared/export-filename",
    "vertex/shared/export-filename",
    "vertex/server/src/routers/cad-operator-generate.ts",
    "vertex/server/src/orthocad-mcp.bundled.mjs",
];

function git(args: string): string {
    return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function pr461ChangedFiles(): string[] {
    return git(`diff --name-only origin/main...${PR461_HEAD}`).split("\n").filter(Boolean);
}

describe("PR #461 grader G3 — manifold guard not loosened", () => {
    test("manufacturing-foot-guard.ts is byte-identical to main", () => {
        const diff = git(
            `diff origin/main...${PR461_HEAD} -- vertex/src/lib/geometry/procedural-wall/manufacturing-foot-guard.ts`,
        );
        expect(diff).toBe("");
    });

    test("assertExactManifold still uses tolerance 0", () => {
        const src = readFileSync(join(REPO_ROOT, "vertex/src/lib/geometry/text-marking/boolean.ts"), "utf8");
        expect(src).toContain("/** Manifold-3d check on the exact index. No tolerance weld. */");
        expect(src).toMatch(/tolerance:\s*0/);
        const diff = git(
            `diff origin/main...${PR461_HEAD} -- vertex/src/lib/geometry/text-marking/boolean.ts`,
        );
        expect(diff).toBe("");
    });

    test("stitch path re-runs assertExactManifold at tolerance 0, not a relaxed check", () => {
        const src = git(`show ${PR461_HEAD}:vertex/src/lib/geometry/text-marking/bottom-engrave.ts`);
        expect(src).toContain("stitchOpenEngraveSeam");
        expect(src).toMatch(/await assertExactManifold\(geo\);\s*}\s*catch/);
        expect(src).not.toMatch(/assertExactManifold\([^)]*tolerance[^0]/);
        const loosen = git(
            `diff origin/main...${PR461_HEAD} -G"tolerance|assertExactManifold" -- vertex/src/lib/geometry/text-marking/boolean.ts vertex/src/lib/geometry/procedural-wall/manufacturing-foot-guard.ts`,
        );
        expect(loosen).toBe("");
    });
});

describe("PR #461 grader G6 — scope and CI", () => {
    test("changed files stay within the engrave / guard / pair-export surface", () => {
        const changed = pr461ChangedFiles();
        expect(changed.length).toBeGreaterThan(0);
        for (const file of changed) {
            const allowed = PR461_ALLOWED.some((prefix) => file.startsWith(prefix) || file.includes(prefix));
            expect(allowed, `unexpected path in PR #461: ${file}`).toBe(true);
        }
    });

    test("independent grader test files are registered in ci/unit-test-shards.json", () => {
        const shards = readFileSync(join(REPO_ROOT, "ci/unit-test-shards.json"), "utf8");
        expect(shards).toContain("vertex/tests/pr461-name-engrave.grader.test.ts");
        expect(shards).toContain("vertex/tests/pr461-name-engrave.grader.static.test.ts");
        expect(shards).toContain("vertex/tests/pr461-pair-export.grader.test.ts");
    });
});
