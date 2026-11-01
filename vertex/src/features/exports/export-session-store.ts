// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { create } from "zustand";
import type { ExportOutputTarget } from "@/features/exports/export-target";
import type { ExportFormat } from "@/types";

export type SessionExportKind = "gcode" | "stl" | "3mf";

export interface SessionExportFilePart {
    side?: "left" | "right";
    filename: string;
    sizeBytes: number;
    blob: Blob;
    estimatedTimeSec?: number;
    materialLabel?: string;
}

export interface SessionExportRecord {
    id: string;
    kind: SessionExportKind;
    target: ExportOutputTarget;
    filename: string;
    sizeBytes: number;
    blob: Blob;
    tokensCharged: number;
    designRevision: string;
    createdAt: number;
    estimatedTimeSec?: number;
    materialLabel?: string;
    /** Pair STL / 3MF / printer G-code — two separate downloads. */
    files?: SessionExportFilePart[];
}

export interface ExportJobProgress {
    phase: "idle" | "building" | "exporting" | "slicing" | "ready" | "error";
    message?: string;
}

interface ExportSessionStore {
    designRevision: string;
    progress: ExportJobProgress;
    byKind: Partial<Record<SessionExportKind, SessionExportRecord>>;
    sessionFiles: SessionExportRecord[];
    setDesignRevision: (revision: string) => void;
    setProgress: (progress: ExportJobProgress) => void;
    recordSuccess: (record: SessionExportRecord) => void;
    clearKind: (kind: SessionExportKind) => void;
    isOutOfDate: (kind: SessionExportKind) => boolean;
    findSessionFile: (id: string) => SessionExportRecord | undefined;
}

export function designRevisionFingerprint(design: unknown): string {
    return JSON.stringify(design);
}

export const useExportSessionStore = create<ExportSessionStore>((set, get) => ({
    designRevision: "",
    progress: { phase: "idle" },
    byKind: {},
    sessionFiles: [],

    setDesignRevision: (designRevision) => set({ designRevision }),

    setProgress: (progress) => set({ progress }),

    recordSuccess: (record) =>
        set((s) => {
            const sessionEntries: SessionExportRecord[] =
                record.files && record.files.length > 0
                    ? record.files.map((part, index) => ({
                          ...record,
                          id: `${record.id}-${part.side ?? index}`,
                          filename: part.filename,
                          sizeBytes: part.sizeBytes,
                          blob: part.blob,
                          estimatedTimeSec: part.estimatedTimeSec ?? record.estimatedTimeSec,
                          materialLabel: part.materialLabel ?? record.materialLabel,
                          files: undefined,
                      }))
                    : [record];
            return {
                byKind: { ...s.byKind, [record.kind]: record },
                sessionFiles: [
                    ...sessionEntries,
                    ...s.sessionFiles.filter((f) => !sessionEntries.some((e) => e.id === f.id)),
                ].slice(0, 12),
                progress: { phase: "ready" },
            };
        }),

    clearKind: (kind) =>
        set((s) => {
            const next = { ...s.byKind };
            delete next[kind];
            return { byKind: next };
        }),

    isOutOfDate: (kind) => {
        const hit = get().byKind[kind];
        if (!hit) return false;
        return hit.designRevision !== get().designRevision;
    },

    findSessionFile: (id) => get().sessionFiles.find((f) => f.id === id),
}));

export function sessionKindFromFormat(format: ExportFormat): SessionExportKind | null {
    if (format === "gcode") return "gcode";
    if (format === "stl") return "stl";
    if (format === "3mf") return "3mf";
    return null;
}
