import { create } from "zustand";
import type { License, UserProfile } from "@/types";

export interface AuthStore {
    user: UserProfile | null;
    license: License | null;
    loading: boolean;

    setUser: (user: UserProfile | null) => void;
    setLicense: (license: License | null) => void;
    setLoading: (loading: boolean) => void;
    /** Optimistic local token deduction; the server remains the source of truth. */
    deductTokens: (n: number) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
    user: null,
    license: null,
    loading: true,

    setUser: (user) => set({ user }),
    setLicense: (license) => set({ license }),
    setLoading: (loading) => set({ loading }),
    deductTokens: (n) =>
        set((s) =>
            s.user
                ? { user: { ...s.user, tokenBalance: Math.max(0, s.user.tokenBalance - n) } }
                : {},
        ),
}));
