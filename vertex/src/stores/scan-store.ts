import type { BufferGeometry } from "three";
import { create } from "zustand";
import type { ManifoldReport } from "@/lib/geometry/manifold";
import type { ImportFormat } from "@/lib/geometry/import";
import type { Side } from "@/types";

export interface ImportedScan {
    id: string;
    name: string;
    side: Side;
    format: ImportFormat;
    triangleCount: number;
    geometry: BufferGeometry;
    manifold: ManifoldReport;
    visible: boolean;
}

interface ScanStore {
    scans: ImportedScan[];
    addScan: (scan: Omit<ImportedScan, "visible">) => void;
    removeScan: (id: string) => void;
    setSide: (id: string, side: Side) => void;
    toggleVisible: (id: string) => void;
    clear: () => void;
}

export const useScanStore = create<ScanStore>((set) => ({
    scans: [],
    addScan: (scan) => set((s) => ({ scans: [...s.scans, { ...scan, visible: true }] })),
    removeScan: (id) =>
        set((s) => {
            const target = s.scans.find((x) => x.id === id);
            target?.geometry.dispose();
            return { scans: s.scans.filter((x) => x.id !== id) };
        }),
    setSide: (id, side) => set((s) => ({ scans: s.scans.map((x) => (x.id === id ? { ...x, side } : x)) })),
    toggleVisible: (id) =>
        set((s) => ({ scans: s.scans.map((x) => (x.id === id ? { ...x, visible: !x.visible } : x)) })),
    clear: () => set({ scans: [] }),
}));
