// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAuthStore } from "@/stores/auth-store";
import { useProductionStore } from "@/stores/production-store";
import type { UserProfile } from "@/types";
import { ProductionPage } from "./ProductionPage";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SECRET_PROOF = "proof-must-not-render";
const SECRET_CREDENTIAL = "credential-must-not-render";

rs.mock("./production-actions", () => {
    const noop = async () => undefined;
    return {
        loadProduction: noop,
        loadProductionShops: async () => [],
        listEnrolledBridges: async () => ({ bridges: [] }),
        holdProductionJob: noop,
        cancelProductionJob: noop,
        retryProductionJob: noop,
        markProductionJobDone: noop,
        assignProductionJob: noop,
        rerunProductionJob: noop,
        saveMoonrakerProductionPrinter: noop,
        createBridgeEnrollment: async () => ({
            proof: SECRET_PROOF,
            bridgeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            expiresAt: "2026-11-10T12:10:00.000Z",
        }),
        revokeBridgeEnrollment: noop,
        approveBridgePairing: noop,
        listBridgeDiscovery: async () => ({
            candidates: [
                {
                    bridgeId: "5598afcd-1111-4111-8111-111111111111",
                    host: "192.168.1.20",
                    port: 7125,
                    address: "http://192.168.1.20:7125",
                    source: "scan" as const,
                    info: {
                        hostname: "bay-1",
                        moonrakerVersion: "v0.8.0",
                        klippyState: "ready",
                        apiVersion: "1.4.0",
                    },
                },
            ],
            lastTest: null,
        }),
        requestPrinterConnectionTest: async () => ({
            pending: true as const,
            address: "http://192.168.1.20:7125",
            method: "GET" as const,
            path: "/server/info" as const,
            proof: SECRET_PROOF,
            credential: SECRET_CREDENTIAL,
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

function user(role: UserProfile["role"]): void {
    useAuthStore.setState({
        user: { id: "u1", email: `${role}@example.com`, fullName: "Operator", role, tokenBalance: 0 },
        license: null,
        loading: false,
    });
}

describe("printer setup screens", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    beforeEach(() => {
        globalThis.fetch = async () =>
            new Response(
                JSON.stringify({
                    assets: [
                        { name: "OrthoCAD-Print-Bridge-Setup.exe" },
                        { name: "OrthoCAD-Print-Bridge.pkg" },
                        { name: "OrthoCAD-Print-Bridge.dmg" },
                    ],
                }),
                { status: 200 },
            );
        useProductionStore.setState({ jobs: [], printers: [] });
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        root = null;
        container.remove();
        useAuthStore.setState({ user: null, license: null, loading: true });
    });

    async function render() {
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(ProductionPage, { tab: "printers" }));
        });
    }

    test("macOS is offered first, with Windows as the other download", async () => {
        Object.defineProperty(navigator, "userAgent", {
            configurable: true,
            value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        });
        Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
        user("admin");
        await render();
        expect(container.querySelector('[data-testid="installer-primary"]')?.textContent).toContain(
            "Download for Mac",
        );
        expect(container.querySelector('[data-testid="installer-alternate"]')?.textContent).toContain(
            "Download for Windows instead",
        );
        expect(container.textContent).toContain("There is nothing to type");
        expect(container.querySelector('[data-testid="bridge-setup-guide"]')?.textContent).toContain(
            "Online means the bridge has checked in",
        );
        expect(container.textContent).not.toContain("npx tsx");
        expect(container.textContent).not.toContain("PowerShell");
        expect(container.textContent).not.toContain(SECRET_PROOF);
    });

    test("a discovered printer can be used and the connection test stays read-only", async () => {
        Object.defineProperty(navigator, "userAgent", {
            configurable: true,
            value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        });
        Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
        user("clinician");
        await render();
        const discovered = container.querySelector('[data-testid="discovered-printer"]');
        expect(discovered?.textContent).toContain("192.168.1.20");
        expect(discovered?.textContent).toContain("ready");
        expect(discovered?.textContent).toContain("v0.8.0");
        const use = [...(discovered?.querySelectorAll("button") ?? [])].find((button) =>
            button.textContent?.includes("Use this address"),
        ) as HTMLButtonElement;
        await act(async () => use.click());
        expect((container.querySelector('[aria-label="Printer address"]') as HTMLInputElement).value).toBe(
            "http://192.168.1.20:7125",
        );
        const testConnection = [...(discovered?.querySelectorAll("button") ?? [])].find((button) =>
            button.textContent?.includes("Test connection"),
        ) as HTMLButtonElement;
        await act(async () => testConnection.click());
        expect(container.textContent).toContain("Read-only info check requested");
        expect(container.textContent).toContain("No print will be started");
        expect(container.textContent).not.toContain(SECRET_PROOF);
        expect(container.textContent).not.toContain(SECRET_CREDENTIAL);
        expect(container.querySelector('[data-testid="create-bridge-enrollment"]')).toBeNull();
        expect(container.querySelector('[aria-label="Bridge id"]')).toBeTruthy();
    });

    test("an unpublished release shows a notice instead of a download that would 404", async () => {
        globalThis.fetch = async () => new Response("missing", { status: 404 });
        Object.defineProperty(navigator, "userAgent", {
            configurable: true,
            value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        });
        Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
        user("clinician");
        await render();
        expect(container.querySelector('[data-testid="installer-unpublished"]')?.textContent).toContain(
            "not published yet",
        );
        expect(container.querySelector('[data-testid="installer-primary"]')).toBeNull();
        expect(container.textContent).not.toContain("npx tsx");
    });
});
