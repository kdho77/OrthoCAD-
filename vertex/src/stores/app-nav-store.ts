// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

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
