// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TOKEN_COST } from "@/features/licensing/license";
import { useAuthStore } from "@/stores/auth-store";

export type ExportFileTypeChoice = "gcode" | "stl" | "3mf";

export const EXPORT_FILE_TYPE_PURPOSE: Record<ExportFileTypeChoice, string> = {
    gcode: "Ready to run on your printer or mill",
    stl: "Mesh for other slicers or CAM",
    "3mf": "Mesh with units, for modern slicers",
};

function userKey(): string {
    return useAuthStore.getState().user?.id ?? "__anonymous__";
}

interface ExportFileTypeStore {
    exportFileType: ExportFileTypeChoice | null;
    lastByUserId: Record<string, ExportFileTypeChoice>;
    setExportFileType: (choice: ExportFileTypeChoice) => void;
    hydrateForCurrentUser: () => void;
    preselectGcode: () => void;
}

export const useExportFileTypeStore = create<ExportFileTypeStore>()(
    persist(
        (set, get) => ({
            exportFileType: null,
            lastByUserId: {},
            setExportFileType: (choice) => {
                const key = userKey();
                set({
                    exportFileType: choice,
                    lastByUserId: { ...get().lastByUserId, [key]: choice },
                });
            },
            hydrateForCurrentUser: () => {
                const remembered = get().lastByUserId[userKey()] ?? null;
                set({ exportFileType: remembered });
            },
            preselectGcode: () => get().setExportFileType("gcode"),
        }),
        {
            name: "vertex-export-file-type",
            partialize: (s) => ({ lastByUserId: s.lastByUserId }),
        },
    ),
);

export function exportPrimaryButtonLabel(choice: ExportFileTypeChoice | null, cnc: boolean): string {
    if (!choice) return "Export";
    if (choice === "gcode") {
        return cnc ? "Download mill G-code" : "Download G-code";
    }
    if (choice === "stl") return "Download STL";
    return "Download 3MF";
}
