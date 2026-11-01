// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Source-agnostic handoff. An external order can open a design with a client,
// scans, and shoe size already filled in. The token is single-use.
//
// This module registers no HTTP route. A caller must already be authenticated
// before it is allowed to issue or consume a token. VO2 and OrthoCloud are not
// implemented here.

import type { ChartShoeWidth } from "./client-files";
import type { ScanSide } from "./client-scans";

export interface ExternalOrderHandoff {
    externalOrderId: string;
    client: {
        displayName: string;
        reference: string;
        shoeSizeUs: number;
        shoeWidth: ChartShoeWidth;
        shoeSizesSplit: boolean;
        shoeSizeLeftUs: number;
        shoeSizeRightUs: number;
    };
    scans: { side: ScanSide; fileName: string; sha256: string }[];
}

export interface HandoffStore {
    issue(payload: ExternalOrderHandoff): string;
    /** Returns the payload once. A second call, or an unknown token, returns null. */
    consume(token: string): ExternalOrderHandoff | null;
}

export function createHandoffStore(): HandoffStore {
    const tokens = new Map<string, ExternalOrderHandoff>();
    return {
        issue(payload) {
            const token = crypto.randomUUID();
            tokens.set(token, payload);
            return token;
        },
        consume(token) {
            const payload = tokens.get(token);
            if (!payload) return null;
            tokens.delete(token);
            return payload;
        },
    };
}
