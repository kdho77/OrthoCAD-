// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { useClientNoticeStore } from "@/stores/client-notice-store";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";

const mockSave = rs.fn<() => Promise<{ ok: true }>>();

rs.mock("@/lib/trpc", () => ({
    isApiConfigured: () => true,
    trpc: {
        design: {
            save: {
                mutate: (...args: unknown[]) => mockSave(...args),
            },
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

const { useClientStore } = await import("./client-store");

describe("client-store saveDesign persistence", () => {
    beforeEach(() => {
        mockSave.mockReset();
        useClientNoticeStore.setState({ error: null });
        useClientStore.setState({
            clients: [],
            designs: [
                {
                    id: "design-1",
                    clientId: "client-1",
                    ownerId: "user-1",
                    name: "Insole 1",
                    kind: "insole",
                    notes: "",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                    archivedAt: null,
                    deletedAt: null,
                    hasExport: false,
                    state: createDesignWithStockPlaceholder(),
                },
            ],
            activeClientId: null,
            activeDesignId: null,
        });
    });

    test("calls trpc.design.save with geometry and updates local state on success", async () => {
        mockSave.mockResolvedValue({ ok: true });
        const state = createDesignWithStockPlaceholder();
        state.elements = [
            {
                kind: "met_pad",
                side: "left",
                position: { x: 0, y: 0 },
                rotationDeg: 0,
                scale: { x: 1, y: 1 },
                heightMm: 4,
            },
        ];
        await useClientStore.getState().saveDesign("design-1", state);
        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(mockSave.mock.calls[0]?.[0]).toMatchObject({
            id: "design-1",
            name: "Insole 1",
            state,
        });
        expect(useClientStore.getState().designs[0]?.state.elements).toHaveLength(1);
    });

    test("surfaces an error and leaves local geometry unchanged when save rejects", async () => {
        mockSave.mockRejectedValue(new Error("Network down"));
        const before = useClientStore.getState().designs[0]?.state;
        await expect(
            useClientStore.getState().saveDesign("design-1", createDesignWithStockPlaceholder()),
        ).rejects.toThrow("Network down");
        expect(useClientNoticeStore.getState().error).toBe("Network down");
        expect(useClientStore.getState().designs[0]?.state).toBe(before);
    });
});
