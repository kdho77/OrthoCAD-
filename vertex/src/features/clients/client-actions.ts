// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { storePhiEnabled } from "@/lib/phi-policy";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { type ClientInput, useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState } from "@/types";
import { type DesignKind, defaultDesignName } from "../../../shared/client-files";

export async function createClientRecord(input: ClientInput): Promise<string> {
    if (isApiConfigured()) {
        try {
            const phi = storePhiEnabled();
            const result = await trpc.client.create.mutate({
                displayName: input.displayName,
                firstName: input.firstName,
                lastName: input.lastName,
                reference: input.reference || "",
                dateOfBirth: phi ? input.dateOfBirth || null : null,
                mrn: phi ? input.mrn || null : null,
                email: phi ? input.email || null : null,
                phone: phi ? input.phone || null : null,
                notes: phi ? input.notes || null : null,
            });
            useClientStore.setState((s) => ({
                clients: [result.client, ...s.clients.filter((client) => client.id !== result.client.id)],
                activeClientId: result.client.id,
            }));
            return result.client.id;
        } catch (error) {
            console.warn("[clients] create fell back to this session", error);
        }
    }
    return useClientStore.getState().addClient(input);
}

export async function saveClientRecord(id: string, input: ClientInput): Promise<void> {
    useClientStore.getState().updateClient(id, input);
    if (!isApiConfigured()) return;
    try {
        const phi = storePhiEnabled();
        const saved = await trpc.client.update.mutate({
            id,
            displayName: input.displayName,
            firstName: input.firstName,
            lastName: input.lastName,
            reference: input.reference || "",
            dateOfBirth: phi ? input.dateOfBirth || null : null,
            mrn: phi ? input.mrn || null : null,
            email: phi ? input.email || null : null,
            phone: phi ? input.phone || null : null,
            notes: phi ? input.notes || null : null,
        });
        useClientStore.setState((s) => ({
            clients: s.clients.map((client) => (client.id === id ? saved : client)),
        }));
    } catch (error) {
        console.warn("[clients] update failed", error);
    }
}

export async function archiveClientRecord(id: string): Promise<void> {
    useClientStore.getState().archiveClient(id);
    if (!isApiConfigured()) return;
    try {
        await trpc.client.archive.mutate({ id });
    } catch (error) {
        console.warn("[clients] archive failed", error);
    }
}

export async function restoreClientRecord(id: string): Promise<void> {
    useClientStore.getState().restoreClient(id);
    if (!isApiConfigured()) return;
    try {
        await trpc.client.restore.mutate({ id });
    } catch (error) {
        console.warn("[clients] restore failed", error);
    }
}

export async function hardDeleteClientRecord(id: string): Promise<boolean> {
    const removed = useClientStore.getState().hardDeleteClient(id);
    if (!removed || !isApiConfigured()) return removed;
    try {
        await trpc.client.hardDelete.mutate({ id });
    } catch (error) {
        console.warn("[clients] hard delete failed", error);
    }
    return removed;
}

export function createLocalDesign(
    clientId: string,
    kind: DesignKind,
    state: DesignState = createDesignWithStockPlaceholder(),
): string {
    const name = defaultDesignName(kind);
    return useClientStore.getState().addDesign(clientId, name, state, kind);
}

export async function createDesignRecord(clientId: string, kind: DesignKind): Promise<string> {
    const state = createDesignWithStockPlaceholder();
    const name = defaultDesignName(kind);
    if (isApiConfigured()) {
        try {
            const row = await trpc.design.create.mutate({ clientId, name, kind });
            useClientStore.setState((s) => ({
                designs: [
                    {
                        ...row,
                        notes: row.notes ?? "",
                        archivedAt: row.archivedAt ?? null,
                        deletedAt: row.deletedAt ?? null,
                        hasExport: row.hasExport ?? false,
                        state,
                    },
                    ...s.designs.filter((design) => design.id !== row.id),
                ],
                activeDesignId: row.id,
                activeClientId: clientId,
            }));
            return row.id;
        } catch (error) {
            console.warn("[clients] design create fell back to this session", error);
        }
    }
    return useClientStore.getState().addDesign(clientId, name, state, kind);
}

export async function saveDesignNotes(id: string, notes: string): Promise<void> {
    if (!storePhiEnabled()) return;
    useClientStore.getState().updateDesignNotes(id, notes);
    if (!isApiConfigured()) return;
    try {
        await trpc.design.updateMeta.mutate({ id, notes });
    } catch (error) {
        console.warn("[clients] notes save failed", error);
    }
}
