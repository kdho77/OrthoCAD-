// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Fake Moonraker only. The cloud handler is in-process. No shop printer is contacted.

import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, test } from "@rstest/core";
import type { Actor } from "../../shared/client-files";
import { memoryBridgeDirectory } from "../../shared/print-bridge-directory";
import { createEnrollment } from "../../shared/print-bridge-enrollment";
import { runBridgeSession } from "../../shared/print-bridge-session";
import { testLoopbackAddressPolicy } from "../../shared/printer-address-policy";
import {
    createMemoryProductionRepo,
    type PrinterRecord,
    type PrinterState,
} from "../../shared/production-jobs";
import { handlePrintBridgeNode, type PrintBridgeHttpDeps } from "./print-bridge-http";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-11-10T04:11:00.000Z";
const OLD = "2020-01-01T00:00:00.000Z";

function actor(): Actor {
    return { id: "user-1", email: "op@example.com", role: "clinician", tenantId: ORG };
}

function printer(input: {
    id: string;
    name: string;
    state: PrinterState;
    tenantId: string;
    bridgeId: string;
    lastSeenAt?: string | null;
}): PrinterRecord {
    return {
        id: input.id,
        name: input.name,
        state: input.state,
        tenantId: input.tenantId,
        ownerId: actor().id,
        adapterMode: "configured",
        protocolId: "moonraker",
        endpointConfigured: true,
        credentialRef: null,
        cancellation: "unsupported",
        liveVerified: false,
        protocolVerified: false,
        lastSeenAt: input.lastSeenAt ?? null,
        enabled: true,
        bridgeId: input.bridgeId,
        configVersion: 1,
    };
}

async function invoke(
    deps: PrintBridgeHttpDeps,
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
) {
    const payload = Buffer.from(JSON.stringify(body));
    const req = Readable.from([payload]) as IncomingMessage;
    req.method = "POST";
    req.url = url;
    req.headers = headers;
    let status = 0;
    const chunks: Buffer[] = [];
    const res = {
        writeHead(code: number) {
            status = code;
            return this;
        },
        end(part?: string | Buffer) {
            if (part) chunks.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
        },
    } as unknown as ServerResponse;
    await handlePrintBridgeNode(req, res, deps);
    const text = Buffer.concat(chunks).toString("utf8");
    return { status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function statusServer(
    webhooks: string,
    print: string,
): Promise<{
    url: string;
    paths: string[];
    close: () => Promise<void>;
}> {
    const paths: string[] = [];
    const server = createServer((req, res) => {
        const path = (req.url ?? "").split("?")[0] ?? "";
        paths.push(`${req.method ?? "GET"} ${path}`);
        if (req.method === "GET" && path === "/printer/objects/query") {
            res.setHeader("content-type", "application/json");
            res.end(
                JSON.stringify({
                    result: {
                        status: {
                            webhooks: { state: webhooks, message: "" },
                            print_stats: { filename: "", state: print, message: "" },
                            virtual_sdcard: { progress: print === "printing" ? 0.5 : 0 },
                        },
                    },
                }),
            );
            return;
        }
        res.writeHead(404);
        res.end();
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            resolve({
                url: `http://127.0.0.1:${port}`,
                paths,
                close: () => new Promise((done) => server.close(() => done())),
            });
        });
    });
}

async function closedLoopback(): Promise<string> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return `http://127.0.0.1:${port}`;
}

describe("bridge check-in printer presence", () => {
    test("a fake Moonraker heartbeat reports idle, printing, and unreachable", async () => {
        const idle = await statusServer("ready", "standby");
        const printing = await statusServer("ready", "printing");
        const down = await closedLoopback();
        const repo = createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} });
        const directory = memoryBridgeDirectory();
        const bodies: string[] = [];
        const cloud = createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            req.on("end", () => {
                const raw = Buffer.concat(chunks);
                bodies.push(raw.toString("utf8"));
                const replay = Readable.from(raw.length ? [raw] : []) as IncomingMessage;
                replay.method = req.method;
                replay.url = req.url;
                replay.headers = req.headers;
                void handlePrintBridgeNode(replay, res, {
                    directory,
                    repo,
                    now: () => new Date(NOW),
                });
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
            now: new Date(NOW),
        });
        await directory.putEnrollment(enrollment.record);
        const idleId = crypto.randomUUID();
        const printingId = crypto.randomUUID();
        const downId = crypto.randomUUID();
        const hiddenId = crypto.randomUUID();
        const rows = [
            { id: idleId, name: "Idle", endpoint: idle.url, state: "offline" as const },
            { id: printingId, name: "Printing", endpoint: printing.url, state: "offline" as const },
            { id: downId, name: "Down", endpoint: down, state: "idle" as const },
        ];
        for (const row of rows) {
            await repo.insertConfiguredPrinter(
                printer({
                    id: row.id,
                    name: row.name,
                    state: row.state,
                    tenantId: ORG,
                    bridgeId,
                }),
                {
                    endpoint: row.endpoint,
                    protocolId: "moonraker",
                    credentialRef: "",
                    cancellation: "unsupported",
                    lastSeenAt: null,
                },
            );
        }
        await repo.insertConfiguredPrinter(
            printer({
                id: hiddenId,
                name: "Hidden",
                state: "paused",
                tenantId: OTHER,
                bridgeId,
                lastSeenAt: OLD,
            }),
            {
                endpoint: "http://127.0.0.1:9",
                protocolId: "moonraker",
                credentialRef: "",
                cancellation: "unsupported",
                lastSeenAt: OLD,
            },
        );
        try {
            const result = await runBridgeSession({
                origin,
                bridgeId,
                stateDir: mkdtempSync(join(tmpdir(), "bridge-presence-")),
                policy: testLoopbackAddressPolicy(),
                proof: enrollment.proof,
                maxCycles: 1,
            });
            expect(result.stopped).toBe("cycles");
            const parsed = bodies.map((body) => JSON.parse(body) as Record<string, unknown>);
            const heartbeats = parsed.filter((body) => body.proof === undefined);
            expect(heartbeats[0]).toEqual({ bridgeId });
            expect(heartbeats[1]).toEqual({
                bridgeId,
                printers: [
                    { id: idleId, state: "idle" },
                    { id: printingId, state: "running" },
                    { id: downId, state: "offline" },
                ],
            });
            expect(JSON.stringify(heartbeats)).not.toContain("apiKey");
            const stored = await repo.listPrinters();
            expect(stored.find((item) => item.id === idleId)).toMatchObject({
                state: "idle",
                lastSeenAt: NOW,
            });
            expect(stored.find((item) => item.id === printingId)).toMatchObject({
                state: "running",
                lastSeenAt: NOW,
            });
            expect(stored.find((item) => item.id === downId)).toMatchObject({
                state: "offline",
                lastSeenAt: NOW,
            });
            expect(stored.find((item) => item.id === hiddenId)).toMatchObject({
                state: "paused",
                lastSeenAt: OLD,
            });
            expect((await directory.findBridge(bridgeId))?.lastSeenAt).toBe(NOW);
            expect(idle.paths).toEqual(["GET /printer/objects/query"]);
            expect(printing.paths).toEqual(["GET /printer/objects/query"]);
            expect(printing.paths.join(" ")).not.toContain("print/start");
            expect(idle.paths.join(" ")).not.toContain("upload");
        } finally {
            await idle.close();
            await printing.close();
            await new Promise<void>((resolve) => cloud.close(() => resolve()));
        }
    });

    test("a legacy {bridgeId} heartbeat still checks in and does not mark printers offline", async () => {
        const directory = memoryBridgeDirectory();
        const repo = createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} });
        const deps: PrintBridgeHttpDeps = { directory, repo, now: () => new Date(NOW) };
        const bridgeId = crypto.randomUUID();
        const enrollment = createEnrollment({
            tenantId: ORG,
            shopId: ORG,
            bridgeId,
            printerIds: [],
            origin: "https://cloud.example",
            now: new Date(NOW),
        });
        await directory.putEnrollment(enrollment.record);
        const mine = crypto.randomUUID();
        const leftOut = crypto.randomUUID();
        const theirs = crypto.randomUUID();
        await repo.insertConfiguredPrinter(
            printer({ id: mine, name: "Mine", state: "idle", tenantId: ORG, bridgeId, lastSeenAt: OLD }),
            {
                endpoint: "http://10.0.0.8:7125",
                protocolId: "moonraker",
                credentialRef: "",
                cancellation: "unsupported",
                lastSeenAt: OLD,
            },
        );
        await repo.insertConfiguredPrinter(
            printer({
                id: leftOut,
                name: "Left out",
                state: "running",
                tenantId: ORG,
                bridgeId,
                lastSeenAt: OLD,
            }),
            {
                endpoint: "http://10.0.0.9:7125",
                protocolId: "moonraker",
                credentialRef: "",
                cancellation: "unsupported",
                lastSeenAt: OLD,
            },
        );
        await repo.insertConfiguredPrinter(
            printer({
                id: theirs,
                name: "Theirs",
                state: "paused",
                tenantId: OTHER,
                bridgeId,
                lastSeenAt: OLD,
            }),
            {
                endpoint: "http://10.0.0.10:7125",
                protocolId: "moonraker",
                credentialRef: "",
                cancellation: "unsupported",
                lastSeenAt: OLD,
            },
        );
        const enrolled = await invoke(deps, "/print-bridge/v1/enroll", {
            proof: enrollment.proof,
            bridgeId,
            origin: "https://cloud.example",
        });
        expect(enrolled.status).toBe(201);
        const auth = { authorization: `Bearer ${enrolled.json.credential}` };
        expect((await directory.findBridge(bridgeId))?.lastSeenAt).toBeNull();

        const legacy = await invoke(deps, "/print-bridge/v1/heartbeat", { bridgeId }, auth);
        expect(legacy.status).toBe(200);
        expect((await directory.findBridge(bridgeId))?.lastSeenAt).toBe(NOW);
        expect((await repo.listPrinters()).find((item) => item.id === mine)).toMatchObject({
            state: "idle",
            lastSeenAt: OLD,
        });
        expect((await repo.listPrinters()).find((item) => item.id === leftOut)).toMatchObject({
            state: "running",
            lastSeenAt: OLD,
        });

        const empty = await invoke(deps, "/print-bridge/v1/heartbeat", { bridgeId, printers: [] }, auth);
        expect(empty.status).toBe(200);
        const weird = await invoke(
            deps,
            "/print-bridge/v1/heartbeat",
            { bridgeId, printers: { id: mine, state: "offline" } },
            auth,
        );
        expect(weird.status).toBe(200);
        const unknown = await invoke(
            deps,
            "/print-bridge/v1/heartbeat",
            { bridgeId, printers: [{ id: mine, state: "printing" }] },
            auth,
        );
        expect(unknown.status).toBe(200);
        expect((await repo.listPrinters()).find((item) => item.id === mine)).toMatchObject({
            state: "idle",
            lastSeenAt: OLD,
        });

        const reported = await invoke(
            deps,
            "/print-bridge/v1/heartbeat",
            {
                bridgeId,
                printers: [
                    { id: mine, state: "running" },
                    { id: theirs, state: "offline" },
                ],
            },
            auth,
        );
        expect(reported.status).toBe(200);
        expect((await repo.listPrinters()).find((item) => item.id === mine)).toMatchObject({
            state: "running",
            lastSeenAt: NOW,
        });
        expect((await repo.listPrinters()).find((item) => item.id === leftOut)).toMatchObject({
            state: "running",
            lastSeenAt: OLD,
        });
        expect((await repo.listPrinters()).find((item) => item.id === theirs)).toMatchObject({
            state: "paused",
            lastSeenAt: OLD,
        });

        const again = await invoke(deps, "/print-bridge/v1/heartbeat", { bridgeId }, auth);
        expect(again.status).toBe(200);
        expect((await repo.listPrinters()).find((item) => item.id === mine)?.state).toBe("running");
        expect((await directory.findBridge(bridgeId))?.lastSeenAt).toBe(NOW);
    });
});
