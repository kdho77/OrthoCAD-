// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { create } from "zustand";
import type { NavItem } from "@/components/layout/TopNav";

interface AppNavStore {
    nav: NavItem;
    setNav: (nav: NavItem) => void;
}

export const useAppNavStore = create<AppNavStore>((set) => ({
    nav: "Production",
    setNav: (nav) => set({ nav }),
}));
