// Independent grader for PR #470 (eac20fa4). Does not reuse worker test helpers.

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { buildFinalizedFootFromSavedDesign } from "@/features/exports/saved-design-finalized-mesh";
import { DEFAULT_GLB_CLOSED_BASELINE, MeshNotWatertightError } from "@/lib/geometry/mesh-close";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClientStore } from "@/stores/client-store";
import type { ClientRow } from "../../../shared/client-files";
import { parseSavedDesignCatalog } from "../../../shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot";

const SUBJECT_SHA = "eac20fa4c8a5abcd1b340bf883ea4940fca8bf60";
const BASE_SHA = "228c72f2771a74e5b7c1d515ab0d01e4dd44d751";
const ALLOWED_PR_PATHS = new Set([
    "ci/unit-test-shards.json",
    "vertex/src/lib/geometry/element-assets/apply-elements.ts",
    "vertex/src/lib/geometry/reverse-mortons-watertight.test.ts",
]);
const WORKTREE = ".grader-worktrees/pr-470-eac20fa";
const SMOKE_REL = "vertex/src/lib/geometry/grader-pr-470-export-smoke.optional.test.ts";
const APPLY_ELEMENTS = "vertex/src/lib/geometry/element-assets/apply-elements.ts";

const originalFetch = globalThis.fetch;

function repoRoot(): string {
    return resolve(process.cwd());
}

function git(args: string): string {
    return execSync(`git ${args}`, { cwd: repoRoot(), encoding: "utf8" }).trim();
}

function ensureSubjectWorktree(): string {
    const root = repoRoot();
    const wt = resolve(root, WORKTREE);
    if (!existsSync(wt)) {
        mkdirSync(resolve(root, ".grader-worktrees"), { recursive: true });
        execSync(`git worktree add ${wt} ${SUBJECT_SHA}`, { cwd: root, stdio: "pipe" });
        execSync("npm ci", { cwd: wt, stdio: "pipe" });
        execSync("npm ci", { cwd: resolve(wt, "vertex"), stdio: "pipe" });
    }
    return wt;
}

function sampleTopBytes(): ArrayBuffer {
    const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
    globalThis.fetch = async () => new Response(bytes);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
    resetManufacturingSolidCache();
    useBottomPatternStore.getState().clear();
    useClientStore.setState({ activeClientId: null, clients: [] });
});

describe("grader PR #470 — static gates", () => {
    test("G-scope: diff is only the brief FILES", () => {
        const names = git(`diff --name-only ${BASE_SHA}..${SUBJECT_SHA}`).split("\n").filter(Boolean);
        expect(names.sort()).toEqual([...ALLOWED_PR_PATHS].sort());
    });

    test("G-guard: mesh-close.ts and closed-solid baseline unchanged", () => {
        const diff = git(`diff ${BASE_SHA}..${SUBJECT_SHA} -- vertex/src/lib/geometry/mesh-close.ts`);
        expect(diff).toBe("");
        const meshClose = git(`show ${SUBJECT_SHA}:vertex/src/lib/geometry/mesh-close.ts`);
        expect(meshClose).toContain("heelBridgeSelfIntersections: 0");
        expect(DEFAULT_GLB_CLOSED_BASELINE.heelBridgeSelfIntersections).toBe(0);
        expect(DEFAULT_GLB_CLOSED_BASELINE.eulerCharacteristic).toBe(3);
    });

    test("G-shard: worker regression registered at subject SHA", () => {
        const shards = git(`show ${SUBJECT_SHA}:ci/unit-test-shards.json`);
        expect(shards).toContain("vertex/src/lib/geometry/reverse-mortons-watertight.test.ts");
    });

    test("G-invent: apply-elements diff uses repo-defined mm constants", () => {
        const patch = git(`diff ${BASE_SHA}..${SUBJECT_SHA} -- ${APPLY_ELEMENTS}`);
        const added = patch
            .split("\n")
            .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
            .join("\n");
        expect(patch).toContain("REMAINING_MATERIAL_MM");
        expect(added).toContain("N_TOP_PATCH_MM");
        expect(added).toContain("ELEMENT_SUBDIVIDE_EDGE_MM");
        expect(added).not.toMatch(/heightMm\s*=\s*\d/);
        expect(added).not.toMatch(/thicknessMm\s*=\s*\d/);
    });
});

describe("grader PR #470 — main repro (pre-fix)", () => {
    test("Latino-proxy US M9 thickness 3 reverse Morton's 2 mm left throws on base apply-elements", () => {
        const head = git("rev-parse HEAD");
        try {
            git(`checkout ${BASE_SHA} -- ${APPLY_ELEMENTS}`);
            const row = {
                id: "grader-repro",
                firstName: "Alex",
                lastName: "Latino",
                displayName: "Alex Latino",
            } as ClientRow;
            useClientStore.setState({ activeClientId: row.id, clients: [row] });
            const snap = buildSavedDesignSnapshot({
                stored: { system: "US_M", size: 9, left: null, right: null, width: null },
                catalog: parseSavedDesignCatalog({
                    thickness_mm: 3,
                    elements: [
                        { name: "reverse_mortons", side: "left", height_mm: 2 },
                        { name: "reverse_mortons", side: "right", height_mm: 2 },
                    ],
                }),
            });
            const run = buildFinalizedFootFromSavedDesign({
                design: snap.design,
                side: "left",
                sampleTopBytes: sampleTopBytes(),
                includeLeader: false,
            });
            return expect(run).rejects.toBeInstanceOf(MeshNotWatertightError);
        } finally {
            git(`checkout ${head} -- ${APPLY_ELEMENTS}`);
        }
    }, 180_000);
});

describe("grader PR #470 — independent subject-tree export", () => {
    test("G-ONE: brief primary case watertight on subject SHA (separate process)", () => {
        const wt = ensureSubjectWorktree();
        const smokeSrc = resolve(repoRoot(), SMOKE_REL);
        const smokeDst = resolve(wt, SMOKE_REL);
        copyFileSync(smokeSrc, smokeDst);
        const out = execSync(`npx rstest ${SMOKE_REL}`, {
            cwd: wt,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 600_000,
        });
        expect(out).toContain("No test failures");
    }, 600_000);

    test("G-matrix: worker file 13/13 on subject SHA (separate process)", () => {
        const wt = ensureSubjectWorktree();
        const out = execSync("npx rstest vertex/src/lib/geometry/reverse-mortons-watertight.test.ts", {
            cwd: wt,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 600_000,
        });
        expect(out).toContain("No test failures");
        expect(out).toMatch(/13 passed|Passed/);
    }, 600_000);
});
