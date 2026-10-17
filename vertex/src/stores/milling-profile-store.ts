// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import type { MillingProfile } from "@/lib/cnc/types";

export type ExportMachine = "printer" | "cnc";

interface MillingProfileStore {
    machine: ExportMachine;
    profile: MillingProfile;
    setMachine: (machine: ExportMachine) => void;
    setProfile: (patch: Partial<MillingProfile>) => void;
    resetIdaho: () => void;
}

export const useMillingProfileStore = create<MillingProfileStore>()(
    persist(
        (set) => ({
            machine: "printer",
            profile: cloneProfile(IDAHO_PROFILE),
            setMachine: (machine) => set({ machine }),
            setProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
            resetIdaho: () => set({ profile: cloneProfile(IDAHO_PROFILE) }),
        }),
        {
            name: "vertex-milling-profile-v1",
            partialize: (s) => ({ machine: s.machine, profile: s.profile }),
        },
    ),
);
