// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Installed bridge loop. It pairs in the browser, then heartbeats until stopped.
// maxCycles on runBridgeSession stays at its library default. This loop repeats that call.
// Secrets are not written to the log callback.

import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveryCandidateRecord } from "../shared/print-bridge-pairing.js";
import { verifySignedManifest } from "../shared/print-bridge-update.js";
import { PRINT_BRIDGE_VERSION } from "../shared/print-bridge-version.js";
import {
    CREDENTIAL_ACCOUNT,
    DEVICE_PROOF_ACCOUNT,
    migratePlaintextCredential,
    type SecretStore,
} from "./secret-store.js";

export interface InstalledCloudResponse {
    status: number;
    json: Record<string, unknown>;
}

export interface InstalledBridgeOptions {
    origin: string;
    bridgeId: string;
    stateDir: string;
    store: SecretStore;
    /** Heartbeat repetitions after a credential is present. The service omits this and runs until stopped. */
    maxCycles?: number;
    signal?: AbortSignal;
    log?: (line: string) => void;
    post?: (path: string, body: unknown, credential: string | null) => Promise<InstalledCloudResponse>;
    runSession?: (credential: string) => Promise<{ cycles: number; stopped: string }>;
    openPairing?: (code: string, pageUrl: string) => void;
    sleep?: (ms: number) => Promise<void>;
    pollLimit?: number;
    discover?: () => Promise<DiscoveryCandidateRecord[]>;
    readManifest?: () => Promise<unknown>;
    installedVersion?: string;
    publicKeys?: Record<string, string>;
    platform?: string;
    applyUpdate?: (artifact: { url: string; sha256: string; version: string }) => Promise<void>;
    now?: () => Date;
}

export async function runInstalledBridge(
    options: InstalledBridgeOptions,
): Promise<{ stopped: string; cycles: number }> {
    const log = options.log ?? (() => undefined);
    mkdirSync(options.stateDir, { recursive: true });
    await migratePlaintextCredential(options.store, options.stateDir);
    let credential = await options.store.get(CREDENTIAL_ACCOUNT);
    if (!credential) {
        const paired = await pairUntilReady(options, log);
        if (!paired.ok) return { stopped: paired.stopped, cycles: 0 };
        credential = paired.credential;
    }
    let cycles = 0;
    const limit = options.maxCycles ?? Number.POSITIVE_INFINITY;
    while (cycles < limit && !options.signal?.aborted) {
        cycles += 1;
        const update = await considerUpdate(options, log);
        if (update === "installed") return { stopped: "updating", cycles };
        const session = options.runSession
            ? await options.runSession(credential)
            : { cycles: 1, stopped: "cycles" as const };
        if (session.stopped === "revoked") {
            await options.store.delete(CREDENTIAL_ACCOUNT);
            return { stopped: "revoked", cycles };
        }
        if (options.discover && options.post) {
            const candidates = await options.discover();
            await options.post(
                "/print-bridge/v1/discovery",
                { bridgeId: options.bridgeId, candidates },
                credential,
            );
        }
        if (options.sleep && cycles < limit) await options.sleep(200);
    }
    return { stopped: "cycles", cycles };
}

async function pairUntilReady(
    options: InstalledBridgeOptions,
    log: (line: string) => void,
): Promise<{ ok: true; credential: string } | { ok: false; stopped: string }> {
    if (!options.post) return { ok: false, stopped: "enrollment-required" };
    const deviceProof = randomBytes(32).toString("base64url");
    await options.store.set(DEVICE_PROOF_ACCOUNT, deviceProof);
    const began = await options.post(
        "/print-bridge/v1/pair/begin",
        { bridgeId: options.bridgeId, deviceProof, origin: options.origin },
        null,
    );
    if (began.status === 409) {
        await options.store.delete(DEVICE_PROOF_ACCOUNT);
        return { ok: false, stopped: "already-enrolled" };
    }
    const pairingCode = typeof began.json.pairingCode === "string" ? began.json.pairingCode : "";
    if (began.status !== 201 || !pairingCode) {
        log("bridge pairing was not started");
        return { ok: false, stopped: "enrollment-rejected" };
    }
    const pageUrl = pairingPage(options.origin, pairingCode);
    writePairingPage(options.stateDir, pairingCode, pageUrl);
    options.openPairing?.(pairingCode, pageUrl);
    log("bridge pairing code is on the shop computer");
    const polls = options.pollLimit ?? 60;
    for (let attempt = 0; attempt < polls && !options.signal?.aborted; attempt += 1) {
        const polled = await options.post(
            "/print-bridge/v1/pair/poll",
            { bridgeId: options.bridgeId, deviceProof, origin: options.origin },
            null,
        );
        const status = typeof polled.json.status === "string" ? polled.json.status : "";
        if (status === "ready" && typeof polled.json.credential === "string") {
            await options.store.set(CREDENTIAL_ACCOUNT, polled.json.credential);
            await options.store.delete(DEVICE_PROOF_ACCOUNT);
            rmSync(join(options.stateDir, "pairing.html"), { force: true });
            log("bridge pairing finished");
            return { ok: true, credential: polled.json.credential };
        }
        if (status === "expired" || status === "consumed" || polled.status === 401) {
            log(`bridge pairing ${status || "rejected"}`);
            return { ok: false, stopped: "enrollment-rejected" };
        }
        if (options.sleep) await options.sleep(50);
    }
    return { ok: false, stopped: "enrollment-required" };
}

function pairingPage(origin: string, code: string): string {
    const url = new URL("/production/printers", origin.endsWith("/") ? origin : `${origin}/`);
    url.searchParams.set("pair", code);
    return url.toString();
}

function writePairingPage(stateDir: string, code: string, pageUrl: string): void {
    const html = `<!doctype html><meta charset="utf-8"><title>OrthoCAD print bridge</title><h1>Pair this computer</h1><p>Pairing code <strong>${escapeHtml(code)}</strong></p><p><a href="${escapeHtml(pageUrl)}">Open OrthoCAD to approve this computer</a></p><p>An admin enters this code. It is not a password.</p>`;
    writeFileSync(join(stateDir, "pairing.html"), html, { mode: 0o600 });
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

async function considerUpdate(
    options: InstalledBridgeOptions,
    log: (line: string) => void,
): Promise<"installed" | "skip"> {
    if (!options.readManifest || !options.publicKeys || !options.applyUpdate) return "skip";
    const manifest = await options.readManifest();
    const decision = verifySignedManifest({
        manifest,
        publicKeys: options.publicKeys,
        installedVersion: options.installedVersion ?? PRINT_BRIDGE_VERSION,
        now: options.now?.() ?? new Date(),
        platform: options.platform ?? "win32-x64",
    });
    if (!decision.ok) {
        log(`update rejected: ${decision.reason}`);
        return "skip";
    }
    await options.applyUpdate({ ...decision.artifact, version: decision.version });
    log(`update accepted: ${decision.version}`);
    return "installed";
}
