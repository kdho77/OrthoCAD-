// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { workpiecesFromDesign } from "@/lib/cnc/compose";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import { thicknessMmForDesignSide } from "@/lib/geometry/shape-finish-modifiers";
import { mirrorGeometry } from "@/lib/library/loaders";
import { settingsEnvelopeForSave } from "../../vertex/server/src/lib/design-schema";
import { parseSavedDesignCatalog } from "../../vertex/shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../../vertex/shared/saved-design-snapshot";
import { designStateFromSavedSettings } from "../../vertex/src/features/exports/saved-design-finalized-mesh";
import { loadSampleTop } from "./helpers";

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
        const raw = await loadSampleTop();
        const loadGeo = async (side: "left" | "right") => {
            const geo = raw.clone();
            return side === "right" ? mirrorGeometry(geo) : geo;
        };

        const thinPart = (await workpiecesFromDesign(thin, ["left"], profile, loadGeo))[0];
        const thickPart = (await workpiecesFromDesign(thick, ["left"], profile, loadGeo))[0];
        if (!thinPart || !thickPart) throw new Error("expected left workpiece");

        expect(thickPart.zMax).toBeGreaterThan(thinPart.zMax + 1);
        raw.dispose();
    }, 120_000);
});
