// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Simulated Moonraker pairing for Print Farm foundation. No HTTP, no printer commands.

export const MOCK_PRINTER_CAPABILITIES = {
    kinematics: "cartesian",
    maxTempC: 300,
    buildVolumeMm: { x: 350, y: 350, z: 350 },
    supportsQueue: true,
} as const;

export interface MockPairingResult {
    paired: true;
    adapter: "mock-moonraker";
    /** Contract-test adapter. This pairing does not contact a printer. */
    mode: "mock-only";
    liveVerified: false;
    moonrakerBaseUrl: string;
    /** Opaque token for a future agent; not a secret and not logged with patient data. */
    registrationToken: string;
    capabilities: typeof MOCK_PRINTER_CAPABILITIES;
}

/** Accepts http(s) Moonraker bases only. Does not probe the network. */
export function normalizeMoonrakerBaseUrl(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error("Moonraker URL is required");
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        throw new Error("Moonraker URL must be a valid http(s) address");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Moonraker URL must use http or https");
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
}

export function mockMoonrakerPair(moonrakerUrl: string, printerName: string): MockPairingResult {
    const base = normalizeMoonrakerBaseUrl(moonrakerUrl);
    const slug = printerName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
    const registrationToken = `mock-${slug || "printer"}-${base.length}`;
    return {
        paired: true,
        adapter: "mock-moonraker",
        mode: "mock-only",
        liveVerified: false,
        moonrakerBaseUrl: base,
        registrationToken,
        capabilities: MOCK_PRINTER_CAPABILITIES,
    };
}
