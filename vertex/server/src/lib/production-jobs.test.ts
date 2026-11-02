// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import type { Actor } from "../../../shared/client-files";
import {
    assignJob,
    cancelJob,
    createMemoryProductionRepo,
    downloadGcode,
    enqueueJob,
    holdJob,
    isGcodeRetained,
    markJobDone,
    type PrinterRecord,
    printerCards,
    queryHistory,
    queryQueue,
    rerunJob,
    retryJob,
    sha256Hex,
} from "../../../shared/production-jobs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const GCODE = "G0 X0\n";
const GCODE_SHA = "fd144cf6c28aa7c4fc8b24403de03a989b319e9d8a54a1feb25f18afa3ad6fa3";

function actor(role: string, tenantId: string | null, id = "user-1"): Actor {
    return { id, email: "op@example.com", role, tenantId };
}

function empty() {
    return createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} });
}

function printer(tenantId: string | null = ORG): PrinterRecord {
    return { id: "printer-1", name: "Bay 1", state: "idle", tenantId, ownerId: "user-1" };
}

describe("production jobs", () => {
    test("sha256 matches the stored G-code and queue defaults to due date", async () => {
        expect(await sha256Hex(GCODE)).toBe(GCODE_SHA);
        const repo = empty();
        const me = actor("clinician", ORG);
        const later = await enqueueJob(repo, me, {
            designId: "d1",
            designName: "Insole A",
            designKind: "insole",
            clientId: "c1",
            clientLabel: "JD",
            process: "print",
            dueAt: "2026-12-02T00:00:00.000Z",
            gcode: GCODE,
        });
        const sooner = await enqueueJob(repo, me, {
            designId: "d2",
            designName: "AFO B",
            designKind: "afo",
            clientId: "c2",
            clientLabel: "AM",
            process: "mill",
            dueAt: "2026-11-02T00:00:00.000Z",
            orderNumber: "VO-100",
            orderUrl: "https://orders.example.com/VO-100",
            orderOpen: true,
            gcode: GCODE,
        });
        const undated = await enqueueJob(repo, me, {
            designId: "d3",
            designName: "Insole C",
            designKind: "insole",
            clientId: "c3",
            clientLabel: "KL",
            process: "print",
            gcode: GCODE,
        });
        const jobs = await repo.listJobs();
        expect(queryQueue(jobs).map((job) => job.id)).toEqual([sooner.id, later.id, undated.id]);
        expect(
            queryQueue(jobs, { q: "vo-100", status: "any", process: "any", due: "any", dir: "asc" }),
        ).toEqual([sooner]);
        expect(queryQueue(jobs, { q: "", status: "any", process: "mill", due: "any", dir: "asc" })).toEqual([
            sooner,
        ]);
        expect(later.gcodeSha256).toBe(GCODE_SHA);
        expect((await repo.getGcode(later.id))?.body).toBe(GCODE);
    });

    test("filters due date and keeps failed jobs on the queue", async () => {
        const repo = empty();
        const me = actor("clinician", ORG);
        const now = new Date("2026-11-01T12:00:00.000Z");
        const overdue = await enqueueJob(
            repo,
            me,
            {
                designId: "d1",
                designName: "Late",
                designKind: "insole",
                clientId: "c1",
                clientLabel: "JD",
                process: "print",
                dueAt: "2026-10-01T00:00:00.000Z",
                gcode: GCODE,
            },
            now,
        );
        await repo.patchJob(overdue.id, { status: "failed", failureReason: "Filament jam" });
        const jobs = await repo.listJobs();
        const queue = queryQueue(
            jobs,
            { q: "", status: "failed", process: "print", due: "overdue", dir: "asc" },
            now,
        );
        expect(queue.map((job) => job.id)).toEqual([overdue.id]);
        expect(queue[0]?.failureReason).toBe("Filament jam");
    });

    test("print assign, hold, and cancel stay in the org", async () => {
        const local = createMemoryProductionRepo({ jobs: [], printers: [printer()], gcode: {} });
        const me = actor("clinician", ORG);
        const job = await enqueueJob(local, me, {
            designId: "d1",
            designName: "Insole",
            designKind: "insole",
            clientId: "c1",
            clientLabel: "JD",
            process: "print",
            gcode: GCODE,
        });
        const mill = await enqueueJob(local, me, {
            designId: "d2",
            designName: "Pair",
            designKind: "insole",
            clientId: "c1",
            clientLabel: "JD",
            process: "mill",
            gcode: GCODE,
        });
        await expect(assignJob(local, me, mill.id, "printer-1")).rejects.toMatchObject({
            code: "BAD_REQUEST",
        });
        const assigned = await assignJob(local, me, job.id, "printer-1");
        expect(assigned.status).toBe("assigned");
        expect(assigned.printerName).toBe("Bay 1");
        const held = await holdJob(local, me, job.id);
        expect(
            queryQueue(await local.listJobs()).some((row) => row.id === held.id && row.status === "held"),
        ).toBe(true);
        const cancelled = await cancelJob(local, me, job.id);
        expect(cancelled.status).toBe("cancelled");
        expect(queryHistory(await local.listJobs()).some((row) => row.id === job.id)).toBe(true);
        await expect(holdJob(local, actor("clinician", OTHER, "user-2"), mill.id)).rejects.toMatchObject({
            code: "NOT_FOUND",
        });
        expect(await holdJob(local, actor("super_admin", null, "root"), mill.id)).toMatchObject({
            status: "held",
        });
    });

    test("retry keeps the same G-code and mill mark-done leaves the queue", async () => {
        const local = createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} });
        const me = actor("clinician", ORG);
        const failed = await enqueueJob(local, me, {
            designId: "d1",
            designName: "Insole",
            designKind: "insole",
            clientId: "c1",
            clientLabel: "JD",
            process: "print",
            gcode: GCODE,
        });
        await local.patchJob(failed.id, { status: "failed", failureReason: "Out of filament" });
        const retried = await retryJob(local, me, failed.id);
        expect(retried.status).toBe("waiting");
        expect(retried.failureReason).toBeNull();
        expect(retried.gcodeSha256).toBe(GCODE_SHA);
        expect((await local.getGcode(failed.id))?.body).toBe(GCODE);

        const mill = await enqueueJob(local, me, {
            designId: "d2",
            designName: "Pair",
            designKind: "insole",
            clientId: "c1",
            clientLabel: "JD",
            process: "mill",
            gcode: `${GCODE}G1 X1\n`,
        });
        const started = new Date("2026-11-01T10:00:00.000Z");
        await local.patchJob(mill.id, { startedAt: started.toISOString() });
        const done = await markJobDone(local, me, mill.id, new Date("2026-11-01T11:30:00.000Z"));
        expect(done.status).toBe("done");
        expect(done.durationMs).toBe(90 * 60 * 1000);
        expect(done.operatorName).toBe("op@example.com");
        expect(queryQueue(await local.listJobs()).some((row) => row.id === mill.id)).toBe(false);
        expect(
            queryHistory(await local.listJobs(), { outcome: "done", from: "2026-11-01", to: "2026-11-01" }),
        ).toEqual([done]);
        const file = await downloadGcode(local, me, mill.id);
        expect(file.gcode).toBe(`${GCODE}G1 X1\n`);
        expect(file.filename).toBe(`LR-${mill.id}.gcode`);
    });

    test("re-run queues the same stored G-code and refuses an expired file", async () => {
        const local = createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} });
        const me = actor("clinician", ORG);
        const storedAt = new Date("2026-01-01T00:00:00.000Z");
        const job = await enqueueJob(
            local,
            me,
            {
                designId: "d1",
                designName: "Pair",
                designKind: "insole",
                clientId: "c1",
                clientLabel: "JD",
                process: "mill",
                orderOpen: false,
                gcode: GCODE,
            },
            storedAt,
        );
        await local.patchJob(job.id, { status: "done", finishedAt: storedAt.toISOString() });
        const copy = await rerunJob(local, me, job.id, new Date("2026-02-01T00:00:00.000Z"));
        expect(copy.id).not.toBe(job.id);
        expect(copy.status).toBe("waiting");
        expect(copy.gcodeSha256).toBe(job.gcodeSha256);
        expect((await local.getGcode(copy.id))?.body).toBe(GCODE);
        expect((await local.getGcode(job.id))?.body).toBe(GCODE);

        await expect(rerunJob(local, me, job.id, new Date("2026-06-01T00:00:00.000Z"))).rejects.toThrow(
            /expired/,
        );
        expect(await local.getGcode(job.id)).toBeNull();
        expect((await local.listJobs()).filter((row) => row.designId === "d1")).toHaveLength(2);
    });

    test("an open order keeps G-code past 90 days", () => {
        const stored = "2026-01-01T00:00:00.000Z";
        const day120 = new Date("2026-05-01T00:00:00.000Z");
        expect(isGcodeRetained(stored, true, day120)).toBe(true);
        expect(isGcodeRetained(stored, false, new Date("2026-03-01T00:00:00.000Z"))).toBe(true);
        expect(isGcodeRetained(stored, false, day120)).toBe(false);
    });

    test("printer cards show state, current job, and next job only", async () => {
        const local = createMemoryProductionRepo({
            jobs: [],
            printers: [printer(), { ...printer(), id: "printer-2", name: "Bay 2", state: "offline" }],
            gcode: {},
        });
        const me = actor("clinician", ORG);
        const running = await enqueueJob(local, me, {
            designId: "d1",
            designName: "Current",
            designKind: "insole",
            clientId: "c1",
            clientLabel: "JD",
            process: "print",
            gcode: GCODE,
        });
        await local.patchJob(running.id, {
            status: "running",
            printerId: "printer-1",
            printerName: "Bay 1",
            progress: 40,
        });
        const next = await enqueueJob(local, me, {
            designId: "d2",
            designName: "Next",
            designKind: "insole",
            clientId: "c1",
            clientLabel: "JD",
            process: "print",
            dueAt: "2026-11-03T00:00:00.000Z",
            gcode: GCODE,
        });
        await local.patchJob(next.id, { status: "assigned", printerId: "printer-1", printerName: "Bay 1" });
        const cards = printerCards(await local.listPrinters(), await local.listJobs());
        expect(cards[0]?.current?.designName).toBe("Current");
        expect(cards[0]?.progress).toBe(40);
        expect(cards[0]?.next?.designName).toBe("Next");
        expect(cards[1]?.printer.state).toBe("offline");
        expect(cards[1]?.current).toBeNull();
        const repoKeys = Object.keys(local);
        expect(repoKeys.some((key) => /command|slice|start|home/i.test(key))).toBe(false);
    });
});
