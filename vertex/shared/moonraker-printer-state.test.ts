// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { printerStateFromMoonraker } from "./moonraker-client";
import { type PrinterState, printerStateLabel } from "./production-jobs";

describe("Moonraker presence mapping", () => {
    test("maps print_stats and webhooks onto PrinterState", () => {
        const state = (webhooksState: string, printState: string) =>
            printerStateFromMoonraker({ webhooksState, printState });

        expect(state("ready", "standby")).toBe("idle");
        expect(state("ready", "complete")).toBe("idle");
        expect(state("ready", "cancelled")).toBe("idle");
        expect(state("ready", "canceled")).toBe("idle");
        expect(state("READY", "STANDBY")).toBe("idle");
        expect(state("startup", "standby")).toBe("idle");
        expect(state("ready", "")).toBe("idle");

        expect(state("ready", "printing")).toBe("running");
        expect(state("startup", "printing")).toBe("running");
        expect(state("ready", "paused")).toBe("paused");

        expect(state("ready", "error")).toBe("error");
        expect(state("error", "standby")).toBe("error");
        expect(state("error", "printing")).toBe("error");

        expect(state("shutdown", "printing")).toBe("offline");
        expect(state("shutdown", "standby")).toBe("offline");
        expect(state("disconnected", "paused")).toBe("offline");
        expect(state("ready", "unknown")).toBe("offline");
        expect(state("", "standby")).toBe("offline");
    });

    test("labels persisted printer state as online, printing, or offline", () => {
        const labels: Record<PrinterState, string> = {
            idle: "Online",
            running: "Printing",
            paused: "Paused",
            error: "Error",
            offline: "Offline",
        };
        for (const [state, label] of Object.entries(labels) as [PrinterState, string][]) {
            expect(printerStateLabel(state)).toBe(label);
        }
    });
});
