// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Uploaded scan bytes stay in memory for the session. They are not written to localStorage.

import { create } from "zustand";
import type { ScanMeta } from "../../shared/client-scans";

interface ClientScanStore {
    scans: ScanMeta[];
    blobs: Record<string, Uint8Array>;
}

export const useClientScanStore = create<ClientScanStore>()(() => ({
    scans: [],
    blobs: {},
}));
