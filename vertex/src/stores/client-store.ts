import { create } from "zustand";
import { useAuthStore } from "@/stores/auth-store";
import type { DesignState } from "@/types";
import type { DesignKind } from "../../shared/client-files";

// Client and design records stay in memory for the session. Names, dates of
// birth, contact details, and notes are not written to localStorage.

try {
    localStorage.removeItem("vertex-clients");
} catch {
    // Storage can be blocked; the in-memory store still works.
}

export interface ClientRecord {
    id: string;
    ownerId: string;
    tenantId: string | null;
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
    reference: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface DesignRecord {
    id: string;
    clientId: string;
    ownerId: string;
    name: string;
    kind: DesignKind;
    notes: string;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
    deletedAt: string | null;
    hasExport: boolean;
    state: DesignState;
}

export interface ClientInput {
    firstName: string;
    lastName: string;
    dateOfBirth?: string | null;
    reference?: string | null;
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
}

interface ClientStore {
    clients: ClientRecord[];
    designs: DesignRecord[];
    activeClientId: string | null;
    activeDesignId: string | null;

    addClient: (input: ClientInput) => string;
    updateClient: (id: string, patch: Partial<ClientInput>) => void;
    archiveClient: (id: string) => void;
    restoreClient: (id: string) => void;
    hardDeleteClient: (id: string) => boolean;
    setActiveClient: (id: string | null) => void;

    addDesign: (clientId: string, name: string, state: DesignState, kind?: DesignKind) => string;
    saveDesign: (id: string, state: DesignState) => void;
    renameDesign: (id: string, name: string) => void;
    updateDesignNotes: (id: string, notes: string) => void;
    duplicateDesign: (id: string) => string | null;
    archiveDesign: (id: string) => void;
    restoreDesignArchive: (id: string) => void;
    softDeleteDesign: (id: string) => void;
    restoreDesign: (id: string, now?: number) => boolean;
    markExported: (id: string) => void;
    setActiveDesign: (id: string | null) => void;
    replaceDirectory: (clients: ClientRecord[], designs: DesignRecord[]) => void;
}

function actorIds(): { ownerId: string; tenantId: string | null } {
    const user = useAuthStore.getState().user;
    return { ownerId: user?.id ?? "local", tenantId: null };
}

function blank(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    return trimmed ? trimmed : null;
}

export const useClientStore = create<ClientStore>()((set, get) => ({
    clients: [],
    designs: [],
    activeClientId: null,
    activeDesignId: null,

    addClient: (input) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const { ownerId, tenantId } = actorIds();
        const record: ClientRecord = {
            id,
            ownerId,
            tenantId,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            dateOfBirth: blank(input.dateOfBirth),
            reference: blank(input.reference),
            email: blank(input.email),
            phone: blank(input.phone),
            notes: blank(input.notes),
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
        };
        set((s) => ({ clients: [record, ...s.clients], activeClientId: id }));
        return id;
    },
    updateClient: (id, patch) =>
        set((s) => ({
            clients: s.clients.map((client) =>
                client.id === id
                    ? {
                          ...client,
                          ...patch,
                          firstName: patch.firstName?.trim() ?? client.firstName,
                          lastName: patch.lastName?.trim() ?? client.lastName,
                          dateOfBirth:
                              patch.dateOfBirth !== undefined ? blank(patch.dateOfBirth) : client.dateOfBirth,
                          reference:
                              patch.reference !== undefined ? blank(patch.reference) : client.reference,
                          email: patch.email !== undefined ? blank(patch.email) : client.email,
                          phone: patch.phone !== undefined ? blank(patch.phone) : client.phone,
                          notes: patch.notes !== undefined ? blank(patch.notes) : client.notes,
                          updatedAt: new Date().toISOString(),
                      }
                    : client,
            ),
        })),
    archiveClient: (id) =>
        set((s) => ({
            clients: s.clients.map((client) =>
                client.id === id
                    ? { ...client, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
                    : client,
            ),
        })),
    restoreClient: (id) =>
        set((s) => ({
            clients: s.clients.map((client) =>
                client.id === id
                    ? { ...client, archivedAt: null, updatedAt: new Date().toISOString() }
                    : client,
            ),
        })),
    hardDeleteClient: (id) => {
        const designs = get().designs.filter((design) => design.clientId === id);
        if (designs.length > 0) return false;
        set((s) => ({
            clients: s.clients.filter((client) => client.id !== id),
            activeClientId: s.activeClientId === id ? null : s.activeClientId,
        }));
        return true;
    },
    setActiveClient: (activeClientId) => set({ activeClientId }),

    addDesign: (clientId, name, state, kind = "insole") => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const record: DesignRecord = {
            id,
            clientId,
            ownerId: actorIds().ownerId,
            name,
            kind,
            notes: "",
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            deletedAt: null,
            hasExport: false,
            state,
        };
        set((s) => ({ designs: [record, ...s.designs], activeDesignId: id, activeClientId: clientId }));
        return id;
    },
    saveDesign: (id, state) =>
        set((s) => ({
            designs: s.designs.map((design) =>
                design.id === id ? { ...design, state, updatedAt: new Date().toISOString() } : design,
            ),
        })),
    renameDesign: (id, name) =>
        set((s) => ({
            designs: s.designs.map((design) =>
                design.id === id ? { ...design, name, updatedAt: new Date().toISOString() } : design,
            ),
        })),
    updateDesignNotes: (id, notes) =>
        set((s) => ({
            designs: s.designs.map((design) =>
                design.id === id
                    ? { ...design, notes: notes.slice(0, 500), updatedAt: new Date().toISOString() }
                    : design,
            ),
        })),
    duplicateDesign: (id) => {
        const source = get().designs.find((design) => design.id === id);
        if (!source || source.deletedAt) return null;
        const copyId = crypto.randomUUID();
        const now = new Date().toISOString();
        const copy: DesignRecord = {
            ...source,
            id: copyId,
            name: `Copy of ${source.name}`,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            deletedAt: null,
            hasExport: false,
            state: JSON.parse(JSON.stringify(source.state)) as DesignState,
        };
        set((s) => ({ designs: [copy, ...s.designs] }));
        return copyId;
    },
    archiveDesign: (id) =>
        set((s) => ({
            designs: s.designs.map((design) =>
                design.id === id
                    ? { ...design, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
                    : design,
            ),
        })),
    restoreDesignArchive: (id) =>
        set((s) => ({
            designs: s.designs.map((design) =>
                design.id === id
                    ? { ...design, archivedAt: null, updatedAt: new Date().toISOString() }
                    : design,
            ),
        })),
    softDeleteDesign: (id) =>
        set((s) => ({
            designs: s.designs.map((design) =>
                design.id === id ? { ...design, deletedAt: new Date().toISOString() } : design,
            ),
            activeDesignId: s.activeDesignId === id ? null : s.activeDesignId,
        })),
    restoreDesign: (id, now = Date.now()) => {
        const design = get().designs.find((row) => row.id === id);
        if (!design?.deletedAt) return false;
        if (now - new Date(design.deletedAt).getTime() > 30 * 24 * 60 * 60 * 1000) return false;
        set((s) => ({
            designs: s.designs.map((row) =>
                row.id === id ? { ...row, deletedAt: null, updatedAt: new Date(now).toISOString() } : row,
            ),
        }));
        return true;
    },
    markExported: (id) =>
        set((s) => ({
            designs: s.designs.map((design) => (design.id === id ? { ...design, hasExport: true } : design)),
        })),
    setActiveDesign: (activeDesignId) => set({ activeDesignId }),
    replaceDirectory: (clients, designs) => set({ clients, designs }),
}));
