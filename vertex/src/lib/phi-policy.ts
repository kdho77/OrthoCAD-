// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { parseStorePhiFlag } from "../../shared/client-files";

/** Browser copy of STORE_PHI. Defaults off. The server flag is the one that decides what is saved. */
export function storePhiEnabled(): boolean {
    const env = import.meta.env as { VITE_STORE_PHI?: string } | undefined;
    return parseStorePhiFlag(env?.VITE_STORE_PHI);
}
