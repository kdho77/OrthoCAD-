// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAuthStore } from "@/stores/auth-store";
import { resetClientDirectoryLoad, useClientStore } from "@/stores/client-store";
import type { UserProfile } from "@/types";
import { type ClientRow, type DesignRow, defaultShoeChart } from "../../../shared/client-files";
import { ClientFilePage } from "./ClientFilePage";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DESIGN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION_MESSAGE = "This client file is not in the current session.";

const listQuery = rs.fn();

rs.mock("@/lib/trpc", () => ({
    isApiConfigured: () => true,
    trpc: {
        client: {
            list: { query: (...args: unknown[]) => listQuery(...args) },
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

function designRow(name = "Insole 1"): DesignRow {
    return {
        id: DESIGN_ID,
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
    };
}

function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

describe("client file deep link", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    beforeEach(() => {
        listQuery.mockReset();
        resetClientDirectoryLoad();
        useAuthStore.setState({ user: clinician, license: null, loading: false });
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

    async function renderPage(clientId = CLIENT_ID) {
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(ClientFilePage, { clientId }));
        });
    }

    test("empty store then list load opens the client instead of the session message", async () => {
        const pending = deferred<{ client: ClientRow; designs: DesignRow[] }[]>();
        listQuery.mockReturnValue(pending.promise);
        await renderPage();
        expect(container.textContent).toContain("Loading…");
        expect(container.textContent).not.toContain(SESSION_MESSAGE);
        expect(container.querySelector('[data-testid="client-file"]')).toBeNull();

        await act(async () => {
            pending.resolve([{ client: clientRow(), designs: [designRow()] }]);
            await pending.promise;
        });

        expect(listQuery).toHaveBeenCalledTimes(1);
        expect(container.textContent).not.toContain(SESSION_MESSAGE);
        expect(container.textContent).not.toContain("Loading…");
        expect(container.querySelector('[data-testid="client-file"]')).not.toBeNull();
        expect(container.textContent).toContain("Jane Doe");
        expect(container.textContent).toContain("Insole 1");
    });

    test("a missing id shows the session message only after the list settles", async () => {
        const pending = deferred<{ client: ClientRow; designs: DesignRow[] }[]>();
        listQuery.mockReturnValue(pending.promise);
        await renderPage();
        expect(container.textContent).not.toContain(SESSION_MESSAGE);

        await act(async () => {
            pending.resolve([{ client: clientRow(OTHER_ID, "Someone Else"), designs: [] }]);
            await pending.promise;
        });

        expect(container.textContent).toContain(SESSION_MESSAGE);
        expect(container.textContent).toContain("Back to clients");
        expect(container.textContent).not.toContain("Someone Else");
        expect(container.querySelector('[data-testid="client-file"]')).toBeNull();
    });

    test("an id that is already in the store does not fetch and keeps the file page", async () => {
        useClientStore.setState({
            clients: [clientRow()],
            designs: [],
            directoryStatus: "idle",
        });
        await renderPage();
        expect(listQuery).not.toHaveBeenCalled();
        expect(container.textContent).not.toContain("Loading…");
        expect(container.textContent).not.toContain(SESSION_MESSAGE);
        expect(container.querySelector('[data-testid="client-file"]')).not.toBeNull();
        expect(container.textContent).toContain("Jane Doe");
        expect(container.textContent).toContain("No designs yet");
        expect(container.textContent).toContain("Edit");
    });

    test("after the directory is loaded, an unknown id shows the session message without another fetch", async () => {
        useClientStore.getState().replaceDirectory([clientRow(OTHER_ID, "Someone Else")], []);
        listQuery.mockClear();
        await renderPage();
        expect(listQuery).not.toHaveBeenCalled();
        expect(container.textContent).toContain(SESSION_MESSAGE);
        expect(container.textContent).toContain("Back to clients");
        expect(container.textContent).not.toContain("Loading…");
    });

    test("waits for auth before fetching, then opens the client", async () => {
        useAuthStore.setState({ user: null, license: null, loading: true });
        const pending = deferred<{ client: ClientRow; designs: DesignRow[] }[]>();
        listQuery.mockReturnValue(pending.promise);
        await renderPage();
        expect(container.textContent).toContain("Loading…");
        expect(container.textContent).not.toContain(SESSION_MESSAGE);
        expect(listQuery).not.toHaveBeenCalled();

        await act(async () => {
            useAuthStore.setState({ user: clinician, license: null, loading: false });
        });
        expect(listQuery).toHaveBeenCalledTimes(1);
        expect(container.textContent).not.toContain(SESSION_MESSAGE);

        await act(async () => {
            pending.resolve([{ client: clientRow(), designs: [] }]);
            await pending.promise;
        });
        expect(container.querySelector('[data-testid="client-file"]')).not.toBeNull();
        expect(container.textContent).toContain("Jane Doe");
    });
});
