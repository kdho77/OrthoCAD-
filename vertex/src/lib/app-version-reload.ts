// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";

export type ReloadAppResult = { ok: true } | { ok: false; reason: string };

function designDiffersFromSavedRecord(): boolean {
    const designId = useClientStore.getState().activeDesignId;
    if (!designId) return false;
    const record = useClientStore.getState().designs.find((row) => row.id === designId);
    if (!record) return false;
    const current = useDesignStore.getState().design;
    return JSON.stringify(current) !== JSON.stringify(record.state);
}

/** Save through the client store when needed, then hard-reload (never auto-reloads without user action). */
export async function reloadAppAfterSave(): Promise<ReloadAppResult> {
    const designId = useClientStore.getState().activeDesignId;
    if (designDiffersFromSavedRecord() && designId) {
        try {
            await useClientStore.getState().saveDesign(designId, useDesignStore.getState().design);
        } catch (error) {
            const reason = error instanceof Error ? error.message : "Could not save before reload";
            return { ok: false, reason };
        }
    }
    window.location.reload();
    return { ok: true };
}
