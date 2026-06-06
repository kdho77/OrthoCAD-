import { create } from "zustand";
import { getKernel } from "@/lib/chili3d";

interface KernelStore {
    /** Bumped when the active geometry kernel changes (e.g. OCCT WASM load). */
    version: number;
    name: string;
    notifyKernelChanged: () => void;
}

export const useKernelStore = create<KernelStore>((set) => ({
    version: 0,
    name: getKernel().name,
    notifyKernelChanged: () =>
        set((s) => ({
            version: s.version + 1,
            name: getKernel().name,
        })),
}));
