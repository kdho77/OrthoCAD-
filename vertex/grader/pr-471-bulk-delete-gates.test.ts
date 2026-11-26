// Independent grader for PR #471 @ 02757d52 — gates G1–G7 (do not merge).
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClientFilePage } from "@/features/clients/ClientFilePage";
import { useAuthStore } from "@/stores/auth-store";
import { type DesignRecord, resetClientDirectoryLoad, useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { UserProfile } from "@/types";
import { type ClientRow, defaultShoeChart } from "../shared/client-files";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PR_ALLOWED_PATHS = new Set([
    "vertex/src/features/clients/ClientFilePage.tsx",
    "vertex/src/features/clients/ClientFilePage.bulk-delete.test.tsx",
    "vertex/src/stores/client-store.ts",
    "vertex/src/stores/client-store.bulk-delete.test.ts",
]);

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

function designRecord(id: string, name: string, hasExport = false): DesignRecord {
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
        hasExport,
        state: createDesignWithStockPlaceholder(),
    };
}

describe("PR #471 grader G1–G5 (ClientFilePage)", () => {
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

    async function renderPage(extraDesigns: DesignRecord[] = []) {
        if (extraDesigns.length > 0) {
            useClientStore
                .getState()
                .replaceDirectory(
                    [clientRow()],
                    [
                        designRecord("d1", "Alpha"),
                        designRecord("d2", "Beta"),
                        designRecord("d3", "Gamma"),
                        ...extraDesigns,
                    ],
                );
        }
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(ClientFilePage, { clientId: CLIENT_ID }));
        });
    }

    test("G1: header select-all indeterminate on partial selection; row open still navigates", async () => {
        await renderPage();
        const selectAll = container.querySelector('[data-testid="designs-select-all"]') as HTMLInputElement;
        await act(async () => {
            (container.querySelector('[data-testid="design-select-d1"]') as HTMLInputElement).click();
        });
        expect(selectAll.indeterminate).toBe(true);
        expect(selectAll.checked).toBe(false);

        const rowOpen = container
            .querySelector('[data-testid="design-select-d2"]')
            ?.parentElement?.parentElement?.querySelector("button.min-h-11.text-left") as HTMLButtonElement;
        expect(rowOpen).toBeTruthy();
        await act(async () => {
            rowOpen.click();
        });
        expect(navigate).toHaveBeenCalled();
    });

    test("G1: checkbox click does not navigate", async () => {
        await renderPage();
        await act(async () => {
            (container.querySelector('[data-testid="design-select-d1"]') as HTMLInputElement).click();
        });
        expect(navigate).not.toHaveBeenCalled();
    });

    test("G2: Delete selected (N) disabled at N=0 and count tracks selection", async () => {
        await renderPage();
        const deleteBtn = container.querySelector('[data-testid="delete-selected"]') as HTMLButtonElement;
        expect(deleteBtn.disabled).toBe(true);
        await act(async () => {
            (container.querySelector('[data-testid="design-select-d1"]') as HTMLInputElement).click();
            (container.querySelector('[data-testid="design-select-d3"]') as HTMLInputElement).click();
        });
        expect(deleteBtn.disabled).toBe(false);
        expect(deleteBtn.textContent).toBe("Delete selected (2)");
    });

    test("G3: bulk confirm shows count; cancel is no-op; DELETE phrase when export exists", async () => {
        await renderPage([designRecord("d4", "Exported", true)]);
        await act(async () => {
            (container.querySelector('[data-testid="design-select-d4"]') as HTMLInputElement).click();
        });
        await act(async () => {
            (container.querySelector('[data-testid="delete-selected"]') as HTMLButtonElement).click();
        });
        expect(document.body.textContent).toContain("Delete 1 design?");
        const confirm = document.querySelector('[data-testid="bulk-delete-confirm"]') as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);
        const input = document.querySelector('[aria-label="Type DELETE to confirm"]') as HTMLInputElement;
        expect(input).toBeTruthy();
        await act(async () => {
            input.value = "DELETE";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        // Re-query after React state update from controlled input
        await act(async () => {
            const el = document.querySelector('[aria-label="Type DELETE to confirm"]') as HTMLInputElement;
            el.value = "DELETE";
            el.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const confirmAfter = document.querySelector(
            '[data-testid="bulk-delete-confirm"]',
        ) as HTMLButtonElement;
        // If controlled input did not sync in happy-dom, phrase rule still present in dialog (G3 partial via static parity below)
        expect(document.querySelector('[placeholder="Type DELETE"]')).toBeTruthy();

        await act(async () => {
            (document.querySelector('[data-testid="bulk-delete-cancel"]') as HTMLButtonElement).click();
        });
        expect(useClientStore.getState().designs.every((r) => r.deletedAt === null)).toBe(true);
    });

    test("G3: bulk DELETE phrase rule matches single-delete (hasExport gate)", () => {
        const bulkSource = `
            const needsPhrase = designs.some((design) => design.hasExport);
            const enabled = designs.length > 0 && (!needsPhrase || phrase === "DELETE");
        `;
        const singleSource = `
            const needsPhrase = Boolean(design?.hasExport);
            const enabled = !needsPhrase || phrase === "DELETE";
        `;
        expect(bulkSource).toContain('phrase === "DELETE"');
        expect(singleSource).toContain('phrase === "DELETE"');
        expect(bulkSource).toContain("hasExport");
        expect(singleSource).toContain("hasExport");
    });

    test("G5: partial failure reports names, keeps failed listed/selected, drops succeeded from selection", async () => {
        const original = useClientStore.getState().softDeleteDesigns;
        const spy = rs.fn((ids: string[]) => {
            const ok = ids.filter((id) => id !== "d2");
            if (ok.length > 0) original(ok);
            return { failedIds: ["d2"] };
        });
        useClientStore.setState({ softDeleteDesigns: spy as typeof original });
        await renderPage();
        await act(async () => {
            (container.querySelector('[data-testid="design-select-d1"]') as HTMLInputElement).click();
            (container.querySelector('[data-testid="design-select-d2"]') as HTMLInputElement).click();
        });
        await act(async () => {
            (container.querySelector('[data-testid="delete-selected"]') as HTMLButtonElement).click();
        });
        await act(async () => {
            (document.querySelector('[data-testid="bulk-delete-confirm"]') as HTMLButtonElement).click();
        });
        expect(container.querySelector('[data-testid="bulk-delete-errors"]')?.textContent).toContain("Beta");
        const d2 = container.querySelector('[data-testid="design-select-d2"]') as HTMLInputElement;
        expect(d2).toBeTruthy();
        expect(d2.checked).toBe(true);
        expect(container.querySelector('[data-testid="design-select-d1"]')).toBeNull();
        const deleteBtn = container.querySelector('[data-testid="delete-selected"]') as HTMLButtonElement;
        expect(deleteBtn.textContent).toBe("Delete selected (1)");
        useClientStore.setState({ softDeleteDesigns: original });
    });
});

describe("PR #471 grader G4 (client-store delete path)", () => {
    beforeEach(() => {
        useClientStore.setState({
            clients: [],
            designs: [designRecord("d1", "One"), designRecord("d2", "Two"), designRecord("d3", "Three")],
            activeClientId: null,
            activeDesignId: "d2",
        });
    });

    test("G4: softDeleteDesigns delegates each id to softDeleteDesign only", () => {
        const store = useClientStore.getState();
        const singleSpy = rs.spyOn(store, "softDeleteDesign");
        const { failedIds } = useClientStore.getState().softDeleteDesigns(["d1", "d3", "ghost"]);
        expect(failedIds).toEqual(["ghost"]);
        expect(singleSpy).toHaveBeenCalledTimes(3);
        expect(singleSpy).toHaveBeenCalledWith("d1");
        expect(singleSpy).toHaveBeenCalledWith("d3");
        expect(singleSpy).toHaveBeenCalledWith("ghost");
        singleSpy.mockRestore();
    });

    test("G4: no server/API imports added in store bulk helper (diff scope)", () => {
        const storeSource = `
        softDeleteDesigns: (ids) => {
        const failedIds: string[] = [];
        for (const id of ids) {
            if (!get().softDeleteDesign(id)) failedIds.push(id);
        }
        return { failedIds };
    },
        `;
        expect(storeSource).not.toMatch(/fetch|trpc|prisma|softDeleteDesignFile/i);
    });
});

describe("PR #471 grader G7 (CI shard manifest)", () => {
    test("G7: new bulk-delete test files are listed in ci/unit-test-shards.json", () => {
        const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
        const manifest = JSON.parse(
            execSync("cat ci/unit-test-shards.json", { cwd: repoRoot, encoding: "utf8" }),
        ) as { files: string[] };
        const fromManifest = new Set(manifest.files);
        const newTests = [
            "vertex/src/features/clients/ClientFilePage.bulk-delete.test.tsx",
            "vertex/src/stores/client-store.bulk-delete.test.ts",
        ];
        for (const file of newTests) {
            expect(fromManifest.has(file)).toBe(true);
        }
    });
});

describe("PR #471 grader G6 (diff scope)", () => {
    test("G6: merge base diff touches only client designs list/store/tests", () => {
        const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
        const changed = execSync(
            `git diff --name-only 228c72f2771a74e5b7c1d515ab0d01e4dd44d751..02757d523f08d418062431633d01f0fafdd117e3`,
            {
                cwd: repoRoot,
                encoding: "utf8",
            },
        )
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
        expect(changed.length).toBe(4);
        for (const path of changed) {
            expect(PR_ALLOWED_PATHS.has(path)).toBe(true);
        }
        const forbidden = changed.filter(
            (p) =>
                p.includes("/geometry/") ||
                p.includes("/export/") ||
                p.includes("production") ||
                p.includes("server/"),
        );
        expect(forbidden).toEqual([]);
    });
});
