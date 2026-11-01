// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { APEX_V2_INSOLE_LOCKED_PROFILE_ID } from "@/features/exports/apex-print-material";
import type { PrinterPreset } from "@/lib/kiri";

/** Legacy belt preset id — hidden in UI; locked insole preset is the single Apex V2 entry. */
export const LEGACY_APEX_BELT_PRESET_ID = "apex-belt-v2";

export const APEX_V2_PRINTER_UI_LABEL = "Apex V2 insole (locked process)";

export function printerPresetsForUi(presets: PrinterPreset[]): PrinterPreset[] {
    return presets
        .filter((p) => p.id !== LEGACY_APEX_BELT_PRESET_ID)
        .map((p) =>
            p.id === APEX_V2_INSOLE_LOCKED_PROFILE_ID ? { ...p, name: APEX_V2_PRINTER_UI_LABEL } : p,
        );
}

export function resolveUiPrinterPresetId(presetId: string): string {
    if (presetId === LEGACY_APEX_BELT_PRESET_ID || presetId === "") {
        return APEX_V2_INSOLE_LOCKED_PROFILE_ID;
    }
    return presetId;
}

export function defaultPrinterPresetForUi(presets: PrinterPreset[]): PrinterPreset | undefined {
    const ui = printerPresetsForUi(presets);
    return (
        ui.find((p) => p.id === APEX_V2_INSOLE_LOCKED_PROFILE_ID) ?? ui.find((p) => p.beltAngleDeg) ?? ui[0]
    );
}
