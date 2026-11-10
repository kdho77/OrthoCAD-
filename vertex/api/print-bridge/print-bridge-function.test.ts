// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// The Vercel function and the Node handler share one contract. No shop network calls.

import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, test } from "@rstest/core";
import { handlePrintBridgeNode, type PrintBridgeHttpDeps } from "../../server/src/print-bridge-http";
import type { Actor } from "../../shared/client-files";
import type { MoonrakerClient } from "../../shared/moonraker-client";
import { memoryBridgeDirectory } from "../../shared/print-bridge-directory";
import { createEnrollment, sha256Hex } from "../../shared/print-bridge-enrollment";
import { runBridgeSession } from "../../shared/print-bridge-session";
import { testLoopbackAddressPolicy } from "../../shared/printer-address-policy";
import { assignJob, createMemoryProductionRepo, enqueueJob } from "../../shared/production-jobs";
import { handlePrintBridgeFunction } from "./index";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const GCODE = "ABCDEFGHIJK";

function actor(tenantId = ORG): Actor {
    return { id: "user-1", email: "op@example.com", role: "clinician", tenantId };
}

async function invoke(
    run: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
) {
    const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    const req = Readable.from(payload) as IncomingMessage;
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
    await run(req, res);
    const text = Buffer.concat(chunks).toString("utf8");
    return { status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {}, text };
}

function fresh(chunk = 1024 * 1024) {
    const directory = memoryBridgeDirectory();
    const repo = createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} });
    const deps: PrintBridgeHttpDeps & { databaseConfigured: boolean } = {
        directory,
        repo,
        databaseConfigured: true,
        artifactChunkBytes: chunk,
        now: () => new Date("2026-11-09T18:00:00.000Z"),
    };
    return { directory, repo, deps };
}

async function seed(deps: PrintBridgeHttpDeps) {
    const bridgeId = crypto.randomUUID();
    const enrollment = createEnrollment({
        tenantId: ORG,
        shopId: ORG,
        bridgeId,
        printerIds: [],
        origin: "https://cloud.example",
        now: new Date("2026-11-09T18:00:00.000Z"),
    });
    await deps.directory.putEnrollment(enrollment.record);
    const mine = crypto.randomUUID();
    const theirs = crypto.randomUUID();
    await deps.repo.insertConfiguredPrinter(
        {
            id: mine,
            name: "Mine",
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
    await deps.repo.insertConfiguredPrinter(
        {
            id: theirs,
            name: "Theirs",
            state: "offline",
            tenantId: OTHER,
            ownerId: "user-2",
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
            endpoint: "http://127.0.0.1:7126",
            protocolId: "moonraker",
            credentialRef: "",
            cancellation: "unsupported",
            lastSeenAt: null,
        },
    );
    const job = await assignJob(
        deps.repo,
        actor(),
        (
            await enqueueJob(deps.repo, actor(), {
                designId: "d-1",
                designName: "Shell",
                designKind: "insole",
                clientId: "c1",
                clientLabel: "JD",
                process: "print",
                gcode: GCODE,
            })
        ).id,
        mine,
    );
    await deps.repo.patchJob(job.id, {
        bridgeId,
        configVersion: 1,
        releasedAt: "2026-11-09T18:00:00.000Z",
        idempotencyKey: "k",
    });
    const hidden = await enqueueJob(deps.repo, actor(OTHER), {
        designId: "d-2",
        designName: "Hidden",
        designKind: "insole",
        clientId: "c2",
        clientLabel: "ZZ",
        process: "print",
        gcode: GCODE,
    });
    await deps.repo.patchJob(hidden.id, {
        bridgeId,
        printerId: theirs,
        configVersion: 1,
        releasedAt: "2026-11-09T18:00:00.000Z",
    });
    return { bridgeId, enrollment, job, mine, theirs, hidden };
}

async function codes(kind: "node" | "vercel") {
    const { deps } = fresh();
    const seeded = await seed(deps);
    const run = (req: IncomingMessage, res: ServerResponse) =>
        kind === "node" ? handlePrintBridgeNode(req, res, deps) : handlePrintBridgeFunction(req, res, deps);
    const enrolled = await invoke(run, "/print-bridge/v1/enroll", {
        proof: seeded.enrollment.proof,
        bridgeId: seeded.bridgeId,
        origin: "https://cloud.example",
    });
    const again = await invoke(run, "/print-bridge/v1/enroll", {
        proof: seeded.enrollment.proof,
        bridgeId: seeded.bridgeId,
        origin: "https://cloud.example",
    });
    const credential = String(enrolled.json.credential ?? "");
    const auth = { authorization: `Bearer ${credential}` };
    const missing = await invoke(run, "/print-bridge/v1/heartbeat", { bridgeId: seeded.bridgeId });
    const invalid = await invoke(
        run,
        "/print-bridge/v1/heartbeat",
        { bridgeId: seeded.bridgeId },
        { authorization: "Bearer not-the-credential" },
    );
    const beat = await invoke(run, "/print-bridge/v1/heartbeat", { bridgeId: seeded.bridgeId }, auth);
    const artifact = await invoke(
        run,
        "/print-bridge/v1/artifact",
        { bridgeId: seeded.bridgeId, jobId: seeded.job.id },
        auth,
    );
    const hiddenArtifact = await invoke(
        run,
        "/print-bridge/v1/artifact",
        { bridgeId: seeded.bridgeId, jobId: seeded.hidden.id },
        auth,
    );
    const report = await invoke(
        run,
        "/print-bridge/v1/report",
        { bridgeId: seeded.bridgeId, jobId: seeded.job.id, kind: "uploaded", detail: "Upload finished." },
        auth,
    );
    const missingRoute = await invoke(run, "/print-bridge/v1/unknown", { bridgeId: seeded.bridgeId }, auth);
    return {
        enrolled,
        again,
        missing,
        invalid,
        beat,
        artifact,
        hiddenArtifact,
        report,
        missingRoute,
        seeded,
    };
}

describe("vercel print-bridge function", () => {
    test("enroll, heartbeat, report, and artifact match the node handler", async () => {
        const node = await codes("node");
        const vercel = await codes("vercel");
        expect(node.enrolled.status).toBe(201);
        expect(vercel.enrolled.status).toBe(201);
        expect(typeof node.enrolled.json.credential).toBe("string");
        expect(typeof vercel.enrolled.json.credential).toBe("string");
        expect(node.again.status).toBe(401);
        expect(vercel.again.status).toBe(401);
        expect(node.missing.status).toBe(401);
        expect(vercel.missing.status).toBe(401);
        expect(node.invalid.status).toBe(401);
        expect(vercel.invalid.status).toBe(401);
        expect(node.beat.status).toBe(200);
        expect(vercel.beat.status).toBe(200);
        const nodePrinters = node.beat.json.printers as { id: string }[];
        const vercelPrinters = vercel.beat.json.printers as { id: string }[];
        expect(nodePrinters.map((printer) => printer.id)).toEqual([node.seeded.mine]);
        expect(vercelPrinters.map((printer) => printer.id)).toEqual([vercel.seeded.mine]);
        expect(JSON.stringify(node.beat.json)).not.toContain(node.seeded.theirs);
        expect(JSON.stringify(vercel.beat.json)).not.toContain(vercel.seeded.theirs);
        const nodeJobs = node.beat.json.jobs as { jobId: string; sha256: string }[];
        expect(nodeJobs.map((job) => job.jobId)).toEqual([node.seeded.job.id]);
        expect((vercel.beat.json.jobs as { jobId: string }[]).map((job) => job.jobId)).toEqual([
            vercel.seeded.job.id,
        ]);
        expect(node.artifact.status).toBe(200);
        expect(vercel.artifact.status).toBe(200);
        expect(node.artifact.json.sha256).toBe(sha256Hex(GCODE));
        expect(vercel.artifact.json.sha256).toBe(sha256Hex(GCODE));
        expect(node.artifact.json.body).toBe(GCODE);
        expect(vercel.artifact.json.complete).toBe(true);
        expect(node.hiddenArtifact.status).toBe(404);
        expect(vercel.hiddenArtifact.status).toBe(404);
        expect(node.report.status).toBe(204);
        expect(vercel.report.status).toBe(204);
        expect(node.missingRoute.status).toBe(404);
        expect(vercel.missingRoute.status).toBe(404);
    });

    test("a tampered artifact is rejected and a ranged read reassembles under the chunk cap", async () => {
        const { deps } = fresh(4);
        const seeded = await seed(deps);
        const run = (req: IncomingMessage, res: ServerResponse) => handlePrintBridgeFunction(req, res, deps);
        const enrolled = await invoke(run, "/print-bridge/v1/enroll", {
            proof: seeded.enrollment.proof,
            bridgeId: seeded.bridgeId,
            origin: "https://cloud.example",
        });
        const auth = { authorization: `Bearer ${enrolled.json.credential}` };
        const parts: string[] = [];
        let offset = 0;
        let guard = 0;
        let sha = "";
        while (guard < 8) {
            guard += 1;
            const chunk = await invoke(
                run,
                "/print-bridge/v1/artifact",
                { bridgeId: seeded.bridgeId, jobId: seeded.job.id, offset },
                auth,
            );
            expect(chunk.status).toBe(200);
            expect(chunk.json.sha256).toBe(sha256Hex(GCODE));
            expect(chunk.json.offset).toBe(offset);
            sha = String(chunk.json.sha256);
            const body = String(chunk.json.body ?? "");
            parts.push(body);
            offset += Buffer.byteLength(body);
            if (chunk.json.complete === true) break;
            expect(Buffer.byteLength(body)).toBeLessThanOrEqual(4);
        }
        const full = parts.join("");
        expect(full).toBe(GCODE);
        expect(sha256Hex(full)).toBe(sha);
        expect(parts.length).toBeGreaterThan(1);
        const badOffset = await invoke(
            run,
            "/print-bridge/v1/artifact",
            { bridgeId: seeded.bridgeId, jobId: seeded.job.id, offset: -1 },
            auth,
        );
        expect(badOffset.status).toBe(400);
        await deps.repo.putGcode(seeded.job.id, {
            body: GCODE,
            sha256: "ab".repeat(32),
            storedAt: "2026-11-09T18:00:00.000Z",
        });
        const rejected = await invoke(
            run,
            "/print-bridge/v1/artifact",
            { bridgeId: seeded.bridgeId, jobId: seeded.job.id, offset: 0 },
            auth,
        );
        expect(rejected.status).toBe(409);
        expect(rejected.text).not.toContain(GCODE);
    });

    test("the bridge checks sha256 after reassembling ranged artifact reads", async () => {
        const { deps } = fresh(4);
        const seeded = await seed(deps);
        const server = createServer((req, res) => {
            void handlePrintBridgeNode(req, res, deps);
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        const origin = `http://127.0.0.1:${port}`;
        seeded.enrollment.record.origin = origin;
        const uploads: Buffer[] = [];
        let filename = "";
        const moonraker: MoonrakerClient = {
            async upload(input) {
                uploads.push(input.body);
                filename = input.filename;
                return { path: input.filename, size: input.body.length, printStarted: false };
            },
            async start() {},
            async queryHttp() {
                return {
                    webhooksState: "ready",
                    filename,
                    printState: "printing",
                    progress: 10,
                    message: "",
                };
            },
            async queryWebSocket() {
                return {
                    webhooksState: "ready",
                    filename,
                    printState: "printing",
                    progress: 10,
                    message: "",
                };
            },
            async cancel() {},
            async pause() {},
            async resume() {},
        };
        const result = await runBridgeSession({
            origin,
            bridgeId: seeded.bridgeId,
            stateDir: mkdtempSync(join(tmpdir(), "bridge-chunk-")),
            policy: testLoopbackAddressPolicy(),
            proof: seeded.enrollment.proof,
            moonraker,
            maxCycles: 1,
        });
        expect(result.stopped).toBe("cycles");
        expect(Buffer.concat(uploads).toString("utf8")).toBe(GCODE);
        expect(sha256Hex(Buffer.concat(uploads).toString("utf8"))).toBe(sha256Hex(GCODE));
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    test("an unconfigured bridge store returns 503", async () => {
        const { deps } = fresh();
        const response = await invoke(
            (req, res) => handlePrintBridgeFunction(req, res, { ...deps, databaseConfigured: false }),
            "/print-bridge/v1/heartbeat",
            { bridgeId: crypto.randomUUID() },
        );
        expect(response.status).toBe(503);
        expect(response.json.error).toBe("bridge store is not configured");
    });
});
