import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CorrectionPresetDefinition, CorrectionPresetPayload } from "@/lib/clinical/correction-presets";
import { VERTEX_STARTER_PRESETS } from "@/lib/clinical/correction-presets";
import { useAuthStore } from "@/stores/auth-store";

export type PresetLibraryScope = "user" | "org";

export interface SavedCorrectionPreset {
    id: string;
    name: string;
    scope: PresetLibraryScope;
    createdAt: string;
    updatedAt: string;
    payload: CorrectionPresetPayload;
}

interface CorrectionPresetStore {
    userPresets: SavedCorrectionPreset[];
    orgPresets: SavedCorrectionPreset[];

    listForScope: (scope: PresetLibraryScope) => SavedCorrectionPreset[];
    listVertexStarters: () => CorrectionPresetDefinition[];
    saveUserPreset: (name: string, payload: CorrectionPresetPayload) => SavedCorrectionPreset | null;
    renamePreset: (scope: PresetLibraryScope, id: string, name: string) => void;
    deletePreset: (scope: PresetLibraryScope, id: string) => void;
}

function storageKey(): string {
    const userId = useAuthStore.getState().user?.id ?? "local";
    return `vertex-correction-presets-${userId}`;
}

export const useCorrectionPresetStore = create<CorrectionPresetStore>()(
    persist(
        (set, get) => ({
            userPresets: [],
            orgPresets: [],

            listForScope: (scope) => (scope === "user" ? get().userPresets : get().orgPresets),

            listVertexStarters: () => VERTEX_STARTER_PRESETS,

            saveUserPreset: (name, payload) => {
                const trimmed = name.trim();
                if (!trimmed) return null;
                const now = new Date().toISOString();
                const entry: SavedCorrectionPreset = {
                    id: crypto.randomUUID(),
                    name: trimmed,
                    scope: "user",
                    createdAt: now,
                    updatedAt: now,
                    payload,
                };
                set((s) => ({ userPresets: [entry, ...s.userPresets] }));
                return entry;
            },

            renamePreset: (scope, id, name) => {
                const nextName = name.trim();
                if (!nextName) return;
                const key = scope === "user" ? "userPresets" : "orgPresets";
                set((s) => ({
                    [key]: (s[key] as SavedCorrectionPreset[]).map((p) =>
                        p.id === id ? { ...p, name: nextName, updatedAt: new Date().toISOString() } : p,
                    ),
                }));
            },

            deletePreset: (scope, id) => {
                const key = scope === "user" ? "userPresets" : "orgPresets";
                set((s) => ({
                    [key]: (s[key] as SavedCorrectionPreset[]).filter((p) => p.id !== id),
                }));
            },
        }),
        {
            name: "vertex-correction-presets-v1",
            partialize: (s) => ({ userPresets: s.userPresets, orgPresets: s.orgPresets }),
            storage: {
                getItem: (name) => {
                    const raw = localStorage.getItem(storageKey()) ?? localStorage.getItem(name);
                    return raw;
                },
                setItem: (_name, value) => {
                    localStorage.setItem(storageKey(), value);
                },
                removeItem: (name) => {
                    localStorage.removeItem(storageKey());
                    localStorage.removeItem(name);
                },
            },
        },
    ),
);
