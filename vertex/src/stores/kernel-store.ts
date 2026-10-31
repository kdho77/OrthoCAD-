import { create } from "zustand";

export type KernelLoadState = "idle" | "loading" | "ready" | "failed";

interface KernelStore {
    version: number;
    name: string;
    loadState: KernelLoadState;
    loadError: string | null;
    notifyKernelChanged: (kernelName: string) => void;
    setLoadState: (state: KernelLoadState, error?: string | null) => void;
}

export const useKernelStore = create<KernelStore>((set) => ({
    version: 0,
    name: "three-procedural",
    loadState: "idle",
    loadError: null,
    notifyKernelChanged: (kernelName) =>
        set((s) => ({
            version: s.version + 1,
            name: kernelName,
        })),
    setLoadState: (loadState, loadError = null) => set({ loadState, loadError }),
}));
