// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    type Actor,
    archiveClientFile,
    CLINICAL_DOCUMENT_TITLE,
    type ClientRow,
    canRestoreDesign,
    clientMatchesQuery,
    clinicalDocumentTitle,
    commitNotes,
    createClientFile,
    createDesignFile,
    createMemoryClientFileRepo,
    defaultClientListQuery,
    defaultShoeChart,
    duplicateDesignFile,
    editNotes,
    findDuplicateClients,
    formatClientName,
    hardDeleteClientFile,
    inactivityPhase,
    listClientFiles,
    type MemoryDb,
    parseClientListQuery,
    parseStorePhiFlag,
    planOrphanAttachment,
    queryClientList,
    restoreClientFile,
    restoreDeletedDesign,
    revertNotes,
    serializeClientListQuery,
    softDeleteDesignFile,
    updateClientFile,
    updateDesignMeta,
} from "../../../shared/client-files.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function actor(role: string, tenantId: string | null, id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"): Actor {
    return { id, email: `${role}@example.com`, role, tenantId };
}

function emptyDb(): MemoryDb {
    return { clients: [], designs: [], exports: [], audits: [] };
}

function client(partial: Partial<ClientRow> & Pick<ClientRow, "id" | "ownerId" | "tenantId">): ClientRow {
    return {
        displayName: "",
        firstName: "Ada",
        lastName: "Lovelace",
        dateOfBirth: "1990-01-02",
        reference: null,
        orderedBy: null,
        mrn: null,
        email: null,
        phone: null,
        notes: null,
        ...defaultShoeChart(),
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        ...partial,
    };
}

describe("client file API", () => {
    test("unassigned clinician cannot read another org, super admin can", async () => {
        const db = emptyDb();
        db.clients.push(
            client({
                id: "c1",
                ownerId: "other-user",
                tenantId: OTHER,
                firstName: "Grace",
                lastName: "Hopper",
            }),
        );
        const repo = createMemoryClientFileRepo(db);
        const hidden = await listClientFiles(repo, actor("clinician", ORG));
        expect(hidden).toHaveLength(0);
        const seen = await listClientFiles(repo, actor("super_admin", null));
        expect(seen).toHaveLength(1);
        expect(seen[0]?.client.lastName).toBe("Hopper");
    });

    test("create, update, archive, restore stay in the actor org", async () => {
        const db = emptyDb();
        const repo = createMemoryClientFileRepo(db);
        const me = actor("clinician", ORG);
        const { client: created, duplicates } = await createClientFile(
            repo,
            me,
            {
                firstName: "Jane",
                lastName: "Doe",
                dateOfBirth: "1980-05-04",
                reference: "MRN-1",
                ...defaultShoeChart(),
            },
            { storePhi: true },
        );
        expect(duplicates).toHaveLength(0);
        expect(created.tenantId).toBe(ORG);
        expect(created.ownerId).toBe(me.id);
        const updated = await updateClientFile(
            repo,
            me,
            created.id,
            { reference: "MRN-2" },
            { storePhi: true },
        );
        expect(updated.reference).toBe("MRN-2");
        const archived = await archiveClientFile(repo, me, created.id);
        expect(archived.archivedAt).toBeTruthy();
        const restored = await restoreClientFile(repo, me, created.id);
        expect(restored.archivedAt).toBeNull();
        expect(db.audits.map((entry) => entry.action)).toEqual([
            "client_created",
            "client_updated",
            "client_archived",
            "client_restored",
        ]);
    });

    test("duplicate name and DOB warns and still creates", async () => {
        const db = emptyDb();
        const repo = createMemoryClientFileRepo(db);
        const me = actor("clinician", ORG);
        await createClientFile(
            repo,
            me,
            {
                firstName: "Jane",
                lastName: "Doe",
                dateOfBirth: "1980-05-04",
                reference: "A-1",
                ...defaultShoeChart(),
            },
            { storePhi: true },
        );
        const again = await createClientFile(
            repo,
            me,
            {
                firstName: " jane ",
                lastName: "DOE",
                dateOfBirth: "1980-05-04",
                reference: "A-2",
                ...defaultShoeChart(),
            },
            { storePhi: true },
        );
        expect(again.duplicates).toHaveLength(1);
        expect(db.clients).toHaveLength(2);
        expect(
            findDuplicateClients(db.clients, { firstName: "Jane", lastName: "Doe", dateOfBirth: null }),
        ).toHaveLength(0);
    });

    test("hard delete is admin-only and refused while any design remains", async () => {
        const db = emptyDb();
        const repo = createMemoryClientFileRepo(db);
        const clinician = actor("clinician", ORG);
        const admin = actor("admin", ORG, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        const { client: created } = await createClientFile(repo, clinician, {
            firstName: "Jane",
            lastName: "Doe",
            reference: "REF-1",
            ...defaultShoeChart(),
        });
        await expect(hardDeleteClientFile(repo, clinician, created.id)).rejects.toMatchObject({
            code: "FORBIDDEN",
        });
        await createDesignFile(repo, clinician, {
            clientId: created.id,
            name: "Insole · L/R · Oct 31",
            kind: "insole",
        });
        await expect(hardDeleteClientFile(repo, admin, created.id)).rejects.toMatchObject({
            code: "BAD_REQUEST",
        });
        db.designs = [];
        await hardDeleteClientFile(repo, admin, created.id);
        expect(db.clients).toHaveLength(0);
        expect(db.audits.some((entry) => entry.action === "client_deleted")).toBe(true);
    });

    test("design soft-delete keeps the row, audits, and restores for 30 days", async () => {
        const db = emptyDb();
        const repo = createMemoryClientFileRepo(db);
        const me = actor("admin", ORG);
        const { client: created } = await createClientFile(repo, me, {
            firstName: "Jane",
            lastName: "Doe",
            reference: "REF-1",
            ...defaultShoeChart(),
        });
        const design = await createDesignFile(repo, me, {
            clientId: created.id,
            name: "Insole · L/R · Oct 31",
            kind: "insole",
        });
        db.exports.push({ id: "ex1", designId: design.id });
        const deletedAt = new Date("2026-10-01T00:00:00.000Z");
        const removed = await softDeleteDesignFile(repo, me, design.id, deletedAt);
        expect(removed.deletedAt).toBe(deletedAt.toISOString());
        expect(db.designs).toHaveLength(1);
        expect(removed.createdAt).toBe(design.createdAt);
        expect(
            db.audits.some((entry) => entry.action === "design_deleted" && entry.targetId === design.id),
        ).toBe(true);
        const restored = await restoreDeletedDesign(
            repo,
            me,
            design.id,
            new Date("2026-10-15T00:00:00.000Z"),
        );
        expect(restored.deletedAt).toBeNull();
        await softDeleteDesignFile(repo, me, design.id, deletedAt);
        await expect(restoreDeletedDesign(repo, actor("clinician", ORG), design.id)).rejects.toMatchObject({
            code: "FORBIDDEN",
        });
        await expect(
            restoreDeletedDesign(repo, me, design.id, new Date("2026-12-01T00:00:00.000Z")),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect(
            canRestoreDesign(deletedAt.toISOString(), new Date("2026-10-31T00:00:00.000Z").getTime()),
        ).toBe(true);
        expect(
            canRestoreDesign(deletedAt.toISOString(), new Date("2026-12-01T00:00:00.000Z").getTime()),
        ).toBe(false);
    });

    test("notes autosave commits on blur and escape reverts", async () => {
        const db = emptyDb();
        const repo = createMemoryClientFileRepo(db);
        const me = actor("clinician", ORG);
        const { client: created } = await createClientFile(repo, me, {
            firstName: "Jane",
            lastName: "Doe",
            reference: "REF-1",
            ...defaultShoeChart(),
        });
        const design = await createDesignFile(repo, me, {
            clientId: created.id,
            name: "Insole",
            kind: "insole",
        });
        let draft = { saved: design.notes, draft: design.notes };
        draft = editNotes(draft, "Heel pain");
        draft = revertNotes(draft);
        expect(draft.draft).toBe("");
        draft = editNotes(draft, `${"x".repeat(600)}`);
        expect(draft.draft).toHaveLength(500);
        draft = commitNotes(draft);
        const saved = await updateDesignMeta(repo, me, design.id, { notes: draft.saved }, { storePhi: true });
        expect(saved.notes).toHaveLength(500);
        expect(db.audits.some((entry) => entry.action === "design_updated")).toBe(true);
    });

    test("STORE_PHI defaults off and drops DOB, MRN, contact, and clinical notes", async () => {
        expect(parseStorePhiFlag(undefined)).toBe(false);
        expect(parseStorePhiFlag("true")).toBe(true);
        const db = emptyDb();
        const repo = createMemoryClientFileRepo(db);
        const me = actor("clinician", ORG);
        const { client: created } = await createClientFile(repo, me, {
            displayName: "JD",
            firstName: "",
            lastName: "",
            reference: "C-1",
            dateOfBirth: "1980-05-04",
            mrn: "MRN-9",
            email: "a@example.com",
            phone: "555",
            notes: "heel pain",
            ...defaultShoeChart(),
        });
        expect(created.displayName).toBe("JD");
        expect(created.reference).toBe("C-1");
        expect(created.dateOfBirth).toBeNull();
        expect(created.mrn).toBeNull();
        expect(created.email).toBeNull();
        expect(created.phone).toBeNull();
        expect(created.notes).toBeNull();
        const listed = await listClientFiles(repo, me);
        expect(listed[0]?.client.dateOfBirth).toBeNull();
        const design = await createDesignFile(repo, me, {
            clientId: created.id,
            name: "Insole",
            kind: "insole",
        });
        const saved = await updateDesignMeta(repo, me, design.id, { notes: "heel pain" });
        expect(saved.notes).toBe("");
        await expect(
            createClientFile(repo, me, {
                displayName: "JD",
                firstName: "",
                lastName: "",
                reference: "",
                ...defaultShoeChart(),
            }),
        ).resolves.toMatchObject({
            client: expect.objectContaining({ displayName: "JD", reference: null }),
        });
    });

    test("create requires an explicit shoe size", async () => {
        const repo = createMemoryClientFileRepo(emptyDb());
        const me = actor("clinician", ORG);
        await expect(
            createClientFile(repo, me, {
                displayName: "Sized",
                firstName: "",
                lastName: "",
                reference: "R-1",
                shoeSizeUs: undefined,
            }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        const { client } = await createClientFile(repo, me, {
            displayName: "Sized",
            firstName: "",
            lastName: "",
            reference: "R-1",
            shoeSizeUs: 11,
            shoeWidth: "wide",
        });
        expect(client.shoeSizeUs).toBe(11);
        expect(client.shoeWidth).toBe("wide");
    });

    test("create defaults ordered by to the tenant account name", async () => {
        const repo = createMemoryClientFileRepo(emptyDb());
        const me = { ...actor("clinician", ORG), tenantName: "Apex Clinic" };
        const { client } = await createClientFile(repo, me, {
            displayName: "Buyer",
            firstName: "",
            lastName: "",
            reference: "B-1",
            ...defaultShoeChart(),
        });
        expect(client.orderedBy).toBe("Apex Clinic");
    });

    test("list search and sort include ordered by", () => {
        const items = [
            {
                client: {
                    ...client({
                        id: "c1",
                        ownerId: "u1",
                        tenantId: ORG,
                        displayName: "Alpha",
                        firstName: "A",
                        lastName: "One",
                    }),
                    orderedBy: "Zulu Account",
                },
                designs: [],
            },
            {
                client: {
                    ...client({
                        id: "c2",
                        ownerId: "u1",
                        tenantId: ORG,
                        displayName: "Beta",
                        firstName: "B",
                        lastName: "Two",
                    }),
                    orderedBy: "Alpha Account",
                },
                designs: [],
            },
        ];
        expect(queryClientList(items, { ...defaultClientListQuery(), q: "zulu" }).total).toBe(1);
        const sorted = queryClientList(items, {
            ...defaultClientListQuery(),
            sort: "orderedBy",
            dir: "asc",
        });
        expect(sorted.rows[0]?.client.orderedBy).toBe("Alpha Account");
    });

    test("duplicate design is named Copy of and does not block", async () => {
        const db = emptyDb();
        const repo = createMemoryClientFileRepo(db);
        const me = actor("clinician", ORG);
        const { client: created } = await createClientFile(repo, me, {
            firstName: "Jane",
            lastName: "Doe",
            reference: "REF-1",
            ...defaultShoeChart(),
        });
        const design = await createDesignFile(repo, me, {
            clientId: created.id,
            name: "Insole · L/R · Oct 31",
            kind: "afo",
        });
        const copy = await duplicateDesignFile(repo, me, design.id);
        expect(copy.name).toBe("Copy of Insole · L/R · Oct 31");
        expect(copy.kind).toBe("afo");
        expect(copy.id).not.toBe(design.id);
        expect(db.designs).toHaveLength(2);
    });

    test("orphan migration keeps dates, sets insole, and uses one client per org", () => {
        const plan = planOrphanAttachment({
            now: "2026-11-01T00:00:00.000Z",
            clientIds: ["keep"],
            owners: [
                { userId: "u1", tenantId: ORG },
                { userId: "u2", tenantId: ORG },
                { userId: "u3", tenantId: null },
                { userId: "u4", tenantId: null },
            ],
            designs: [
                {
                    id: "kept",
                    ownerId: "u1",
                    clientId: "keep",
                    createdAt: "2020-01-01T00:00:00.000Z",
                    updatedAt: "2020-02-01T00:00:00.000Z",
                },
                {
                    id: "o1",
                    ownerId: "u1",
                    clientId: "missing",
                    createdAt: "2024-03-01T00:00:00.000Z",
                    updatedAt: "2024-04-01T00:00:00.000Z",
                },
                {
                    id: "o2",
                    ownerId: "u2",
                    clientId: null,
                    createdAt: "2024-05-01T00:00:00.000Z",
                    updatedAt: "2024-06-01T00:00:00.000Z",
                },
                {
                    id: "o3",
                    ownerId: "u3",
                    clientId: null,
                    createdAt: "2021-01-01T00:00:00.000Z",
                    updatedAt: "2021-01-02T00:00:00.000Z",
                },
                {
                    id: "o4",
                    ownerId: "u4",
                    clientId: null,
                    createdAt: "2021-07-01T00:00:00.000Z",
                    updatedAt: "2021-07-02T00:00:00.000Z",
                },
            ],
            newId: (() => {
                let n = 0;
                return () => `new-${n++}`;
            })(),
        });
        expect(plan.designUpdates.find((row) => row.id === "kept")).toBeUndefined();
        expect(plan.clients.filter((row) => row.tenantId === ORG)).toHaveLength(1);
        expect(plan.clients.filter((row) => row.tenantId === null)).toHaveLength(2);
        const moved = plan.designUpdates.find((row) => row.id === "o1");
        expect(moved?.kind).toBe("insole");
        expect(moved?.createdAt).toBe("2024-03-01T00:00:00.000Z");
        expect(moved?.updatedAt).toBe("2024-04-01T00:00:00.000Z");
        expect(formatClientName({ firstName: "", lastName: "Unassigned" })).toBe("Unassigned");
        expect(plan.designUpdates).toHaveLength(4);
    });
});

describe("client list query and PHI chrome", () => {
    test("search, sort, and filter round-trip in the query string", () => {
        const parsed = parseClientListQuery("?q=doe&filter=afo&sort=name&dir=asc&page=2");
        expect(parsed).toEqual({ q: "doe", filter: "afo", sort: "name", dir: "asc", page: 2 });
        expect(serializeClientListQuery(parsed)).toBe("?q=doe&filter=afo&sort=name&dir=asc&page=2");
        expect(clinicalDocumentTitle()).toBe(CLINICAL_DOCUMENT_TITLE);
        expect(clinicalDocumentTitle().includes("Doe")).toBe(false);
    });

    test("archived clients stay out of All, and search matches name, id, and DOB", () => {
        const items = [
            {
                client: client({
                    id: "1",
                    ownerId: "u",
                    tenantId: ORG,
                    firstName: "Jane",
                    lastName: "Doe",
                    reference: "MRN-9",
                    dateOfBirth: "1980-05-04",
                    updatedAt: "2026-10-01T00:00:00.000Z",
                }),
                designs: [],
            },
            {
                client: client({
                    id: "2",
                    ownerId: "u",
                    tenantId: ORG,
                    firstName: "Alan",
                    lastName: "Turing",
                    archivedAt: "2026-01-01T00:00:00.000Z",
                }),
                designs: [],
            },
        ];
        const all = queryClientList(items, { q: "", filter: "all", sort: "modified", dir: "desc", page: 1 });
        expect(all.rows.map((row) => row.client.id)).toEqual(["1"]);
        const archived = queryClientList(items, {
            q: "",
            filter: "archived",
            sort: "name",
            dir: "asc",
            page: 1,
        });
        expect(archived.rows).toHaveLength(1);
        expect(clientMatchesQuery(items[0]!, "mrn-9")).toBe(true);
        expect(clientMatchesQuery(items[0]!, "1980-05-04")).toBe(true);
        expect(clientMatchesQuery(items[0]!, "doe, jane")).toBe(true);
    });

    test("inactivity warning is the minute before logout", () => {
        expect(inactivityPhase(IDLE_WARNING_MS_LOCAL - 1)).toBe("active");
        expect(inactivityPhase(14 * 60 * 1000)).toBe("warning");
        expect(inactivityPhase(15 * 60 * 1000)).toBe("logout");
    });
});

const IDLE_WARNING_MS_LOCAL = 14 * 60 * 1000;
