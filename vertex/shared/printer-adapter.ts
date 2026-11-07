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
