// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { workpiecesFromDesign } from "@/lib/cnc/compose";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import type { CncWorkpiece } from "@/lib/cnc/types";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { thicknessMmForDesignSide } from "@/lib/geometry/shape-finish-modifiers";
import { settingsEnvelopeForSave } from "../../vertex/server/src/lib/design-schema";
import { parseSavedDesignCatalog } from "../../vertex/shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../../vertex/shared/saved-design-snapshot";
import { designStateFromSavedSettings } from "../../vertex/src/features/exports/saved-design-finalized-mesh";

/** Serve the fixture GLB for any SAMPLE_Top URL. Returns a restore function. */
function installSampleTopFetch(bytes: Uint8Array): () => void {
    const orig = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        const url = typeof input === "string" ? input : ((input as { url?: string }).url ?? String(input));
        if (/SAMPLE_Top\.glb/.test(url)) {
            return new Response(new Uint8Array(bytes), {
                status: 200,
                headers: { "content-type": "model/gltf-binary" },
            });
        }
        return orig(input as Parameters<typeof orig>[0], init);
    }) as typeof globalThis.fetch;
    return () => {
        globalThis.fetch = orig;
    };
}

/** Median heightmap Z on the forefoot, 70–100% of outline length. */
function forefootMedianZ(part: CncWorkpiece): number {
    const hm = part.heightmap;
    const xs = part.outline.map((q) => q.x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const span = x1 - x0;
    const zs: number[] = [];
    for (let iy = 0; iy < hm.ny; iy++) {
        for (let ix = 0; ix < hm.nx; ix++) {
            const i = iy * hm.nx + ix;
            if (hm.inside[i] !== 1) continue;
            const z = hm.z[i];
            if (z === undefined || !Number.isFinite(z)) continue;
            const f = (hm.originX + ix * hm.cell - x0) / span;
            if (f >= 0.7 && f < 1.0001) zs.push(z);
        }
    }
    zs.sort((a, b) => a - b);
    const mid = zs[zs.length >> 1];
    return mid === undefined ? Number.NaN : mid;
}

describe("CNC workpiece shell thickness", () => {
    test("4 mm catalog thickness drives the milling workpiece above the 2 mm default", async () => {
        const stored = {
            system: "US_M" as const,
            size: 9,
            left: null,
            right: null,
            width: "medium" as const,
        };
        const thinSnap = buildSavedDesignSnapshot({ stored, catalog: parseSavedDesignCatalog({}) });
        const thickSnap = buildSavedDesignSnapshot({
            stored,
            catalog: parseSavedDesignCatalog({ thickness_mm: 4 }),
        });
        const thin = designStateFromSavedSettings(settingsEnvelopeForSave(thinSnap.design));
        const thick = designStateFromSavedSettings(settingsEnvelopeForSave(thickSnap.design));
        thick.method = "milling_3axis";

        expect(thicknessMmForDesignSide(thick, "left")).toBe(4);
        expect(thicknessMmForDesignSide(thin, "left")).toBe(2);
        expect(thick.shellThicknessMode).toBe("zonal");
        expect(thin.shellThicknessMode).toBe("zonal");

        const profile = cloneProfile(IDAHO_PROFILE);
        resetSampleTopGeometryCache();
        const restoreFetch = installSampleTopFetch(
            readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb")),
        );
        try {
            // Production default loader: no loadGeo override.
            const thinPart = (await workpiecesFromDesign(thin, ["left"], profile))[0];
            const thickPart = (await workpiecesFromDesign(thick, ["left"], profile))[0];
            if (!thinPart || !thickPart) throw new Error("expected left workpiece");

            expect(thickPart.zMax).toBeGreaterThan(thinPart.zMax + 1);
            expect(forefootMedianZ(thickPart)).toBeGreaterThanOrEqual(4);
            expect(forefootMedianZ(thinPart)).toBeGreaterThanOrEqual(2);
        } finally {
            restoreFetch();
            resetSampleTopGeometryCache();
        }
    }, 120_000);
});
