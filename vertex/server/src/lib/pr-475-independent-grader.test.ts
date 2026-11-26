// Independent grader gates for PR #475 — do not merge; evidence for PASS/FAIL table.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "@rstest/core";

import {
    beginCadOperatorProduction,
    type CadProductionInsert,
    claimProduction,
    MemoryCadProductionStore,
    storedManufacturingStlReusable,
    TRANSIENT_PRODUCTION_ATTEMPTS,
} from "./cad-operator-production.js";
import { LOFT_WORKER_LIMIT } from "./loft-worker-pool.js";
import { HEALTH_TIMEOUT_MS } from "./vertexslice-build.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const here = dirname(fileURLToPath(import.meta.url));

/** PR #475 head under review (do not move when grader commits land on this branch). */
const PR_475_HEAD = "edd53e8aefa0315981e01dd1a26ca456b1d320f4";

const ALLOWED_PR_FILES = new Set([
    "ci/unit-test-shards.json",
    "packages/mcp/src/tools/handlers.ts",
    "packages/mcp/src/tools/schemas.ts",
    "packages/mcp/test/production-poll.test.ts",
    "vertex/server/src/lib/cad-operator-production.ts",
    "vertex/server/src/lib/generate-reliability.test.ts",
    "vertex/server/src/lib/loft-worker-pool.ts",
    "vertex/server/src/lib/storage.ts",
    "vertex/server/src/lib/vertexslice-build.test.ts",
    "vertex/server/src/lib/vertexslice-build.ts",
    "vertex/server/src/orthocad-mcp.bundled.mjs",
    "vertex/server/src/routers/cad-operator-generate.ts",
]);

function graderInsert(side: "left" | "right"): CadProductionInsert {
    return {
        designId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        side,
        presetId: "apex-v2-insole-95a",
        idempotencyKey: `cadop:v1:grader:${side}:gate`,
        settingsFingerprint: `grader-${side}`,
        beltAngleDeg: 45,
        layerHeightMm: null,
        material: "apex_core",
    };
}

describe("PR #475 independent grader gates", () => {
    test("G-scope: diff touches only the brief file list", () => {
        const mergeBase = execSync(`git merge-base ${PR_475_HEAD} main`, {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim();
        const names = execSync(`git diff --name-only ${mergeBase}...${PR_475_HEAD}`, {
            cwd: repoRoot,
            encoding: "utf8",
        })
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) {
            expect(ALLOWED_PR_FILES.has(name)).toBe(true);
        }
        expect(names).not.toEqual(
            expect.arrayContaining([
                expect.stringMatching(/^vertex\/src\//),
                expect.stringMatching(/loft|mesh|seam/i),
            ]),
        );
    });

    test("stored manufacturing STL reuse stays disabled in production", () => {
        expect(storedManufacturingStlReusable(null, null)).toBe(false);
        expect(storedManufacturingStlReusable({} as never, { stlIdentity: "archive/key.stl" })).toBe(false);
        const sources = [
            join(here, "cad-operator-production.ts"),
            join(here, "../routers/cad-operator-generate.ts"),
            join(here, "../routers/manufacturing-cad.ts"),
        ].map((path) => readFileSync(path, "utf8"));
        expect(sources.join("\n")).not.toContain("downloadManufacturingStl");
    });

    test("enqueue budget and operational caps match the brief", () => {
        const handlers = readFileSync(join(repoRoot, "packages/mcp/src/tools/handlers.ts"), "utf8");
        expect(handlers).toMatch(/GENERATE_ENQUEUE_ATTEMPT_MS = 12_000/);
        expect(handlers).toMatch(/GENERATE_ENQUEUE_ATTEMPTS = 3/);
        expect(12_000 * 3).toBeLessThan(60_000);
        expect(handlers).toContain("No partial pair is returned");
        expect(TRANSIENT_PRODUCTION_ATTEMPTS).toBe(3);
        expect(HEALTH_TIMEOUT_MS).toBe(5_000);
        expect(LOFT_WORKER_LIMIT).toBe(4);
    });

    test("beginCadOperatorProduction resolves with an id before background execute finishes", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-26T04:00:00.000Z");
        let executeStarted = false;
        let executeDone = false;
        let scheduled: Promise<void> | undefined;
        const slowExecute = new Promise<void>((resolve) => {
            executeStarted = true;
            setTimeout(() => {
                executeDone = true;
                resolve();
            }, 200);
        });
        const started = await beginCadOperatorProduction({
            store,
            insert: graderInsert("left"),
            now,
            schedule: (work) => {
                scheduled = work;
            },
            execute: async () => {
                await slowExecute;
            },
        });
        expect(started.status).toBe("pending");
        expect(started.productionId).toBeTruthy();
        expect(executeStarted).toBe(true);
        expect(executeDone).toBe(false);
        await scheduled;
        expect(executeDone).toBe(true);
    });

    test("a dead pending row is reclaimed without duplicating execute on a live running row", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-26T04:10:00.000Z");
        const claimed = await claimProduction(store, graderInsert("right"), now);
        await store.updateIf(claimed.row.id, () => true, {
            status: "running",
            updatedAt: now,
            leaseExpiresAt: new Date(now.getTime() + 300_000),
        });
        let runs = 0;
        const second = await beginCadOperatorProduction({
            store,
            insert: graderInsert("right"),
            now,
            schedule: () => {},
            execute: async () => {
                runs += 1;
            },
        });
        expect(second.productionId).toBe(claimed.row.id);
        expect(runs).toBe(0);
    });
});
