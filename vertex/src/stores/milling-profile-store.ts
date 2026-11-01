// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PartPlacement } from "@/lib/cnc/placement";
import { cloneProfile, IDAHO_PROFILE, reconcileMillingProfile } from "@/lib/cnc/profile";
import type { MillingProfile } from "@/lib/cnc/types";
import type { Side } from "@/types";

export type ExportMachine = "printer" | "cnc";
export type MillTableViewMode = "top" | "orbit";

interface MillingProfileStore {
    machine: ExportMachine;
    profile: MillingProfile;
    placements: PartPlacement[];
    millView: MillTableViewMode;
    millSelected: Side | null;
    setMachine: (machine: ExportMachine) => void;
    setProfile: (patch: Partial<MillingProfile>) => void;
    setPlacements: (placements: PartPlacement[]) => void;
    patchPlacement: (side: Side, patch: Partial<Omit<PartPlacement, "side">>) => void;
    resetPlacements: () => void;
    setMillView: (view: MillTableViewMode) => void;
    setMillSelected: (side: Side | null) => void;
    resetIdaho: () => void;
}

export const useMillingProfileStore = create<MillingProfileStore>()(
    persist(
        (set) => ({
            machine: "printer",
            profile: cloneProfile(IDAHO_PROFILE),
            placements: [],
            millView: "top",
            millSelected: null,
            setMachine: (machine) => set({ machine }),
            setProfile: (patch) =>
                set((s) => ({ profile: reconcileMillingProfile({ ...s.profile, ...patch }) })),
            setPlacements: (placements) => set({ placements }),
            patchPlacement: (side, patch) =>
                set((s) => {
                    const prev = s.placements.find((p) => p.side === side);
                    const next: PartPlacement = {
                        side,
                        tx: patch.tx ?? prev?.tx,
                        ty: patch.ty ?? prev?.ty,
                        rotationDeg: patch.rotationDeg ?? prev?.rotationDeg,
                    };
                    return { placements: [...s.placements.filter((p) => p.side !== side), next] };
                }),
            resetPlacements: () => set({ placements: [] }),
            setMillView: (millView) => set({ millView }),
            setMillSelected: (millSelected) => set({ millSelected }),
            resetIdaho: () => set({ profile: cloneProfile(IDAHO_PROFILE), placements: [] }),
        }),
        {
            name: "vertex-milling-profile-v1",
            partialize: (s) => ({
                machine: s.machine,
                profile: s.profile,
                placements: s.placements,
            }),
            merge: (persistedState, currentState) => {
                const persisted = (persistedState ?? {}) as Partial<MillingProfileStore>;
                const profile = reconcileMillingProfile(persisted.profile ?? currentState.profile);
                return {
                    ...currentState,
                    ...persisted,
                    profile,
                    placements: persisted.placements ?? currentState.placements,
                };
            },
        },
    ),
);
