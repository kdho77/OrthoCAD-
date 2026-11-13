// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { create } from "zustand";
import type { VersionCheckState } from "@/lib/app-version";

interface AppVersionStore {
    showUpdateBanner: boolean;
    exportBlockedModalOpen: boolean;
    reloadError: string | null;
    syncFromCheck: (state: VersionCheckState) => void;
    openExportBlockedModal: () => void;
    closeExportBlockedModal: () => void;
    setReloadError: (message: string | null) => void;
    resetForTests: () => void;
}

export const useAppVersionStore = create<AppVersionStore>()((set) => ({
    showUpdateBanner: false,
    exportBlockedModalOpen: false,
    reloadError: null,
    syncFromCheck: (state) => {
        set({ showUpdateBanner: state === "stale" });
    },
    openExportBlockedModal: () => {
        set({ exportBlockedModalOpen: true, reloadError: null });
    },
    closeExportBlockedModal: () => {
        set({ exportBlockedModalOpen: false, reloadError: null });
    },
    setReloadError: (message) => set({ reloadError: message }),
    resetForTests: () => set({ showUpdateBanner: false, exportBlockedModalOpen: false, reloadError: null }),
}));
