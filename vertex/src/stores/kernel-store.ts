import { create } from "zustand";
import { getKernel } from "@/lib/chili3d";

export type KernelLoadState = "idle" | "loading" | "ready" | "failed";

interface KernelStore {
    version: number;
    name: string;
    loadState: KernelLoadState;
    loadError: string | null;
    notifyKernelChanged: () => void;
    setLoadState: (state: KernelLoadState, error?: string | null) => void;
}

export const useKernelStore = create<KernelStore>((set) => ({
    version: 0,
    name: getKernel().name,
    loadState: "idle",
    loadError: null,
    notifyKernelChanged: () =>
        set((s) => ({
            version: s.version + 1,
            name: getKernel().name,
            loadState: getKernel().name === "opencascade-wasm" ? "ready" : s.loadState,
        })),
    setLoadState: (loadState, loadError = null) => set({ loadState, loadError }),
}));
