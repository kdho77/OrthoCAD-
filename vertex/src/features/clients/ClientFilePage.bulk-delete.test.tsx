// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAuthStore } from "@/stores/auth-store";
import { type DesignRecord, resetClientDirectoryLoad, useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { UserProfile } from "@/types";
import { type ClientRow, defaultShoeChart } from "../../../shared/client-files";
import { ClientFilePage } from "./ClientFilePage";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const navigate = rs.fn();

rs.mock("@/features/admin/admin-nav", () => ({
    navigate: (...args: unknown[]) => navigate(...args),
    useLocationPath: () => `/clients/${CLIENT_ID}`,
    showSuperAdminLink: () => false,
}));

rs.mock("@/lib/trpc", () => ({
    isApiConfigured: () => false,
    trpc: {
        client: {
            policy: { query: async () => ({ storePhi: false }) },
        },
    },
}));

rs.mock("@/lib/phi-policy", () => ({
    storePhiEnabled: () => false,
}));

const clinician: UserProfile = {
    id: "user-1",
    email: "clinician@example.com",
    fullName: "Clinician",
    role: "clinician",
    tokenBalance: 10,
};

function clientRow(): ClientRow {
    return {
        id: CLIENT_ID,
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

function designRecord(id: string, name: string): DesignRecord {
    return {
        id,
        clientId: CLIENT_ID,
        ownerId: "user-1",
        name,
        kind: "insole",
        notes: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        hasExport: false,
        state: createDesignWithStockPlaceholder(),
    };
}

describe("ClientFilePage bulk delete", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    beforeEach(() => {
        navigate.mockReset();
        resetClientDirectoryLoad();
        useAuthStore.setState({ user: clinician, license: null, loading: false });
        useClientStore
            .getState()
            .replaceDirectory(
                [clientRow()],
                [designRecord("d1", "Alpha"), designRecord("d2", "Beta"), designRecord("d3", "Gamma")],
            );
        window.history.replaceState(null, "", `/clients/${CLIENT_ID}`);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(async () => {
        await act(async () => {
            root?.unmount();
        });
        root = null;
        container.remove();
        resetClientDirectoryLoad();
        useAuthStore.setState({ user: null, license: null, loading: true });
    });

    async function renderPage() {
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(ClientFilePage, { clientId: CLIENT_ID }));
        });
    }

    function deleteSelectedButton(): HTMLButtonElement {
        const button = container.querySelector('[data-testid="delete-selected"]');
        expect(button).toBeTruthy();
        return button as HTMLButtonElement;
    }

    function dialogButton(testId: string): HTMLButtonElement {
        const button = document.querySelector(`[data-testid="${testId}"]`);
        expect(button).toBeTruthy();
        return button as HTMLButtonElement;
    }

    test("Delete selected is disabled until rows are checked", async () => {
        await renderPage();
        expect(deleteSelectedButton().disabled).toBe(true);
        const row = container.querySelector('[data-testid="design-select-d1"]') as HTMLInputElement;
        await act(async () => {
            row.click();
        });
        expect(deleteSelectedButton().disabled).toBe(false);
        expect(deleteSelectedButton().textContent).toContain("Delete selected (1)");
    });

    test("select-all toggles every visible row", async () => {
        await renderPage();
        const selectAll = container.querySelector('[data-testid="designs-select-all"]') as HTMLInputElement;
        await act(async () => {
            selectAll.click();
        });
        expect(selectAll.checked).toBe(true);
        for (const id of ["d1", "d2", "d3"]) {
            const box = container.querySelector(`[data-testid="design-select-${id}"]`) as HTMLInputElement;
            expect(box.checked).toBe(true);
        }
        expect(deleteSelectedButton().textContent).toContain("Delete selected (3)");
        await act(async () => {
            selectAll.click();
        });
        expect(selectAll.checked).toBe(false);
        for (const id of ["d1", "d2", "d3"]) {
            const box = container.querySelector(`[data-testid="design-select-${id}"]`) as HTMLInputElement;
            expect(box.checked).toBe(false);
        }
    });

    test("confirm dialog lists the selection count and delete removes only those designs", async () => {
        await renderPage();
        const d1 = container.querySelector('[data-testid="design-select-d1"]') as HTMLInputElement;
        const d2 = container.querySelector('[data-testid="design-select-d2"]') as HTMLInputElement;
        await act(async () => {
            d1.click();
            d2.click();
        });
        await act(async () => {
            deleteSelectedButton().click();
        });
        expect(document.body.textContent).toContain("Delete 2 designs?");
        await act(async () => {
            dialogButton("bulk-delete-confirm").click();
        });
        const rows = useClientStore.getState().designs;
        expect(rows.find((row) => row.id === "d1")?.deletedAt).not.toBeNull();
        expect(rows.find((row) => row.id === "d2")?.deletedAt).not.toBeNull();
        expect(rows.find((row) => row.id === "d3")?.deletedAt).toBeNull();
        expect(deleteSelectedButton().disabled).toBe(true);
        expect(container.textContent).not.toContain("Alpha");
        expect(container.textContent).not.toContain("Beta");
        expect(container.textContent).toContain("Gamma");
    });

    test("cancel closes the dialog without deleting", async () => {
        await renderPage();
        await act(async () => {
            (container.querySelector('[data-testid="design-select-d1"]') as HTMLInputElement).click();
        });
        await act(async () => {
            deleteSelectedButton().click();
        });
        await act(async () => {
            dialogButton("bulk-delete-cancel").click();
        });
        expect(useClientStore.getState().designs.every((row) => row.deletedAt === null)).toBe(true);
    });

    test("checkbox click does not open the design", async () => {
        await renderPage();
        await act(async () => {
            (container.querySelector('[data-testid="design-select-d1"]') as HTMLInputElement).click();
        });
        expect(navigate).not.toHaveBeenCalled();
    });

    test("partial failure keeps failed rows selected and lists them", async () => {
        const original = useClientStore.getState().softDeleteDesigns;
        const spy = rs.fn((ids: string[]) => {
            const failedIds = ids.filter((id) => id === "d2");
            const ok = ids.filter((id) => id !== "d2");
            if (ok.length > 0) original(ok);
            return { failedIds };
        });
        useClientStore.setState({
            softDeleteDesigns: spy as typeof original,
        });
        await renderPage();
        await act(async () => {
            (container.querySelector('[data-testid="design-select-d1"]') as HTMLInputElement).click();
            (container.querySelector('[data-testid="design-select-d2"]') as HTMLInputElement).click();
        });
        await act(async () => {
            deleteSelectedButton().click();
        });
        await act(async () => {
            dialogButton("bulk-delete-confirm").click();
        });
        expect(container.querySelector('[data-testid="bulk-delete-errors"]')?.textContent).toContain("Beta");
        const d2 = container.querySelector('[data-testid="design-select-d2"]') as HTMLInputElement;
        expect(d2.checked).toBe(true);
        const d1 = container.querySelector('[data-testid="design-select-d1"]');
        expect(d1).toBeNull();
        useClientStore.setState({ softDeleteDesigns: original });
    });
});
