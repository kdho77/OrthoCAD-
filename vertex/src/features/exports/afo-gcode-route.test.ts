// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { afoShellSliceFields } from "@/features/exports/apex-print-material";
import { resolveHybridSlice } from "@/features/exports/export-service";
import { PRINTER_PRESETS } from "@/lib/kiri/presets";

describe("AFO G-code route", () => {
    test("an AFO uses ApexVylon and the shell method even when the insole picker says Apex Core", () => {
        const route = resolveHybridSlice({ productType: "afo" }, { apexMaterialId: "ApexCore" });
        const fields = afoShellSliceFields();
        expect(route?.material).toBe("apex_vylon");
        expect(route?.material).toBe(fields.material);
        expect(route?.presetId).toBe(fields.presetId);
        expect(route?.method).toBe("printing_shell");
        expect(route?.localPresetId).toBe("apex-belt-v2-shell");
        const local = PRINTER_PRESETS.find((p) => p.id === route?.localPresetId);
        expect(local?.method).toBe("printing_shell");
    });

    test("an insole keeps the selected Apex Core solid profile", () => {
        const route = resolveHybridSlice({ productType: "insole" }, { apexMaterialId: "ApexCore" });
        expect(route?.material).toBe("apex_core");
        expect(route?.method).toBe("printing_solid");
        expect(route?.localPresetId).toBe("apex-belt-v2");
    });

    test("Send to VertexSlice's apex_vylon flag matches the AFO route", () => {
        const sent = resolveHybridSlice({ productType: "insole" }, { afoSliceMaterial: "apex_vylon" });
        const afo = resolveHybridSlice({ productType: "afo" }, { apexMaterialId: "ApexCore" });
        expect(sent).toEqual(afo);
    });
});
