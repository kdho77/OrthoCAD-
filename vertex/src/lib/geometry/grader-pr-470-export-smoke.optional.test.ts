// Copied into the PR #470 worktree by grader-pr-470-independent.test.ts (not on subject SHA).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { buildFinalizedFootFromSavedDesign } from "@/features/exports/saved-design-finalized-mesh";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClientStore } from "@/stores/client-store";
import type { ClientRow } from "../../../shared/client-files";
import { parseSavedDesignCatalog } from "../../../shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
    resetManufacturingSolidCache();
    useBottomPatternStore.getState().clear();
    useClientStore.setState({ activeClientId: null, clients: [] });
});

describe("grader PR #470 export smoke (subject tree)", () => {
    test("US M9 L+R thickness 3 reverse Morton's 2 mm watertight euler 2", async () => {
        const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
        globalThis.fetch = async () => new Response(bytes);
        const sampleTopBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const row = {
            id: "grader-smoke",
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
        for (const side of ["left", "right"] as const) {
            const foot = await buildFinalizedFootFromSavedDesign({
                design: snap.design,
                side,
                sampleTopBytes,
                includeLeader: false,
            });
            const geometry = binaryStlToGeometry(foot.stl);
            try {
                const report = validateManifold(geometry);
                expect(report.openEdges, side).toBe(0);
                expect(report.nonManifoldEdges, side).toBe(0);
                expect(report.isWatertight, side).toBe(true);
                expect(report.eulerCharacteristic, side).toBe(2);
            } finally {
                geometry.dispose();
            }
        }
    }, 360_000);
});
