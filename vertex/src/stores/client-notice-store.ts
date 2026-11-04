// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Short-lived user-visible errors from client/design persistence actions.

import { create } from "zustand";

interface ClientNoticeStore {
    error: string | null;
    setError: (message: string) => void;
    clearError: () => void;
}

export const useClientNoticeStore = create<ClientNoticeStore>()((set) => ({
    error: null,
    setError: (message) => set({ error: message.trim() || "Something went wrong" }),
    clearError: () => set({ error: null }),
}));
