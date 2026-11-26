// Independent grader for PR #485 @ f391f49d040943a2174b275f3645c2eb505c7edb. Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "@rstest/core";
import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import {
    buildFinalizedFootFromSavedDesign,
    publishProceduralSampleTopOutlines,
} from "@/features/exports/saved-design-finalized-mesh";
import { activePatientDisplayName } from "@/lib/clinical/patient-display-name";
import { buildExportStl } from "@/lib/geometry/export-geometry";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import { endPatternOnTrim, TRIM_PRESET_LANDMARK_U } from "@/lib/geometry/trim-presets";
import type { TrimlineCurve } from "@/lib/geometry/trimline";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { curveForTrimPreset, resolveActiveTrimline, useMeshEditStore } from "@/stores/mesh-edit-store";
import {
    createSavedDesignInputSchema,
    listMcpSavedDesignCatalogKeyPaths,
    savedDesignCatalogSchema,
} from "../../packages/mcp/src/tools/schemas.ts";
import {
    catalogLengthPreset,
    listSavedDesignCatalogKeyPaths,
    parseSavedDesignCatalog,
    SavedDesignSnapshotError,
} from "../shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../shared/saved-design-snapshot";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const GRADED_SHA = "f391f49d040943a2174b275f3645c2eb505c7edb";
const MAIN_BASELINE_SHA = "91e0062a7fd1de564b7d8b9f14b869a752464a7b";

/** Files in the PR #485 diff at f391f49d (scope gate). */
const PR485_CHANGED_FILES = [
    "ci/unit-test-shards.json",
    "packages/mcp/README.md",
    "packages/mcp/src/tools/schemas.ts",
    "packages/mcp/test/persist-saved-design-snapshot.test.ts",
    "scripts/ci/generate-unit-test-shards.mjs",
    "vertex/server/src/lib/saved-design-snapshot.test.ts",
    "vertex/server/src/orthocad-mcp.bundled.mjs",
    "vertex/shared/saved-design-catalog.ts",
    "vertex/shared/saved-design-snapshot.ts",
    "vertex/src/features/exports/saved-design-finalized-mesh.ts",
    "vertex/src/features/exports/saved-design-length-preset.test.ts",
    "vertex/src/hooks/useBaseInsoleGeometry.ts",
    "vertex/src/lib/geometry/export-geometry.ts",
    "vertex/src/lib/geometry/trim-presets.ts",
    "vertex/src/stores/mesh-edit-store.ts",
] as const;

const originalFetch = globalThis.fetch;

function sha256(bytes: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function designForLength(length?: string) {
    const snap = buildSavedDesignSnapshot({
        stored: { system: "US_M", size: 9, left: null, right: null, width: "medium" },
        catalog: parseSavedDesignCatalog(length ? { length } : {}),
    });
    return createDesignWithStockPlaceholder(snap.design);
}

function requireCurve(curve: TrimlineCurve | null, label: string): TrimlineCurve {
    if (!curve || curve.points.length < 4) throw new Error(`missing ${label}`);
    return curve;
}

function sameCurve(actual: TrimlineCurve | null, expected: TrimlineCurve | null): void {
    const left = requireCurve(actual, "actual curve");
    const right = requireCurve(expected, "expected curve");
    expect(left.points.length).toBe(right.points.length);
    for (let i = 0; i < left.points.length; i += 1) {
        const a = left.points[i];
        const b = right.points[i];
        if (!a || !b) throw new Error("missing curve point");
        expect(a.x).toBe(b.x);
        expect(a.y).toBe(b.y);
        expect(a.z).toBe(b.z);
    }
}

async function publishOutlines(design: ReturnType<typeof designForLength>): Promise<ArrayBuffer> {
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    useBaseOutlineStore.setState({ outlines: {} });
    const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
    globalThis.fetch = async () => new Response(bytes);
    useDesignStore.setState({
        design,
        viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural" },
    });
    const sampleTop = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const native = await sampleTopFromArrayBuffer(sampleTop);
    publishProceduralSampleTopOutlines(native, design);
    native.dispose();
    return sampleTop;
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
    resetManufacturingSolidCache();
});

describe("PR #485 grader G1 — graded commit and scope", () => {
    test("G1a: repository HEAD includes graded SHA in history", () => {
        const log = execSync(`git merge-base --is-ancestor ${GRADED_SHA} HEAD`, {
            cwd: REPO_ROOT,
            encoding: "utf8",
        });
        expect(log).toBe("");
    });

    test("G1b: PR file list exists at graded SHA", () => {
        const names = execSync(`git diff-tree --no-commit-id --name-only -r ${GRADED_SHA}^..${GRADED_SHA}`, {
            cwd: REPO_ROOT,
            encoding: "utf8",
        })
            .trim()
            .split("\n")
            .filter(Boolean)
            .sort();
        expect(names).toEqual([...PR485_CHANGED_FILES].sort());
    });
});

describe("PR #485 grader G2 — catalog length maps to #364 presets only", () => {
    test("G2a: Kingston 3/4 and Sulcus map to met_head and sulcus", () => {
        expect(catalogLengthPreset("3/4")).toBe("met_head");
        expect(catalogLengthPreset("3/4 length")).toBe("met_head");
        expect(catalogLengthPreset("Met-head")).toBe("met_head");
        expect(catalogLengthPreset("Sulcus")).toBe("sulcus");
        expect(catalogLengthPreset("Full")).toBe("full");
        expect(() => parseSavedDesignCatalog({ length: "half" })).toThrow(SavedDesignSnapshotError);
    });

    test("G2b: TRIM_PRESET_LANDMARK_U matches main (no new cut geometry)", () => {
        const mainLandmarks = execSync(
            `git show ${MAIN_BASELINE_SHA}:vertex/src/lib/geometry/trim-presets.ts`,
            {
                cwd: REPO_ROOT,
                encoding: "utf8",
            },
        );
        expect(mainLandmarks).toContain("sulcus: 0.72");
        expect(mainLandmarks).toContain("met_head: 0.66");
        expect(TRIM_PRESET_LANDMARK_U).toEqual({ full: 1, sulcus: 0.72, met_head: 0.66 });
        const diff = execSync(
            `git diff ${MAIN_BASELINE_SHA}..${GRADED_SHA} -- vertex/src/lib/geometry/trim-presets.ts`,
            {
                cwd: REPO_ROOT,
                encoding: "utf8",
            },
        );
        expect(diff).not.toContain("0.73");
        expect(diff).not.toContain("0.65");
        expect(diff).toMatch(/met_head: "3\/4"/);
    });
});

describe("PR #485 grader G3 — MCP create_saved_design persistence", () => {
    test("G3: MCP catalog keys and length schema match shared contract", () => {
        expect(listMcpSavedDesignCatalogKeyPaths().sort()).toEqual(listSavedDesignCatalogKeyPaths().sort());
        expect(savedDesignCatalogSchema.parse({ length: "3/4" }).length).toBe("met_head");
        expect(
            createSavedDesignInputSchema.safeParse({
                external_order_id: "fixture",
                catalog: { length: "Sulcus" },
            }).success,
        ).toBe(true);
        expect(savedDesignCatalogSchema.safeParse({ length: "custom-trim" }).success).toBe(false);
    });
});

describe("PR #485 grader G4 — Full / omitted export matches main baseline", () => {
    test("G4: omitted-length STL SHA-256 matches main@91e0062 fixture", async () => {
        const baselinePath = resolve("tests/fixtures/pr485-main-omitted-stl-sha256.json");
        expect(existsSync(baselinePath)).toBe(true);
        const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<"left" | "right", string>;
        const design = designForLength();
        const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
        globalThis.fetch = async () => new Response(bytes);
        useDesignStore.setState({
            design,
            viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural" },
        });
        useBottomPatternStore.getState().clear();
        useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
        const sampleTop = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const native = await sampleTopFromArrayBuffer(sampleTop);
        native.dispose();
        for (const side of ["left", "right"] as const) {
            const stl = await buildExportStl(side);
            expect(sha256(stl)).toBe(baseline[side]);
            const geo = binaryStlToGeometry(stl);
            try {
                const check = validateManifold(geo);
                expect(check.isWatertight).toBe(true);
                expect(check.eulerCharacteristic).toBe(2);
            } finally {
                geo.dispose();
            }
        }
    }, 600_000);
});

describe("PR #485 grader G5 — headless vs UI trim patterns on both feet", () => {
    for (const [label, length] of [
        ["3/4", "3/4"],
        ["Sulcus", "Sulcus"],
    ] as const) {
        test(`G5: ${label} top trim and bottom pattern match UI preset (left + right)`, async () => {
            const design = designForLength(length);
            await publishOutlines(design);
            for (const side of ["left", "right"] as const) {
                const preset = length === "3/4" ? ("met_head" as const) : ("sulcus" as const);
                const rebuilt = resolveActiveTrimline(side, design);
                const uiCurve = curveForTrimPreset(side, preset);
                sameCurve(rebuilt, uiCurve);
                const outline = requireCurve(curveForTrimPreset(side, "full"), "outline");
                const ended = endPatternOnTrim(outline, rebuilt);
                const expectedEnded = endPatternOnTrim(outline, uiCurve);
                sameCurve(ended, expectedEnded);
            }
        });
    }
});

describe("PR #485 grader G6 — headless manufacturing parity", () => {
    beforeAll(() => {
        useClientStore.getState().addClient({
            firstName: "Kingston",
            lastName: "f1939235",
            shoeSizeUs: 9,
        });
    });

    test("G6a: Full omitted design — headless STL bytes match UI export (both feet)", async () => {
        const design = designForLength();
        const sampleTop = await publishOutlines(design);
        expect(activePatientDisplayName()).toContain("Kingston");
        expect(design.textMarking).toMatchObject({
            surface: "bottom",
            addPatientName: true,
            feet: "both",
        });
        for (const side of ["left", "right"] as const) {
            const ui = await buildPrinterFootManufacturingStl(side, true);
            const headless = await buildFinalizedFootFromSavedDesign({
                design,
                side,
                sampleTopBytes: sampleTop,
                includeLeader: true,
            });
            expect(sha256(headless.stl)).toBe(sha256(ui.stl));
        }
    }, 600_000);

    test("G6b: 3/4 manufacturing loft — UI and headless fail the same S1-PRELOFT gate (documented residual)", async () => {
        const design = designForLength("3/4");
        const sampleTop = await publishOutlines(design);
        const uiError = await buildPrinterFootManufacturingStl("left", true).then(
            () => null,
            (error: unknown) => error,
        );
        const headlessError = await buildFinalizedFootFromSavedDesign({
            design,
            side: "left",
            sampleTopBytes: sampleTop,
            includeLeader: true,
        }).then(
            () => null,
            (error: unknown) => error,
        );
        expect(String(uiError)).toContain("[S1-PRELOFT]");
        expect(String(headlessError)).toContain("[S1-PRELOFT]");
    }, 120_000);
});

describe("PR #485 grader G7 — shard manifest registers length suite", () => {
    test("G7: saved-design-length-preset.test.ts is listed in ci/unit-test-shards.json", () => {
        const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "ci/unit-test-shards.json"), "utf8")) as {
            shards: Array<{ files: string[] }>;
        };
        const files = manifest.shards.flatMap((shard) => shard.files);
        expect(files).toContain("vertex/src/features/exports/saved-design-length-preset.test.ts");
        expect(files).toContain("packages/mcp/test/persist-saved-design-snapshot.test.ts");
        expect(files).toContain("vertex/tests/pr485-orthotic-length.grader.test.ts");
        expect(files.length).toBeGreaterThanOrEqual(388);
    });
});
