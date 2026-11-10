// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAuthStore } from "@/stores/auth-store";
import { useProductionStore } from "@/stores/production-store";
import type { PrinterRecord, PrinterState } from "../../../shared/production-jobs";
import { printerStateLabel } from "../../../shared/production-jobs";
import { ProductionPage } from "./ProductionPage";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

rs.mock("./production-actions", () => {
    const noop = async () => undefined;
    return {
        loadProduction: noop,
        loadProductionShops: async () => [],
        holdProductionJob: noop,
        cancelProductionJob: noop,
        retryProductionJob: noop,
        markProductionJobDone: noop,
        assignProductionJob: noop,
        rerunProductionJob: noop,
        saveMoonrakerProductionPrinter: noop,
        createBridgeEnrollment: noop,
        revokeBridgeEnrollment: noop,
        approveBridgePairing: noop,
        listBridgeDiscovery: async () => ({ candidates: [], lastTest: null }),
        requestPrinterConnectionTest: noop,
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

function printer(name: string, state: PrinterState, lastSeenAt: string | null): PrinterRecord {
    return {
        id: crypto.randomUUID(),
        name,
        state,
        tenantId: null,
        ownerId: "user-1",
        adapterMode: "configured",
        protocolId: "moonraker",
        endpointConfigured: true,
        credentialRef: null,
        cancellation: "unsupported",
        liveVerified: false,
        protocolVerified: false,
        lastSeenAt,
        bridgeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
}

describe("printer state badges", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    beforeEach(() => {
        globalThis.fetch = async () =>
            new Response(
                JSON.stringify({
                    assets: [{ name: "OrthoCAD-Print-Bridge-Setup.exe" }],
                }),
                { status: 200 },
            );
        useAuthStore.setState({
            user: {
                id: "u1",
                email: "clinician@example.com",
                fullName: "Operator",
                role: "clinician",
                tokenBalance: 0,
            },
            license: null,
            loading: false,
        });
        useProductionStore.setState({
            jobs: [],
            printers: [
                printer("Up", "idle", null),
                printer("Busy", "running", "2020-01-01T00:00:00.000Z"),
                printer("Held", "paused", "2020-01-01T00:00:00.000Z"),
                printer("Fault", "error", "2020-01-01T00:00:00.000Z"),
                printer("Down", "offline", "2026-11-10T04:11:00.000Z"),
            ],
            gcode: {},
        });
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        root = null;
        container.remove();
        useAuthStore.setState({ user: null, license: null, loading: true });
    });

    test("shows Online, Printing, or Offline from persisted state, not lastSeenAt", async () => {
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(ProductionPage, { tab: "printers" }));
        });
        const cards = [...container.querySelectorAll('[data-testid="printer-card"]')];
        const badge = (name: string) => {
            const card = cards.find((item) => item.querySelector("h2")?.textContent === name);
            const node = card?.querySelector('[data-testid="printer-state"]');
            return {
                text: node?.textContent?.trim() ?? "",
                state: node?.getAttribute("data-state"),
            };
        };
        expect(badge("Up")).toEqual({ text: printerStateLabel("idle"), state: "idle" });
        expect(badge("Busy")).toEqual({ text: printerStateLabel("running"), state: "running" });
        expect(badge("Held")).toEqual({ text: "Paused", state: "paused" });
        expect(badge("Fault")).toEqual({ text: "Error", state: "error" });
        expect(badge("Down")).toEqual({ text: "Offline", state: "offline" });
        expect(badge("Up").text).toBe("Online");
        expect(badge("Busy").text).toBe("Printing");
        expect(badge("Down").text).toBe("Offline");
    });
});
