// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAuthStore } from "@/stores/auth-store";
import { useProductionStore } from "@/stores/production-store";
import type { UserProfile } from "@/types";
import type { PrinterRecord, ProductionJob } from "../../../shared/production-jobs";
import { ProductionPage } from "./ProductionPage";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const enrollmentSpy = rs.fn(async (bridgeName: string) => ({
    proof: `proof-shown-once-${bridgeName}`,
    bridgeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    expiresAt: "2026-11-09T20:10:00.000Z",
}));

rs.mock("./production-actions", () => {
    const noop = async () => undefined;
    return {
        loadProduction: noop,
        holdProductionJob: noop,
        cancelProductionJob: noop,
        retryProductionJob: noop,
        markProductionJobDone: noop,
        assignProductionJob: noop,
        rerunProductionJob: noop,
        saveMoonrakerProductionPrinter: noop,
        createBridgeEnrollment: (bridgeName: string) => enrollmentSpy(bridgeName),
        revokeBridgeEnrollment: noop,
        registerConfiguredProductionPrinter: noop,
        dispatchProductionJob: noop,
        reconcileProductionPrinter: noop,
        refreshProductionReadiness: noop,
        registerMockProductionPrinter: noop,
        cancelDispatchedProductionJob: noop,
        downloadProductionGcode: noop,
        enqueueCurrentDesignPrintFarm: async () => false,
    };
});

const printer: PrinterRecord = {
    id: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
    name: "Bay 1",
    state: "idle",
    tenantId: null,
    ownerId: "user-1",
    adapterMode: "mock-only",
    protocolId: null,
    endpointConfigured: false,
    credentialRef: null,
    cancellation: "unsupported",
    liveVerified: false,
    protocolVerified: false,
    lastSeenAt: null,
};

function job(status: ProductionJob["status"], designName: string): ProductionJob {
    return {
        id:
            status === "done"
                ? "jjjjjjjj-jjjj-4jjj-8jjj-jjjjjjjjjjj2"
                : "jjjjjjjj-jjjj-4jjj-8jjj-jjjjjjjjjjj1",
        designId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        designName,
        designKind: "insole",
        clientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        clientLabel: "JD",
        ownerId: "user-1",
        tenantId: null,
        process: "print",
        status,
        orderNumber: null,
        orderUrl: null,
        orderOpen: false,
        printerId: null,
        printerName: null,
        dueAt: null,
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-02T00:00:00.000Z",
        startedAt: null,
        finishedAt: status === "done" ? "2026-11-02T00:00:00.000Z" : null,
        durationMs: null,
        operatorName: null,
        failureReason: null,
        progress: null,
        gcodeSha256: null,
        gcodeStoredAt: null,
        dispatchState: "none",
        controllerJobId: null,
        dispatchAttempt: 0,
        idempotencyKey: null,
        dispatchError: null,
    };
}

function user(role: UserProfile["role"] | null): void {
    useAuthStore.setState({
        user: role
            ? {
                  id: "u1",
                  email: `${role}@example.com`,
                  fullName: "Operator",
                  role,
                  tokenBalance: 0,
              }
            : null,
        license: null,
        loading: false,
    });
}

function setInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonLabels(root: ParentNode | null): string[] {
    return [...(root?.querySelectorAll("button") ?? [])].map((button) =>
        (button.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
}

function headings(root: ParentNode | null): string[] {
    return [...(root?.querySelectorAll("h2") ?? [])].map((heading) =>
        (heading.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
}

describe("production printers enrollment", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;
    const written: string[] = [];

    beforeEach(() => {
        enrollmentSpy.mockClear();
        written.length = 0;
        localStorage.clear();
        sessionStorage.clear();
        useProductionStore.setState({
            jobs: [job("waiting", "Left shell"), job("done", "Right shell")],
            printers: [printer],
        });
        container = document.createElement("div");
        document.body.appendChild(container);
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                writeText: async (value: string) => {
                    written.push(value);
                },
            },
        });
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        root = null;
        container.remove();
        useAuthStore.setState({ user: null, license: null, loading: true });
    });

    async function render(tab: "queue" | "printers" | "history") {
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(ProductionPage, { tab }));
        });
    }

    test("queue, history, and the existing printer forms stay in place for a non-admin", async () => {
        user("clinician");
        await render("queue");
        const queue = container.querySelector('[data-testid="production-queue"]');
        expect(queue?.textContent).toContain("Left shell");
        expect(queue?.querySelector('[aria-label="Search jobs"]')).toBeTruthy();
        expect(queue?.textContent ?? "").not.toContain("No jobs in the queue.");
        expect(buttonLabels(queue)).toEqual([
            "Due date ↑",
            "Open design",
            "Assign to printer",
            "Hold",
            "Cancel",
            "Open design",
            "Assign to printer",
            "Hold",
            "Cancel",
        ]);
        expect(queue?.textContent).not.toContain("Create bridge enrollment");

        await act(async () => root?.unmount());
        await render("history");
        const history = container.querySelector('[data-testid="production-history"]');
        expect(history?.textContent).toContain("Right shell");
        expect(history?.textContent ?? "").not.toContain("No completed jobs.");
        expect(buttonLabels(history)).toEqual(["Re-run"]);
        expect(history?.textContent).not.toContain("Create bridge enrollment");

        await act(async () => root?.unmount());
        await render("printers");
        const printers = container.querySelector('[data-testid="production-printers"]');
        expect(headings(printers)).toEqual(["Register mock printer", "Configure Moonraker printer", "Bay 1"]);
        expect(buttonLabels(printers)).toEqual([
            "Register",
            "Save configuration",
            "Check readiness",
            "Reconcile status",
        ]);
        expect(printers?.querySelector('[aria-label="Bridge id"]')).toBeTruthy();
        expect(printers?.querySelector('[aria-label="Moonraker URL"]')).toBeTruthy();
        expect(printers?.querySelector('[data-testid="create-bridge-enrollment"]')).toBeNull();
        expect(printers?.textContent).toContain("Mock only. Not a live printer.");
        expect(enrollmentSpy).not.toHaveBeenCalled();
    });

    test("an admin sees the enrollment once, and a signed-out viewer does not", async () => {
        user(null);
        await render("printers");
        expect(container.querySelector('[data-testid="create-bridge-enrollment"]')).toBeNull();

        await act(async () => root?.unmount());
        user("admin");
        await render("printers");
        const printers = container.querySelector('[data-testid="production-printers"]');
        expect(headings(printers)).toEqual([
            "Register mock printer",
            "Configure Moonraker printer",
            "Create bridge enrollment",
            "Bay 1",
        ]);
        expect(buttonLabels(printers)).toEqual([
            "Register",
            "Save configuration",
            "Create bridge enrollment",
            "Check readiness",
            "Reconcile status",
        ]);
        const name = printers?.querySelector('[aria-label="Bridge name"]') as HTMLInputElement;
        const create = [...(printers?.querySelectorAll("button") ?? [])].find(
            (button) => button.textContent === "Create bridge enrollment",
        ) as HTMLButtonElement;
        expect(create.disabled).toBe(true);
        await act(async () => setInputValue(name, "Bay press"));
        expect(create.disabled).toBe(false);
        await act(async () => {
            create.click();
        });
        const shown = container.querySelector('[data-testid="bridge-enrollment-proof"]');
        expect(shown?.textContent).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        expect(shown?.textContent).toContain("proof-shown-once-Bay press");
        expect(shown?.textContent).toContain("expires in 10 minutes");
        expect((printers?.querySelector('[aria-label="Bridge id"]') as HTMLInputElement).value).toBe("");
        expect(JSON.stringify(localStorage)).not.toContain("proof-shown-once");
        expect(JSON.stringify(sessionStorage)).not.toContain("proof-shown-once");
        expect(JSON.stringify(useProductionStore.getState().jobs)).not.toContain("proof-shown-once");
        await act(async () => {
            (container.querySelector('[data-testid="copy-bridge-proof"]') as HTMLButtonElement).click();
        });
        expect(written.join("\n")).toContain("proof-shown-once-Bay press");
        expect(written.join("\n")).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

        await act(async () => root?.unmount());
        await render("printers");
        expect(container.querySelector('[data-testid="bridge-enrollment-proof"]')).toBeNull();
        expect(container.textContent).not.toContain("proof-shown-once-Bay press");
    });

    test("a super admin sees the same control", async () => {
        user("super_admin");
        await render("printers");
        expect(container.querySelector('[data-testid="create-bridge-enrollment"]')).toBeTruthy();
        expect(container.querySelector('[aria-label="Bridge id"]')).toBeTruthy();
        expect(container.querySelector('[aria-label="Moonraker URL"]')).toBeTruthy();
    });
});
