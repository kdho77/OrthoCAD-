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

const SECRET_PROOF = "proof-shown-once-Bay-press";
const SECRET_CREDENTIAL = "credential-not-for-display";
const NORTH = "11111111-1111-4111-8111-111111111111";
const SOUTH = "22222222-2222-4222-8222-222222222222";

const approveSpy = rs.fn(async () => ({
    bridgeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    bridgeName: "Bay press",
    proof: SECRET_PROOF,
    credential: SECRET_CREDENTIAL,
}));
const shopsSpy = rs.fn(async (): Promise<{ id: string; name: string }[]> => []);
const saveSpy = rs.fn(async (_input?: unknown, _shop?: unknown) => undefined);

rs.mock("./production-actions", () => {
    const noop = async () => undefined;
    return {
        loadProduction: noop,
        loadProductionShops: () => shopsSpy(),
        holdProductionJob: noop,
        cancelProductionJob: noop,
        retryProductionJob: noop,
        markProductionJobDone: noop,
        assignProductionJob: noop,
        rerunProductionJob: noop,
        saveMoonrakerProductionPrinter: (input: unknown, shop?: unknown) => saveSpy(input, shop),
        createBridgeEnrollment: async () => ({
            bridgeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            proof: SECRET_PROOF,
            expiresAt: "2026-11-10T12:10:00.000Z",
        }),
        revokeBridgeEnrollment: noop,
        listEnrolledBridges: async () => ({
            bridges: [{ id: "5598afcd-1111-4111-8111-111111111111", name: "Existing press" }],
        }),
        approveBridgePairing: (input: unknown) => approveSpy(input),
        listBridgeDiscovery: async () => ({ candidates: [], lastTest: null }),
        requestPrinterConnectionTest: async () => ({
            pending: true as const,
            address: "http://192.168.1.20:7125",
            method: "GET" as const,
            path: "/server/info" as const,
        }),
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

function setSelectValue(select: HTMLSelectElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    descriptor?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
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
        approveSpy.mockClear();
        saveSpy.mockClear();
        shopsSpy.mockReset();
        shopsSpy.mockResolvedValue([]);
        written.length = 0;
        Object.defineProperty(navigator, "userAgent", {
            configurable: true,
            value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        });
        Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
        localStorage.clear();
        sessionStorage.clear();
        globalThis.fetch = async (input) => {
            const url = String(input);
            if (url.includes("releases/latest")) {
                return new Response(
                    JSON.stringify({
                        assets: [
                            { name: "OrthoCAD-Print-Bridge-Setup.exe" },
                            { name: "OrthoCAD-Print-Bridge.pkg" },
                            { name: "OrthoCAD-Print-Bridge.dmg" },
                        ],
                    }),
                    { status: 200 },
                );
            }
            return new Response("", { status: 404 });
        };
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
        expect(headings(printers)).toEqual([
            "Install the print bridge",
            "How setup works",
            "Add a printer",
            "Register mock printer",
            "Configure Moonraker printer",
            "Bay 1",
        ]);
        expect(buttonLabels(printers)).toEqual([
            "Test connection",
            "Register",
            "Save configuration",
            "Check readiness",
            "Reconcile status",
        ]);
        expect(printers?.querySelector('[data-testid="installer-primary"]')?.textContent).toContain(
            "Download for Windows",
        );
        expect(printers?.querySelector('[data-testid="installer-alternate"]')?.textContent).toContain(
            "Download for Mac instead",
        );
        expect(printers?.querySelector('[data-testid="bridge-setup-guide"]')?.textContent).toContain(
            "Online means the bridge has checked in",
        );
        expect(printers?.querySelector('[aria-label="Bridge id"]')).toBeTruthy();
        expect(printers?.querySelector('[aria-label="Printer address"]')).toBeTruthy();
        expect(printers?.querySelector('[aria-label="Moonraker URL"]')).toBeTruthy();
        expect(printers?.querySelector('[data-testid="create-bridge-enrollment"]')).toBeNull();
        expect(printers?.querySelector('[data-testid="production-shop-picker"]')).toBeNull();
        expect(printers?.textContent).toContain("Mock only. Not a live printer.");
        expect(printers?.textContent).not.toContain(SECRET_PROOF);
        expect(approveSpy).not.toHaveBeenCalled();
    });

    test("an admin sees the enrollment once, and a signed-out viewer does not", async () => {
        user(null);
        await render("printers");
        expect(container.querySelector('[data-testid="create-bridge-enrollment"]')).toBeNull();

        await act(async () => root?.unmount());
        user("admin");
        await render("printers");
        const printers = container.querySelector('[data-testid="production-printers"]');
        expect(printers?.querySelector('[data-testid="production-shop-picker"]')).toBeNull();
        expect(printers?.querySelector('[aria-label="Shop"]')).toBeNull();
        expect(headings(printers)).toEqual([
            "Install the print bridge",
            "How setup works",
            "Approve a print bridge",
            "Add a printer",
            "Register mock printer",
            "Configure Moonraker printer",
            "Bay 1",
        ]);
        expect(buttonLabels(printers)).toEqual([
            "Approve bridge",
            "Test connection",
            "Register",
            "Save configuration",
            "Check readiness",
            "Reconcile status",
        ]);
        const name = printers?.querySelector('[aria-label="Bridge name"]') as HTMLInputElement;
        const code = printers?.querySelector('[aria-label="Pairing code"]') as HTMLInputElement;
        const approve = [...(printers?.querySelectorAll("button") ?? [])].find(
            (button) => button.textContent === "Approve bridge",
        ) as HTMLButtonElement;
        expect(approve.disabled).toBe(true);
        await act(async () => {
            setInputValue(code, "ABCD-EFGH");
            setInputValue(name, "Bay press");
        });
        expect(approve.disabled).toBe(false);
        await act(async () => {
            approve.click();
        });
        const shown = container.querySelector('[data-testid="bridge-pairing-approved"]');
        expect(shown?.textContent).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        expect(container.textContent).not.toContain(SECRET_PROOF);
        expect(container.textContent).not.toContain(SECRET_CREDENTIAL);
        expect(container.querySelector('[data-testid="bridge-enrollment-proof"]')).toBeNull();
        expect(container.querySelector('[data-testid="copy-bridge-proof"]')).toBeNull();
        expect((printers?.querySelector('[aria-label="Bridge id"]') as HTMLInputElement).value).toBe("");
        expect(JSON.stringify(localStorage)).not.toContain(SECRET_PROOF);
        expect(JSON.stringify(sessionStorage)).not.toContain(SECRET_PROOF);
        expect(JSON.stringify(useProductionStore.getState().jobs)).not.toContain(SECRET_PROOF);
        expect(written.join("\n")).not.toContain(SECRET_PROOF);
        expect(written.join("\n")).not.toContain(SECRET_CREDENTIAL);
    });

    test("a super admin sees the same control", async () => {
        user("super_admin");
        await render("printers");
        expect(container.querySelector('[data-testid="create-bridge-enrollment"]')).toBeTruthy();
        expect(container.querySelector('[data-testid="production-shop-picker"]')).toBeTruthy();
        expect(container.querySelector('[aria-label="Shop"]')).toBeTruthy();
        expect(container.querySelector('[aria-label="Bridge id"]')).toBeTruthy();
        expect(container.querySelector('[aria-label="Moonraker URL"]')).toBeTruthy();
    });

    test("a super admin must pick a shop, and that picker stays hidden for an admin", async () => {
        shopsSpy.mockResolvedValue([
            { id: NORTH, name: "North clinic" },
            { id: SOUTH, name: "South clinic" },
        ]);
        useProductionStore.setState({
            jobs: [job("waiting", "Left shell")],
            printers: [
                printer,
                {
                    ...printer,
                    id: "qqqqqqqq-qqqq-4qqq-8qqq-qqqqqqqqqqqq",
                    name: "North press",
                    tenantId: NORTH,
                },
                {
                    ...printer,
                    id: "rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr",
                    name: "South press",
                    tenantId: SOUTH,
                },
            ],
        });

        user("admin");
        await render("printers");
        expect(container.querySelector('[data-testid="production-shop-picker"]')).toBeNull();
        expect(container.textContent).toContain("Bay 1");

        await act(async () => root?.unmount());
        user("super_admin");
        await render("printers");
        const picker = container.querySelector('[data-testid="production-shop-picker"]');
        expect(picker).toBeTruthy();
        const select = picker?.querySelector('[aria-label="Shop"]') as HTMLSelectElement;
        const optionText = [...select.options].map((option) => option.textContent);
        expect(optionText).toEqual(["Choose a shop", "North clinic", "South clinic"]);
        expect(select.value).toBe("");
        expect(container.textContent).not.toContain("North press");
        expect(container.textContent).not.toContain("South press");
        expect(container.textContent).not.toContain("Bay 1");

        const printers = container.querySelector('[data-testid="production-printers"]');
        const name = printers?.querySelector('[aria-label="Bridge name"]') as HTMLInputElement;
        const code = printers?.querySelector('[aria-label="Pairing code"]') as HTMLInputElement;
        const approve = [...(printers?.querySelectorAll("button") ?? [])].find(
            (button) => button.textContent === "Approve bridge",
        ) as HTMLButtonElement;
        const save = [...(printers?.querySelectorAll("button") ?? [])].find(
            (button) => button.textContent === "Save configuration",
        ) as HTMLButtonElement;
        await act(async () => {
            setInputValue(code, "ABCD-EFGH");
            setInputValue(name, "Bay press");
        });
        expect(approve.disabled).toBe(true);
        expect(save.disabled).toBe(true);
        await act(async () => {
            approve.click();
            save.click();
        });
        expect(approveSpy).not.toHaveBeenCalled();
        expect(saveSpy).not.toHaveBeenCalled();

        await act(async () => setSelectValue(select, NORTH));
        expect(container.textContent).toContain("North press");
        expect(container.textContent).not.toContain("South press");
        expect(container.textContent).not.toContain("Bay 1");
        expect(approve.disabled).toBe(false);
        const existing = printers?.querySelector('[aria-label="Existing bridge"]') as HTMLSelectElement;
        await act(async () => setSelectValue(existing, "5598afcd-1111-4111-8111-111111111111"));
        await act(async () => {
            approve.click();
        });
        expect(approveSpy).toHaveBeenCalledTimes(1);
        expect(approveSpy.mock.calls[0]?.[0]).toMatchObject({
            code: "ABCD-EFGH",
            bridgeName: "Bay press",
            replaceBridgeId: "5598afcd-1111-4111-8111-111111111111",
            shop: { tenantId: NORTH, shopId: NORTH },
        });
        expect(container.querySelector('[data-testid="bridge-enrollment-proof"]')).toBeNull();
        expect(container.textContent).not.toContain(SECRET_PROOF);
        expect(container.textContent).not.toContain(SECRET_CREDENTIAL);

        const configName = printers?.querySelector(
            '[aria-label="Configured printer name"]',
        ) as HTMLInputElement;
        await act(async () => setInputValue(configName, "North bay"));
        await act(async () => {
            save.click();
        });
        expect(saveSpy).toHaveBeenCalledTimes(1);
        expect(saveSpy.mock.calls[0]?.[1]).toEqual({ tenantId: NORTH, shopId: NORTH });
    });
});
