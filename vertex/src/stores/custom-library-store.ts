import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LibraryElementItem, LibraryPrefabItem } from "@/lib/library/manifest";

export interface LocalGlbAsset {
    id: string;
    name: string;
    category: string;
    parentStockId?: string | null;
    /** Base64 GLB for offline persistence. */
    glbBase64: string;
    createdAt: string;
    /** True when imported from an external GLB upload (vs a saved modification). */
    uploaded?: boolean;
    /** Number of source meshes in the GLB (e.g. Top + Bottom ⇒ 2). */
    meshCount?: number;
}

export interface CustomLibraryStore {
    customElements: LibraryElementItem[];
    customPrefabs: LibraryPrefabItem[];
    /** Offline GLB blobs keyed by custom item id. */
    localGlbs: Record<string, LocalGlbAsset>;
    loading: boolean;

    setCustomElements: (items: LibraryElementItem[]) => void;
    setCustomPrefabs: (items: LibraryPrefabItem[]) => void;
    addCustomElement: (item: LibraryElementItem, glbBase64?: string) => void;
    addCustomPrefab: (item: LibraryPrefabItem, glbBase64?: string) => void;
    removeCustomElement: (id: string) => void;
    removeCustomPrefab: (id: string) => void;
    renameCustomElement: (id: string, name: string) => void;
    renameCustomPrefab: (id: string, name: string) => void;
    setLoading: (loading: boolean) => void;
    getLocalGlb: (id: string) => LocalGlbAsset | undefined;
}

export const useCustomLibraryStore = create<CustomLibraryStore>()(
    persist(
        (set, get) => ({
            customElements: [],
            customPrefabs: [],
            localGlbs: {},
            loading: false,

            setCustomElements: (customElements) => set({ customElements }),
            setCustomPrefabs: (customPrefabs) => set({ customPrefabs }),

            addCustomElement: (item, glbBase64) =>
                set((s) => {
                    const next = { ...s.localGlbs };
                    if (glbBase64) {
                        next[item.id] = {
                            id: item.id,
                            name: item.name,
                            category: item.category,
                            parentStockId: item.parentStockId,
                            glbBase64,
                            createdAt: item.createdAt ?? new Date().toISOString(),
                        };
                    }
                    return {
                        customElements: [item, ...s.customElements.filter((e) => e.id !== item.id)],
                        localGlbs: next,
                    };
                }),

            addCustomPrefab: (item, glbBase64) =>
                set((s) => {
                    const next = { ...s.localGlbs };
                    if (glbBase64) {
                        next[item.id] = {
                            id: item.id,
                            name: item.name,
                            category: item.category,
                            parentStockId: item.parentStockId,
                            glbBase64,
                            createdAt: item.createdAt ?? new Date().toISOString(),
                            uploaded: item.uploaded,
                            meshCount: item.meshCount,
                        };
                    }
                    return {
                        customPrefabs: [item, ...s.customPrefabs.filter((e) => e.id !== item.id)],
                        localGlbs: next,
                    };
                }),

            removeCustomElement: (id) =>
                set((s) => {
                    const { [id]: _, ...localGlbs } = s.localGlbs;
                    return {
                        customElements: s.customElements.filter((e) => e.id !== id),
                        localGlbs,
                    };
                }),

            removeCustomPrefab: (id) =>
                set((s) => {
                    const { [id]: _, ...localGlbs } = s.localGlbs;
                    return {
                        customPrefabs: s.customPrefabs.filter((e) => e.id !== id),
                        localGlbs,
                    };
                }),

            renameCustomElement: (id, name) =>
                set((s) => {
                    const local = s.localGlbs[id];
                    return {
                        customElements: s.customElements.map((e) => (e.id === id ? { ...e, name } : e)),
                        localGlbs: local ? { ...s.localGlbs, [id]: { ...local, name } } : s.localGlbs,
                    };
                }),

            renameCustomPrefab: (id, name) =>
                set((s) => {
                    const local = s.localGlbs[id];
                    return {
                        customPrefabs: s.customPrefabs.map((e) => (e.id === id ? { ...e, name } : e)),
                        localGlbs: local ? { ...s.localGlbs, [id]: { ...local, name } } : s.localGlbs,
                    };
                }),

            setLoading: (loading) => set({ loading }),
            getLocalGlb: (id) => get().localGlbs[id],
        }),
        {
            name: "vertex-custom-library",
            partialize: (state) => ({
                customElements: state.customElements,
                customPrefabs: state.customPrefabs,
                localGlbs: state.localGlbs,
            }),
            onRehydrateStorage: () => () => {
                useCustomLibraryStore.setState({ loading: false });
            },
        },
    ),
);
