/**
 * Independent grader gates for PR #486 (head 42d58d5b) against the hardness-tint brief.
 * These tests assert the ORIGINAL BRIEF requirements on the merged tree at PR head.
 * Do not merge this file into the worker PR.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";

import {
    CLASS_PREVIEW_COLORS,
    type RegionHardnessClass,
} from "../shared/print-recipe/hardness-class-table.js";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const PR_HEAD = "42d58d5b602671ab951fd7101ceb65ac9d88f844";

const BRIEF_TOUCH_FILES = [
    "vertex/src/components/viewer/BaseInsoleMesh.tsx",
    "vertex/src/components/viewer/InsoleMesh.tsx",
    "vertex/src/lib/hardness/split-overlay.ts",
    "vertex/shared/print-recipe/hardness-class-table.ts",
    "vertex/src/stores/design-store.ts",
];

function readRepoFile(rel: string): string {
    return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

function prDiffNames(): string[] {
    return execFileSync("git", ["diff", "--name-only", `main...${PR_HEAD}`], {
        cwd: REPO_ROOT,
        encoding: "utf8",
    })
        .trim()
        .split("\n")
        .filter(Boolean);
}

describe("PR #486 grader — scope vs brief", () => {
    test("diff touches brief viewer/hardness files", () => {
        const names = prDiffNames();
        const touched = BRIEF_TOUCH_FILES.filter((f) => names.includes(f));
        expect(
            touched,
            `PR diff only ${JSON.stringify(names)}; brief requires changes under ${BRIEF_TOUCH_FILES.join(", ")}`,
        ).not.toHaveLength(0);
    });

    test("PR title/body claim hardness tint but commit is snapshot merge", () => {
        const subject = execFileSync("git", ["log", "-1", "--format=%s", PR_HEAD], {
            cwd: REPO_ROOT,
            encoding: "utf8",
        }).trim();
        expect(subject, "Head commit message does not describe viewport hardness tint").toMatch(
            /hardness|tint|viewport|heatmap/i,
        );
    });
});

describe("PR #486 grader — Kendon t2785u insole viewport tint", () => {
    test("BaseInsoleMesh maps design insole hardness to CLASS_PREVIEW_COLORS (non-heightmap)", () => {
        const src = readRepoFile("vertex/src/components/viewer/BaseInsoleMesh.tsx");
        const usesPreviewScheme =
            /CLASS_PREVIEW_COLORS|insoleHardness|defaultHardness|resolveInsole.*Color|hardnessTint/i.test(
                src,
            );
        expect(
            usesPreviewScheme,
            "BaseInsoleMesh still uses fixed sideColors gray; no hardness-driven base tint",
        ).toBe(true);
    });

    test("each named hardness yields a distinct insole preview color", () => {
        const ladder = ["Extra Soft", "Soft", "Medium", "Hard", "Extra Hard"] as const;
        const colors = new Set(ladder.map((name) => CLASS_PREVIEW_COLORS[name as RegionHardnessClass]));
        expect(colors.size).toBe(ladder.length);
        // Brief gate: implementation must wire these into the base mesh material (not only elements).
        const baseSrc = readRepoFile("vertex/src/components/viewer/BaseInsoleMesh.tsx");
        expect(baseSrc).toMatch(/CLASS_PREVIEW_COLORS/);
    });

    test("InsoleMesh applies hardness tint for parametric path", () => {
        const src = readRepoFile("vertex/src/components/viewer/InsoleMesh.tsx");
        expect(src).toMatch(/CLASS_PREVIEW_COLORS|insoleHardness|defaultHardness/i);
    });
});

describe("PR #486 grader — t2786u per-tab default view modes", () => {
    const designSteps = ["scan", "setup", "base", "corrections", "elements"] as const;

    test("entering a design tab defaults viewer to heightmap", () => {
        const src = readRepoFile("vertex/src/stores/clinical-workflow-store.ts");
        const setsHeightmapOnDesignTab = designSteps.some((step) =>
            new RegExp(`step.*${step}|"${step}".*heightmap|heightmap.*"${step}"`, "is").test(src),
        );
        expect(
            setsHeightmapOnDesignTab,
            "setStep does not set design-store viewer.heightmap=true for design tabs",
        ).toBe(true);
    });

    test("print and export tabs default to solid (non-heightmap) viewport", () => {
        const src = readRepoFile("vertex/src/stores/clinical-workflow-store.ts");
        expect(src).toMatch(/print.*heightmap:\s*false|export.*heightmap:\s*false/i);
    });
});

describe("PR #486 grader — Print/Export light tint and stronger shading", () => {
    test("print/export solid view uses lightened hardness tint helper", () => {
        const candidates = [
            "vertex/src/lib/hardness/split-overlay.ts",
            "vertex/src/components/viewer/BaseInsoleMesh.tsx",
            "vertex/src/components/viewer/Viewer3D.tsx",
        ];
        const found = candidates.some((rel) =>
            /print.*tint|lighten.*hardness|printExport.*Shading|contour.*shading/i.test(readRepoFile(rel)),
        );
        expect(found, "No print/export light hardness tint or extra contour shading hook found").toBe(true);
    });
});

describe("PR #486 grader — visual-only / export bytes", () => {
    test("PR adds or updates a viewport-only export byte parity test", () => {
        const names = prDiffNames();
        const parityTouch = names.some(
            (n) =>
                /export.*test\.ts$/.test(n) &&
                (n.includes("hardness") || n.includes("viewport") || n.includes("insole")),
        );
        expect(parityTouch, `PR diff files: ${names.join(", ")}`).toBe(true);
    });

    test("brief paths do not modify export mesh builders in this PR (negative gate on wrong scope)", () => {
        const names = prDiffNames();
        const exportCore = names.filter((n) => /export-service|manufacturing|mesh-close\.ts$/.test(n));
        expect(exportCore, "Unexpected export geometry changes in PR #486").toHaveLength(0);
    });
});

describe("PR #486 grader — draft PR hygiene", () => {
    test("PR diff includes requested server snapshot merge tests (actual worker scope)", () => {
        const names = prDiffNames();
        expect(names).toContain("vertex/server/src/lib/saved-design-snapshot.ts");
        expect(names).toContain("vertex/server/src/lib/saved-design-snapshot.test.ts");
    });
});
