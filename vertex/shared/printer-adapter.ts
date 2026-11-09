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
 * No vendor print, upload, or probe command is implemented in this repository.
 */
export const REAL_PRINTER_ADAPTER_DEPENDENCY = {
    liveVerified: false,
    inRepoImplementation: "mock-only",
    protocolVerified: false,
    /** No shop document names the controller vendor, API, or wire protocol. */
    vendorProtocolDocumented: false,
    /** The server dispatch path refuses to open a socket until a transport is injected. */
    dispatchTransport: "unbound",
    mockReportedAsLive: false,
    note: "The mock is labeled moonraker because the print-farm foundation used that name. URL normalization is not a printer API. orthocad-local-bridge is this repo's software seam, not a shop-verified controller.",
    requiredBeforeLiveAdapter: [
        "The shop's authoritative printer protocol. Do not infer commands from this mock.",
        "The authentication scheme and a credential issued outside this repository.",
        "A contract test against that protocol on a fake socket, with liveVerified still false until a physical call is evidenced.",
        "A local bridge on the shop network. This server does not assume Vercel can reach a printer LAN and does not open a tunnel.",
    ],
} as const;

/**
 * Software seam id. This is not a documented vendor protocol and is not shop-verified.
 * No HTTP path or socket frame is defined for it in this repository.
 */
export const LOCAL_BRIDGE_PROTOCOL_ID = "orthocad-local-bridge";

/** Operator policy in this software. Not a controller specification. */
export const PRINTER_READINESS_MAX_AGE_MS = 120_000;

export const DISPATCH_LEDGER_UNAVAILABLE =
    "Dispatch ledger is not available, so no controller job id was written. Review vertex/src/features/production/dispatch-ledger.review.sql. That file is not applied and is not in prisma/migrations.";

export type CredentialPresence = "present" | "absent";

/** Presence only. Implementations must not return or log a secret value. */
export type CredentialGate = (credentialRef: string) => CredentialPresence;

/** Default gate. It does not read the environment or any secret store. */
export function absentCredentialGate(): CredentialGate {
    return () => "absent";
}

export function publicPrinterMessage(raw: string): string {
    const cleaned = raw
        .replace(/https?:\/\/\S+/gi, "[url]")
        .replace(/bearer\s+\S+/gi, "[secret]")
        .replace(/\s+/g, " ")
        .trim();
    return (cleaned || "Printer request failed").slice(0, 200);
}

export class PrinterTransportError extends Error {
    readonly mayHaveStarted: boolean;

    constructor(message: string, mayHaveStarted: boolean) {
        super(publicPrinterMessage(message));
        this.name = "PrinterTransportError";
        this.mayHaveStarted = mayHaveStarted;
    }
}

/** Normalized operator endpoint. The value is stored for a future bridge; this module does not dial it. */
export function normalizeBridgeEndpoint(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error("Printer endpoint is required");
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        throw new Error("Printer endpoint must be an http(s) address");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Printer endpoint must use http or https");
    }
    if (url.username || url.password) {
        throw new Error("Printer endpoint must not include a username or password");
    }
    if (url.search) {
        throw new Error("Printer endpoint must not include a query string");
    }
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "";
    return url.toString().replace(/\/$/, "");
}

/** A secret name. Rejects blanks and values that look like a URL or a pasted token. */
export function normalizeCredentialRef(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error("Printer credential name is required");
    if (trimmed.length > 80) throw new Error("Printer credential name is too long");
    if (/[\s:/]/.test(trimmed)) {
        throw new Error("Printer credential name must be a name, not a secret value");
    }
    return trimmed;
}

export function assertSupportedProtocol(protocolId: string): void {
    if (protocolId !== LOCAL_BRIDGE_PROTOCOL_ID) {
        throw new Error(
            "Unsupported printer protocol. No vendor controller contract is documented in this repository.",
        );
    }
}

export interface PrinterIoCall {
    operation: "readiness" | "dispatch" | "status" | "cancel";
    printerId: string;
    idempotencyKey?: string;
    gcodeSha256?: string;
    gcode?: string;
    controllerJobId?: string;
}

export type PrinterIoResult =
    | { operation: "readiness"; ready: boolean; reason?: string }
    | { operation: "dispatch"; outcome: "acknowledged"; controllerJobId: string }
    | { operation: "dispatch"; outcome: "rejected"; reason: string }
    | { operation: "dispatch"; outcome: "uncertain"; reason: string }
    | {
          operation: "status";
          controllerJobId: string;
          phase: "queued" | "printing" | "paused" | "complete" | "failed" | "unknown";
          progress: number | null;
          reason?: string;
      }
    | { operation: "cancel"; outcome: "cancelled" | "rejected"; reason?: string };

/**
 * Injected controller stand-in. Production code passes a fake in tests.
 * This interface has no URL, so a caller cannot turn it into a fetch by accident.
 */
export interface PrinterIo {
    request(call: PrinterIoCall): Promise<PrinterIoResult>;
}

export interface TransportDispatchInput {
    printerId: string;
    idempotencyKey: string;
    gcodeSha256: string;
    gcode: string;
}

export interface TransportStatusInput {
    printerId: string;
    controllerJobId: string;
}

export type TransportDispatchResult =
    | { outcome: "acknowledged"; controllerJobId: string }
    | { outcome: "rejected"; reason: string }
    | { outcome: "uncertain"; reason: string };

export interface PrinterTransport {
    readonly bound: boolean;
    readonly liveVerified: false;
    readonly protocolVerified: false;
    readiness(printerId: string): Promise<{ ready: boolean; reason: string | null }>;
    dispatch(input: TransportDispatchInput): Promise<TransportDispatchResult>;
    status(input: TransportStatusInput): Promise<Extract<PrinterIoResult, { operation: "status" }>>;
    cancel(input: TransportStatusInput): Promise<Extract<PrinterIoResult, { operation: "cancel" }>>;
}

export function unboundPrinterTransport(): PrinterTransport {
    const refuse = (): never => {
        throw new PrinterTransportError(
            "Printer transport is not bound. No controller call was made.",
            false,
        );
    };
    return {
        bound: false,
        liveVerified: false,
        protocolVerified: false,
        readiness: async () => refuse(),
        dispatch: async () => refuse(),
        status: async () => refuse(),
        cancel: async () => refuse(),
    };
}

export function closedPrinterDispatch(): { transport: PrinterTransport; credentialGate: CredentialGate } {
    return { transport: unboundPrinterTransport(), credentialGate: absentCredentialGate() };
}

function asDispatch(result: PrinterIoResult): TransportDispatchResult {
    if (result.operation !== "dispatch") {
        return { outcome: "uncertain", reason: "Controller response did not match the dispatch request." };
    }
    if (result.outcome === "acknowledged" && !result.controllerJobId.trim()) {
        return { outcome: "uncertain", reason: "Controller acknowledgement did not include a job id." };
    }
    if (result.outcome === "acknowledged") {
        return { outcome: "acknowledged", controllerJobId: result.controllerJobId.trim() };
    }
    if (result.outcome === "rejected")
        return { outcome: "rejected", reason: publicPrinterMessage(result.reason) };
    return { outcome: "uncertain", reason: publicPrinterMessage(result.reason) };
}

/**
 * Maps an injected controller to the dispatch seam.
 * liveVerified and protocolVerified stay false. This function does not open a socket.
 */
export function createContractTransport(io: PrinterIo): PrinterTransport {
    return {
        bound: true,
        liveVerified: false,
        protocolVerified: false,
        async readiness(printerId) {
            const result = await io.request({ operation: "readiness", printerId });
            if (result.operation !== "readiness") {
                throw new PrinterTransportError(
                    "Controller response did not match the readiness request.",
                    false,
                );
            }
            return {
                ready: result.ready,
                reason: result.reason ? publicPrinterMessage(result.reason) : null,
            };
        },
        async dispatch(input) {
            try {
                const result = await io.request({
                    operation: "dispatch",
                    printerId: input.printerId,
                    idempotencyKey: input.idempotencyKey,
                    gcodeSha256: input.gcodeSha256,
                    gcode: input.gcode,
                });
                return asDispatch(result);
            } catch (error) {
                if (error instanceof PrinterTransportError && !error.mayHaveStarted) throw error;
                const reason = error instanceof Error ? error.message : "Controller dispatch failed";
                return { outcome: "uncertain", reason: publicPrinterMessage(reason) };
            }
        },
        async status(input) {
            const result = await io.request({
                operation: "status",
                printerId: input.printerId,
                controllerJobId: input.controllerJobId,
            });
            if (result.operation !== "status") {
                throw new PrinterTransportError(
                    "Controller response did not match the status request.",
                    false,
                );
            }
            return result;
        },
        async cancel(input) {
            const result = await io.request({
                operation: "cancel",
                printerId: input.printerId,
                controllerJobId: input.controllerJobId,
            });
            if (result.operation !== "cancel") {
                throw new PrinterTransportError(
                    "Controller response did not match the cancel request.",
                    false,
                );
            }
            return result;
        },
    };
}
