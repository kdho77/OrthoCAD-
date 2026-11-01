// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { create } from "zustand";
import type { ApexPrintMaterialId } from "@/features/exports/apex-print-material";
import type { GrindingStyleInput } from "@/features/exports/export-service";
import type { CamOverrides } from "@/lib/kiri";

interface PrintExportSettingsStore {
    presetId: string;
    /** Apex TPU line for printer G-code; null until user picks (no silent default). */
    apexMaterialId: ApexPrintMaterialId | null;
    grindingStyle: GrindingStyleInput;
    overrides: CamOverrides;
    setPrintExportSettings: (patch: {
        presetId?: string;
        apexMaterialId?: ApexPrintMaterialId | null;
        grindingStyle?: GrindingStyleInput;
        overrides?: CamOverrides;
    }) => void;
}

export const usePrintExportSettingsStore = create<PrintExportSettingsStore>((set) => ({
    presetId: "",
    apexMaterialId: null,
    grindingStyle: { type: "straight", angle_degrees: 8 },
    overrides: { layerHeightMm: 0.3, infillDensity: 0.2 },
    setPrintExportSettings: (patch) =>
        set((s) => ({
            presetId: patch.presetId ?? s.presetId,
            apexMaterialId: patch.apexMaterialId !== undefined ? patch.apexMaterialId : s.apexMaterialId,
            grindingStyle: patch.grindingStyle ?? s.grindingStyle,
            overrides: patch.overrides ?? s.overrides,
        })),
}));
