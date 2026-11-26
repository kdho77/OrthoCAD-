// Independent grader for PR #466 (per-foot wedges + rearfoot posting sign). Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "@rstest/core";

import { orthocadMcpHttpSourceHash } from "../../../scripts/orthocad-mcp-http-bundle-hash.mjs";
import {
    parseSavedDesignCatalog,
    REARFOOT_POSTING_DEG_SIGN,
    savedDesignCatalogSchema,
    WEDGE_FOOT_FIELD,
} from "../../../shared/saved-design-catalog";
import type { Side, SideCorrections } from "../../types";
import { heightAt } from "../geometry/height-field";
import { migrateSideCorrections } from "../geometry/migrate-corrections";
import { insoleLayoutForUsMenSize } from "../geometry/shoe-size";
import { buildSavedDesignSnapshot } from "./saved-design-snapshot";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** Files in PR #466 @ b9083a13 (G-scope). */
const PR466_CHANGED_FILES = [
    "ci/unit-test-shards.json",
    "packages/mcp/src/tools/schemas.ts",
    "packages/mcp/test/persist-saved-design-snapshot.test.ts",
    "vertex/server/src/orthocad-mcp.bundled.mjs",
    "vertex/shared/saved-design-catalog.ts",
    "vertex/shared/saved-design-snapshot.ts",
    "vertex/src/lib/clinical/per-foot-wedge.test.ts",
] as const;

const WORKER_SHA = "b9083a1319f88a3c435c294b756715c5ddd6cd76";

const storedNine = {
    system: "US_M" as const,
    size: 9,
    left: null,
    right: null,
    width: null,
};

function snap(catalog: unknown) {
    return buildSavedDesignSnapshot({
        stored: storedNine,
        catalog: parseSavedDesignCatalog(catalog),
    });
}

function solidChecksum(side: Side, corrections: SideCorrections): string {
    const layout = insoleLayoutForUsMenSize(9);
    const rows: string[] = [];
    for (let ui = 0; ui < 11; ui++) {
        const u = 0.05 + ui * 0.09;
        for (let vi = 0; vi < 7; vi++) {
            const v = -1 + vi * (2 / 6);
            const z = heightAt(u, v, {
                side,
                lengthMm: layout.lengthMm,
                widthMm: layout.widthMm,
                thicknessMm: 2,
                corrections,
                elements: [],
                includeSkives: false,
                includeElements: false,
                trimline: null,
            });
            rows.push(z.toFixed(6));
        }
    }
    return createHash("sha256").update(rows.join("|")).digest("hex");
}

describe("PR #466 independent grader", () => {
    test("G-scope: worker diff stays inside the brief FILE list", () => {
        expect(PR466_CHANGED_FILES).toHaveLength(7);
        for (const rel of PR466_CHANGED_FILES) {
            expect(readFileSync(join(REPO_ROOT, rel), "utf8").length).toBeGreaterThan(0);
        }
        const diffFiles = execSync(`git diff --name-only main...${WORKER_SHA}`, {
            cwd: REPO_ROOT,
            encoding: "utf8",
        })
            .trim()
            .split("\n")
            .filter(Boolean)
            .sort();
        expect(diffFiles).toEqual([...PR466_CHANGED_FILES].sort());
    });

    test("AC1: omitted foot is legacy both-feet wedge write (byte-identical shape)", () => {
        const wedge = {
            side: "medial" as const,
            value: 2,
            unit: "deg" as const,
            degree_mode: "station" as const,
        };
        const legacy = snap({
            rearfoot_wedge: {
                side: wedge.side,
                value: wedge.value,
                unit: wedge.unit,
                degree_mode: wedge.degree_mode,
            },
            full_length_wedge: { side: "lateral", value: 3, unit: "mm" },
        });
        const expectedWedge = {
            side: wedge.side,
            value: wedge.value,
            unit: wedge.unit,
            degreeMode: wedge.degree_mode,
        };
        expect(legacy.design.corrections.linked).toBe(true);
        expect(legacy.design.corrections.left.rearfootWedge).toEqual(expectedWedge);
        expect(legacy.design.corrections.right.rearfootWedge).toEqual(expectedWedge);
        expect(legacy.design.corrections.left.fullLengthWedge).toEqual({
            side: "lateral",
            value: 3,
            unit: "mm",
        });
        expect(legacy.design.corrections.right.fullLengthWedge).toEqual({
            side: "lateral",
            value: 3,
            unit: "mm",
        });
        const wedgePaths = [
            "settings.corrections.left.fullLengthWedge",
            "settings.corrections.left.rearfootWedge",
            "settings.corrections.right.fullLengthWedge",
            "settings.corrections.right.rearfootWedge",
        ];
        for (const path of wedgePaths) {
            expect(legacy.paths, path).toContain(path);
        }
        expect(legacy.paths).not.toContain("settings.corrections.linked");
    });

    test("AC2: left-only rearfoot wedge changes only the left solid checksum", () => {
        const blank = snap({});
        const leftOnly = snap({
            rearfoot_wedge: { side: "medial", value: 2, unit: "deg", foot: "left" },
        });
        expect(leftOnly.design.corrections.linked).toBe(false);
        expect(solidChecksum("right", leftOnly.design.corrections.right)).toBe(
            solidChecksum("right", blank.design.corrections.right),
        );
        expect(solidChecksum("left", leftOnly.design.corrections.left)).not.toBe(
            solidChecksum("left", blank.design.corrections.left),
        );
    });

    test("AC2b: left-only full-length wedge changes only the left solid checksum", () => {
        const blank = snap({});
        const leftOnly = snap({
            full_length_wedge: { side: "lateral", value: 4, unit: "deg", foot: "left" },
        });
        expect(solidChecksum("right", leftOnly.design.corrections.right)).toBe(
            solidChecksum("right", blank.design.corrections.right),
        );
        expect(solidChecksum("left", leftOnly.design.corrections.left)).not.toBe(
            solidChecksum("left", blank.design.corrections.left),
        );
    });

    test("AC3: posting sign matches migrateSideCorrections (+ valgus lateral, − varus medial)", () => {
        expect(REARFOOT_POSTING_DEG_SIGN).toContain("Positive is valgus");
        expect(REARFOOT_POSTING_DEG_SIGN).toContain("Negative is varus");

        const neutral = migrateSideCorrections(snap({}).design.corrections.left);
        const valgus = migrateSideCorrections(
            snap({ sliders: { rearfoot_posting_deg: 2 } }).design.corrections.left,
        );
        const varus = migrateSideCorrections(
            snap({ sliders_by_side: { right: { rearfoot_posting_deg: -2 } } }).design.corrections.right,
        );
        expect(valgus.rearfootWedge).toEqual({ side: "lateral", value: 2, unit: "deg" });
        expect(varus.rearfootWedge).toEqual({ side: "medial", value: 2, unit: "deg" });

        const layout = insoleLayoutForUsMenSize(9);
        const latV = (side: Side) => (side === "left" ? -0.98 : 0.98);
        const medV = (side: Side) => -latV(side);
        for (const side of ["left", "right"] as const) {
            const migrated = migrateSideCorrections(
                snap({ sliders: { rearfoot_posting_deg: 2 } }).design.corrections[side],
            );
            const lateralRise =
                heightAt(0.12, latV(side), {
                    side,
                    lengthMm: layout.lengthMm,
                    widthMm: layout.widthMm,
                    thicknessMm: 2,
                    corrections: migrated,
                    elements: [],
                    includeSkives: false,
                    includeElements: false,
                    trimline: null,
                }) -
                heightAt(0.12, latV(side), {
                    side,
                    lengthMm: layout.lengthMm,
                    widthMm: layout.widthMm,
                    thicknessMm: 2,
                    corrections: neutral,
                    elements: [],
                    includeSkives: false,
                    includeElements: false,
                    trimline: null,
                });
            const medialRise =
                heightAt(0.12, medV(side), {
                    side,
                    lengthMm: layout.lengthMm,
                    widthMm: layout.widthMm,
                    thicknessMm: 2,
                    corrections: migrated,
                    elements: [],
                    includeSkives: false,
                    includeElements: false,
                    trimline: null,
                }) -
                heightAt(0.12, medV(side), {
                    side,
                    lengthMm: layout.lengthMm,
                    widthMm: layout.widthMm,
                    thicknessMm: 2,
                    corrections: neutral,
                    elements: [],
                    includeSkives: false,
                    includeElements: false,
                    trimline: null,
                });
            expect(lateralRise).toBeGreaterThan(0.15);
            expect(medialRise).toBeLessThan(lateralRise * 0.3);
        }
    });

    test("AC4: catalog schema documents posting sign on sliders and sliders_by_side", () => {
        const slider = savedDesignCatalogSchema.shape.sliders.unwrap().shape.rearfoot_posting_deg;
        expect(slider.description).toBe(REARFOOT_POSTING_DEG_SIGN);
        const bySide = savedDesignCatalogSchema.shape.sliders_by_side.unwrap();
        expect(bySide.shape.left.unwrap().shape.rearfoot_posting_deg.description).toBe(
            REARFOOT_POSTING_DEG_SIGN,
        );
        expect(bySide.shape.right.unwrap().shape.rearfoot_posting_deg.description).toBe(
            REARFOOT_POSTING_DEG_SIGN,
        );
        expect(savedDesignCatalogSchema.shape.rearfoot_wedge.unwrap().shape.foot.unwrap().description).toBe(
            WEDGE_FOOT_FIELD,
        );
        expect(
            savedDesignCatalogSchema.shape.full_length_wedge.unwrap().shape.foot.unwrap().description,
        ).toBe(WEDGE_FOOT_FIELD);
        expect(savedDesignCatalogSchema.shape.forefoot_wedge.unwrap().shape).not.toHaveProperty("foot");
    });

    test("G-bundle: hosted MCP bundle hash matches source (not loosened)", () => {
        const bundlePath = join(REPO_ROOT, "vertex/server/src/orthocad-mcp.bundled.mjs");
        const firstLine = readFileSync(bundlePath, "utf8").split("\n")[0];
        expect(firstLine).toBe(`// orthocad-mcp-http-bundle ${orthocadMcpHttpSourceHash()}`);
        expect(firstLine).toContain("9aa2fdab48460007e089b04b0c45864961c43ea77673b3253f5eaa05ebdc2dc7");
    });

    test("G-worker-sha: graded revision is the PR head under test", () => {
        expect(WORKER_SHA).toMatch(/^b9083a13/);
    });
});
