// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { create } from "zustand";
import type { GrindingStyleInput } from "@/features/exports/export-service";
import type { CamOverrides } from "@/lib/kiri";

interface PrintExportSettingsStore {
    presetId: string;
    grindingStyle: GrindingStyleInput;
    overrides: CamOverrides;
    setPrintExportSettings: (patch: {
        presetId?: string;
        grindingStyle?: GrindingStyleInput;
        overrides?: CamOverrides;
    }) => void;
}

export const usePrintExportSettingsStore = create<PrintExportSettingsStore>((set) => ({
    presetId: "",
    grindingStyle: { type: "straight", angle_degrees: 8 },
    overrides: { layerHeightMm: 0.3, infillDensity: 0.2 },
    setPrintExportSettings: (patch) =>
        set((s) => ({
            presetId: patch.presetId ?? s.presetId,
            grindingStyle: patch.grindingStyle ?? s.grindingStyle,
            overrides: patch.overrides ?? s.overrides,
        })),
}));
