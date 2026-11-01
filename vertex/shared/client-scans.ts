// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Client scan blobs. Bytes stay behind this repository. No Supabase client.
// The scan is PHI and is never the manufacturing mesh.

import { type Actor, ClientFileError, canAccessOrg } from "./client-files";
import { isScanRetained, scanRetentionLabel } from "./retention";

export const SCAN_SIDES = ["left", "right"] as const;
export type ScanSide = (typeof SCAN_SIDES)[number];
export const SCAN_BYTES_MAX = 15 * 1024 * 1024;
export const SCAN_RETENTION_NOTICE = "OrthoCAD deletes scans after 3 years; keep your own copies.";

export interface ScanMeta {
    id: string;
    clientId: string;
    ownerId: string;
    tenantId: string | null;
    side: ScanSide;
    fileName: string;
    contentType: string;
    byteLength: number;
    sha256: string;
    uploadedAt: string;
}

export interface ScanListItem extends ScanMeta {
    retentionLabel: string;
}

export interface ScanRepo {
    listByClient(clientId: string): Promise<ScanMeta[]>;
    listAll(): Promise<ScanMeta[]>;
    getMeta(id: string): Promise<ScanMeta | null>;
    getBytes(id: string): Promise<Uint8Array | null>;
    insert(meta: ScanMeta, bytes: Uint8Array): Promise<void>;
    patch(id: string, patch: Partial<Pick<ScanMeta, "side" | "fileName">>): Promise<ScanMeta>;
    remove(id: string): Promise<void>;
}

export interface ScanMemory {
    scans: ScanMeta[];
    blobs: Record<string, Uint8Array>;
}

export function createMemoryScanRepo(db: ScanMemory): ScanRepo {
    return {
        async listByClient(clientId) {
            return db.scans.filter((scan) => scan.clientId === clientId).map((scan) => ({ ...scan }));
        },
        async listAll() {
            return db.scans.map((scan) => ({ ...scan }));
        },
        async getMeta(id) {
            const scan = db.scans.find((row) => row.id === id);
            return scan ? { ...scan } : null;
        },
        async getBytes(id) {
            return db.blobs[id] ?? null;
        },
        async insert(meta, bytes) {
            db.scans.push({ ...meta });
            db.blobs[meta.id] = bytes;
        },
        async patch(id, patch) {
            const index = db.scans.findIndex((scan) => scan.id === id);
            const current = db.scans[index];
            if (!current) throw new ClientFileError("NOT_FOUND", "Scan not found");
            const next = { ...current, ...patch, id };
            db.scans[index] = next;
            return { ...next };
        },
        async remove(id) {
            db.scans = db.scans.filter((scan) => scan.id !== id);
            delete db.blobs[id];
        },
    };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireScan(repo: ScanRepo, actor: Actor, id: string): Promise<ScanMeta> {
    const scan = await repo.getMeta(id);
    if (!scan || !canAccessOrg(actor, scan)) throw new ClientFileError("NOT_FOUND", "Scan not found");
    return scan;
}

export async function purgeExpiredScans(repo: ScanRepo, actor: Actor, now = new Date()): Promise<void> {
    for (const scan of await repo.listAll()) {
        if (!canAccessOrg(actor, scan)) continue;
        if (isScanRetained(scan.uploadedAt, now)) continue;
        await repo.remove(scan.id);
    }
}

export async function listClientScans(
    repo: ScanRepo,
    actor: Actor,
    client: { id: string; ownerId: string; tenantId: string | null },
    now = new Date(),
): Promise<ScanListItem[]> {
    if (!canAccessOrg(actor, client)) throw new ClientFileError("NOT_FOUND", "Client not found");
    await purgeExpiredScans(repo, actor, now);
    const rows = await repo.listByClient(client.id);
    return rows
        .filter((scan) => canAccessOrg(actor, scan))
        .map((scan) => ({ ...scan, retentionLabel: scanRetentionLabel(scan.uploadedAt, now) }));
}

export async function uploadClientScan(
    repo: ScanRepo,
    actor: Actor,
    input: {
        client: { id: string; ownerId: string; tenantId: string | null };
        side: ScanSide;
        fileName: string;
        contentType: string;
        bytes: Uint8Array;
        now?: Date;
    },
): Promise<ScanListItem> {
    if (!canAccessOrg(actor, input.client)) throw new ClientFileError("NOT_FOUND", "Client not found");
    const fileName = input.fileName.trim();
    if (!fileName) throw new ClientFileError("BAD_REQUEST", "File name is required");
    if (input.bytes.byteLength === 0) throw new ClientFileError("BAD_REQUEST", "Scan file is empty");
    if (input.bytes.byteLength > SCAN_BYTES_MAX) {
        throw new ClientFileError("BAD_REQUEST", "Scan file is too large");
    }
    const uploadedAt = (input.now ?? new Date()).toISOString();
    const meta: ScanMeta = {
        id: crypto.randomUUID(),
        clientId: input.client.id,
        ownerId: actor.id,
        tenantId: input.client.tenantId,
        side: input.side,
        fileName,
        contentType: input.contentType || "application/octet-stream",
        byteLength: input.bytes.byteLength,
        sha256: await sha256Hex(input.bytes),
        uploadedAt,
    };
    await repo.insert(meta, input.bytes);
    return { ...meta, retentionLabel: scanRetentionLabel(uploadedAt, input.now) };
}

export async function getClientScan(repo: ScanRepo, actor: Actor, id: string): Promise<ScanListItem> {
    const scan = await requireScan(repo, actor, id);
    return { ...scan, retentionLabel: scanRetentionLabel(scan.uploadedAt) };
}

export async function downloadClientScan(
    repo: ScanRepo,
    actor: Actor,
    id: string,
    now = new Date(),
): Promise<{ meta: ScanListItem; bytes: Uint8Array }> {
    const scan = await requireScan(repo, actor, id);
    if (!isScanRetained(scan.uploadedAt, now)) {
        await repo.remove(scan.id);
        throw new ClientFileError("NOT_FOUND", "Scan has expired");
    }
    const bytes = await repo.getBytes(id);
    if (!bytes) throw new ClientFileError("NOT_FOUND", "Scan not found");
    return { meta: { ...scan, retentionLabel: scanRetentionLabel(scan.uploadedAt, now) }, bytes };
}

export async function updateClientScan(
    repo: ScanRepo,
    actor: Actor,
    id: string,
    patch: Partial<Pick<ScanMeta, "side" | "fileName">>,
): Promise<ScanListItem> {
    await requireScan(repo, actor, id);
    const next: Partial<Pick<ScanMeta, "side" | "fileName">> = {};
    if (patch.side !== undefined) {
        if (!SCAN_SIDES.includes(patch.side)) throw new ClientFileError("BAD_REQUEST", "Side is invalid");
        next.side = patch.side;
    }
    if (patch.fileName !== undefined) {
        const fileName = patch.fileName.trim();
        if (!fileName) throw new ClientFileError("BAD_REQUEST", "File name is required");
        next.fileName = fileName;
    }
    const saved = await repo.patch(id, next);
    return { ...saved, retentionLabel: scanRetentionLabel(saved.uploadedAt) };
}

export async function deleteClientScan(repo: ScanRepo, actor: Actor, id: string): Promise<{ ok: true }> {
    await requireScan(repo, actor, id);
    await repo.remove(id);
    return { ok: true };
}
