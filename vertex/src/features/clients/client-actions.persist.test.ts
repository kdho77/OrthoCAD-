// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { useClientNoticeStore } from "@/stores/client-notice-store";
import { useClientStore } from "@/stores/client-store";
import type { DesignDocument } from "./design-document";

const mockDesignGet = rs.fn<() => Promise<DesignDocument>>();
const mockScanList = rs.fn<() => Promise<unknown[]>>();
const mockScanGet = rs.fn<() => Promise<unknown>>();
const mockScanDownload = rs.fn<() => Promise<{ bytesBase64: string }>>();
const mockClientCreate = rs.fn<() => Promise<{ client: { id: string } }>>();

rs.mock("@/lib/trpc", () => ({
    isApiConfigured: () => true,
    trpc: {
        design: {
            get: { query: (...args: unknown[]) => mockDesignGet(...args) },
        },
        scan: {
            list: { query: (...args: unknown[]) => mockScanList(...args) },
            get: { query: (...args: unknown[]) => mockScanGet(...args) },
            download: { query: (...args: unknown[]) => mockScanDownload(...args) },
        },
        client: {
            create: { mutate: (...args: unknown[]) => mockClientCreate(...args) },
        },
    },
}));

rs.mock("@/lib/phi-policy", () => ({
    storePhiEnabled: () => false,
}));

const { hydrateDesignForEditor, createClientRecord } = await import("./client-actions");

describe("client-actions persistence wiring", () => {
    beforeEach(() => {
        mockDesignGet.mockReset();
        mockScanList.mockReset();
        mockScanGet.mockReset();
        mockScanDownload.mockReset();
        mockClientCreate.mockReset();
        useClientNoticeStore.setState({ error: null });
        useClientStore.setState({ clients: [], designs: [], activeClientId: null, activeDesignId: null });
        mockScanList.mockResolvedValue([
            {
                id: "scan-1",
                clientId: "client-1",
                ownerId: "user-1",
                tenantId: null,
                side: "left",
                fileName: "foot.stl",
                contentType: "model/stl",
                byteLength: 3,
                sha256: "abc",
                uploadedAt: "2026-01-01T00:00:00.000Z",
                retentionLabel: "3 years",
            },
        ]);
        mockScanGet.mockResolvedValue({});
        mockScanDownload.mockResolvedValue({ bytesBase64: btoa("stl") });
    });

    test("hydrateDesignForEditor loads persisted geometry from design.get", async () => {
        const doc: DesignDocument = {
            id: "design-1",
            pattern: "full_contact",
            method: "printing_solid",
            thicknessMm: 3,
            linked: true,
            unit: "mm",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            corrections: [
                {
                    side: "left",
                    forefootPostingDeg: 0,
                    rearfootPostingDeg: 0,
                    medialSkiveMm: 0,
                    lateralSkiveMm: 0,
                    archFillMm: 0,
                    archHeightMm: 5,
                    heelCupDepthMm: 0,
                    heelCupHeightMm: 0,
                    apexMoveMm: 0,
                    medialFlangeMm: 0,
                    lateralFlangeMm: 0,
                },
            ],
            elements: [],
        };
        mockDesignGet.mockResolvedValue(doc);
        const { createDesignWithStockPlaceholder } = await import("@/stores/design-store");
        const session = createDesignWithStockPlaceholder();
        const loaded = await hydrateDesignForEditor("client-1", "design-1", session);
        expect(mockDesignGet).toHaveBeenCalledWith({ id: "design-1" });
        expect(mockScanList).toHaveBeenCalledWith({ clientId: "client-1" });
        expect(loaded.corrections.left.archHeightMm).toBe(5);
        expect(loaded.thicknessMm).toBe(3);
    });

    test("createClientRecord shows an error instead of keeping a tab-only client", async () => {
        mockClientCreate.mockRejectedValue(new Error("Server refused"));
        await expect(
            createClientRecord({
                firstName: "Ada",
                lastName: "Lovelace",
                reference: "ref",
            }),
        ).rejects.toThrow("Server refused");
        expect(useClientStore.getState().clients).toHaveLength(0);
        expect(useClientNoticeStore.getState().error).toBe("Server refused");
    });
});
