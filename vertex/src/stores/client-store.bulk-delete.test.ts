// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";

rs.mock("@/lib/phi-policy", () => ({
    storePhiEnabled: () => false,
}));

rs.mock("@/stores/auth-store", () => ({
    useAuthStore: {
        getState: () => ({ user: { id: "user-1", fullName: "Clinician" } }),
    },
}));

const { useClientStore } = await import("./client-store");

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

describe("client-store bulk delete", () => {
    beforeEach(() => {
        useClientStore.setState({
            clients: [],
            designs: [design("d1", "One"), design("d2", "Two"), design("d3", "Three")],
            activeClientId: null,
            activeDesignId: "d2",
        });
    });

    test("softDeleteDesign returns false for missing or already deleted rows", () => {
        const store = useClientStore.getState();
        expect(store.softDeleteDesign("missing")).toBe(false);
        expect(store.softDeleteDesign("d1")).toBe(true);
        expect(store.softDeleteDesign("d1")).toBe(false);
    });

    test("softDeleteDesigns deletes each id via the single-delete path", () => {
        const { failedIds } = useClientStore.getState().softDeleteDesigns(["d1", "d3"]);
        expect(failedIds).toEqual([]);
        const rows = useClientStore.getState().designs;
        expect(rows.find((row) => row.id === "d1")?.deletedAt).not.toBeNull();
        expect(rows.find((row) => row.id === "d2")?.deletedAt).toBeNull();
        expect(rows.find((row) => row.id === "d3")?.deletedAt).not.toBeNull();
        expect(useClientStore.getState().activeDesignId).toBe("d2");
    });

    test("softDeleteDesigns reports ids that could not be deleted", () => {
        const { failedIds } = useClientStore.getState().softDeleteDesigns(["d1", "ghost", "d1"]);
        expect(failedIds).toEqual(["ghost", "d1"]);
        expect(useClientStore.getState().designs.find((row) => row.id === "d1")?.deletedAt).not.toBeNull();
    });
});
