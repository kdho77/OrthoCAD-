// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import { type ClientRow, type DesignRow, defaultShoeChart } from "../../shared/client-files";

const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DESIGN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let apiConfigured = true;
const listQuery = rs.fn();

rs.mock("@/lib/trpc", () => ({
    isApiConfigured: () => apiConfigured,
    trpc: {
        client: {
            list: {
                query: (...args: unknown[]) => listQuery(...args),
            },
        },
        design: {
            save: {
                mutate: async () => ({ ok: true }),
            },
        },
    },
}));

rs.mock("@/lib/phi-policy", () => ({
    storePhiEnabled: () => false,
}));

rs.mock("@/stores/auth-store", () => ({
    useAuthStore: {
        getState: () => ({ user: { id: "user-1", fullName: "Clinician" }, loading: false }),
    },
}));

const { isDirectoryUnresolved, resetClientDirectoryLoad, useClientStore } = await import("./client-store");

function clientRow(id = CLIENT_ID, displayName = "Jane Doe"): ClientRow {
    return {
        id,
        ownerId: "user-1",
        tenantId: null,
        displayName,
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

function designRow(
    id = DESIGN_ID,
    clientId = CLIENT_ID,
    kind: DesignRow["kind"] = "insole",
    name = "Insole 1",
): DesignRow {
    return {
        id,
        clientId,
        ownerId: "user-1",
        name,
        kind,
        notes: "session note",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        hasExport: false,
    };
}

describe("client directory load", () => {
    beforeEach(() => {
        apiConfigured = true;
        listQuery.mockReset();
        resetClientDirectoryLoad();
    });

    test("an id is unresolved only while the directory can still load it", () => {
        expect(isDirectoryUnresolved(true, "idle")).toBe(false);
        expect(isDirectoryUnresolved(false, "idle")).toBe(true);
        expect(isDirectoryUnresolved(false, "loading")).toBe(true);
        expect(isDirectoryUnresolved(false, "ready")).toBe(false);
        apiConfigured = false;
        expect(isDirectoryUnresolved(false, "idle")).toBe(false);
    });

    test("loads a missing client and design from client.list once", async () => {
        listQuery.mockResolvedValue([{ client: clientRow(), designs: [designRow()] }]);
        await useClientStore.getState().loadDirectory();
        await useClientStore.getState().loadDirectory();
        expect(listQuery).toHaveBeenCalledTimes(1);
        expect(useClientStore.getState().directoryStatus).toBe("ready");
        expect(useClientStore.getState().clients.map((client) => client.id)).toEqual([CLIENT_ID]);
        expect(useClientStore.getState().designs.map((design) => design.id)).toEqual([DESIGN_ID]);
        expect(useClientStore.getState().designs[0]?.name).toBe("Insole 1");
        expect(useClientStore.getState().designs[0]?.state).toBeTruthy();
    });

    test("shares one in-flight list fetch", async () => {
        let resolveList: (items: { client: ClientRow; designs: DesignRow[] }[]) => void = () => undefined;
        listQuery.mockReturnValue(
            new Promise((resolve) => {
                resolveList = resolve;
            }),
        );
        const first = useClientStore.getState().loadDirectory();
        const second = useClientStore.getState().loadDirectory();
        expect(useClientStore.getState().directoryStatus).toBe("loading");
        expect(listQuery).toHaveBeenCalledTimes(1);
        resolveList([{ client: clientRow(), designs: [designRow()] }]);
        await Promise.all([first, second]);
        expect(listQuery).toHaveBeenCalledTimes(1);
        expect(useClientStore.getState().clients).toHaveLength(1);
    });

    test("does not fetch again after the directory is already in the store", async () => {
        useClientStore.getState().replaceDirectory([clientRow()], []);
        listQuery.mockClear();
        await useClientStore.getState().loadDirectory();
        expect(listQuery).not.toHaveBeenCalled();
        expect(useClientStore.getState().clients[0]?.displayName).toBe("Jane Doe");
    });

    test("keeps design state already in the store when the list returns the same id", async () => {
        const state = createDesignWithStockPlaceholder();
        useClientStore.setState({
            designs: [{ ...designRow(), notes: "", state }],
        });
        listQuery.mockResolvedValue([{ client: clientRow(), designs: [designRow()] }]);
        await useClientStore.getState().loadDirectory();
        expect(useClientStore.getState().designs[0]?.state).toBe(state);
        expect(listQuery).toHaveBeenCalledTimes(1);
    });

    test("settles when the list fails so a missing id can be reported", async () => {
        listQuery.mockRejectedValue(new Error("offline"));
        await useClientStore.getState().loadDirectory();
        expect(useClientStore.getState().directoryStatus).toBe("ready");
        expect(useClientStore.getState().clients).toEqual([]);
        expect(useClientStore.getState().designs).toEqual([]);
    });

    test("does not call the API when it is not configured", async () => {
        apiConfigured = false;
        await useClientStore.getState().loadDirectory();
        expect(listQuery).not.toHaveBeenCalled();
        expect(useClientStore.getState().directoryStatus).toBe("ready");
    });
});
