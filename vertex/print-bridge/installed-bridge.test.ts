// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { memoryBridgeDirectory } from "../shared/print-bridge-directory";
import { containsSecret } from "../shared/print-bridge-pairing";
import { signUpdateManifest, type UpdatePayload } from "../shared/print-bridge-update";
import { PRINT_BRIDGE_PRODUCT, PRINT_BRIDGE_VERSION } from "../shared/print-bridge-version";
import { runInstalledBridge } from "./installed-bridge";
import { CREDENTIAL_ACCOUNT, DEVICE_PROOF_ACCOUNT, memorySecretStore } from "./secret-store";

const ORIGIN = "https://cloud.example";
const BRIDGE_ID = "5598afcd-1111-4111-8111-111111111111";
const LEGACY = "legacy-bridge-credential-not-for-logs";

describe("installed print bridge", () => {
    test("an already enrolled credential heartbeats and does not start pairing", async () => {
        const dir = mkdtempSync(join(tmpdir(), "bridge-installed-"));
        const store = memorySecretStore();
        await store.set(CREDENTIAL_ACCOUNT, LEGACY);
        const logs: string[] = [];
        const posts: string[] = [];
        const sessions: string[] = [];
        const result = await runInstalledBridge({
            origin: ORIGIN,
            bridgeId: BRIDGE_ID,
            stateDir: dir,
            store,
            maxCycles: 1,
            log: (line) => logs.push(line),
            post: async (path) => {
                posts.push(path);
                return { status: 200, json: {} };
            },
            runSession: async (credential) => {
                sessions.push(credential);
                return { cycles: 1, stopped: "cycles" };
            },
        });
        expect(result.stopped).toBe("cycles");
        expect(posts).toEqual([]);
        expect(sessions).toEqual([LEGACY]);
        expect(containsSecret(logs.join("\n"), LEGACY)).toBe(false);
    });

    test("browser pairing stores the credential and does not write the proof or credential to the page or log", async () => {
        const dir = mkdtempSync(join(tmpdir(), "bridge-pair-"));
        const directory = memoryBridgeDirectory();
        const store = memorySecretStore();
        const logs: string[] = [];
        let page = "";
        const result = await runInstalledBridge({
            origin: ORIGIN,
            bridgeId: BRIDGE_ID,
            stateDir: dir,
            store,
            maxCycles: 1,
            pollLimit: 2,
            log: (line) => logs.push(line),
            sleep: async () => undefined,
            openPairing: (_code, pageUrl) => {
                page = readFileSync(join(dir, "pairing.html"), "utf8");
                expect(page).toContain(pageUrl);
                const proof = store.dump()[DEVICE_PROOF_ACCOUNT] ?? "";
                expect(containsSecret(page, proof)).toBe(false);
                expect(page).not.toContain(proof);
            },
            post: async (path, body) => {
                const record = body as { bridgeId: string; deviceProof: string; origin: string };
                if (path === "/print-bridge/v1/pair/begin") {
                    const began = await directory.beginPairing({
                        ...record,
                        now: new Date("2026-11-10T12:00:00.000Z"),
                    });
                    return began.ok
                        ? {
                              status: 201,
                              json: { pairingCode: began.pairingCode, expiresAt: began.expiresAt },
                          }
                        : { status: 400, json: {} };
                }
                if (path === "/print-bridge/v1/pair/poll") {
                    const pending = await directory.pollPairing({
                        ...record,
                        now: new Date("2026-11-10T12:00:00.000Z"),
                    });
                    if (pending.status === "pending") {
                        const code = page.match(/Pairing code <strong>([^<]+)<\/strong>/)?.[1] ?? "";
                        await directory.approvePairing({
                            code,
                            tenantId: "11111111-1111-4111-8111-111111111111",
                            shopId: "11111111-1111-4111-8111-111111111111",
                            bridgeName: "Shop computer",
                            now: new Date("2026-11-10T12:00:00.000Z"),
                        });
                        return { status: 200, json: { status: "pending" } };
                    }
                    return { status: 200, json: pending };
                }
                return { status: 404, json: {} };
            },
            runSession: async () => ({ cycles: 1, stopped: "cycles" }),
        });
        expect(result.stopped).toBe("cycles");
        const credential = store.dump()[CREDENTIAL_ACCOUNT] ?? "";
        expect(credential.length).toBeGreaterThan(20);
        expect(store.dump()[DEVICE_PROOF_ACCOUNT]).toBeUndefined();
        expect(containsSecret(logs.join("\n"), credential)).toBe(false);
        expect(containsSecret(directory.inspect(), credential)).toBe(false);
        expect(() => readFileSync(join(dir, "pairing.html"), "utf8")).toThrow();
    });

    test("a tampered update manifest is not installed", async () => {
        const { privateKey, publicKey } = generateKeyPairSync("ed25519");
        const payload: UpdatePayload = {
            product: PRINT_BRIDGE_PRODUCT,
            channel: "stable",
            version: "2026.11.10.4",
            minVersion: "2026.11.09.0",
            releasedAt: "2026-11-10T00:00:00.000Z",
            expiresAt: "2027-11-10T00:00:00.000Z",
            platforms: {
                "win32-x64": {
                    url: "https://downloads.example/OrthoCAD-Print-Bridge-Setup.exe",
                    sha256: "c".repeat(64),
                },
            },
        };
        const signed = signUpdateManifest(
            payload,
            privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
            "test-key",
        );
        const store = memorySecretStore();
        await store.set(CREDENTIAL_ACCOUNT, LEGACY);
        const applied: string[] = [];
        const logs: string[] = [];
        await runInstalledBridge({
            origin: ORIGIN,
            bridgeId: BRIDGE_ID,
            stateDir: mkdtempSync(join(tmpdir(), "bridge-update-")),
            store,
            maxCycles: 1,
            installedVersion: PRINT_BRIDGE_VERSION,
            platform: "win32-x64",
            publicKeys: { "test-key": publicKey.export({ type: "spki", format: "pem" }).toString() },
            now: () => new Date("2026-11-10T12:00:00.000Z"),
            log: (line) => logs.push(line),
            readManifest: async () => ({
                ...signed,
                payload: { ...signed.payload, version: "2026.11.10.9" },
            }),
            applyUpdate: async (artifact) => {
                applied.push(artifact.version);
            },
            runSession: async () => ({ cycles: 1, stopped: "cycles" }),
        });
        expect(applied).toEqual([]);
        expect(logs.join("\n")).toContain("update rejected: tampered");
    });
});
