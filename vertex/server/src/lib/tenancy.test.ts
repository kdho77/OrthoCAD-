// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    type Actor,
    archiveClientFile,
    type ClientFileError,
    createClientFile,
    createDesignFile,
    createMemoryClientFileRepo,
    defaultShoeChart,
    getClientFile,
    getDesignFile,
    softDeleteDesignFile,
    updateClientFile,
    updateDesignMeta,
} from "../../../shared/client-files";
import {
    createMemoryScanRepo,
    deleteClientScan,
    getClientScan,
    updateClientScan,
    uploadClientScan,
} from "../../../shared/client-scans";
import { createHandoffStore } from "../../../shared/external-handoff";
import {
    cancelJob,
    createMemoryProductionRepo,
    downloadGcode,
    enqueueJob,
    getProductionJob,
    holdJob,
} from "../../../shared/production-jobs";
import { gcodeRetentionLabel, scanRetentionLabel } from "../../../shared/retention";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function actor(role: string, tenantId: string | null, id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"): Actor {
    return { id, email: `${role}@example.com`, role, tenantId };
}

describe("tenant isolation by id", () => {
    test("another tenant cannot fetch, update, or delete a client, design, scan, or job", async () => {
        const files = createMemoryClientFileRepo({ clients: [], designs: [], exports: [], audits: [] });
        const owner = actor("clinician", OTHER, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        const stranger = actor("clinician", ORG);
        const { client } = await createClientFile(files, owner, {
            displayName: "Hidden",
            firstName: "Hid",
            lastName: "Den",
            reference: "REF-9",
            ...defaultShoeChart(),
        });
        const design = await createDesignFile(files, owner, {
            clientId: client.id,
            name: "Insole",
            kind: "insole",
        });
        const scans = createMemoryScanRepo({ scans: [], blobs: {} });
        const scan = await uploadClientScan(scans, owner, {
            client,
            side: "left",
            fileName: "left.stl",
            contentType: "model/stl",
            bytes: new Uint8Array([1, 2, 3]),
        });
        const jobs = createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} });
        const job = await enqueueJob(jobs, owner, {
            designId: design.id,
            designName: "Insole",
            designKind: "insole",
            clientId: client.id,
            clientLabel: "HD",
            process: "mill",
            gcode: "G0 X0\n",
        });

        await expect(getClientFile(files, stranger, client.id)).rejects.toMatchObject({
            code: "NOT_FOUND",
        } satisfies Partial<ClientFileError>);
        await expect(
            updateClientFile(files, stranger, client.id, { reference: "NOPE" }),
        ).rejects.toMatchObject({
            code: "NOT_FOUND",
        });
        await expect(archiveClientFile(files, stranger, client.id)).rejects.toMatchObject({
            code: "NOT_FOUND",
        });

        await expect(getDesignFile(files, stranger, design.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(updateDesignMeta(files, stranger, design.id, { name: "NOPE" })).rejects.toMatchObject({
            code: "NOT_FOUND",
        });
        await expect(softDeleteDesignFile(files, stranger, design.id)).rejects.toMatchObject({
            code: "NOT_FOUND",
        });

        await expect(getClientScan(scans, stranger, scan.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
            updateClientScan(scans, stranger, scan.id, { fileName: "nope.stl" }),
        ).rejects.toMatchObject({
            code: "NOT_FOUND",
        });
        await expect(deleteClientScan(scans, stranger, scan.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

        await expect(getProductionJob(jobs, stranger, job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(holdJob(jobs, stranger, job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(cancelJob(jobs, stranger, job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(downloadGcode(jobs, stranger, job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

        expect((await files.getClient(client.id))?.reference).toBe("REF-9");
        expect((await files.getDesign(design.id))?.deletedAt).toBeNull();
        expect((await scans.getMeta(scan.id))?.fileName).toBe("left.stl");
        expect((await jobs.getJob(job.id))?.status).toBe("waiting");
    });

    test("super admin can fetch, update, and delete another tenant's records", async () => {
        const files = createMemoryClientFileRepo({ clients: [], designs: [], exports: [], audits: [] });
        const owner = actor("clinician", OTHER, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        const root = actor("super_admin", null, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
        const { client } = await createClientFile(files, owner, {
            displayName: "Visible",
            firstName: "Vis",
            lastName: "Ible",
            reference: "REF-1",
            ...defaultShoeChart(),
        });
        const design = await createDesignFile(files, owner, {
            clientId: client.id,
            name: "Insole",
            kind: "insole",
        });
        const scans = createMemoryScanRepo({ scans: [], blobs: {} });
        const scan = await uploadClientScan(scans, owner, {
            client,
            side: "right",
            fileName: "right.stl",
            contentType: "model/stl",
            bytes: new Uint8Array([4]),
        });
        const jobs = createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} });
        const job = await enqueueJob(jobs, owner, {
            designId: design.id,
            designName: "Insole",
            designKind: "insole",
            clientId: client.id,
            clientLabel: "VI",
            process: "print",
            gcode: "G0 X0\n",
        });

        expect((await getClientFile(files, root, client.id)).reference).toBe("REF-1");
        expect((await updateClientFile(files, root, client.id, { reference: "REF-2" })).reference).toBe(
            "REF-2",
        );
        expect((await getDesignFile(files, root, design.id)).name).toBe("Insole");
        expect((await updateDesignMeta(files, root, design.id, { name: "Renamed" })).name).toBe("Renamed");
        expect((await getClientScan(scans, root, scan.id)).fileName).toBe("right.stl");
        expect((await updateClientScan(scans, root, scan.id, { fileName: "renamed.stl" })).fileName).toBe(
            "renamed.stl",
        );
        expect((await getProductionJob(jobs, root, job.id)).status).toBe("waiting");
        expect((await holdJob(jobs, root, job.id)).status).toBe("held");
        const file = await downloadGcode(jobs, root, job.id);
        expect(file.gcode).toBe("G0 X0\n");

        await deleteClientScan(scans, root, scan.id);
        await softDeleteDesignFile(files, root, design.id);
        await cancelJob(jobs, root, job.id);
        expect(await scans.getMeta(scan.id)).toBeNull();
        expect((await files.getDesign(design.id))?.deletedAt).toBeTruthy();
        expect((await jobs.getJob(job.id))?.status).toBe("cancelled");
    });
});

describe("retention labels and handoff", () => {
    test("scans count three 365-day years and g-code counts 90 days", () => {
        const now = new Date("2026-11-01T00:00:00.000Z");
        expect(scanRetentionLabel(now.toISOString(), now)).toBe("Removed in 1095 days");
        const stored = new Date(now.getTime() - 67 * 24 * 60 * 60 * 1000).toISOString();
        expect(gcodeRetentionLabel(stored, false, now)).toBe("Removed in 23 days");
        expect(gcodeRetentionLabel(stored, true, now)).toBe("Kept while the order is open");
        const almost = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000).toISOString();
        expect(gcodeRetentionLabel(almost, false, now)).toBe("Removed in 1 day");
    });

    test("an external handoff token is single-use and has no route of its own", () => {
        const store = createHandoffStore();
        const token = store.issue({
            externalOrderId: "ext-1",
            client: {
                displayName: "A B",
                reference: "C-1",
                shoeSizeUs: 9,
                shoeWidth: "medium",
                shoeSizesSplit: false,
                shoeSizeLeftUs: 9,
                shoeSizeRightUs: 9,
            },
            scans: [{ side: "left", fileName: "left.stl", sha256: "abc" }],
        });
        expect(store.consume(token)?.client.reference).toBe("C-1");
        expect(store.consume(token)).toBeNull();
    });
});
