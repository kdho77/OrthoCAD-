import { create } from "zustand";
import { storePhiEnabled } from "@/lib/phi-policy";
import { useAuthStore } from "@/stores/auth-store";
import type { DesignState } from "@/types";
import {
    type ClientInput,
    type ClientRow,
    type DesignKind,
    prepareClientRecord,
    shoeChartFromInput,
} from "../../shared/client-files";

// Client and design records stay in memory for the session. Names, dates of
// birth, contact details, and notes are not written to localStorage.

try {
    localStorage.removeItem("vertex-clients");
} catch {
    // Storage can be blocked; the in-memory store still works.
}

export type ClientRecord = ClientRow;
export type { ClientInput };

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

function actorIds(): { id: string; tenantId: string | null; tenantName?: string | null } {
    const user = useAuthStore.getState().user;
    return { id: user?.id ?? "local", tenantId: null, tenantName: user?.fullName ?? null };
}

function withoutPhi<
    T extends {
        dateOfBirth: string | null;
        mrn: string | null;
        email: string | null;
        phone: string | null;
        notes: string | null;
    },
>(row: T): T {
    if (storePhiEnabled()) return row;
    return { ...row, dateOfBirth: null, mrn: null, email: null, phone: null, notes: null };
}

export const useClientStore = create<ClientStore>()((set, get) => ({
    clients: [],
    designs: [],
    activeClientId: null,
    activeDesignId: null,

    addClient: (input) => {
        const record = prepareClientRecord(input, actorIds(), { storePhi: storePhiEnabled() });
        set((s) => ({ clients: [record, ...s.clients], activeClientId: record.id }));
        return record.id;
    },
    updateClient: (id, patch) =>
        set((s) => ({
            clients: s.clients.map((client) => {
                if (client.id !== id) return client;
                const prepared = prepareClientRecord(
                    {
                        displayName: patch.displayName ?? client.displayName,
                        firstName: patch.firstName ?? client.firstName,
                        lastName: patch.lastName ?? client.lastName,
                        reference: patch.reference ?? client.reference ?? "",
                        orderedBy: patch.orderedBy !== undefined ? patch.orderedBy : client.orderedBy,
                        dateOfBirth: patch.dateOfBirth !== undefined ? patch.dateOfBirth : client.dateOfBirth,
                        mrn: patch.mrn !== undefined ? patch.mrn : client.mrn,
                        email: patch.email !== undefined ? patch.email : client.email,
                        phone: patch.phone !== undefined ? patch.phone : client.phone,
                        notes: patch.notes !== undefined ? patch.notes : client.notes,
                        ...shoeChartFromInput({
                            shoeSizeUs: patch.shoeSizeUs ?? client.shoeSizeUs,
                            shoeSizesSplit: patch.shoeSizesSplit ?? client.shoeSizesSplit,
                            shoeSizeLeftUs: patch.shoeSizeLeftUs ?? client.shoeSizeLeftUs,
                            shoeSizeRightUs: patch.shoeSizeRightUs ?? client.shoeSizeRightUs,
                            shoeWidth: patch.shoeWidth ?? client.shoeWidth,
                        }),
                    },
                    { id: client.ownerId, tenantId: client.tenantId },
                    { storePhi: storePhiEnabled(), id: client.id },
                );
                return {
                    ...prepared,
                    archivedAt: client.archivedAt,
                    createdAt: client.createdAt,
                    updatedAt: new Date().toISOString(),
                };
            }),
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
            ownerId: actorIds().id,
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
    updateDesignNotes: (id, notes) => {
        if (!storePhiEnabled()) return;
        set((s) => ({
            designs: s.designs.map((design) =>
                design.id === id
                    ? { ...design, notes: notes.slice(0, 500), updatedAt: new Date().toISOString() }
                    : design,
            ),
        }));
    },
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
            notes: storePhiEnabled() ? source.notes : "",
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
    replaceDirectory: (clients, designs) =>
        set({
            clients: clients.map(withoutPhi),
            designs: designs.map((design) => (storePhiEnabled() ? design : { ...design, notes: "" })),
        }),
}));
