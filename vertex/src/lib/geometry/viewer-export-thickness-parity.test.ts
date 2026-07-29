// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import { baseModifierField, baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import { defaultDesign } from "@/stores/design-store";
import type { DesignState, Side } from "@/types";

const DEFAULT_GLB_URL =
    "https://wstneucimlemaokoyjwh.supabase.co/storage/v1/object/public/stock-bases/Templates/Default.glb";
const DEFAULT_GLB_CACHE = "/tmp/Default.glb";

async function loadDefaultBase() {
    if (!existsSync(DEFAULT_GLB_CACHE)) {
        const res = await fetch(DEFAULT_GLB_URL);
        if (!res.ok) throw new Error(`Failed to download Default.glb (${res.status})`);
        writeFileSync(DEFAULT_GLB_CACHE, Buffer.from(await res.arrayBuffer()));
    }
    const group = await loadGlbFromBuffer(readFileSync(DEFAULT_GLB_CACHE).buffer.slice(0));
    const merged = extractMergedGeometry(group);
    if (!merged) throw new Error("no merged geometry");
    const raw = merged.geometry;
    (raw.userData as Record<string, unknown>).isMultiMeshBase = true;
    return raw;
}

/** Mirror useBaseInsoleGeometry thickness resolution (viewer path). */
function viewerThicknessMm(design: DesignState, side: Side, thicknessPreview?: number | null): number {
    const pairedT = design.paired
        ? side === "left"
            ? design.paired.leftThicknessMm
            : design.paired.rightThicknessMm
        : design.thicknessMm;
    return thicknessPreview ?? pairedT;
}

/** Mirror export-geometry effThickness resolution (export path). */
function exportEffThicknessMm(design: DesignState, side: Side): number {
    return design.paired
        ? side === "left"
            ? design.paired.leftThicknessMm
            : design.paired.rightThicknessMm
        : design.thicknessMm;
}

function topPositionsBitIdentical(
    a: Float32Array,
    b: Float32Array,
    topN: number,
): { identical: boolean; firstDiff: number } {
    for (let i = 0; i < topN; i++) {
        for (let k = 0; k < 3; k++) {
            const ai = a[i * 3 + k]!;
            const bi = b[i * 3 + k]!;
            if (!Object.is(ai, bi)) return { identical: false, firstDiff: i };
        }
    }
    return { identical: true, firstDiff: -1 };
}

describe("viewer/export thickness parity (V2)", () => {
    test("paired differing L/R thickness: viewer and export top submesh positions are bit-identical", async () => {
        const base = await loadDefaultBase();
        const topN = (base.userData as { topVertexCount?: number }).topVertexCount ?? 0;
        expect(topN).toBeGreaterThan(1000);

        // Paired design with deliberately different per-side thickness; top-level
        // thicknessMm left at a third value so a discarded third-arg bug would
        // collapse both sides to the wrong shared value.
        const design: DesignState = {
            ...defaultDesign(),
            thicknessMm: 3,
            base: { assetId: "default", name: "Default", source: "stock" },
            paired: {
                linked: false,
                leftBase: { assetId: "default", name: "Default", source: "stock" },
                rightBase: { assetId: "default", name: "Default", source: "stock" },
                leftThicknessMm: 2.5,
                rightThicknessMm: 6.5,
                leftMethod: "printing_solid",
                rightMethod: "printing_solid",
            },
        };

        for (const side of ["left", "right"] as const) {
            const viewerT = viewerThicknessMm(design, side);
            const exportT = exportEffThicknessMm(design, side);
            expect(viewerT).toBe(exportT);
            expect(viewerT).toBe(side === "left" ? 2.5 : 6.5);

            const viewerField = baseModifierField(design, side, viewerT);
            const exportField = baseModifierFieldAuthoritative(design, side, exportT);
            expect(viewerField.thicknessMm).toBe(viewerT);
            expect(exportField.thicknessMm).toBe(exportT);

            const viewerGeo = applyBaseModifiers(base, viewerField, 0);
            const exportGeo = applyBaseModifiers(base, exportField, 0);
            const vPos = viewerGeo.getAttribute("position")!.array as Float32Array;
            const ePos = exportGeo.getAttribute("position")!.array as Float32Array;
            const cmp = topPositionsBitIdentical(vPos, ePos, topN);
            expect(cmp.identical).toBe(true);

            viewerGeo.dispose();
            exportGeo.dispose();
        }

        // Cross-side: left@2.5 and right@6.5 must NOT be bit-identical (per-side wiring).
        const leftGeo = applyBaseModifiers(
            base,
            baseModifierField(design, "left", viewerThicknessMm(design, "left")),
            0,
        );
        const rightGeo = applyBaseModifiers(
            base,
            baseModifierFieldAuthoritative(design, "right", exportEffThicknessMm(design, "right")),
            0,
        );
        const cross = topPositionsBitIdentical(
            leftGeo.getAttribute("position")!.array as Float32Array,
            rightGeo.getAttribute("position")!.array as Float32Array,
            topN,
        );
        expect(cross.identical).toBe(false);

        leftGeo.dispose();
        rightGeo.dispose();
        base.dispose();
    }, 180000);
});
