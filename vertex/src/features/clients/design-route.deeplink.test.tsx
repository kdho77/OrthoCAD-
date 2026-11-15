// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CadApp } from "@/App";
import { saveDesignWorkflowSession } from "@/features/clients/design-workflow-session";
import { useAuthStore } from "@/stores/auth-store";
import { resetClientDirectoryLoad, useClientStore } from "@/stores/client-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { UserProfile } from "@/types";
import {
    type ClientRow,
    type DesignKind,
    type DesignRow,
    defaultShoeChart,
} from "../../../shared/client-files";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DESIGN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_DESIGN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SESSION_MESSAGE = "This design is not in the current session.";

const listQuery = rs.fn();
const designGet = rs.fn();

rs.mock("@/lib/trpc", () => ({
    isApiConfigured: () => true,
    trpc: {
        client: {
            list: { query: (...args: unknown[]) => listQuery(...args) },
            policy: { query: async () => ({ storePhi: false }) },
        },
        design: {
            get: { query: (...args: unknown[]) => designGet(...args) },
            save: { mutate: async () => ({ ok: true }) },
        },
        scan: {
            list: { query: async () => [] },
        },
    },
}));

rs.mock("@/lib/phi-policy", () => ({
    storePhiEnabled: () => false,
}));

rs.mock("@/components/viewer/Viewer3D", () => ({
    Viewer3D: () => createElement("div", { "data-testid": "viewer" }, "viewer"),
}));

rs.mock("@/components/layout/RightPanel", () => ({
    RightPanel: () => createElement("div", { "data-testid": "right-panel" }),
}));

rs.mock("@/features/mill/MillTableView", () => ({
    MillTableView: () => null,
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

function designRow(id: string, kind: DesignKind, name: string): DesignRow {
    return {
        id,
        clientId: CLIENT_ID,
        ownerId: "user-1",
        name,
        kind,
        notes: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        hasExport: false,
    };
}

function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function designName(): string {
    return (container.querySelector('[aria-label="Design name"]') as HTMLInputElement | null)?.value ?? "";
}

let container: HTMLDivElement;

describe("design deep link", () => {
    let root: Root | null = null;

    beforeEach(() => {
        listQuery.mockReset();
        designGet.mockReset();
        designGet.mockResolvedValue({
            id: DESIGN_ID,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        resetClientDirectoryLoad();
        useAuthStore.setState({ user: clinician, license: null, loading: false });
        useDesignStore.setState({ pendingSessionDesign: null });
        localStorage.removeItem("vertex-design-session");
        localStorage.removeItem("vertex-design-workflow");
        useClinicalWorkflowStore.setState({
            productType: "insole",
            step: "scan",
            designStartPath: null,
            completedSteps: [],
            footSideExplicitlyChosen: false,
        });
        window.history.replaceState(null, "", `/clients/${CLIENT_ID}/designs/${DESIGN_ID}`);
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

    async function renderDesign() {
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(CadApp, { clientId: CLIENT_ID, designId: DESIGN_ID }));
        });
    }

    test("empty store then list load opens the insole instead of the session message", async () => {
        const pending = deferred<{ client: ClientRow; designs: DesignRow[] }[]>();
        listQuery.mockReturnValue(pending.promise);
        await renderDesign();
        expect(container.textContent).toContain("Loading…");
        expect(container.textContent).not.toContain(SESSION_MESSAGE);
        expect(container.querySelector('[data-testid="viewer"]')).toBeNull();

        await act(async () => {
            pending.resolve([{ client: clientRow(), designs: [designRow(DESIGN_ID, "insole", "Insole 1")] }]);
            await pending.promise;
        });

        expect(listQuery).toHaveBeenCalledTimes(1);
        expect(designGet).toHaveBeenCalledTimes(1);
        expect(container.textContent).not.toContain(SESSION_MESSAGE);
        expect(container.textContent).not.toContain("Loading…");
        expect(container.querySelector('[data-testid="viewer"]')).not.toBeNull();
        expect(designName()).toBe("Insole 1");
        expect(container.querySelector('[data-testid="breadcrumb-client"]')?.textContent).toContain(
            "Jane Doe",
        );
    });

    test("empty store then list load opens the AFO editor instead of the session message", async () => {
        const pending = deferred<{ client: ClientRow; designs: DesignRow[] }[]>();
        listQuery.mockReturnValue(pending.promise);
        await renderDesign();
        expect(container.textContent).not.toContain(SESSION_MESSAGE);

        await act(async () => {
            pending.resolve([{ client: clientRow(), designs: [designRow(DESIGN_ID, "afo", "AFO 1")] }]);
            await pending.promise;
        });

        expect(listQuery).toHaveBeenCalledTimes(1);
        expect(designGet).not.toHaveBeenCalled();
        expect(container.textContent).not.toContain("AFO editor coming soon");
        expect(container.textContent).toContain("Cast");
        expect(container.textContent).not.toContain(SESSION_MESSAGE);
        expect(designName()).toBe("AFO 1");
        expect(container.querySelector('[data-testid="viewer"]')).not.toBeNull();
    });

    test("a missing design shows the session message only after the list settles", async () => {
        const pending = deferred<{ client: ClientRow; designs: DesignRow[] }[]>();
        listQuery.mockReturnValue(pending.promise);
        await renderDesign();
        expect(container.textContent).toContain("Loading…");
        expect(container.textContent).not.toContain(SESSION_MESSAGE);

        await act(async () => {
            pending.resolve([
                { client: clientRow(), designs: [designRow(OTHER_DESIGN_ID, "insole", "Other")] },
            ]);
            await pending.promise;
        });

        expect(container.textContent).toContain(SESSION_MESSAGE);
        expect(container.textContent).not.toContain("AFO editor coming soon");
        expect(container.querySelector('[data-testid="viewer"]')).toBeNull();
        expect(designGet).not.toHaveBeenCalled();
    });

    test("a design already in the store skips the list fetch and opens the editor", async () => {
        useClientStore.setState({
            clients: [clientRow()],
            designs: [
                {
                    ...designRow(DESIGN_ID, "insole", "Insole 1"),
                    state: createDesignWithStockPlaceholder(),
                },
            ],
            directoryStatus: "idle",
        });
        await renderDesign();
        expect(listQuery).not.toHaveBeenCalled();
        expect(container.textContent).not.toContain("Loading…");
        expect(container.textContent).not.toContain(SESSION_MESSAGE);
        expect(container.querySelector('[data-testid="viewer"]')).not.toBeNull();
        expect(designName()).toBe("Insole 1");
        expect(container.querySelector('[data-testid="breadcrumb-client"]')?.textContent).toContain(
            "Jane Doe",
        );
        expect(designGet).toHaveBeenCalledTimes(1);
    });

    test("an AFO already in the store skips the list fetch and opens the editor", async () => {
        useClientStore.setState({
            clients: [clientRow()],
            designs: [
                {
                    ...designRow(DESIGN_ID, "afo", "AFO 1"),
                    state: createDesignWithStockPlaceholder(),
                },
            ],
            directoryStatus: "idle",
        });
        await renderDesign();
        expect(listQuery).not.toHaveBeenCalled();
        expect(designGet).not.toHaveBeenCalled();
        expect(container.textContent).not.toContain("Loading…");
        expect(container.textContent).not.toContain(SESSION_MESSAGE);
        expect(container.textContent).not.toContain("AFO editor coming soon");
        expect(container.textContent).toContain("Cast");
        expect(container.querySelector('[data-testid="viewer"]')).not.toBeNull();
        expect(designName()).toBe("AFO 1");
    });

    test("reopening without entry restores the saved clinical step", async () => {
        saveDesignWorkflowSession(DESIGN_ID, {
            step: "corrections",
            completedSteps: ["scan", "setup", "base"],
            footSideExplicitlyChosen: true,
            designStartPath: null,
        });
        useClientStore.setState({
            clients: [clientRow()],
            designs: [
                {
                    ...designRow(DESIGN_ID, "insole", "Insole 1"),
                    state: createDesignWithStockPlaceholder(),
                },
            ],
            directoryStatus: "idle",
        });
        await renderDesign();
        expect(useClinicalWorkflowStore.getState().step).toBe("corrections");
        expect(useClinicalWorkflowStore.getState().completedSteps).toEqual([
            "scan",
            "setup",
            "base",
        ]);
    });

    test("after the directory is loaded, an unknown design shows the session message without another fetch", async () => {
        useClientStore.getState().replaceDirectory(
            [clientRow()],
            [
                {
                    ...designRow(OTHER_DESIGN_ID, "insole", "Other"),
                    state: createDesignWithStockPlaceholder(),
                },
            ],
        );
        listQuery.mockClear();
        await renderDesign();
        expect(listQuery).not.toHaveBeenCalled();
        expect(designGet).not.toHaveBeenCalled();
        expect(container.textContent).toContain(SESSION_MESSAGE);
        expect(container.textContent).not.toContain("Loading…");
    });
});
