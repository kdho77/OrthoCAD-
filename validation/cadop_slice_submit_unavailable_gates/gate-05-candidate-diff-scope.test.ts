// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execFileSync } from "node:child_process";
import { describe, expect, test } from "@rstest/core";

const ALLOWED = new Set([
    "vertex/server/src/lib/vertexslice-client.ts",
    "vertex/server/src/lib/vertexslice-client.test.ts",
    "vertex/server/src/lib/cad-operator-production.test.ts",
    "vertex/server/src/lib/cad-operator-production.ts",
]);

describe("G5 — candidate diff scope (grading only)", () => {
    test("diff vs BASE touches only allowlisted client/test files", () => {
        const base = process.env.CADOP_GATES_BASE_SHA ?? "cc6482be37175bd7db3c25e3179e22753e5dd899";
        const candidate = process.env.CADOP_GATES_CANDIDATE_SHA;
        if (!candidate) {
            expect(true).toBe(true);
            return;
        }
        const repoRoot = process.env.CADOP_GATES_REPO_ROOT ?? process.cwd();
        const out = execFileSync("git", ["diff", "--name-only", `${base}..${candidate}`], {
            cwd: repoRoot,
            encoding: "utf8",
        })
            .trim()
            .split("\n")
            .filter(Boolean);
        const forbidden = out.filter((p) => !ALLOWED.has(p));
        expect(forbidden).toEqual([]);
        expect(out.length).toBeGreaterThan(0);
    });
});
