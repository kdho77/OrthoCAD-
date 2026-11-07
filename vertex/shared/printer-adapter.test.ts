import { describe, expect, test } from "@rstest/core";

import { createMockMoonrakerAdapter, REAL_PRINTER_ADAPTER_DEPENDENCY } from "./printer-adapter.js";

describe("printer adapter contract", () => {
    test("the mock adapter describes a printer without calling the network", () => {
        const calls: string[] = [];
        const original = globalThis.fetch;
        globalThis.fetch = (async (input: string | URL) => {
            calls.push(String(input));
            throw new Error("printer adapter must not fetch");
        }) as typeof fetch;
        try {
            const adapter = createMockMoonrakerAdapter();
            expect(adapter.kind).toBe("moonraker");
            expect(adapter.mode).toBe("mock-only");
            expect(adapter.liveVerified).toBe(false);
            const described = adapter.describe("Bay 1", "http://127.0.0.1:7125/");
            expect(described).toMatchObject({
                adapter: "mock-moonraker",
                mode: "mock-only",
                liveVerified: false,
                moonrakerBaseUrl: "http://127.0.0.1:7125",
                capabilities: { kinematics: "cartesian", supportsQueue: true },
            });
            expect(adapter.describe("Bay 1", "http://127.0.0.1:7125")).toEqual(described);
            expect(() => adapter.normalizeBaseUrl("ftp://printer.local")).toThrow(/http/);
            expect(calls).toEqual([]);
            expect(REAL_PRINTER_ADAPTER_DEPENDENCY.liveVerified).toBe(false);
            expect(REAL_PRINTER_ADAPTER_DEPENDENCY.protocolVerified).toBe(false);
            expect(REAL_PRINTER_ADAPTER_DEPENDENCY.inRepoImplementation).toBe("mock-only");
        } finally {
            globalThis.fetch = original;
        }
    });
});
