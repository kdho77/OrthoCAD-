import { create } from "zustand";

// Client-side session audit trail. The server keeps the authoritative,
// persistent audit log (Prisma `audit_logs`); this mirrors recent actions for
// the Admin Portal and immediate UX feedback.

export type AuditAction =
    | "export_generated"
    | "ai_prescription_parsed"
    | "tokens_granted"
    | "license_renewed"
    | "license_revoked"
    | "design_saved";

export interface AuditEntry {
    id: string;
    action: AuditAction;
    detail: string;
    at: string;
}

interface AuditStore {
    entries: AuditEntry[];
    record: (action: AuditAction, detail: string) => void;
    clear: () => void;
}

export const useAuditStore = create<AuditStore>((set) => ({
    entries: [],
    record: (action, detail) =>
        set((s) => ({
            entries: [
                { id: crypto.randomUUID(), action, detail, at: new Date().toISOString() },
                ...s.entries,
            ].slice(0, 200),
        })),
    clear: () => set({ entries: [] }),
}));
