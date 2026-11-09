// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Fake controller only. These tests must not open a socket.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { Actor } from "../../../shared/client-files";
import {
    closedPrinterDispatch,
    createContractTransport,
    DISPATCH_LEDGER_UNAVAILABLE,
    LOCAL_BRIDGE_PROTOCOL_ID,
    type PrinterIo,
    type PrinterIoCall,
    type PrinterIoResult,
    PrinterTransportError,
} from "../../../shared/printer-adapter";
import {
    assignJob,
    cancelDispatchedPrint,
    cancelJob,
    createMemoryProductionRepo,
    type DispatchDeps,
    type DispatchEvent,
    dispatchAssignedJob,
    enqueueJob,
    ProductionError,
    type ProductionRepo,
    reconcilePrinter,
    refreshPrinterReadiness,
    registerConfiguredPrinter,
    registerMockPrinter,
    retryJob,
    sha256Hex,
} from "../../../shared/production-jobs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const GCODE = "G0 X0\n";
const CRED = "bay-credential-name";
const NOW = new Date("2026-11-07T12:00:00.000Z");

function actor(tenantId: string | null = ORG, id = "user-1"): Actor {
    return { id, email: "op@example.com", role: "clinician", tenantId };
}

function repoDb() {
    return {
        jobs: [],
        printers: [],
        gcode: {} as Record<string, { body: string; sha256: string; storedAt: string }>,
        endpoints: {} as Record<string, string>,
        events: [] as DispatchEvent[],
    };
}

function fakeController(handler: (call: PrinterIoCall) => PrinterIoResult | Promise<PrinterIoResult>): {
    calls: PrinterIoCall[];
    io: PrinterIo;
} {
    const calls: PrinterIoCall[] = [];
    return {
        calls,
        io: {
            async request(call) {
                calls.push(call);
                return handler(call);
            },
        },
    };
}

function deps(io: PrinterIo, gate: "present" | "absent" = "present", now = NOW): DispatchDeps {
    return {
        transport: createContractTransport(io),
        credentialGate: (ref) => (gate === "present" && ref === CRED ? "present" : "absent"),
        now,
    };
}

async function twoPrinters(cancellation: "unsupported" | "explicit" = "unsupported") {
    const db = repoDb();
    const repo = createMemoryProductionRepo(db);
    const me = actor();
    const bayA = await registerConfiguredPrinter(repo, me, {
        name: "Bay A",
        protocolId: LOCAL_BRIDGE_PROTOCOL_ID,
        endpoint: "http://10.0.0.11:4400/",
        credentialRef: CRED,
        cancellation,
    });
    const bayB = await registerConfiguredPrinter(repo, me, {
        name: "Bay B",
        protocolId: LOCAL_BRIDGE_PROTOCOL_ID,
        endpoint: "http://10.0.0.12:4400",
        credentialRef: CRED,
        cancellation: "explicit",
    });
    return { db, repo, me, bayA, bayB };
}

async function enqueueAssigned(repo: ProductionRepo, me: Actor, designId: string, printerId: string) {
    const job = await enqueueJob(
        repo,
        me,
        {
            designId,
            designName: designId,
            designKind: "insole",
            clientId: "c1",
            clientLabel: "JD",
            process: "print",
            gcode: GCODE,
        },
        NOW,
    );
    return assignJob(repo, me, job.id, printerId, NOW);
}

describe("two-printer dispatch seam", () => {
    test("mock registration is not live, and a configured printer stays unverified", async () => {
        const calls: string[] = [];
        const original = globalThis.fetch;
        globalThis.fetch = (async (input: string | URL) => {
            calls.push(String(input));
            throw new Error("printer adapter must not fetch");
        }) as typeof fetch;
        try {
            const { repo, me, bayA } = await twoPrinters();
            const mock = await registerMockPrinter(repo, me, {
                name: "Mock bay",
                moonrakerUrl: "http://127.0.0.1:7125/",
            });
            expect(mock.pairing.mode).toBe("mock-only");
            expect(mock.pairing.liveVerified).toBe(false);
            expect(mock.printer.adapterMode).toBe("mock-only");
            expect(bayA.adapterMode).toBe("configured");
            expect(bayA.liveVerified).toBe(false);
            expect(bayA.protocolVerified).toBe(false);
            expect(bayA.endpointConfigured).toBe(true);
            expect(JSON.stringify(bayA)).not.toContain("10.0.0.11");
            expect(calls).toEqual([]);
            const closed = closedPrinterDispatch();
            await expect(closed.transport.readiness(bayA.id)).rejects.toThrow(/not bound/);
        } finally {
            globalThis.fetch = original;
        }
    });

    test("rejects missing, invalid, and unsupported configuration without a controller call", async () => {
        const db = repoDb();
        const repo = createMemoryProductionRepo(db);
        const me = actor();
        const cases = [
            { protocolId: "moonraker", endpoint: "http://10.0.0.11", credentialRef: CRED },
            { protocolId: "", endpoint: "http://10.0.0.11", credentialRef: CRED },
            { protocolId: "klipper", endpoint: "http://10.0.0.11", credentialRef: CRED },
            { protocolId: LOCAL_BRIDGE_PROTOCOL_ID, endpoint: "", credentialRef: CRED },
            { protocolId: LOCAL_BRIDGE_PROTOCOL_ID, endpoint: "ftp://10.0.0.11", credentialRef: CRED },
            { protocolId: LOCAL_BRIDGE_PROTOCOL_ID, endpoint: "http://10.0.0.11", credentialRef: "" },
            {
                protocolId: LOCAL_BRIDGE_PROTOCOL_ID,
                endpoint: "http://user:s3cret@10.0.0.11",
                credentialRef: CRED,
            },
            {
                protocolId: LOCAL_BRIDGE_PROTOCOL_ID,
                endpoint: "http://10.0.0.11/?token=s3cret",
                credentialRef: CRED,
            },
        ];
        for (const input of cases) {
            let message = "";
            try {
                await registerConfiguredPrinter(repo, me, {
                    name: "Bay",
                    cancellation: "unsupported",
                    ...input,
                });
            } catch (error) {
                message = error instanceof Error ? error.message : "";
            }
            expect(message.length).toBeGreaterThan(0);
            expect(message).not.toContain("s3cret");
            expect(message.toLowerCase()).not.toContain("live verified");
        }
        expect(await repo.listPrinters()).toEqual([]);
    });

    test("two printers route and reconcile independently", async () => {
        const { repo, me, bayA, bayB } = await twoPrinters();
        const fake = fakeController((call) => {
            if (call.operation === "readiness") return { operation: "readiness", ready: true };
            if (call.operation === "dispatch") {
                return {
                    operation: "dispatch",
                    outcome: "acknowledged",
                    controllerJobId: call.printerId === bayA.id ? "ctl-a" : "ctl-b",
                };
            }
            return {
                operation: "status",
                controllerJobId: call.controllerJobId ?? "",
                phase: "printing",
                progress: 25,
            };
        });
        const bound = deps(fake.io);
        await refreshPrinterReadiness(repo, me, bayA.id, bound);
        await refreshPrinterReadiness(repo, me, bayB.id, bound);
        const jobA = await enqueueAssigned(repo, me, "d-a", bayA.id);
        const jobB = await enqueueAssigned(repo, me, "d-b", bayB.id);
        const sentA = await dispatchAssignedJob(repo, me, jobA.id, bound);
        const sentB = await dispatchAssignedJob(repo, me, jobB.id, bound);
        expect(sentA.controllerJobId).toBe("ctl-a");
        expect(sentB.controllerJobId).toBe("ctl-b");
        expect(sentA.printerId).toBe(bayA.id);
        expect(sentB.printerId).toBe(bayB.id);
        expect(sentA.dispatchState).toBe("acknowledged");
        expect(sentB.status).toBe("running");
        const dispatchCalls = fake.calls.filter((call) => call.operation === "dispatch");
        expect(dispatchCalls.map((call) => call.printerId)).toEqual([bayA.id, bayB.id]);
        expect(JSON.stringify(dispatchCalls)).not.toContain("10.0.0.11");
        expect(JSON.stringify(dispatchCalls)).not.toContain("10.0.0.12");
        expect(dispatchCalls[0]?.gcode).toBe(GCODE);
        expect(dispatchCalls[0]?.gcodeSha256).toBe(await sha256Hex(GCODE));
        const extra = await enqueueAssigned(repo, me, "d-a2", bayA.id);
        await expect(dispatchAssignedJob(repo, me, extra.id, bound)).rejects.toThrow(/active job/);
        expect(fake.calls.filter((call) => call.operation === "dispatch")).toHaveLength(2);
    });

    test("process restart reconciles the stored controller id and does not dispatch again", async () => {
        const { db, repo, me, bayA } = await twoPrinters();
        const fake = fakeController((call) => {
            if (call.operation === "readiness") return { operation: "readiness", ready: true };
            if (call.operation === "dispatch") {
                return { operation: "dispatch", outcome: "acknowledged", controllerJobId: "ctl-a" };
            }
            return { operation: "status", controllerJobId: "ctl-a", phase: "printing", progress: 40 };
        });
        const bound = deps(fake.io);
        await refreshPrinterReadiness(repo, me, bayA.id, bound);
        const job = await enqueueAssigned(repo, me, "d1", bayA.id);
        await dispatchAssignedJob(repo, me, job.id, bound);
        const restarted = createMemoryProductionRepo(db);
        expect(restarted).not.toBe(repo);
        const jobs = await reconcilePrinter(restarted, me, bayA.id, bound);
        expect(jobs.find((row) => row.id === job.id)?.controllerJobId).toBe("ctl-a");
        expect(jobs.find((row) => row.id === job.id)?.progress).toBe(40);
        expect(fake.calls.filter((call) => call.operation === "dispatch")).toHaveLength(1);
        expect(
            fake.calls.filter((call) => call.operation === "status").map((call) => call.controllerJobId),
        ).toEqual(["ctl-a"]);
    });

    test("offline, unknown, and stale printers are not sent a job", async () => {
        const { repo, me, bayA } = await twoPrinters();
        const fake = fakeController((call) => {
            if (call.operation === "readiness") return { operation: "readiness", ready: false };
            return { operation: "dispatch", outcome: "acknowledged", controllerJobId: "nope" };
        });
        const bound = deps(fake.io);
        const job = await enqueueAssigned(repo, me, "d1", bayA.id);
        await expect(dispatchAssignedJob(repo, me, job.id, bound)).rejects.toThrow(/not been checked/);
        await refreshPrinterReadiness(repo, me, bayA.id, bound);
        await expect(dispatchAssignedJob(repo, me, job.id, bound)).rejects.toThrow(/offline|stale/);
        await repo.patchPrinter(bayA.id, { state: "idle", lastSeenAt: "2020-01-01T00:00:00.000Z" });
        await expect(dispatchAssignedJob(repo, me, job.id, deps(fake.io, "present", NOW))).rejects.toThrow(
            /stale/,
        );
        expect(fake.calls.filter((call) => call.operation === "dispatch")).toEqual([]);
    });

    test("missing permission, unbound transport, and mock printers do not dispatch", async () => {
        const { repo, me, bayA } = await twoPrinters();
        const fake = fakeController(() => ({ operation: "readiness", ready: true }));
        const job = await enqueueAssigned(repo, me, "d1", bayA.id);
        await expect(dispatchAssignedJob(repo, me, job.id, deps(fake.io, "absent"))).rejects.toThrow(
            /credential/,
        );
        await expect(refreshPrinterReadiness(repo, me, bayA.id, deps(fake.io))).resolves.toMatchObject({
            liveVerified: false,
            state: "idle",
        });
        await expect(dispatchAssignedJob(repo, me, job.id, closedPrinterDispatch())).rejects.toThrow(
            /not bound/,
        );
        const mock = await registerMockPrinter(repo, me, {
            name: "Mock",
            moonrakerUrl: "http://127.0.0.1:7125",
        });
        const mockJob = await enqueueAssigned(repo, me, "d-mock", mock.printer.id);
        await expect(dispatchAssignedJob(repo, me, mockJob.id, deps(fake.io))).rejects.toThrow(
            /Mock printer/,
        );
        expect(fake.calls.filter((call) => call.operation === "dispatch")).toEqual([]);
        expect(mock.printer.liveVerified).toBe(false);
    });

    test("duplicate dispatch, rejected retry, uncertain retry, and timeout do not double-send", async () => {
        const { repo, me, bayA } = await twoPrinters();
        let mode: "ack" | "reject" | "hang" | "empty" | "throw" = "ack";
        let release: () => void = () => undefined;
        const gate = () =>
            new Promise<void>((resolve) => {
                release = resolve;
            });
        let pending: Promise<void> | null = null;
        const fake = fakeController(async (call) => {
            if (call.operation === "readiness") return { operation: "readiness", ready: true };
            if (mode === "reject") {
                throw new PrinterTransportError("refused before start", false);
            }
            if (mode === "throw") throw new Error("timed out after https://10.9.9.9/secret");
            if (mode === "empty")
                return { operation: "dispatch", outcome: "acknowledged", controllerJobId: "  " };
            if (mode === "hang") {
                pending = gate();
                await pending;
            }
            return { operation: "dispatch", outcome: "acknowledged", controllerJobId: "ctl-1" };
        });
        const bound = deps(fake.io);
        await refreshPrinterReadiness(repo, me, bayA.id, bound);
        const job = await enqueueAssigned(repo, me, "d1", bayA.id);
        mode = "hang";
        const first = dispatchAssignedJob(repo, me, job.id, bound);
        const second = dispatchAssignedJob(repo, me, job.id, bound);
        for (
            let i = 0;
            i < 50 && fake.calls.filter((call) => call.operation === "dispatch").length < 1;
            i += 1
        ) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        release();
        const settled = await Promise.allSettled([first, second]);
        expect(settled.filter((row) => row.status === "fulfilled")).toHaveLength(1);
        expect(fake.calls.filter((call) => call.operation === "dispatch")).toHaveLength(1);
        expect((await repo.getJob(job.id))?.controllerJobId).toBe("ctl-1");
        await repo.patchJob(job.id, { status: "done" });

        mode = "reject";
        await repo.patchPrinter(bayA.id, { state: "idle", lastSeenAt: NOW.toISOString() });
        const rejectedJob = await enqueueAssigned(repo, me, "d2", bayA.id);
        const rejected = await dispatchAssignedJob(repo, me, rejectedJob.id, bound);
        expect(rejected.status).toBe("failed");
        expect(rejected.dispatchState).toBe("rejected");
        const retried = await retryJob(repo, me, rejected.id, NOW);
        const reassigned = await assignJob(repo, me, retried.id, bayA.id, NOW);
        mode = "ack";
        const again = await dispatchAssignedJob(repo, me, reassigned.id, bound);
        expect(again.idempotencyKey).not.toBe(rejected.idempotencyKey);
        expect(again.controllerJobId).toBe("ctl-1");
        await repo.patchJob(again.id, { status: "done" });

        mode = "throw";
        await repo.patchPrinter(bayA.id, { state: "idle", lastSeenAt: NOW.toISOString() });
        const timed = await enqueueAssigned(repo, me, "d3", bayA.id);
        const uncertain = await dispatchAssignedJob(repo, me, timed.id, bound);
        expect(uncertain.dispatchState).toBe("uncertain");
        expect(uncertain.controllerJobId).toBeNull();
        expect(uncertain.dispatchError ?? "").not.toContain("10.9.9.9");
        expect(uncertain.dispatchError ?? "").not.toContain("http");
        const before = fake.calls.filter((call) => call.operation === "dispatch").length;
        await expect(dispatchAssignedJob(repo, me, timed.id, bound)).rejects.toThrow(/not be sent again/);
        await expect(retryJob(repo, me, timed.id, NOW)).rejects.toThrow(/not sent again/);
        expect(fake.calls.filter((call) => call.operation === "dispatch")).toHaveLength(before);
        await repo.patchJob(timed.id, { status: "failed", dispatchState: "rejected" });

        mode = "empty";
        await repo.patchPrinter(bayA.id, { state: "idle", lastSeenAt: NOW.toISOString() });
        const partialJob = await enqueueAssigned(repo, me, "d4", bayA.id);
        const partial = await dispatchAssignedJob(repo, me, partialJob.id, bound);
        expect(partial.dispatchState).toBe("uncertain");
        expect(partial.controllerJobId).toBeNull();
        expect(fake.calls.filter((call) => call.operation === "dispatch")).toHaveLength(before + 1);
    });

    test("reconciliation keeps a mismatched controller id and a started job with no id", async () => {
        const { db, repo, me, bayA } = await twoPrinters();
        const fake = fakeController((call) => {
            if (call.operation === "readiness") return { operation: "readiness", ready: true };
            if (call.operation === "dispatch") {
                return { operation: "dispatch", outcome: "acknowledged", controllerJobId: "ctl-kept" };
            }
            return { operation: "status", controllerJobId: "foreign-id", phase: "complete", progress: 100 };
        });
        const bound = deps(fake.io);
        await refreshPrinterReadiness(repo, me, bayA.id, bound);
        const job = await enqueueAssigned(repo, me, "d1", bayA.id);
        await dispatchAssignedJob(repo, me, job.id, bound);
        const reconciled = await reconcilePrinter(repo, me, bayA.id, bound);
        const row = reconciled.find((item) => item.id === job.id);
        expect(row?.controllerJobId).toBe("ctl-kept");
        expect(row?.status).toBe("running");
        expect(row?.dispatchError).toMatch(/did not match/);
        expect(JSON.stringify(await repo.listDispatchEvents(job.id))).not.toContain("foreign-id");

        const crashed = await enqueueAssigned(repo, me, "d2", bayA.id);
        await repo.patchJob(crashed.id, {
            dispatchState: "started",
            controllerJobId: null,
            status: "assigned",
        });
        await repo.patchPrinter(bayA.id, { state: "idle", lastSeenAt: NOW.toISOString() });
        const after = await reconcilePrinter(createMemoryProductionRepo(db), me, bayA.id, bound);
        expect(after.find((item) => item.id === crashed.id)?.dispatchState).toBe("uncertain");
        expect(fake.calls.filter((call) => call.operation === "dispatch")).toHaveLength(1);
        expect(
            fake.calls.filter((call) => call.operation === "status" && call.controllerJobId === "ctl-kept")
                .length,
        ).toBeGreaterThanOrEqual(1);
        expect(fake.calls.some((call) => call.operation === "status" && !call.controllerJobId)).toBe(false);
    });

    test("cancellation is explicit, and a disconnected printer is not retried", async () => {
        const { repo, me, bayA, bayB } = await twoPrinters("unsupported");
        const fake = fakeController((call) => {
            if (call.operation === "readiness")
                return { operation: "readiness", ready: call.printerId === bayB.id };
            if (call.operation === "dispatch") {
                return { operation: "dispatch", outcome: "acknowledged", controllerJobId: "ctl-b" };
            }
            if (call.operation === "cancel") return { operation: "cancel", outcome: "cancelled" };
            return { operation: "status", controllerJobId: "ctl-b", phase: "printing", progress: 5 };
        });
        const bound = deps(fake.io);
        await refreshPrinterReadiness(repo, me, bayB.id, bound);
        const job = await enqueueAssigned(repo, me, "d-b", bayB.id);
        const sent = await dispatchAssignedJob(repo, me, job.id, bound);
        await expect(cancelJob(repo, me, sent.id, NOW)).rejects.toThrow(/refused/);
        expect((await repo.getJob(sent.id))?.status).toBe("running");
        const unsupported = await enqueueAssigned(repo, me, "d-a", bayA.id);
        await repo.patchJob(unsupported.id, {
            dispatchState: "acknowledged",
            controllerJobId: "ctl-a",
            status: "running",
            printerId: bayA.id,
        });
        await expect(cancelDispatchedPrint(repo, me, unsupported.id, bound)).rejects.toThrow(
            /does not support/,
        );
        const cancelled = await cancelDispatchedPrint(repo, me, sent.id, bound);
        expect(cancelled.status).toBe("cancelled");
        expect(fake.calls.filter((call) => call.operation === "cancel")).toHaveLength(1);

        const uncertain = await enqueueAssigned(repo, me, "d-u", bayB.id);
        await repo.patchJob(uncertain.id, {
            dispatchState: "uncertain",
            controllerJobId: null,
            status: "assigned",
        });
        await expect(cancelDispatchedPrint(repo, me, uncertain.id, bound)).rejects.toThrow(/unknown/);
        expect(fake.calls.filter((call) => call.operation === "cancel")).toHaveLength(1);
        await repo.patchJob(uncertain.id, { status: "cancelled", dispatchState: "rejected" });

        await repo.patchPrinter(bayB.id, { state: "idle", lastSeenAt: NOW.toISOString() });
        const open = await enqueueAssigned(repo, me, "d-open", bayB.id);
        await dispatchAssignedJob(repo, me, open.id, bound);
        const offline = fakeController(() => {
            throw new Error("socket closed");
        });
        const after = await reconcilePrinter(repo, me, bayB.id, deps(offline.io));
        expect(after.find((item) => item.id === open.id)?.controllerJobId).toBeTruthy();
        expect(after.find((item) => item.id === open.id)?.dispatchError).toMatch(/disconnected/);
        expect(offline.calls.filter((call) => call.operation === "dispatch")).toEqual([]);
    });

    test("another tenant and a mill job are refused, and a missing ledger writes nothing", async () => {
        const { repo, me, bayA } = await twoPrinters();
        const fake = fakeController(() => ({ operation: "readiness", ready: true }));
        const job = await enqueueAssigned(repo, me, "d1", bayA.id);
        await expect(
            dispatchAssignedJob(repo, actor(OTHER, "user-2"), job.id, deps(fake.io)),
        ).rejects.toMatchObject({
            code: "NOT_FOUND",
        });
        const mill = await enqueueJob(repo, me, {
            designId: "mill",
            designName: "Mill",
            designKind: "insole",
            clientId: "c1",
            clientLabel: "JD",
            process: "mill",
            gcode: GCODE,
        });
        await expect(dispatchAssignedJob(repo, me, mill.id, deps(fake.io))).rejects.toThrow(/Mill/);
        const blocked = createMemoryProductionRepo(repoDb());
        const refusing: ProductionRepo = {
            ...blocked,
            async insertConfiguredPrinter() {
                throw new ProductionError("BAD_REQUEST", DISPATCH_LEDGER_UNAVAILABLE);
            },
        };
        await expect(
            registerConfiguredPrinter(refusing, me, {
                name: "Bay C",
                protocolId: LOCAL_BRIDGE_PROTOCOL_ID,
                endpoint: "http://10.0.0.13:4400",
                credentialRef: CRED,
                cancellation: "unsupported",
            }),
        ).rejects.toThrow(/not applied/);
        expect(await blocked.listPrinters()).toEqual([]);
        expect(fake.calls).toEqual([]);
    });

    test("the dispatch ledger review depends on the foundation migration and is not auto-applied", () => {
        const root = process.cwd();
        const foundation = readFileSync(
            join(root, "vertex/prisma/migrations/20261101170000_production_jobs/migration.sql"),
            "utf8",
        );
        const review = readFileSync(
            join(root, "vertex/src/features/production/dispatch-ledger.review.sql"),
            "utf8",
        );
        const schema = readFileSync(join(root, "vertex/prisma/schema.prisma"), "utf8");
        const migrations = readdirSync(join(root, "vertex/prisma/migrations"));
        expect(foundation).toContain('CREATE TABLE IF NOT EXISTS "shop_jobs"');
        expect(foundation).toContain('CREATE TABLE IF NOT EXISTS "shop_printers"');
        expect(foundation).toContain('CREATE TABLE IF NOT EXISTS "job_gcode"');
        expect(foundation).toContain("Do not apply this file to production");
        expect(review).toContain('REFERENCES "shop_jobs"');
        expect(review).toContain('REFERENCES "shop_printers"');
        expect(review).toContain("DO NOT APPLY");
        expect(review).toContain("prisma/migrations");
        expect(review).not.toContain("ALTER TYPE");
        expect(schema).toContain("model ShopDispatchRecord");
        expect(migrations).not.toContain("dispatch-ledger.review.sql");
        expect(migrations.some((name) => name.includes("dispatch_ledger"))).toBe(false);
    });
});
