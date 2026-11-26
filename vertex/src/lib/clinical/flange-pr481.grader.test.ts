// Independent grader for PR #481 (452a2f6). Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { Side, SideCorrections } from "@/types";
import { DESIGN_SETTINGS_SCHEMA_VERSION, readStoredDesignSettings } from "../../../shared/design-settings";
import { parseSavedDesignCatalog, type StoredLinkShoe } from "../../../shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot";
import { designStateFromSavedSettings } from "../../features/exports/saved-design-finalized-mesh";
import { BASE_REFERENCE_THICKNESS_MM, correctionDeltaAt } from "../geometry/base-modifier";
import type { HeightFieldParams } from "../geometry/height-field";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const PR481_HEAD = "452a2f6c7b8804141e29d332f3cee38dd349a74b";
const PR481_BASE = "228c72f2771a74e5b7c1d515ab0d01e4dd44d751";

const storedNine: StoredLinkShoe = {
    system: "US_M",
    size: 9,
    left: null,
    right: null,
    width: null,
};

function build(catalog: unknown) {
    return buildSavedDesignSnapshot({
        stored: storedNine,
        catalog: parseSavedDesignCatalog(catalog),
    });
}

function flangeField(side: Side, corrections: SideCorrections): HeightFieldParams {
    return {
        side,
        lengthMm: 270,
        widthMm: 92,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections,
        elements: [],
        includeSkives: false,
        includeElements: false,
    };
}

function borderDelta(side: Side, corrections: SideCorrections, border: "medial" | "lateral"): number {
    const neutral = build({}).design.corrections[side];
    const v = side === "left" ? (border === "medial" ? 0.92 : -0.92) : border === "medial" ? -0.92 : 0.92;
    return correctionDeltaAt(0.45, v, flangeField(side, corrections), flangeField(side, neutral));
}

describe("PR #481 grader G1 — explicit lateral_mm 0 is numeric zero, not default 3", () => {
    test("G1 Heinrich: left lateral_mm 0 stays 0 on corrections and readback", () => {
        const built = build({ flange: { left: { lateral_mm: 0 } } });
        expect(built.design.corrections.left.lateralFlangeMm).toBe(0);
        expect(built.design.corrections.left.medialFlangeMm).toBe(0);
        expect(Math.abs(borderDelta("left", built.design.corrections.left, "lateral"))).toBeLessThan(1e-6);

        const envelope = { schemaVersion: DESIGN_SETTINGS_SCHEMA_VERSION, settings: built.design };
        const read = readStoredDesignSettings(envelope);
        expect((read?.corrections as { left: SideCorrections }).left.lateralFlangeMm).toBe(0);
        expect(designStateFromSavedSettings(envelope).corrections.left.lateralFlangeMm).toBe(0);
    });
});

describe("PR #481 grader G2 — Najim medial-only does not back-fill lateral 3", () => {
    test("G2 left medial_mm only yields lateral 0 and no lateral path", () => {
        const built = build({ flange: { left: { medial_mm: 3 } } });
        expect(built.design.corrections.left).toMatchObject({ medialFlangeMm: 3, lateralFlangeMm: 0 });
        expect(built.paths).not.toContain("settings.corrections.left.lateralFlangeMm");
        expect(borderDelta("left", built.design.corrections.left, "medial")).toBeGreaterThan(0.2);
        expect(Math.abs(borderDelta("left", built.design.corrections.left, "lateral"))).toBeLessThan(1e-6);
    });
});

describe("PR #481 grader G3 — Gomez right lateral-only", () => {
    test("G3 right lateral_mm alone maps to lateral correction only", () => {
        const built = build({ flange: { right: { lateral_mm: 5 } } });
        expect(built.design.corrections.right).toMatchObject({ medialFlangeMm: 0, lateralFlangeMm: 5 });
        expect(built.paths).not.toContain("settings.corrections.right.medialFlangeMm");
        expect(built.paths).toContain("settings.corrections.right.lateralFlangeMm");
    });
});

describe("PR #481 grader G4 — all four explicit zeros produce flat border", () => {
    test("G4 bilateral explicit 0 on every border", () => {
        const built = build({
            flange: {
                left: { medial_mm: 0, lateral_mm: 0 },
                right: { medial_mm: 0, lateral_mm: 0 },
            },
        });
        for (const side of ["left", "right"] as const) {
            const c = built.design.corrections[side];
            expect(c.medialFlangeMm).toBe(0);
            expect(c.lateralFlangeMm).toBe(0);
            expect(Math.abs(borderDelta(side, c, "medial"))).toBeLessThan(1e-6);
            expect(Math.abs(borderDelta(side, c, "lateral"))).toBeLessThan(1e-6);
        }
    });
});

describe("PR #481 grader G5 — omitted catalog vs empty flange object defaults", () => {
    test("G5 template 0 when flange omitted; 3/3 only when foot object is present but empty", () => {
        const omitted = build({});
        expect(omitted.design.corrections.left).toMatchObject({ medialFlangeMm: 0, lateralFlangeMm: 0 });

        const emptyFoot = build({ flange: { left: {} } });
        expect(emptyFoot.design.corrections.left).toMatchObject({ medialFlangeMm: 3, lateralFlangeMm: 3 });
    });
});

describe("PR #481 grader G9 — PR #481 diff scope and shard registration", () => {
    test("G9a worker diff touches only the seven brief-listed paths", () => {
        const raw = execFileSync("git", ["diff", "--name-only", `${PR481_BASE}..${PR481_HEAD}`], {
            cwd: REPO_ROOT,
            encoding: "utf8",
        }).trim();
        const workerFiles = raw ? raw.split("\n").sort() : [];
        expect(workerFiles).toEqual(
            [
                "ci/unit-test-shards.json",
                "packages/mcp/test/persist-saved-design-snapshot.test.ts",
                "vertex/server/src/lib/saved-design-snapshot.test.ts",
                "vertex/server/src/lib/saved-design-snapshot.ts",
                "vertex/shared/saved-design-snapshot.ts",
                "vertex/src/lib/clinical/flange-explicit-zero.test.ts",
                "vertex/src/lib/geometry/procedural-wall/defaults.test.ts",
            ].sort(),
        );
    });

    test("G9b flange-explicit-zero.test.ts is registered in shard 1", () => {
        const shards = JSON.parse(readFileSync(join(REPO_ROOT, "ci/unit-test-shards.json"), "utf8")) as {
            shards: Array<{ index: number; files: string[] }>;
        };
        const shard1 = shards.shards.find((s) => s.index === 1);
        expect(shard1?.files).toContain("vertex/src/lib/clinical/flange-explicit-zero.test.ts");
    });
});
