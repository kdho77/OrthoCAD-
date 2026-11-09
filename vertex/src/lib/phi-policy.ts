// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { parseStorePhiFlag } from "../../shared/client-files";
import { readViteConfig } from "./vite-env";

/** Browser copy of STORE_PHI. Defaults off. The server flag is the one that decides what is saved. */
export function storePhiEnabled(): boolean {
    return parseStorePhiFlag(readViteConfig().VITE_STORE_PHI);
}
