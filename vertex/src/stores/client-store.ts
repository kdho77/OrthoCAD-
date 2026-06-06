import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DesignState } from "@/types";

// Local-first client / design management. Persists to localStorage so the full
// workflow works offline; the tRPC `client.*` / `design.*` routers provide the
// server-authoritative path when the API is configured (synced in Phase 5).

export interface ClientRecord {
    id: string;
    firstName: string;
    lastName: string;
    reference?: string;
    email?: string;
    phone?: string;
    notes?: string;
    createdAt: string;
}

export interface DesignRecord {
    id: string;
    clientId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    state: DesignState;
}

export interface ClientInput {
    firstName: string;
    lastName: string;
    reference?: string;
    email?: string;
    phone?: string;
    notes?: string;
}

interface ClientStore {
    clients: ClientRecord[];
    designs: DesignRecord[];
    activeClientId: string | null;
    activeDesignId: string | null;

    addClient: (input: ClientInput) => string;
    updateClient: (id: string, patch: Partial<ClientInput>) => void;
    removeClient: (id: string) => void;
    setActiveClient: (id: string | null) => void;

    addDesign: (clientId: string, name: string, state: DesignState) => string;
    saveDesign: (id: string, state: DesignState) => void;
    renameDesign: (id: string, name: string) => void;
    removeDesign: (id: string) => void;
    setActiveDesign: (id: string | null) => void;
}

export const useClientStore = create<ClientStore>()(
    persist(
        (set) => ({
            clients: [],
            designs: [],
            activeClientId: null,
            activeDesignId: null,

            addClient: (input) => {
                const id = crypto.randomUUID();
                const record: ClientRecord = { id, createdAt: new Date().toISOString(), ...input };
                set((s) => ({ clients: [record, ...s.clients], activeClientId: id }));
                return id;
            },
            updateClient: (id, patch) =>
                set((s) => ({ clients: s.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
            removeClient: (id) =>
                set((s) => ({
                    clients: s.clients.filter((c) => c.id !== id),
                    designs: s.designs.filter((d) => d.clientId !== id),
                    activeClientId: s.activeClientId === id ? null : s.activeClientId,
                })),
            setActiveClient: (activeClientId) => set({ activeClientId }),

            addDesign: (clientId, name, state) => {
                const id = crypto.randomUUID();
                const now = new Date().toISOString();
                const record: DesignRecord = { id, clientId, name, createdAt: now, updatedAt: now, state };
                set((s) => ({ designs: [record, ...s.designs], activeDesignId: id }));
                return id;
            },
            saveDesign: (id, state) =>
                set((s) => ({
                    designs: s.designs.map((d) =>
                        d.id === id ? { ...d, state, updatedAt: new Date().toISOString() } : d,
                    ),
                })),
            renameDesign: (id, name) =>
                set((s) => ({ designs: s.designs.map((d) => (d.id === id ? { ...d, name } : d)) })),
            removeDesign: (id) =>
                set((s) => ({
                    designs: s.designs.filter((d) => d.id !== id),
                    activeDesignId: s.activeDesignId === id ? null : s.activeDesignId,
                })),
            setActiveDesign: (activeDesignId) => set({ activeDesignId }),
        }),
        { name: "vertex-clients" },
    ),
);
