// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import { type ClientRow, defaultShoeChart } from "../../shared/client-files";

const mockDelete = rs.fn(async (_input: { id: string }) => ({ ok: true as const }));
const mockList = rs.fn(async () => [] as { client: ClientRow; designs: ReturnType<typeof design>[] }[]);
let apiConfigured = true;

rs.mock("@/lib/trpc", () => ({
    isApiConfigured: () => apiConfigured,
    trpc: {
        design: {
            delete: { mutate: (input: { id: string }) => mockDelete(input) },
            save: { mutate: async () => ({ ok: true }) },
        },
        client: {
            list: { query: () => mockList() },
        },
    },
}));

rs.mock("@/lib/phi-policy", () => ({
    storePhiEnabled: () => false,
}));

rs.mock("@/stores/auth-store", () => ({
    useAuthStore: {
        getState: () => ({ user: { id: "user-1", fullName: "Clinician" } }),
    },
}));

const { resetClientDirectoryLoad, useClientStore } = await import("./client-store");

function design(id: string, name: string) {
    return {
        id,
        clientId: "client-1",
        ownerId: "user-1",
        name,
        kind: "insole" as const,
        notes: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        hasExport: false,
        state: createDesignWithStockPlaceholder(),
    };
}

function clientRow(): ClientRow {
    return {
        id: "client-1",
        ownerId: "user-1",
        tenantId: null,
        displayName: "Jane Doe",
        firstName: "Jane",
        lastName: "Doe",
        reference: null,
        orderedBy: null,
        dateOfBirth: null,
        mrn: null,
        email: null,
        phone: null,
        notes: null,
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...defaultShoeChart(),
    };
}

describe("client-store bulk delete", () => {
    beforeEach(() => {
        apiConfigured = true;
        mockDelete.mockReset();
        mockDelete.mockResolvedValue({ ok: true });
        mockList.mockReset();
        resetClientDirectoryLoad();
        useClientStore.setState({
            clients: [clientRow()],
            designs: [design("d1", "One"), design("d2", "Two"), design("d3", "Three")],
            activeClientId: "client-1",
            activeDesignId: "d2",
            directoryStatus: "ready",
        });
    });

    test("softDeleteDesign returns false for missing or already deleted rows", async () => {
        const store = useClientStore.getState();
        expect(await store.softDeleteDesign("missing")).toBe(false);
        expect(await store.softDeleteDesign("d1")).toBe(true);
        expect(await useClientStore.getState().softDeleteDesign("d1")).toBe(false);
    });

    test("softDeleteDesigns deletes each id via the single-delete path", async () => {
        const { failedIds } = await useClientStore.getState().softDeleteDesigns(["d1", "d3"]);
        expect(failedIds).toEqual([]);
        const rows = useClientStore.getState().designs;
        expect(rows.find((row) => row.id === "d1")?.deletedAt).not.toBeNull();
        expect(rows.find((row) => row.id === "d2")?.deletedAt).toBeNull();
        expect(rows.find((row) => row.id === "d3")?.deletedAt).not.toBeNull();
        expect(useClientStore.getState().activeDesignId).toBe("d2");
    });

    test("softDeleteDesigns reports ids that could not be deleted", async () => {
        const { failedIds } = await useClientStore.getState().softDeleteDesigns(["d1", "ghost", "d1"]);
        expect(failedIds).toEqual(["ghost", "d1"]);
        expect(useClientStore.getState().designs.find((row) => row.id === "d1")?.deletedAt).not.toBeNull();
    });

    test("deleted designs stay gone after the client file is reloaded", async () => {
        const server = [design("d1", "One"), design("d2", "Two"), design("d3", "Three")];
        mockDelete.mockImplementation(async (input: { id: string }) => {
            const row = server.find((item) => item.id === input.id);
            if (!row) throw new Error("Design not found");
            row.deletedAt = "2026-11-28T00:00:00.000Z";
            return { ok: true };
        });
        const { failedIds } = await useClientStore.getState().softDeleteDesigns(["d1", "d3"]);
        expect(failedIds).toEqual([]);
        expect(mockDelete.mock.calls.map((call) => call[0]?.id).sort()).toEqual(["d1", "d3"]);

        resetClientDirectoryLoad();
        mockList.mockResolvedValue([
            {
                client: clientRow(),
                designs: server.filter((row) => row.deletedAt === null),
            },
        ]);
        await useClientStore.getState().loadDirectory();
        expect(useClientStore.getState().designs.map((row) => row.id)).toEqual(["d2"]);
    });

    test("a reload drops a design the server already marked deleted", async () => {
        resetClientDirectoryLoad();
        mockList.mockResolvedValue([
            {
                client: clientRow(),
                designs: [
                    design("d1", "One"),
                    { ...design("d2", "Two"), deletedAt: "2026-11-28T00:00:00.000Z" },
                ],
            },
        ]);
        await useClientStore.getState().loadDirectory();
        expect(useClientStore.getState().designs.map((row) => row.id)).toEqual(["d1"]);
    });

    test("bulk delete awaits every design and leaves a rejected id in place", async () => {
        const order: string[] = [];
        mockDelete.mockImplementation(async (input: { id: string }) => {
            order.push(input.id);
            if (input.id === "d2") throw new Error("delete rejected");
            return { ok: true };
        });
        const { failedIds } = await useClientStore.getState().softDeleteDesigns(["d1", "d2", "d3"]);
        expect(order).toEqual(["d1", "d2", "d3"]);
        expect(failedIds).toEqual(["d2"]);
        const rows = useClientStore.getState().designs;
        expect(rows.find((row) => row.id === "d1")?.deletedAt).not.toBeNull();
        expect(rows.find((row) => row.id === "d2")?.deletedAt).toBeNull();
        expect(rows.find((row) => row.id === "d3")?.deletedAt).not.toBeNull();
    });
});
