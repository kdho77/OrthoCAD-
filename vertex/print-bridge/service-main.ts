// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Windows service and macOS LaunchAgent entry. It does not open a console for the shop.
// Printer discovery in this process is opt-in and read-only (GET /server/info).

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBridgeSession } from "../shared/print-bridge-session.js";
import { productionBridgePolicy } from "../shared/printer-address-resolve.js";
import { stageVerifiedUpdate } from "./apply-update.js";
import { runInstalledBridge } from "./installed-bridge.js";
import { discoverLanPrinters, localLanAddresses, probeServerInfo } from "./lan-discovery.js";
import { type CommandRunner, createPlatformSecretStore } from "./secret-store.js";

interface BridgeConfig {
    origin: string;
    bridgeId: string;
    updateManifestUrl?: string;
}

function stateDir(): string {
    if (process.platform === "win32") {
        const root = process.env.PROGRAMDATA || "C:\\ProgramData";
        return join(root, "OrthoCAD", "PrintBridge");
    }
    return "/Library/Application Support/OrthoCAD/PrintBridge/state";
}

function readConfig(dir: string): BridgeConfig {
    const parsed = JSON.parse(readFileSync(join(dir, "bridge.json"), "utf8")) as Partial<BridgeConfig>;
    if (!parsed.origin || !parsed.bridgeId) {
        console.error("bridge config is incomplete. The bridge was not started.");
        process.exit(1);
    }
    return { origin: parsed.origin, bridgeId: parsed.bridgeId, updateManifestUrl: parsed.updateManifestUrl };
}

function openBrowser(url: string): void {
    if (process.platform === "win32") {
        spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
            windowsHide: true,
            detached: true,
            stdio: "ignore",
        }).unref();
        return;
    }
    if (process.platform === "darwin") {
        spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    }
}

const runner: CommandRunner = (command, args, input) =>
    new Promise((resolve) => {
        const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
        child.on("error", () => resolve({ code: 1, stdout: "", stderr: "protected store unavailable" }));
        child.on("close", (code) =>
            resolve({
                code: code ?? 1,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            }),
        );
        child.stdin.end(input);
    });

async function postJson(origin: string, path: string, body: unknown, credential: string | null) {
    const url = new URL(path, origin.endsWith("/") ? origin : `${origin}/`);
    const payload = Buffer.from(JSON.stringify(body));
    const headers: Record<string, string> = {
        "content-type": "application/json",
        "content-length": String(payload.length),
    };
    if (credential) headers.authorization = `Bearer ${credential}`;
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
        const req = transport(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port,
                path: `${url.pathname}${url.search}`,
                method: "POST",
                headers,
            },
            (res) => {
                const status = res.statusCode ?? 0;
                const chunks: Buffer[] = [];
                res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
                res.on("end", () => {
                    const text = Buffer.concat(chunks).toString("utf8");
                    let json: Record<string, unknown> = {};
                    if (text) {
                        try {
                            json = JSON.parse(text) as Record<string, unknown>;
                        } catch {
                            json = {};
                        }
                    }
                    resolve({ status, json });
                });
            },
        );
        req.on("error", reject);
        req.end(payload);
    });
}

function trustedPublicKeys(dirs: string[]): Record<string, string> | undefined {
    const trusted: Record<string, string> = {};
    for (const dir of dirs) {
        try {
            const parsed = JSON.parse(readFileSync(join(dir, "update-public-keys.json"), "utf8")) as Record<
                string,
                unknown
            >;
            for (const [key, value] of Object.entries(parsed)) {
                if (
                    typeof value === "string" &&
                    value.includes("BEGIN PUBLIC KEY") &&
                    !value.includes("REPLACE")
                ) {
                    trusted[key] = value;
                }
            }
        } catch {
            // The payload or state directory may not have the key file yet.
        }
    }
    return Object.keys(trusted).length > 0 ? trusted : undefined;
}

const dir = process.env.ORTHOCAD_BRIDGE_STATE_DIR?.trim() || stateDir();
const config = readConfig(dir);
const store = createPlatformSecretStore({ platform: process.platform, stateDir: dir, run: runner });
const publicKeys = trustedPublicKeys([dir, dirname(fileURLToPath(import.meta.url))]);

const result = await runInstalledBridge({
    origin: config.origin,
    bridgeId: config.bridgeId,
    stateDir: dir,
    store,
    post: (path, body, credential) => postJson(config.origin, path, body, credential),
    openPairing: (_code, pageUrl) => openBrowser(pageUrl),
    runSession: (credential, bridgeId) =>
        runBridgeSession({
            origin: config.origin,
            bridgeId,
            stateDir: dir,
            credential,
            policy: productionBridgePolicy(),
            maxCycles: 1,
        }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    discover:
        process.env.ORTHOCAD_BRIDGE_ALLOW_LAN_PROBE === "1"
            ? async () => discoverLanPrinters({ localAddresses: localLanAddresses(), probe: probeServerInfo })
            : async () => [],
    readManifest:
        config.updateManifestUrl && publicKeys
            ? async () => {
                  const response = await fetch(config.updateManifestUrl as string, { redirect: "manual" });
                  if (!response.ok) return null;
                  return response.json();
              }
            : undefined,
    publicKeys,
    applyUpdate: async (artifact) => {
        const staged = await stageVerifiedUpdate({
            url: artifact.url,
            sha256: artifact.sha256,
            destination: join(dir, "pending-update.bin"),
        });
        if (!staged.ok) throw new Error("update payload was rejected");
        if (process.platform === "win32" && artifact.url.endsWith(".exe")) {
            spawn(join(dir, "pending-update.bin"), ["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"], {
                detached: true,
                windowsHide: true,
                stdio: "ignore",
            }).unref();
        } else if (process.platform === "darwin" && artifact.url.endsWith(".pkg")) {
            spawn(
                "installer",
                ["-pkg", join(dir, "pending-update.bin"), "-target", "CurrentUserHomeDirectory"],
                {
                    detached: true,
                    stdio: "ignore",
                },
            ).unref();
        }
    },
    log: (line) => console.error(line),
});

console.error(`bridge stopped: ${result.stopped} cycles=${result.cycles}`);
process.exit(result.stopped === "revoked" || result.stopped === "enrollment-rejected" ? 1 : 0);
