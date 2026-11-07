// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Local fake Moonraker and the real bridge HTTP route. No shop network calls.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { handlePrintBridgeNode } from "../server/src/print-bridge-http";
import type { Actor } from "../shared/client-files";
import { createMoonrakerClient } from "../shared/moonraker-client";
import { saveMoonrakerPrinter } from "../shared/moonraker-farm";
import { memoryBridgeDirectory } from "../shared/print-bridge-directory";
import { createEnrollment } from "../shared/print-bridge-enrollment";
import { runBridgeSession } from "../shared/print-bridge-session";
import { testLoopbackAddressPolicy } from "../shared/printer-address-policy";
import { assignJob, createMemoryProductionRepo, enqueueJob } from "../shared/production-jobs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const GCODE = "G0 X0\n";

function actor(tenantId = ORG): Actor {
    return { id: "user-1", email: "op@example.com", role: "clinician", tenantId };
}

function startFakeMoonraker(): Promise<{
    url: string;
    close: () => Promise<void>;
    counts: Record<string, number>;
    state: { filename: string; printState: string };
}> {
    const counts: Record<string, number> = {};
    const state = { filename: "", printState: "standby" };
    const sockets = new Set<import("node:net").Socket>();
    const server = createServer((req, res) => {
        const path = (req.url ?? "").split("?")[0] ?? "";
        counts[path] = (counts[path] ?? 0) + 1;
        if (path.includes("gcode/script")) {
            res.writeHead(403);
            res.end("no");
            return;
        }
        if (path === "/redirect") {
            res.writeHead(302, { location: "http://169.254.169.254/" });
            res.end();
            return;
        }
        if (req.method === "POST" && path === "/server/files/upload") {
            const chunks: Buffer[] = [];
            req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            req.on("end", () => {
                const raw = Buffer.concat(chunks);
                const marker = raw.indexOf(Buffer.from("application/octet-stream\r\n\r\n"));
                const start = marker + Buffer.from("application/octet-stream\r\n\r\n").length;
                const end = raw.indexOf(Buffer.from("\r\n--"), start);
                const file = raw.subarray(start, end);
                state.filename = `orthocad-upload.gcode`;
                res.writeHead(201, { "content-type": "application/json" });
                res.end(
                    JSON.stringify({
                        item: { path: "orthocad-upload.gcode", root: "gcodes", size: file.length },
                        print_started: false,
                        action: "create_file",
                    }),
                );
            });
            return;
        }
        if (req.method === "POST" && path === "/printer/print/start") {
            const filename = new URL(req.url ?? "", "http://printer").searchParams.get("filename") ?? "";
            state.filename = filename;
            state.printState = "printing";
            res.end("ok");
            return;
        }
        if (req.method === "POST" && path === "/printer/print/cancel") {
            state.printState = "cancelled";
            res.end("ok");
            return;
        }
        if (req.method === "GET" && path === "/printer/objects/query") {
            res.setHeader("content-type", "application/json");
            res.end(
                JSON.stringify({
                    result: {
                        status: {
                            webhooks: { state: "ready", message: "" },
                            print_stats: { filename: state.filename, state: state.printState, message: "" },
                            virtual_sdcard: { progress: state.printState === "printing" ? 0.4 : 0 },
                        },
                    },
                }),
            );
            return;
        }
        res.writeHead(404);
        res.end();
    });
    server.on("connection", (socket) => sockets.add(socket));
    server.on("upgrade", (req, socket) => {
        counts.websocket = (counts.websocket ?? 0) + 1;
        const key = String(req.headers["sec-websocket-key"] ?? "");
        const accept = createHash("sha1")
            .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
            .digest("base64");
        socket.write(
            `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        socket.on("data", (buf: Buffer) => {
            const text = decodeFrame(buf);
            if (!text.includes("printer.objects.query")) return;
            const payload = JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: {
                    status: {
                        webhooks: { state: "ready", message: "" },
                        print_stats: { filename: state.filename, state: state.printState, message: "" },
                        virtual_sdcard: { progress: 0.4 },
                    },
                },
            });
            socket.write(encodeFrame(payload));
            socket.end();
        });
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            resolve({
                url: `http://127.0.0.1:${port}`,
                counts,
                state,
                close: () =>
                    new Promise((done) => {
                        for (const socket of sockets) socket.destroy();
                        server.close(() => done());
                    }),
            });
        });
    });
}

function decodeFrame(buf: Buffer): string {
    const length = buf[1] & 127;
    const mask = buf.subarray(2, 6);
    const data = buf.subarray(6, 6 + length);
    for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4];
    return data.toString("utf8");
}

function encodeFrame(text: string): Buffer {
    const payload = Buffer.from(text);
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

async function listen(
    repo: ReturnType<typeof createMemoryProductionRepo>,
    directory: ReturnType<typeof memoryBridgeDirectory>,
) {
    const server = createServer((req, res) => {
        void handlePrintBridgeNode(req, res, { directory, repo });
    });
    const sockets = new Set<import("node:net").Socket>();
    server.on("connection", (socket) => sockets.add(socket));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return {
        origin: `http://127.0.0.1:${port}`,
        close: () =>
            new Promise<void>((resolve) => {
                for (const socket of sockets) socket.destroy();
                server.close(() => resolve());
            }),
    };
}

describe("local bridge and fake Moonraker", () => {
    test("two printers upload and start independently, and a second start is not sent", async () => {
        const left = await startFakeMoonraker();
        const right = await startFakeMoonraker();
        const repo = createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} });
        const directory = memoryBridgeDirectory();
        const cloud = await listen(repo, directory);
        const me = actor();
        const bridgeId = crypto.randomUUID();
        const enrollment = createEnrollment({
            tenantId: ORG,
            shopId: ORG,
            bridgeId,
            printerIds: [],
            origin: cloud.origin,
            now: new Date(),
        });
        await directory.putEnrollment(enrollment.record);
        const bayAId = crypto.randomUUID();
        const bayBId = crypto.randomUUID();
        await repo.insertConfiguredPrinter(
            {
                id: bayAId,
                name: "A",
                state: "offline",
                tenantId: ORG,
                ownerId: "user-1",
                adapterMode: "configured",
                protocolId: "moonraker",
                endpointConfigured: true,
                credentialRef: null,
                cancellation: "explicit",
                liveVerified: false,
                protocolVerified: false,
                lastSeenAt: null,
                enabled: true,
                bridgeId,
                configVersion: 1,
            },
            {
                endpoint: left.url,
                protocolId: "moonraker",
                credentialRef: "",
                cancellation: "explicit",
                lastSeenAt: null,
            },
        );
        await repo.insertConfiguredPrinter(
            {
                id: bayBId,
                name: "B",
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
                endpoint: right.url,
                protocolId: "moonraker",
                credentialRef: "",
                cancellation: "unsupported",
                lastSeenAt: null,
            },
        );
        const jobA = await assignJob(
            repo,
            me,
            (
                await enqueueJob(repo, me, {
                    designId: "d-a",
                    designName: "A",
                    designKind: "insole",
                    clientId: "c1",
                    clientLabel: "JD",
                    process: "print",
                    gcode: GCODE,
                })
            ).id,
            bayAId,
        );
        const jobB = await assignJob(
            repo,
            me,
            (
                await enqueueJob(repo, me, {
                    designId: "d-b",
                    designName: "B",
                    designKind: "insole",
                    clientId: "c1",
                    clientLabel: "JD",
                    process: "print",
                    gcode: `${GCODE}G1 X1\n`,
                })
            ).id,
            bayBId,
        );
        await repo.patchJob(jobA.id, {
            bridgeId,
            configVersion: 1,
            releasedAt: new Date().toISOString(),
            idempotencyKey: "a",
        });
        await repo.patchJob(jobB.id, {
            bridgeId,
            configVersion: 1,
            releasedAt: new Date().toISOString(),
            idempotencyKey: "b",
        });
        const hidden = await enqueueJob(repo, actor(OTHER), {
            designId: "d-hidden",
            designName: "Hidden",
            designKind: "insole",
            clientId: "c9",
            clientLabel: "ZZ",
            process: "print",
            gcode: GCODE,
        });
        await repo.patchJob(hidden.id, {
            bridgeId,
            configVersion: 1,
            releasedAt: new Date().toISOString(),
            printerId: bayBId,
        });
        const first = await runBridgeSession({
            origin: cloud.origin,
            bridgeId,
            stateDir: mkdtempSync(join(tmpdir(), "bridge-")),
            policy: testLoopbackAddressPolicy(),
            proof: enrollment.proof,
            maxCycles: 1,
        });
        expect(first.stopped).toBe("cycles");
        expect((await repo.getJob(jobA.id))?.dispatchState).toBe("acknowledged");
        expect((await repo.getJob(jobB.id))?.status).toBe("running");
        expect((await repo.getJob(hidden.id))?.dispatchState ?? "none").not.toBe("acknowledged");
        expect(left.counts["/printer/print/start"]).toBe(1);
        expect(right.counts["/printer/print/start"]).toBe(1);
        expect(left.counts["/printer/gcode/script"] ?? 0).toBe(0);
        const again = await runBridgeSession({
            origin: cloud.origin,
            bridgeId,
            stateDir: mkdtempSync(join(tmpdir(), "bridge-")),
            policy: testLoopbackAddressPolicy(),
            credential: "wrong",
            maxCycles: 1,
        });
        expect(again.stopped).toBe("revoked");
        expect(left.counts["/printer/print/start"]).toBe(1);
        await left.close();
        await right.close();
        await cloud.close();
    });

    test("enrollment is single-use and production policy rejects loopback before a call", async () => {
        const directory = memoryBridgeDirectory();
        const now = new Date("2026-11-07T12:00:00.000Z");
        const bridgeId = crypto.randomUUID();
        const created = createEnrollment({
            tenantId: ORG,
            shopId: ORG,
            bridgeId,
            printerIds: [],
            origin: "https://cloud.example",
            now,
            ttlMs: 1000,
        });
        await directory.putEnrollment(created.record);
        const first = await directory.redeem({
            proof: created.proof,
            bridgeId,
            origin: "https://cloud.example",
            now,
        });
        const second = await directory.redeem({
            proof: created.proof,
            bridgeId,
            origin: "https://cloud.example",
            now,
        });
        expect(first.ok).toBe(true);
        expect(second.ok).toBe(false);
        const expired = createEnrollment({
            tenantId: ORG,
            shopId: ORG,
            bridgeId: crypto.randomUUID(),
            printerIds: [],
            origin: "https://cloud.example",
            now: new Date(now.getTime() - 5_000),
            ttlMs: 1000,
        });
        await directory.putEnrollment(expired.record);
        const late = await directory.redeem({
            proof: expired.proof,
            bridgeId: expired.record.bridgeId,
            origin: "https://cloud.example",
            now,
        });
        expect(late.ok).toBe(false);
        const client = createMoonrakerClient(testLoopbackAddressPolicy());
        await expect(client.queryHttp({ address: "http://169.254.169.254:80" })).rejects.toThrow(
            /approved LAN/,
        );
        const repo = createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} });
        await expect(
            saveMoonrakerPrinter(repo, actor(), {
                name: "Nope",
                address: "http://127.0.0.1:7125",
                bridgeId,
                cancellation: "unsupported",
                enabled: true,
            }),
        ).rejects.toThrow(/approved LAN/);
    });

    test("the production bridge executable enrolls outbound and does not embed a test loopback policy", async () => {
        const { readFileSync } = await import("node:fs");
        const source = readFileSync(join(process.cwd(), "vertex/print-bridge/main.ts"), "utf8");
        expect(source).toContain("productionAddressPolicy");
        expect(source).not.toContain("testLoopback");
        const repo = createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} });
        const directory = memoryBridgeDirectory();
        const cloud = await listen(repo, directory);
        const bridgeId = crypto.randomUUID();
        const enrollment = createEnrollment({
            tenantId: ORG,
            shopId: ORG,
            bridgeId,
            printerIds: [],
            origin: cloud.origin,
            now: new Date(),
        });
        await directory.putEnrollment(enrollment.record);
        const stateDir = mkdtempSync(join(tmpdir(), "bridge-exec-"));
        const child = spawn("npx", ["tsx", "print-bridge/main.ts"], {
            cwd: join(process.cwd(), "vertex"),
            env: {
                ...process.env,
                ORTHOCAD_BRIDGE_CLOUD_ORIGIN: cloud.origin,
                ORTHOCAD_BRIDGE_ID: bridgeId,
                ORTHOCAD_BRIDGE_STATE_DIR: stateDir,
                ORTHOCAD_BRIDGE_ENROLLMENT_PROOF: enrollment.proof,
            },
        });
        const logs: string[] = [];
        child.stderr.on("data", (chunk) => logs.push(String(chunk)));
        const code = await new Promise<number>((resolve) =>
            child.on("exit", (status) => resolve(status ?? 1)),
        );
        expect(code).toBe(0);
        expect(logs.join("")).not.toContain(enrollment.proof);
        expect(readFileSync(join(stateDir, "credential"), "utf8").length).toBeGreaterThan(20);
        await cloud.close();
    });
});
