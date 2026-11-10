// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Shop-local bridge. It connects outbound to ORTHOCAD_BRIDGE_CLOUD_ORIGIN.
// It does not listen for inbound printer traffic.
// Printer addresses come from the cloud enrollment, never from this file.

import { readMoonrakerApiKeyFile, runBridgeSession } from "../shared/print-bridge-session.js";
import { productionBridgePolicy } from "../shared/printer-address-resolve.js";

function required(name: string): string {
    const value = process.env[name]?.trim() ?? "";
    if (!value) {
        console.error(`Missing ${name}. The bridge was not started.`);
        process.exit(1);
    }
    return value;
}

const origin = required("ORTHOCAD_BRIDGE_CLOUD_ORIGIN");
const bridgeId = required("ORTHOCAD_BRIDGE_ID");
const stateDir = required("ORTHOCAD_BRIDGE_STATE_DIR");
let parsed: URL;
try {
    parsed = new URL(origin);
} catch {
    console.error("ORTHOCAD_BRIDGE_CLOUD_ORIGIN is not a URL. The bridge was not started.");
    process.exit(1);
}
const loopbackCloud = parsed.hostname === "127.0.0.1" && parsed.protocol === "http:";
if (parsed.protocol !== "https:" && !loopbackCloud) {
    console.error("ORTHOCAD_BRIDGE_CLOUD_ORIGIN must be https. The bridge was not started.");
    process.exit(1);
}

let moonrakerApiKey: string | undefined;
try {
    moonrakerApiKey = readMoonrakerApiKeyFile(process.env.ORTHOCAD_MOONRAKER_API_KEY_FILE);
} catch (error) {
    console.error(
        error instanceof Error
            ? error.message
            : "ORTHOCAD_MOONRAKER_API_KEY_FILE is unreadable. The bridge was not started.",
    );
    process.exit(1);
}

const result = await runBridgeSession({
    origin,
    bridgeId,
    stateDir,
    policy: productionBridgePolicy(),
    proof: process.env.ORTHOCAD_BRIDGE_ENROLLMENT_PROOF?.trim() || undefined,
    moonrakerApiKey,
});
console.error(`bridge stopped: ${result.stopped} cycles=${result.cycles}`);
process.exit(result.stopped === "revoked" || result.stopped === "enrollment-rejected" ? 1 : 0);
