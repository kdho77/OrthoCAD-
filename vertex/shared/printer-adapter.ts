// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Printer adapter contract. The only implementation here is mock-only.
// liveVerified stays false until a physical printer call is evidenced elsewhere.

import {
    MOCK_PRINTER_CAPABILITIES,
    type MockPairingResult,
    mockMoonrakerPair,
    normalizeMoonrakerBaseUrl,
} from "./mock-moonraker.js";

export interface PrinterCapabilities {
    kinematics: "cartesian";
    maxTempC: number;
    buildVolumeMm: { x: number; y: number; z: number };
    supportsQueue: boolean;
}

/**
 * A printer adapter the queue can describe without opening a socket.
 * This interface has no print, upload, or probe method.
 */
export interface PrinterAdapter {
    readonly kind: "moonraker";
    readonly mode: "mock-only";
    readonly liveVerified: false;
    normalizeBaseUrl(raw: string): string;
    describe(name: string, baseUrl: string): MockPairingResult;
}

export function createMockMoonrakerAdapter(): PrinterAdapter {
    return {
        kind: "moonraker",
        mode: "mock-only",
        liveVerified: false,
        normalizeBaseUrl: normalizeMoonrakerBaseUrl,
        describe(name, baseUrl) {
            const pairing = mockMoonrakerPair(baseUrl, name);
            if (pairing.liveVerified !== false || pairing.mode !== "mock-only") {
                throw new Error("Mock printer adapter must stay live-unverified.");
            }
            return pairing;
        },
    };
}

export function mockAdapterCapabilities(): PrinterCapabilities {
    return MOCK_PRINTER_CAPABILITIES;
}

/**
 * What a live adapter still needs. The mock name is not a vendor protocol.
 * No print, upload, or probe method exists in this repository.
 */
export const REAL_PRINTER_ADAPTER_DEPENDENCY = {
    liveVerified: false,
    inRepoImplementation: "mock-only",
    protocolVerified: false,
    note: "The mock is labeled moonraker because the print-farm foundation used that name. URL normalization is not a printer API.",
    requiredBeforeLiveAdapter: [
        "The shop's authoritative printer protocol. Do not infer commands from this mock.",
        "The authentication scheme and a credential issued outside this repository.",
        "A contract test against that protocol on a fake socket, with liveVerified still false until a physical call is evidenced.",
    ],
} as const;
