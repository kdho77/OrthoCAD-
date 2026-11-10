// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// The Moonraker key stays on Moonraker HTTP calls. It is not sent to the cloud.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, test } from "@rstest/core";
import { handlePrintBridgeNode } from "../server/src/print-bridge-http";
import type { Actor } from "./client-files";
import { createMoonrakerClient } from "./moonraker-client";
import { memoryBridgeDirectory } from "./print-bridge-directory";
import { createEnrollment } from "./print-bridge-enrollment";
import { readMoonrakerApiKeyFile, runBridgeSession } from "./print-bridge-session";
import { testLoopbackAddressPolicy } from "./printer-address-policy";
import { assignJob, createMemoryProductionRepo, enqueueJob } from "./production-jobs";

const SECRET = "mk_test_secret_value";
const ORG = "11111111-1111-4111-8111-111111111111";

function actor(): Actor {
    return { id: "user-1", email: "op@example.com", role: "clinician", tenantId: ORG };
}

describe("Moonraker API key file", () => {
    test("reads the key once and fails closed without revealing it", () => {
        const logs: string[] = [];
        const error = console.error;
        const log = console.log;
        console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
        console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
        try {
            expect(readMoonrakerApiKeyFile(undefined)).toBeUndefined();
            expect(readMoonrakerApiKeyFile("   ")).toBeUndefined();
            const dir = mkdtempSync(join(tmpdir(), "moonraker-key-"));
            const file = join(dir, "key");
            writeFileSync(file, `  ${SECRET}\n`, { mode: 0o600 });
            expect(readMoonrakerApiKeyFile(file)).toBe(SECRET);
            expect(() => readMoonrakerApiKeyFile(join(dir, "missing"))).toThrow(
                /ORTHOCAD_MOONRAKER_API_KEY_FILE is set but the file cannot be read/,
            );
            writeFileSync(file, " \n", { mode: 0o600 });
            expect(() => readMoonrakerApiKeyFile(file)).toThrow(
                /ORTHOCAD_MOONRAKER_API_KEY_FILE is set but the file is empty/,
            );
            expect(logs.join("\n")).not.toContain(SECRET);
        } finally {
            console.error = error;
            console.log = log;
        }
        try {
            readMoonrakerApiKeyFile("/no/such/orthocad-moonraker-key", () => {
                throw new Error(`EACCES: ${SECRET}`);
            });
            throw new Error("expected failure");
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toMatch(/cannot be read/);
            expect((error as Error).message).not.toContain(SECRET);
        }
    });

    test("sends X-Api-Key to Moonraker HTTP and not to the cloud", async () => {
        const seen: string[] = [];
        const server = createServer((req, res) => {
            seen.push(String(req.headers["x-api-key"] ?? ""));
            res.setHeader("content-type", "application/json");
            res.end(
                JSON.stringify({
                    result: {
                        status: {
                            webhooks: { state: "ready", message: "" },
                            print_stats: { filename: "", state: "standby", message: "" },
                            virtual_sdcard: { progress: 0 },
                        },
                    },
                }),
            );
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        const client = createMoonrakerClient(testLoopbackAddressPolicy());
        await client.queryHttp({ address: `http://127.0.0.1:${port}`, apiKey: SECRET });
        expect(seen).toEqual([SECRET]);
        await new Promise<void>((resolve) => server.close(() => resolve()));

        const repo = createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} });
        const directory = memoryBridgeDirectory();
        const cloudHeaders: string[] = [];
        const cloud = createServer((req, res) => {
            cloudHeaders.push(JSON.stringify(req.headers));
            const chunks: Buffer[] = [];
            req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            req.on("end", () => {
                const body = Buffer.concat(chunks);
                cloudHeaders.push(body.toString("utf8"));
                const replay = Readable.from(body.length ? [body] : []) as IncomingMessage;
                replay.method = req.method;
                replay.url = req.url;
                replay.headers = req.headers;
                void handlePrintBridgeNode(replay, res, { directory, repo });
            });
        });
        await new Promise<void>((resolve) => cloud.listen(0, "127.0.0.1", () => resolve()));
        const cloudAddress = cloud.address();
        const cloudPort = typeof cloudAddress === "object" && cloudAddress ? cloudAddress.port : 0;
        const origin = `http://127.0.0.1:${cloudPort}`;
        const bridgeId = crypto.randomUUID();
        const enrollment = createEnrollment({
            tenantId: ORG,
            shopId: ORG,
            bridgeId,
            printerIds: [],
            origin,
            now: new Date(),
        });
        await directory.putEnrollment(enrollment.record);
        const printerId = crypto.randomUUID();
        await repo.insertConfiguredPrinter(
            {
                id: printerId,
                name: "Bay",
                state: "offline",
                tenantId: ORG,
                ownerId: "user-1",
                adapterMode: "configured",
                protocolId: "moonraker",
                endpointConfigured: true,
                credentialRef: null,
                cancellation: "unsupported",
                liveVerified: false,
                protocolVerified: false,
                lastSeenAt: null,
                enabled: true,
                bridgeId,
                configVersion: 1,
            },
            {
                endpoint: "http://127.0.0.1:7125",
                protocolId: "moonraker",
                credentialRef: "",
                cancellation: "unsupported",
                lastSeenAt: null,
            },
        );
        const queued = await enqueueJob(repo, actor(), {
            designId: "d-1",
            designName: "Shell",
            designKind: "insole",
            clientId: "c1",
            clientLabel: "JD",
            process: "print",
            gcode: "G0 X0\n",
        });
        await assignJob(repo, actor(), queued.id, printerId);
        await repo.patchJob(queued.id, {
            bridgeId,
            configVersion: 1,
            releasedAt: new Date().toISOString(),
            idempotencyKey: "k",
        });
        const calls: { method: string; apiKey?: string }[] = [];
        const logs: string[] = [];
        const error = console.error;
        const log = console.log;
        console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
        console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
        try {
            await runBridgeSession({
                origin,
                bridgeId,
                stateDir: mkdtempSync(join(tmpdir(), "bridge-key-")),
                policy: testLoopbackAddressPolicy(),
                proof: enrollment.proof,
                moonrakerApiKey: SECRET,
                maxCycles: 1,
                moonraker: {
                    async upload(input) {
                        calls.push({ method: "upload", apiKey: input.apiKey });
                        return { path: input.filename, size: input.body.length, printStarted: false };
                    },
                    async start(input) {
                        calls.push({ method: "start", apiKey: input.apiKey });
                    },
                    async queryHttp(input) {
                        calls.push({ method: "queryHttp", apiKey: input.apiKey });
                        return {
                            webhooksState: "ready",
                            filename: `orthocad-${queued.id}.gcode`,
                            printState: "printing",
                            progress: 10,
                            message: "",
                        };
                    },
                    async queryWebSocket(input) {
                        calls.push({ method: "queryWebSocket", apiKey: input.apiKey });
                        return {
                            webhooksState: "ready",
                            filename: `orthocad-${queued.id}.gcode`,
                            printState: "printing",
                            progress: 10,
                            message: "",
                        };
                    },
                    async cancel(input) {
                        calls.push({ method: "cancel", apiKey: input.apiKey });
                    },
                    async pause(input) {
                        calls.push({ method: "pause", apiKey: input.apiKey });
                    },
                    async resume(input) {
                        calls.push({ method: "resume", apiKey: input.apiKey });
                    },
                },
            });
        } finally {
            console.error = error;
            console.log = log;
            await new Promise<void>((resolve) => cloud.close(() => resolve()));
        }
        expect(calls.find((call) => call.method === "upload")?.apiKey).toBe(SECRET);
        expect(calls.find((call) => call.method === "start")?.apiKey).toBe(SECRET);
        expect(calls.find((call) => call.method === "queryHttp")?.apiKey).toBe(SECRET);
        expect(calls.find((call) => call.method === "queryWebSocket")?.apiKey).toBeUndefined();
        expect(cloudHeaders.join("\n")).not.toContain(SECRET);
        expect(logs.join("\n")).not.toContain(SECRET);
    });

    test("the bridge executable exits when the key file cannot be read", async () => {
        const stateDir = mkdtempSync(join(tmpdir(), "bridge-key-exec-"));
        const child = spawn("npx", ["tsx", "print-bridge/main.ts"], {
            cwd: join(process.cwd(), "vertex"),
            env: {
                ...process.env,
                ORTHOCAD_BRIDGE_CLOUD_ORIGIN: "https://cloud.example",
                ORTHOCAD_BRIDGE_ID: crypto.randomUUID(),
                ORTHOCAD_BRIDGE_STATE_DIR: stateDir,
                ORTHOCAD_MOONRAKER_API_KEY_FILE: join(stateDir, "missing-key"),
                ORTHOCAD_BRIDGE_ENROLLMENT_PROOF: "",
            },
        });
        const logs: string[] = [];
        child.stderr.on("data", (chunk) => logs.push(String(chunk)));
        child.stdout.on("data", (chunk) => logs.push(String(chunk)));
        const code = await new Promise<number>((resolve) =>
            child.on("exit", (status) => resolve(status ?? 1)),
        );
        expect(code).toBe(1);
        expect(logs.join("")).toMatch(/cannot be read/);
        expect(logs.join("")).not.toContain(SECRET);
    });
});
