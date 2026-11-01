// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Scan bytes stay in the session repository unless the API is configured.
// They are not written to localStorage.

import { isApiConfigured, trpc } from "@/lib/trpc";
import { useAuthStore } from "@/stores/auth-store";
import { useClientScanStore } from "@/stores/client-scan-store";
import type { ClientRecord } from "@/stores/client-store";
import type { Actor } from "../../../shared/client-files";
import {
    deleteClientScan,
    downloadClientScan,
    type ScanListItem,
    type ScanRepo,
    type ScanSide,
    uploadClientScan,
} from "../../../shared/client-scans";

function actor(): Actor {
    const user = useAuthStore.getState().user;
    return {
        id: user?.id ?? "local",
        email: user?.email ?? "",
        role: user?.role ?? "clinician",
        tenantId: null,
    };
}

function memoryRepo(): ScanRepo {
    return {
        async listByClient(clientId) {
            return useClientScanStore.getState().scans.filter((scan) => scan.clientId === clientId);
        },
        async listAll() {
            return useClientScanStore.getState().scans;
        },
        async getMeta(id) {
            return useClientScanStore.getState().scans.find((scan) => scan.id === id) ?? null;
        },
        async getBytes(id) {
            return useClientScanStore.getState().blobs[id] ?? null;
        },
        async insert(meta, bytes) {
            useClientScanStore.setState((state) => ({
                scans: [meta, ...state.scans.filter((scan) => scan.id !== meta.id)],
                blobs: { ...state.blobs, [meta.id]: bytes },
            }));
        },
        async patch(id, patch) {
            let next: import("../../../shared/client-scans").ScanMeta | null = null;
            useClientScanStore.setState((state) => ({
                scans: state.scans.map((scan) => {
                    if (scan.id !== id) return scan;
                    next = { ...scan, ...patch };
                    return next;
                }),
            }));
            if (!next) throw new Error("Scan not found");
            return next;
        },
        async remove(id) {
            useClientScanStore.setState((state) => {
                const blobs = { ...state.blobs };
                delete blobs[id];
                return { scans: state.scans.filter((scan) => scan.id !== id), blobs };
            });
        },
    };
}

export async function uploadStoredScan(input: {
    client: ClientRecord;
    side: ScanSide;
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
}): Promise<ScanListItem> {
    if (isApiConfigured()) {
        try {
            const saved = await trpc.scan.upload.mutate({
                clientId: input.client.id,
                side: input.side,
                fileName: input.fileName,
                contentType: input.contentType,
                bytesBase64: uint8ToBase64(input.bytes),
            });
            return saved;
        } catch (error) {
            console.warn("[scans] upload fell back to this session", error);
        }
    }
    return uploadClientScan(memoryRepo(), actor(), input);
}

export async function downloadStoredScan(id: string): Promise<void> {
    const file = isApiConfigured()
        ? await trpc.scan.download
              .query({ id })
              .then((result) => ({
                  fileName: result.fileName,
                  contentType: result.contentType,
                  bytes: base64ToUint8(result.bytesBase64),
              }))
              .catch(async () => {
                  const local = await downloadClientScan(memoryRepo(), actor(), id);
                  return {
                      fileName: local.meta.fileName,
                      contentType: local.meta.contentType,
                      bytes: local.bytes,
                  };
              })
        : await downloadClientScan(memoryRepo(), actor(), id).then((local) => ({
              fileName: local.meta.fileName,
              contentType: local.meta.contentType,
              bytes: local.bytes,
          }));
    const url = URL.createObjectURL(new Blob([file.bytes], { type: file.contentType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

export async function deleteStoredScan(id: string): Promise<void> {
    if (isApiConfigured()) {
        try {
            await trpc.scan.delete.mutate({ id });
            return;
        } catch (error) {
            console.warn("[scans] delete fell back to this session", error);
        }
    }
    await deleteClientScan(memoryRepo(), actor(), id);
}

function uint8ToBase64(bytes: Uint8Array): string {
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
}

function base64ToUint8(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}
